import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { drainStorageDeletionsBestEffort } from "@/server/modules/maintenance/storage-deletion.service";
import { AppError, conflict, forbidden, notFound } from "@/server/http/errors";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { defaultDeps, ensureEmailReady, type AuthDeps } from "@/server/modules/auth/auth.service";
import type { Actor } from "@/server/modules/authz/permissions";
import { teamInvitationEmail } from "@/server/modules/email/templates";
import { BLOCK_MESSAGE, placeFor, registrationBlock } from "@/server/modules/events/event-lifecycle";
import { confirmedSeats, lockEvent, promoteWaitlist } from "@/server/modules/events/registrations.service";
import { enforceRateLimits } from "@/server/security/rate-limit";
import { generateToken, hashToken } from "@/server/security/tokens";
import type { CreateTeamInput, UpdateTeamInput } from "./teams.schema";

type Tx = Prisma.TransactionClient;
export const INVITATION_TTL_DAYS = 7;
const DAY = 86_400_000;

const isUnique = (e: unknown, name?: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && (!name || JSON.stringify(e.meta ?? {}).includes(name));
/** The database refuses a team that is over its limit (trigger, SQLSTATE 23514). Prisma reports it as a raw-query error. */
const isTeamFull = (e: unknown) => e instanceof Error && /team is full/.test(e.message);

// ───────────────────────────── helpers ─────────────────────────────

async function loadTeamForLeader(tx: Tx, actor: Actor, teamId: string) {
  const team = await tx.team.findUnique({ where: { id: teamId }, include: { event: true, members: true } });
  if (!team) throw notFound("Team");
  const isMember = team.members.some((m) => m.userId === actor.id);
  if (!isMember) throw notFound("Team"); // non-members cannot even learn the team exists
  if (team.leaderId !== actor.id) throw forbidden();
  return team;
}

function assertTeamEvent(event: { registrationMode: string; status: string }) {
  if (event.registrationMode !== "TEAM") throw new AppError(409, "not_a_team_event", "This event is for individual participants, so it has no teams.");
}

/** Team changes (create, invite, join) are possible while the event is published, not ended, and registration has not closed. */
function assertTeamFormationOpen(event: Parameters<typeof registrationBlock>[0], now: Date) {
  const block = registrationBlock(event, now, "team");
  if (block === "NOT_PUBLISHED") throw notFound("Event");
  // Teams may form before registration opens; only "closed", "ended" and "cancelled" stop them.
  if (block && block !== "NOT_OPEN_YET") throw new AppError(409, `team_${block.toLowerCase()}`, BLOCK_MESSAGE[block]);
}

async function registeredRows(tx: Tx, teamId: string) {
  return tx.registration.count({ where: { teamId, status: { not: "CANCELLED" } } });
}

// ───────────────────────────── create / edit / read ─────────────────────────────

export async function createTeam(actor: Actor, eventId: string, input: CreateTeamInput, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) throw notFound("Event");
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    if (event.status !== "PUBLISHED") throw notFound("Event");
    assertTeamEvent(event);
    assertTeamFormationOpen(event, now);
    const already = await tx.teamMember.findUnique({ where: { eventId_userId: { eventId, userId: actor.id } } });
    if (already) throw new AppError(409, "already_in_team", "You are already in a team for this event.");
    try {
      const team = await tx.team.create({ data: { eventId, name: input.name, description: input.description ?? null, leaderId: actor.id } });
      await tx.teamMember.create({ data: { teamId: team.id, eventId, userId: actor.id, role: "LEADER" } });
      await writeAudit({ actorId: actor.id, action: "team.create", entityType: "team", entityId: team.id, after: { eventId, name: team.name } }, tx);
      return team;
    } catch (e) {
      if (isUnique(e, "name")) throw new AppError(409, "team_name_taken", "A team with this name already exists for this event.");
      throw e;
    }
  });
}

export async function updateTeam(actor: Actor, teamId: string, input: UpdateTeamInput) {
  return getDb().$transaction(async (tx) => {
    const team = await loadTeamForLeader(tx, actor, teamId);
    if (team.status !== "ACTIVE") throw conflict("A disbanded team cannot be edited.");
    try {
      const updated = await tx.team.update({
        where: { id: teamId },
        data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) },
      });
      await writeAudit({ actorId: actor.id, action: "team.update", entityType: "team", entityId: teamId, after: { fields: Object.keys(input) } }, tx);
      return updated;
    } catch (e) {
      if (isUnique(e, "name")) throw new AppError(409, "team_name_taken", "A team with this name already exists for this event.");
      throw e;
    }
  });
}

