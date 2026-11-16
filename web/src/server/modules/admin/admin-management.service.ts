import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError, conflict, notFound } from "@/server/http/errors";
import { stripNul } from "@/lib/sanitize";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { revokeAllUserSessions } from "@/server/modules/auth/session.service";
import { can, type Actor } from "@/server/modules/authz/permissions";
import { normalizeEmail } from "@/server/security/tokens";

/** Every function here starts with this: only platform administrators (global ADMIN) pass. */
export function assertAdmin(actor: Actor | null | undefined): asserts actor is Actor {
  if (!can(actor, "admin:access")) throw new AppError(403, "forbidden", "You do not have access to this resource");
}

// ───────────────────────────── user details and activity ─────────────────────────────

const SENSITIVE_KEY = /token|secret|password|hash|code/i;
/** Defensive display filter on top of the audit redactor: never show values of sensitive-looking keys. */
export function scrubAuditJson(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubAuditJson(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[hidden]" : scrubAuditJson(v, depth + 1)]));
}

export async function getUserDetail(actor: Actor, userId: string) {
  assertAdmin(actor);
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, fullName: true, bio: true, status: true, emailVerifiedAt: true, createdAt: true, lastLoginAt: true,
      roles: { select: { role: true, eventId: true, organizationId: true, createdAt: true } },
      mfa: { select: { enabledAt: true } },
      _count: { select: { registrations: true, teamMemberships: true, submissions: true, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
    },
  });
  if (!user) throw notFound("User");
  const activity = await db.auditLog.findMany({
    where: { OR: [{ actorId: userId }, { entityType: "user", entityId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, after: true, actor: { select: { fullName: true } } },
  });
  return {
    id: user.id, email: user.email, fullName: user.fullName, bio: user.bio, status: user.status, emailVerified: !!user.emailVerifiedAt,
    createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, mfaEnabled: !!user.mfa?.enabledAt,
    roles: user.roles, counts: { registrations: user._count.registrations, teams: user._count.teamMemberships, submissions: user._count.submissions, activeSessions: user._count.sessions },
    activity: activity.map((a) => ({ id: a.id, action: a.action, entityType: a.entityType, entityId: a.entityId, createdAt: a.createdAt, by: a.actor?.fullName ?? "system", details: scrubAuditJson(a.after) })),
  };
}

// ───────────────────────────── events ─────────────────────────────

export const adminEventsQuerySchema = z.object({
  q: z.string().transform(stripNul).pipe(z.string().trim().max(100)).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED", "ARCHIVED"]).optional(),
  category: z.enum(["HACKATHON", "DATATHON", "AI_ML", "PROGRAMMING_CONTEST", "WORKSHOP", "SUMMIT", "INNOVATION_CHALLENGE", "OTHER"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** All events, drafts included, with counts. Paginated; counts are computed for the page only. */
export async function listAllEvents(actor: Actor, q: z.infer<typeof adminEventsQuerySchema>) {
  assertAdmin(actor);
  const db = getDb();
  const where: Prisma.EventWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { slug: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.event.count({ where }),
    db.event.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: {
        id: true, slug: true, title: true, category: true, status: true, startsAt: true, registrationMode: true, resultsPublishedAt: true, createdAt: true,
        organizers: { select: { user: { select: { id: true, fullName: true } } } },
        hosts: { select: { role: true, organization: { select: { id: true, name: true } } } },
        _count: { select: { teams: true, submissions: true } },
      },
    }),
  ]);
  const ids = rows.map((r) => r.id);
  const regs = ids.length ? await db.registration.groupBy({ by: ["eventId", "status"], where: { eventId: { in: ids } }, _count: { _all: true } }) : [];
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((e) => {
      const c = { CONFIRMED: 0, WAITLISTED: 0, PENDING: 0, CANCELLED: 0 };
      for (const r of regs) if (r.eventId === e.id) c[r.status] = r._count._all;
      return { ...e, registrations: c };
    }),
  };
}

/** One event with everything an administrator manages: organizers, hosts, counts. Includes drafts. */
export async function getEventAdminDetail(actor: Actor, eventId: string) {
  assertAdmin(actor);
  const db = getDb();
  const e = await db.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, slug: true, title: true, category: true, status: true, registrationMode: true, startsAt: true, endsAt: true, registrationClosesAt: true, resultsPublishedAt: true, capacity: true,
      organizers: { select: { isLead: true, user: { select: { id: true, fullName: true, email: true } } } },
      hosts: { select: { role: true, organization: { select: { id: true, name: true } } } },
      _count: { select: { teams: true, submissions: true, certificates: true, judges: true } },
    },
  });
  if (!e) throw notFound("Event");
  const regs = await db.registration.groupBy({ by: ["status"], where: { eventId }, _count: { _all: true } });
  const counts = { CONFIRMED: 0, WAITLISTED: 0, PENDING: 0, CANCELLED: 0 };
  for (const r of regs) counts[r.status] = r._count._all;
  const history = await db.auditLog.findMany({ where: { entityType: "event", entityId: eventId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, createdAt: true, actor: { select: { fullName: true } } } });
  return { ...e, registrations: counts, history: history.map((h) => ({ id: h.id, action: h.action, createdAt: h.createdAt, by: h.actor?.fullName ?? "system" })) };
}

