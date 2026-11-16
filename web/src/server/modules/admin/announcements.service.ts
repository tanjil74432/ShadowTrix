import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { conflict, notFound } from "@/server/http/errors";
import { stripNul } from "@/lib/sanitize";
import { writeAudit } from "@/server/modules/audit/audit.service";
import type { Actor } from "@/server/modules/authz/permissions";
import { assertAdmin } from "./admin-management.service";

/**
 * Platform announcements (the existing `announcements` table). A row is a DRAFT while publishedAt is null, SCHEDULED while it is in the
 * future and PUBLISHED once it has passed, so scheduling needs no worker: readers simply filter on the clock. The audience limits who
 * sees it; an event-specific announcement is shown only to people connected to that event. Announcements are shown on the signed-in
 * dashboard (no outside notification service). Text is stored as plain text and rendered escaped by React.
 */
const text = (min: number, max: number) => z.string().transform(stripNul).pipe(z.string().trim().min(min).max(max));
export const announcementSchema = z.object({
  title: text(3, 120),
  body: text(1, 5000),
  audience: z.enum(["ALL", "ORGANIZERS", "PARTICIPANTS", "JUDGES"]).default("ALL"),
  eventId: z.uuid().nullable().optional(),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;
export const publishSchema = z.object({ at: z.iso.datetime().optional() });

export type AnnouncementState = "DRAFT" | "SCHEDULED" | "PUBLISHED";
export const stateOf = (a: { publishedAt: Date | null }, now: Date = new Date()): AnnouncementState => (!a.publishedAt ? "DRAFT" : a.publishedAt > now ? "SCHEDULED" : "PUBLISHED");

const SELECT = {
  id: true, title: true, body: true, audience: true, eventId: true, publishedAt: true, createdAt: true, updatedAt: true,
  event: { select: { title: true } }, author: { select: { fullName: true } }, updatedBy: { select: { fullName: true } },
} satisfies Prisma.AnnouncementSelect;

async function assertEventExists(eventId: string | null | undefined, db: Pick<Prisma.TransactionClient, "event">) {
  if (eventId && !(await db.event.findUnique({ where: { id: eventId }, select: { id: true } }))) throw notFound("Event");
}

export async function createAnnouncement(actor: Actor, input: AnnouncementInput) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    await assertEventExists(input.eventId, tx);
    const a = await tx.announcement.create({ data: { title: input.title, body: input.body, audience: input.audience, eventId: input.eventId ?? null, authorId: actor.id, updatedById: actor.id }, select: { id: true } });
    await writeAudit({ actorId: actor.id, action: "announcement.created", entityType: "announcement", entityId: a.id, after: { title: input.title, audience: input.audience, eventId: input.eventId ?? null } }, tx);
    return a;
  });
}

export async function updateAnnouncement(actor: Actor, id: string, input: AnnouncementInput) {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    const before = await tx.announcement.findUnique({ where: { id }, select: { title: true, audience: true, eventId: true } });
    if (!before) throw notFound("Announcement");
    await assertEventExists(input.eventId, tx);
    await tx.announcement.update({ where: { id }, data: { title: input.title, body: input.body, audience: input.audience, eventId: input.eventId ?? null, updatedById: actor.id } });
    await writeAudit({ actorId: actor.id, action: "announcement.updated", entityType: "announcement", entityId: id, before, after: { title: input.title, audience: input.audience, eventId: input.eventId ?? null } }, tx);
  });
}

/** Publishes now, or at a future time (scheduling). A past time counts as now. */
export async function publishAnnouncement(actor: Actor, id: string, at: Date | undefined, now: Date = new Date()) {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    const a = await tx.announcement.findUnique({ where: { id }, select: { publishedAt: true } });
    if (!a) throw notFound("Announcement");
    const when = at && at > now ? at : now;
    await tx.announcement.update({ where: { id }, data: { publishedAt: when, updatedById: actor.id } });
    await writeAudit({ actorId: actor.id, action: when > now ? "announcement.scheduled" : "announcement.published", entityType: "announcement", entityId: id, before: { state: stateOf(a, now) }, after: { publishedAt: when.toISOString() } }, tx);
  });
}