const TEAM_VIEW = {
  id: true, name: true, description: true, status: true, leaderId: true, eventId: true, createdAt: true,
  event: { select: { id: true, slug: true, title: true, status: true, minTeamSize: true, maxTeamSize: true, registrationClosesAt: true, endsAt: true, capacity: true } },
  members: { select: { userId: true, role: true, joinedAt: true, user: { select: { fullName: true } } }, orderBy: { joinedAt: "asc" as const } },
} satisfies Prisma.TeamSelect;

/** A team as its own members see it. Member email addresses are never included. Non-members get 404. */
export async function getTeamForMember(actor: Actor, teamId: string) {
  const db = getDb();
  const team = await db.team.findFirst({ where: { id: teamId, members: { some: { userId: actor.id } } }, select: TEAM_VIEW });
  if (!team) throw notFound("Team");
  const isLeader = team.leaderId === actor.id;
  const [registered, invitations] = await Promise.all([
    db.registration.findMany({ where: { teamId, status: { not: "CANCELLED" } }, select: { status: true }, take: 1 }),
    isLeader
      ? db.teamInvitation.findMany({ where: { teamId, status: "PENDING" }, select: { id: true, inviteeEmail: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
  ]);
  return { ...team, isLeader, registration: registered[0]?.status ?? null, invitations };
}

export async function listMyTeams(userId: string) {
  return getDb().team.findMany({
    where: { members: { some: { userId } }, status: "ACTIVE" },
    select: { id: true, name: true, leaderId: true, event: { select: { id: true, slug: true, title: true, endsAt: true } }, _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** The caller's team for one event, if any. */
export async function getMyTeamForEvent(userId: string, eventId: string) {
  const m = await getDb().teamMember.findUnique({ where: { eventId_userId: { eventId, userId } }, select: { teamId: true, role: true, team: { select: { name: true, status: true } } } });
  return m && m.team.status === "ACTIVE" ? { teamId: m.teamId, role: m.role, name: m.team.name } : null;
}

// ───────────────────────────── invitations ─────────────────────────────

const link = (path: string, token: string) => {
  const u = new URL(path, getEnv().APP_URL);
  u.searchParams.set("token", token);
  return u.toString();
};

/**
 * The leader invites an email address. The answer never says whether the address has an account, and an address that is
 * already in another team is only discovered (and refused) when the invitation is answered.
 */
export async function inviteMember(actor: Actor, teamId: string, email: string, deps: AuthDeps = defaultDeps()) {
  ensureEmailReady(deps);
  const now = deps.now();
  await enforceRateLimits([{ scope: "team-invite:team", id: teamId, policy: { limit: 20, windowSeconds: 3600 } }], now);
  const result = await getDb().$transaction(async (tx) => {
    const team = await loadTeamForLeader(tx, actor, teamId);
    if (team.status !== "ACTIVE") throw conflict("A disbanded team cannot invite people.");
    assertTeamEvent(team.event);
    assertTeamFormationOpen(team.event, now);
    const max = team.event.maxTeamSize ?? Number.MAX_SAFE_INTEGER;
    const pending = await tx.teamInvitation.count({ where: { teamId, status: "PENDING", expiresAt: { gt: now } } });
    if (team.members.length + pending >= max) throw new AppError(409, "team_full", `A team can have at most ${max} members, counting open invitations.`);
    const memberEmails = await tx.user.findMany({ where: { id: { in: team.members.map((m) => m.userId) } }, select: { email: true } });
    if (memberEmails.some((u) => u.email === email)) throw new AppError(409, "already_member", "That person is already in your team.");
    // Expired invitations no longer block a new one.
    await tx.teamInvitation.updateMany({ where: { teamId, inviteeEmail: email, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", respondedAt: now } });
    const invitee = await tx.user.findUnique({ where: { email }, select: { id: true } });
    const token = generateToken();
    try {
      const inv = await tx.teamInvitation.create({
        data: { teamId, inviterId: actor.id, inviteeId: invitee?.id ?? null, inviteeEmail: email, tokenHash: hashToken(token), createdAt: now, expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * DAY) },
      });
      await writeAudit({ actorId: actor.id, action: "team.invite", entityType: "team", entityId: teamId, after: { invitationId: inv.id } }, tx);
      const inviter = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { fullName: true } });
      return { token, id: inv.id, teamName: team.name, eventTitle: team.event.title, inviterName: inviter.fullName };
    } catch (e) {
      if (isUnique(e)) throw new AppError(409, "already_invited", "That address already has an open invitation.");
      throw e;
    }
  });
  deps.schedule(() => deps.mailer.send(teamInvitationEmail(email, result.inviterName, result.teamName, result.eventTitle, link("/team-invitations", result.token), INVITATION_TTL_DAYS)));
  return { id: result.id };
}

export async function revokeInvitation(actor: Actor, teamId: string, invitationId: string, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    await loadTeamForLeader(tx, actor, teamId);
    const res = await tx.teamInvitation.updateMany({ where: { id: invitationId, teamId, status: "PENDING" }, data: { status: "REVOKED", respondedAt: now } });
    if (res.count !== 1) throw notFound("Invitation");
    await writeAudit({ actorId: actor.id, action: "team.invitation_revoked", entityType: "team", entityId: teamId, after: { invitationId } }, tx);
  });
}

/** What an invitation link shows before anyone decides. Only the invited person (matching verified email) can see it. */
export async function previewInvitation(actor: Actor & { email: string }, token: string, now: Date = new Date()) {
  const inv = await getDb().teamInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, inviteeEmail: true, status: true, expiresAt: true, team: { select: { name: true, status: true, event: { select: { title: true, slug: true } } } }, inviter: { select: { fullName: true } } },
  });
  if (!inv || inv.inviteeEmail !== actor.email.toLowerCase()) return null; // same answer for unknown tokens and other people's tokens
  return { id: inv.id, teamName: inv.team.name, eventTitle: inv.team.event.title, eventSlug: inv.team.event.slug, inviterName: inv.inviter.fullName, expired: inv.expiresAt <= now, status: inv.status };
}

export async function listMyInvitations(actor: { email: string }, now: Date = new Date()) {
  return getDb().teamInvitation.findMany({
    where: { inviteeEmail: actor.email.toLowerCase(), status: "PENDING", expiresAt: { gt: now } },
    select: { id: true, expiresAt: true, team: { select: { name: true, event: { select: { title: true, slug: true } } } }, inviter: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

const invalidInvitation = () => new AppError(400, "invalid_invitation", "This invitation is invalid, has expired, or was already answered.");

/**
 * Accept or decline. Works from the emailed link (token) or the dashboard (id). Only the person whose verified email the
 * invitation was sent to can answer. The status change is a conditional update (PENDING and unexpired), so an answer can
 * be given exactly once even when submitted twice at the same moment; accepting and joining happen in one transaction.
 */
export async function respondToInvitation(actor: Actor & { email: string }, ref: { token: string } | { id: string }, accept: boolean, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    const inv = await tx.teamInvitation.findUnique({
      where: "token" in ref ? { tokenHash: hashToken(ref.token) } : { id: ref.id },
      include: { team: { include: { event: true } } },
    });
    if (!inv || inv.inviteeEmail !== actor.email.toLowerCase()) throw invalidInvitation();
    const claimed = await tx.teamInvitation.updateMany({
      where: { id: inv.id, status: "PENDING", expiresAt: { gt: now } },
      data: { status: accept ? "ACCEPTED" : "REJECTED", respondedAt: now, inviteeId: actor.id },
    });
    if (claimed.count !== 1) throw invalidInvitation();
    await writeAudit({ actorId: actor.id, action: accept ? "team.invitation_accepted" : "team.invitation_declined", entityType: "team", entityId: inv.teamId, after: { invitationId: inv.id } }, tx);
    if (!accept) return { joined: false as const, teamId: inv.teamId };

    const { team } = inv;
    if (team.status !== "ACTIVE") throw new AppError(409, "team_disbanded", "This team no longer exists.");
    if (!(await lockEvent(tx, team.eventId))) throw notFound("Event");
    const event = await tx.event.findUniqueOrThrow({ where: { id: team.eventId } });
    assertTeamFormationOpen(event, now);
    try {
      await tx.teamMember.create({ data: { teamId: team.id, eventId: team.eventId, userId: actor.id, role: "MEMBER" } });
    } catch (e) {
      if (isTeamFull(e)) throw new AppError(409, "team_full", "This team is already full.");
      if (isUnique(e)) throw new AppError(409, "already_in_team", "You are already in a team for this event.");
      throw e;
    }
    // A team that is already registered takes the newcomer into its registration with the team's status.
    const existing = await tx.registration.findFirst({ where: { teamId: team.id, status: { not: "CANCELLED" } }, select: { status: true } });
    if (existing) await upsertMemberRegistration(tx, team.eventId, actor.id, team.id, existing.status, now);
    return { joined: true as const, teamId: team.id };
  }).catch((e) => {
    // Postgres reports the trigger's refusal as a raw error: surface it as the same 409 whichever statement raised it.
    if (isTeamFull(e)) throw new AppError(409, "team_full", "This team is already full.");
    throw e;
  });
}

async function upsertMemberRegistration(tx: Tx, eventId: string, userId: string, teamId: string, status: "PENDING" | "CONFIRMED" | "WAITLISTED" | "CANCELLED", now: Date) {
  const existing = await tx.registration.findUnique({ where: { eventId_userId: { eventId, userId } } });
  if (existing) await tx.registration.update({ where: { id: existing.id }, data: { teamId, status, cancelledAt: null, registeredAt: now } });
  else await tx.registration.create({ data: { eventId, userId, teamId, status, registeredAt: now } });
}

// ───────────────────────────── membership changes ─────────────────────────────

async function dropMember(tx: Tx, team: Awaited<ReturnType<typeof loadTeamForLeader>>, userId: string, now: Date, action: string, actorId: string) {
  const registered = await registeredRows(tx, team.id);
  if (registered > 0) {
    const min = team.event.minTeamSize ?? 1;
    if (team.members.length - 1 < min) throw new AppError(409, "team_too_small", `The team is registered and needs at least ${min} members. Cancel the team's registration first.`);
  }
  await tx.teamMember.delete({ where: { teamId_userId: { teamId: team.id, userId } } });
  await tx.registration.updateMany({ where: { eventId: team.eventId, userId, teamId: team.id, status: { not: "CANCELLED" } }, data: { status: "CANCELLED", cancelledAt: now, teamId: null } });
  await writeAudit({ actorId, action, entityType: "team", entityId: team.id, after: { userId } }, tx);
}

export async function removeMember(actor: Actor, teamId: string, userId: string, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    await lockEvent(tx, (await tx.team.findUnique({ where: { id: teamId }, select: { eventId: true } }))?.eventId ?? "00000000-0000-0000-0000-000000000000");
    const team = await loadTeamForLeader(tx, actor, teamId);
    if (userId === team.leaderId) throw new AppError(400, "cannot_remove_leader", "The team leader cannot be removed. Disband the team instead.");
    if (!team.members.some((m) => m.userId === userId)) throw notFound("Member");
    await dropMember(tx, team, userId, now, "team.member_removed", actor.id);
  });
}

/** A member leaves voluntarily. The leader cannot leave a team that still has other members. */
export async function leaveTeam(actor: Actor, teamId: string, now: Date = new Date()) {
  const result = await leaveTeamTx(actor, teamId, now);
  await drainStorageDeletionsBestEffort(); // a leader leaving alone disbands the team: delete the files of its draft submissions now
  return result;
}

async function leaveTeamTx(actor: Actor, teamId: string, now: Date) {
  return getDb().$transaction(async (tx) => {
    const t = await tx.team.findUnique({ where: { id: teamId }, include: { event: true, members: true } });
    if (!t || !t.members.some((m) => m.userId === actor.id)) throw notFound("Team");
    await lockEvent(tx, t.eventId);
    if (t.leaderId === actor.id) {
      if (t.members.length > 1) throw new AppError(409, "leader_cannot_leave", "Transfer leadership or remove the other members first, or disband the team.");
      return disband(tx, t, now, actor.id);
    }
    await dropMember(tx, t, actor.id, now, "team.member_left", actor.id);
  });
}

async function disband(tx: Tx, team: { id: string; eventId: string }, now: Date, actorId: string) {
  const submitted = await tx.submission.findFirst({ where: { teamId: team.id, status: { not: "DRAFT" } }, select: { id: true } });
  if (submitted) throw new AppError(409, "team_has_submission", "A team with a submitted project cannot be disbanded.");
  await tx.registration.updateMany({ where: { teamId: team.id, status: { not: "CANCELLED" } }, data: { status: "CANCELLED", cancelledAt: now, teamId: null } });
  await tx.teamInvitation.updateMany({ where: { teamId: team.id, status: "PENDING" }, data: { status: "REVOKED", respondedAt: now } });
  await tx.submission.deleteMany({ where: { teamId: team.id, status: "DRAFT" } });
  await tx.teamMember.deleteMany({ where: { teamId: team.id } });
  await tx.team.update({ where: { id: team.id }, data: { status: "DISBANDED" } });
  await promoteWaitlist(tx, team.eventId);
  await writeAudit({ actorId, action: "team.disband", entityType: "team", entityId: team.id }, tx);
}

async function disbandTeamTx(actor: Actor, teamId: string, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    const pre = await tx.team.findUnique({ where: { id: teamId }, select: { eventId: true } });
    if (pre) await lockEvent(tx, pre.eventId);
    const team = await loadTeamForLeader(tx, actor, teamId);
    if (team.status !== "ACTIVE") throw conflict("This team is already disbanded.");
    await disband(tx, team, now, actor.id);
  });
}

