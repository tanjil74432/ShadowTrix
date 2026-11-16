import "server-only";
import type { Prisma, RegistrationStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError, conflict, notFound } from "@/server/http/errors";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { canManageEvent, type Actor } from "@/server/modules/authz/permissions";
import { enforceRateLimits, POLICIES } from "@/server/security/rate-limit";
import { BLOCK_MESSAGE, placeFor, registrationBlock } from "./event-lifecycle";

type Tx = Prisma.TransactionClient;
export interface Clock {
  now: () => Date;
}
const realClock: Clock = { now: () => new Date() };

/** Serializes everything that changes the seat count of one event (register, cancel, capacity change). */
export async function lockEvent(tx: Tx, eventId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

/**
 * Places taken. Individual events count confirmed people; team events count confirmed TEAMS (capacity is a number of
 * teams, and every member of a registered team holds a registration row).
 */
export async function confirmedSeats(tx: Pick<Tx, "registration">, eventId: string, mode: "INDIVIDUAL" | "TEAM"): Promise<number> {
  if (mode === "INDIVIDUAL") return tx.registration.count({ where: { eventId, status: "CONFIRMED" } });
  const teams = await tx.registration.groupBy({ by: ["teamId"], where: { eventId, status: "CONFIRMED", teamId: { not: null } } });
  return teams.length;
}

/** Moves the oldest waitlisted people (or teams) into freed places. Call inside a transaction that holds the event lock. */
export async function promoteWaitlist(tx: Tx, eventId: string): Promise<number> {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { capacity: true, status: true, registrationMode: true } });
  if (!event || event.status === "CANCELLED") return 0;
  const confirmed = await confirmedSeats(tx, eventId, event.registrationMode);
  const free = event.capacity == null ? 1000 : event.capacity - confirmed;
  if (free <= 0) return 0;
  if (event.registrationMode === "TEAM") {
    // Oldest waiting team first (by the time its leader registered it); a whole team is promoted at once.
    const waiting = await tx.registration.groupBy({
      by: ["teamId"],
      where: { eventId, status: "WAITLISTED", teamId: { not: null } },
      _min: { registeredAt: true },
      orderBy: [{ _min: { registeredAt: "asc" } }, { teamId: "asc" }],
      take: Math.min(free, 1000),
    });
    const teamIds = waiting.map((w) => w.teamId as string);
    if (teamIds.length) await tx.registration.updateMany({ where: { eventId, status: "WAITLISTED", teamId: { in: teamIds } }, data: { status: "CONFIRMED" } });
    return teamIds.length;
  }
  const next = await tx.registration.findMany({
    where: { eventId, status: "WAITLISTED" },
    orderBy: [{ registeredAt: "asc" }, { id: "asc" }],
    take: Math.min(free, 1000),
    select: { id: true },
  });
  if (next.length) await tx.registration.updateMany({ where: { id: { in: next.map((n) => n.id) } }, data: { status: "CONFIRMED" } });
  return next.length;
}

export interface RegistrationResult {
  status: "CONFIRMED" | "WAITLISTED";
  created: boolean;
}

/**
 * Registers the signed-in user. One transaction with the event row locked, so two people racing for the last
 * seat cannot both get it. Idempotent: registering again returns the existing registration. A cancelled
 * registration is reactivated (the unique (event, user) row is reused) and goes to the back of the queue.
 */
export async function registerForEvent(actor: Actor, eventId: string, clock: Clock = realClock): Promise<RegistrationResult> {
  await enforceRateLimits([{ scope: "event-registration:user", id: actor.id, policy: POLICIES.eventRegistrationUser }], clock.now());
  return getDb().$transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) throw notFound("Event");
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    const now = clock.now();
    const existing = await tx.registration.findUnique({ where: { eventId_userId: { eventId, userId: actor.id } } });
    if (existing && existing.status !== "CANCELLED") {
      return { status: existing.status === "WAITLISTED" ? "WAITLISTED" : "CONFIRMED", created: false };
    }

    const block = registrationBlock(event, now);
    if (block === "NOT_PUBLISHED") throw notFound("Event"); // drafts and archived events do not exist for participants
    if (block) throw new AppError(409, `registration_${block.toLowerCase()}`, BLOCK_MESSAGE[block]);

    const confirmed = await confirmedSeats(tx, eventId, event.registrationMode);
    const status = placeFor(event.capacity, confirmed);
    if (existing) await tx.registration.update({ where: { id: existing.id }, data: { status, cancelledAt: null, registeredAt: now } });
    else await tx.registration.create({ data: { eventId, userId: actor.id, status, registeredAt: now } });
    await writeAudit({ actorId: actor.id, action: "registration.create", entityType: "event", entityId: eventId, after: { status } }, tx);
    return { status, created: true };
  });
}