/** Adds an organizer to an event: an existing, confirmed account. Records an event-scoped ORGANIZER role and ends their sessions once. */
export async function addEventOrganizer(actor: Actor, eventId: string, rawEmail: string) {
  assertAdmin(actor);
  const email = normalizeEmail(rawEmail);
  return getDb().$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw notFound("Event");
    const user = await tx.user.findUnique({ where: { email }, select: { id: true, status: true, emailVerifiedAt: true } });
    if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) throw new AppError(404, "user_not_found", "No active, confirmed account has that email address.");
    const exists = await tx.eventOrganizer.findUnique({ where: { eventId_userId: { eventId, userId: user.id } } });
    if (exists) return { userId: user.id, created: false };
    await tx.eventOrganizer.create({ data: { eventId, userId: user.id, isLead: false } });
    if (!(await tx.userRoleAssignment.findFirst({ where: { userId: user.id, role: "ORGANIZER", eventId } }))) {
      await tx.userRoleAssignment.create({ data: { userId: user.id, role: "ORGANIZER", eventId, grantedById: actor.id } });
    }
    await revokeAllUserSessions(user.id, "role_changed", tx);
    await writeAudit({ actorId: actor.id, action: "admin.event_organizer_added", entityType: "event", entityId: eventId, after: { userId: user.id } }, tx);
    return { userId: user.id, created: true };
  });
}

export async function removeEventOrganizer(actor: Actor, eventId: string, userId: string) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const all = await tx.eventOrganizer.findMany({ where: { eventId }, select: { userId: true } });
    if (!all.some((o) => o.userId === userId)) throw notFound("Organizer");
    if (all.length === 1) throw conflict("An event needs at least one organizer. Add another before removing this one.");
    await tx.eventOrganizer.delete({ where: { eventId_userId: { eventId, userId } } });
    await tx.userRoleAssignment.deleteMany({ where: { userId, role: "ORGANIZER", eventId } });
    await revokeAllUserSessions(userId, "role_changed", tx);
    await writeAudit({ actorId: actor.id, action: "admin.event_organizer_removed", entityType: "event", entityId: eventId, after: { userId } }, tx);
  });
}

export async function addEventHost(actor: Actor, eventId: string, organizationId: string, role: "HOST" | "CO_HOST" | "PARTNER") {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    if (!(await tx.event.findUnique({ where: { id: eventId }, select: { id: true } }))) throw notFound("Event");
    if (!(await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw notFound("Organization");
    await tx.eventHost.upsert({ where: { eventId_organizationId: { eventId, organizationId } }, create: { eventId, organizationId, role }, update: { role } });
    await writeAudit({ actorId: actor.id, action: "admin.event_host_set", entityType: "event", entityId: eventId, after: { organizationId, role } }, tx);
  });
}

export async function removeEventHost(actor: Actor, eventId: string, organizationId: string) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const res = await tx.eventHost.deleteMany({ where: { eventId, organizationId } });
    if (res.count !== 1) throw notFound("Host");
    await writeAudit({ actorId: actor.id, action: "admin.event_host_removed", entityType: "event", entityId: eventId, after: { organizationId } }, tx);
  });
}

// ───────────────────────────── audit and security logs ─────────────────────────────

export const auditQuerySchema = z.object({
  view: z.enum(["all", "security", "admin"]).default("all"),
  action: z.string().transform(stripNul).pipe(z.string().trim().max(60)).optional(),
  entityType: z.string().transform(stripNul).pipe(z.string().trim().max(40)).optional(),
  actor: z.string().transform(stripNul).pipe(z.string().trim().max(100)).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/** Prefixes of actions that make up the "security events" view. */
export const SECURITY_PREFIXES = ["auth.", "mfa.", "score.reopened", "admin.role", "admin.user_status", "maintenance."];

export async function listAuditLog(actor: Actor, q: z.infer<typeof auditQuerySchema>) {
  assertAdmin(actor);
  const and: Prisma.AuditLogWhereInput[] = [];
  if (q.view === "security") and.push({ OR: SECURITY_PREFIXES.map((p) => ({ action: { startsWith: p } })) });
  if (q.view === "admin") and.push({ action: { startsWith: "admin." } });
  if (q.action) and.push({ action: { startsWith: q.action } });
  if (q.entityType) and.push({ entityType: q.entityType });
  if (q.actor) and.push({ actor: { OR: [{ email: { contains: q.actor.toLowerCase() } }, { fullName: { contains: q.actor, mode: "insensitive" } }] } });
  if (q.from) and.push({ createdAt: { gte: new Date(`${q.from}T00:00:00Z`) } });
  if (q.to) and.push({ createdAt: { lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } });
  const where: Prisma.AuditLogWhereInput = and.length ? { AND: and } : {};
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, action: true, entityType: true, entityId: true, before: true, after: true, createdAt: true, actor: { select: { id: true, fullName: true, email: true } } },
    }),
  ]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((r) => ({ id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId, createdAt: r.createdAt, actor: r.actor, before: scrubAuditJson(r.before), after: scrubAuditJson(r.after) })),
  };
}

// ───────────────────────────── platform settings ─────────────────────────────

const SIGNUPS_KEY = "signups_enabled";

/** New-account registration switch. Defaults to enabled when nothing is stored. */
export async function getSignupsEnabled(): Promise<boolean> {
  const row = await getDb().siteSetting.findUnique({ where: { key: SIGNUPS_KEY } });
  return row ? row.value !== false : true;
}

export async function setSignupsEnabled(actor: Actor, enabled: boolean) {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    await tx.siteSetting.upsert({ where: { key: SIGNUPS_KEY }, create: { key: SIGNUPS_KEY, value: enabled }, update: { value: enabled } });
    await writeAudit({ actorId: actor.id, action: "admin.setting_changed", entityType: "setting", entityId: SIGNUPS_KEY, after: { enabled } }, tx);
  });
}