export async function unpublishAnnouncement(actor: Actor, id: string, now: Date = new Date()) {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    const a = await tx.announcement.findUnique({ where: { id }, select: { publishedAt: true } });
    if (!a) throw notFound("Announcement");
    if (!a.publishedAt) throw conflict("This announcement is already a draft.");
    await tx.announcement.update({ where: { id }, data: { publishedAt: null, updatedById: actor.id } });
    await writeAudit({ actorId: actor.id, action: "announcement.unpublished", entityType: "announcement", entityId: id, before: { state: stateOf(a, now) } }, tx);
  });
}

/** Only a draft can be deleted: anything that was ever visible stays as history (unpublish it instead). */
export async function deleteAnnouncement(actor: Actor, id: string) {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    const a = await tx.announcement.findUnique({ where: { id }, select: { publishedAt: true, title: true } });
    if (!a) throw notFound("Announcement");
    if (a.publishedAt) throw conflict("Unpublish this announcement before deleting it.");
    await tx.announcement.delete({ where: { id } });
    await writeAudit({ actorId: actor.id, action: "announcement.deleted", entityType: "announcement", entityId: id, before: { title: a.title } }, tx);
  });
}

export const announcementListSchema = z.object({
  state: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listAnnouncementsAdmin(actor: Actor, q: z.infer<typeof announcementListSchema>, now: Date = new Date()) {
  assertAdmin(actor);
  const where: Prisma.AnnouncementWhereInput = q.state === "DRAFT" ? { publishedAt: null } : q.state === "SCHEDULED" ? { publishedAt: { gt: now } } : q.state === "PUBLISHED" ? { publishedAt: { lte: now } } : {};
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.announcement.count({ where }),
    db.announcement.findMany({ where, select: SELECT, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, items: rows.map((r) => ({ ...r, state: stateOf(r, now) })) };
}

export async function getAnnouncementAdmin(actor: Actor, id: string) {
  assertAdmin(actor);
  const a = await getDb().announcement.findUnique({ where: { id }, select: SELECT });
  if (!a) throw notFound("Announcement");
  const history = await getDb().auditLog.findMany({ where: { entityType: "announcement", entityId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, createdAt: true, actor: { select: { fullName: true } } } });
  return { ...a, state: stateOf(a), history: history.map((h) => ({ id: h.id, action: h.action, at: h.createdAt, by: h.actor?.fullName ?? "system" })) };
}

/** What one signed-in user may see now: published, matching their role, and for event announcements only events they take part in. */
export async function listVisibleAnnouncements(user: { id: string }, now: Date = new Date(), limit = 5) {
  const db = getDb();
  const [roles, regs, teams, judged, organized] = await Promise.all([
    db.userRoleAssignment.findMany({ where: { userId: user.id }, select: { role: true, eventId: true } }),
    db.registration.findMany({ where: { userId: user.id, status: { not: "CANCELLED" } }, select: { eventId: true } }),
    db.teamMember.findMany({ where: { userId: user.id, team: { status: "ACTIVE" } }, select: { eventId: true } }),
    db.judgeAssignment.findMany({ where: { judgeId: user.id }, select: { eventId: true } }),
    db.eventOrganizer.findMany({ where: { userId: user.id }, select: { eventId: true } }),
  ]);
  const audiences: ("ALL" | "ORGANIZERS" | "PARTICIPANTS" | "JUDGES")[] = ["ALL"];
  if (roles.some((r) => r.role === "ORGANIZER" || r.role === "ADMIN") || organized.length) audiences.push("ORGANIZERS");
  if (regs.length || teams.length) audiences.push("PARTICIPANTS");
  if (roles.some((r) => r.role === "JUDGE") || judged.length) audiences.push("JUDGES");
  const mine = new Set([...regs, ...teams, ...judged, ...organized, ...roles.flatMap((r) => (r.eventId ? [{ eventId: r.eventId }] : []))].map((x) => x.eventId));
  return db.announcement.findMany({
    where: { publishedAt: { lte: now }, audience: { in: audiences }, OR: [{ eventId: null }, { eventId: { in: [...mine] } }] },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }], take: limit,
    select: { id: true, title: true, body: true, publishedAt: true, event: { select: { title: true, slug: true } } },
  });
}

/** Events an announcement can be attached to (drafts and published), newest first, plus the one already attached when editing. */
export async function listEventChoices(actor: Actor, includeId?: string | null) {
  assertAdmin(actor);
  return getDb().event.findMany({
    where: { OR: [{ status: { in: ["PUBLISHED", "DRAFT"] } }, ...(includeId ? [{ id: includeId }] : [])] },
    orderBy: { createdAt: "desc" }, take: 200, select: { id: true, title: true },
  });
}