/** Cancels the user's own registration (allowed until the event ends) and promotes the next person on the waiting list. */
export async function cancelRegistration(actor: Actor, eventId: string, clock: Clock = realClock): Promise<{ cancelled: boolean }> {
  await enforceRateLimits([{ scope: "event-registration:user", id: actor.id, policy: POLICIES.eventRegistrationUser }], clock.now());
  return getDb().$transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) throw notFound("Event");
    const reg = await tx.registration.findUnique({
      where: { eventId_userId: { eventId, userId: actor.id } },
      include: { event: { select: { endsAt: true } } },
    });
    if (!reg || reg.status === "CANCELLED") return { cancelled: false };
    if (clock.now() >= reg.event.endsAt) throw conflict("This event has ended, so the registration can no longer be cancelled.");
    await tx.registration.update({ where: { id: reg.id }, data: { status: "CANCELLED", cancelledAt: clock.now() } });
    if (reg.status === "CONFIRMED") await promoteWaitlist(tx, eventId);
    await writeAudit({ actorId: actor.id, action: "registration.cancel", entityType: "event", entityId: eventId, before: { status: reg.status } }, tx);
    return { cancelled: true };
  });
}

/** The caller's own registration for one event (null when none or cancelled). */
export async function getMyRegistration(userId: string, eventId: string) {
  const r = await getDb().registration.findUnique({ where: { eventId_userId: { eventId, userId } }, select: { status: true, registeredAt: true } });
  return r && r.status !== "CANCELLED" ? r : null;
}

/** Everything the participant dashboard needs, scoped to the caller. */
export async function listMyRegistrations(userId: string) {
  return getDb().registration.findMany({
    where: { userId },
    orderBy: [{ registeredAt: "desc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      status: true,
      registeredAt: true,
      cancelledAt: true,
      event: {
        select: {
          id: true, slug: true, title: true, category: true, status: true, startsAt: true, endsAt: true,
          registrationClosesAt: true, submissionDeadline: true, timezone: true, locationType: true, resultsPublishedAt: true, registrationMode: true,
        },
      },
    },
  });
}

/**
 * The participant list of one event, for its organizers only. This is the one place participant names and email
 * addresses leave the database, so it checks authorization itself and records who looked.
 */
export async function listEventRegistrations(
  actor: Actor,
  eventId: string,
  opts: { page: number; pageSize: number; status?: RegistrationStatus },
) {
  const db = getDb();
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, status: true, organizers: { select: { userId: true } } } });
  if (!event) throw notFound("Event");
  if (!canManageEvent(actor, event.id, event.organizers.map((o) => o.userId))) {
    if (event.status === "DRAFT" || event.status === "ARCHIVED") throw notFound("Event");
    throw new AppError(403, "forbidden", "You do not have access to this resource");
  }
  const where: Prisma.RegistrationWhereInput = { eventId, ...(opts.status ? { status: opts.status } : {}) };
  const [total, items, grouped] = await Promise.all([
    db.registration.count({ where }),
    db.registration.findMany({
      where,
      orderBy: [{ registeredAt: "asc" }, { id: "asc" }],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      select: { id: true, status: true, registeredAt: true, cancelledAt: true, user: { select: { id: true, fullName: true, email: true } } },
    }),
    db.registration.groupBy({ by: ["status"], where: { eventId }, _count: { _all: true } }),
  ]);
  await writeAudit({ actorId: actor.id, action: "registration.list_viewed", entityType: "event", entityId: eventId, after: { page: opts.page } });
  const counts = { CONFIRMED: 0, WAITLISTED: 0, PENDING: 0, CANCELLED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;
  return { items, total, page: opts.page, pageSize: opts.pageSize, counts };
}