export async function disbandTeam(actor: Actor, teamId: string, now: Date = new Date()) {
  const result = await disbandTeamTx(actor, teamId, now);
  await drainStorageDeletionsBestEffort(); // the database already queued the deletion of the draft submissions' files in the same transaction
  return result;
}

// ───────────────────────────── team registration ─────────────────────────────

/**
 * The leader registers the whole team. Every current member gets a registration with the same status, and capacity counts
 * TEAMS: the team is confirmed when a team place is free, otherwise it joins the waiting list as one unit. The team size
 * must be within the event's limits. Registering again returns the existing registration.
 */
export async function registerTeam(actor: Actor, teamId: string, now: Date = new Date()): Promise<{ status: "CONFIRMED" | "WAITLISTED"; created: boolean }> {
  return getDb().$transaction(async (tx) => {
    const pre = await tx.team.findUnique({ where: { id: teamId }, select: { eventId: true } });
    if (!pre) throw notFound("Team");
    await lockEvent(tx, pre.eventId);
    const team = await loadTeamForLeader(tx, actor, teamId);
    if (team.status !== "ACTIVE") throw conflict("A disbanded team cannot register.");
    const existing = await tx.registration.findFirst({ where: { teamId, status: { in: ["CONFIRMED", "WAITLISTED", "PENDING"] } }, select: { status: true } });
    if (existing) return { status: existing.status === "WAITLISTED" ? "WAITLISTED" : "CONFIRMED", created: false };
    const event = team.event;
    const block = registrationBlock(event, now, "team");
    if (block === "NOT_PUBLISHED") throw notFound("Event");
    if (block) throw new AppError(409, `registration_${block.toLowerCase()}`, BLOCK_MESSAGE[block]);
    const min = event.minTeamSize ?? 1;
    const max = event.maxTeamSize ?? Number.MAX_SAFE_INTEGER;
    if (team.members.length < min || team.members.length > max) {
      throw new AppError(409, "team_size_invalid", `This event needs teams of ${min} to ${event.maxTeamSize ?? "any number of"} members. Your team has ${team.members.length}.`);
    }
    // A member may have registered some other way earlier; the database allows one registration row per person and event.
    const taken = await confirmedSeats(tx, event.id, event.registrationMode);
    const status = placeFor(event.capacity, taken);
    for (const m of team.members) await upsertMemberRegistration(tx, event.id, m.userId, team.id, status, now);
    await writeAudit({ actorId: actor.id, action: "team.registered", entityType: "team", entityId: team.id, after: { status, members: team.members.length } }, tx);
    return { status, created: true };
  });
}

export async function cancelTeamRegistration(actor: Actor, teamId: string, now: Date = new Date()): Promise<{ cancelled: boolean }> {
  return getDb().$transaction(async (tx) => {
    const pre = await tx.team.findUnique({ where: { id: teamId }, select: { eventId: true } });
    if (!pre) throw notFound("Team");
    await lockEvent(tx, pre.eventId);
    const team = await loadTeamForLeader(tx, actor, teamId);
    if (now >= team.event.endsAt) throw conflict("This event has ended, so the registration can no longer be cancelled.");
    const res = await tx.registration.updateMany({ where: { teamId, status: { not: "CANCELLED" } }, data: { status: "CANCELLED", cancelledAt: now } });
    if (res.count === 0) return { cancelled: false };
    await promoteWaitlist(tx, team.eventId);
    await writeAudit({ actorId: actor.id, action: "team.registration_cancelled", entityType: "team", entityId: teamId }, tx);
    return { cancelled: true };
  });
}
