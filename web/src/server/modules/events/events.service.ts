import "server-only";
import { randomBytes } from "node:crypto";
import type { EventCategory, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError, conflict, forbidden, notFound } from "@/server/http/errors";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { canCreateEvents, canManageEvent, hasGlobalRole, type Actor } from "@/server/modules/authz/permissions";
import { timelineIssues, type CreateEventInput, type EventStatusAction, type UpdateEventInput } from "./event.schema";
import { nextState, slugify } from "./event-lifecycle";
import { lockEvent, promoteWaitlist } from "./registrations.service";

type Tx = Prisma.TransactionClient;
export interface Clock {
  now: () => Date;
}
const realClock: Clock = { now: () => new Date() };

// ───────────────────────────── Public reads ─────────────────────────────

/** Fields safe to show to anyone. Never includes organizers' emails, creator ids or registrations. */
const PUBLIC_SELECT = {
  id: true, slug: true, title: true, category: true, summary: true, description: true, coverImageUrl: true, status: true,
  startsAt: true, endsAt: true, registrationOpensAt: true, registrationClosesAt: true, submissionDeadline: true,
  judgingStartsAt: true, judgingEndsAt: true, resultsAnnouncementAt: true, registrationManuallyClosed: true, capacity: true,
  registrationMode: true, eligibility: true, locationType: true, location: true, timezone: true,
  hosts: { select: { role: true, organization: { select: { name: true, slug: true } } } },
} satisfies Prisma.EventSelect;

export type PublicEvent = Prisma.EventGetPayload<{ select: typeof PUBLIC_SELECT }> & { confirmedCount: number };

async function withCounts<T extends { id: string }>(events: T[]): Promise<(T & { confirmedCount: number })[]> {
  if (events.length === 0) return [];
  const rows = await getDb().registration.groupBy({
    by: ["eventId"],
    where: { eventId: { in: events.map((e) => e.id) }, status: "CONFIRMED" },
    _count: { _all: true },
  });
  const counts = new Map(rows.map((r) => [r.eventId, r._count._all]));
  return events.map((e) => ({ ...e, confirmedCount: counts.get(e.id) ?? 0 }));
}

export async function listPublicEvents(q: { q?: string; category?: EventCategory; page: number; pageSize: number }) {
  const where: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    ...(q.category ? { category: q.category } : {}),
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { summary: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const db = getDb();
  const [total, rows] = await Promise.all([
    db.event.count({ where }),
    db.event.findMany({ where, select: PUBLIC_SELECT, orderBy: [{ startsAt: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items: await withCounts(rows), total, page: q.page, pageSize: q.pageSize };
}

/** Published and cancelled events have public pages (a cancelled event must say so). Drafts and archived events are invisible. */
export async function getPublicEvent(slug: string): Promise<PublicEvent | null> {
  const row = await getDb().event.findFirst({ where: { slug, status: { in: ["PUBLISHED", "CANCELLED"] } }, select: PUBLIC_SELECT });
  return row ? (await withCounts([row]))[0] : null;
}

// ───────────────────────────── Organizer: load + authorize ─────────────────────────────

/** Loads an event for management; 404 when it does not exist and 403 when the actor does not organize it. */
export async function loadManagedEvent(actor: Actor, eventId: string, db: Pick<Tx, "event"> = getDb()) {
  const event = await db.event.findUnique({ where: { id: eventId }, include: { organizers: { select: { userId: true } } } });
  if (!event) throw notFound("Event");
  if (!canManageEvent(actor, event.id, event.organizers.map((o) => o.userId))) {
    // Do not reveal draft or archived events to people who cannot manage them.
    if (event.status === "DRAFT" || event.status === "ARCHIVED") throw notFound("Event");
    throw forbidden();
  }
  return event;
}

async function uniqueSlug(tx: Tx, title: string): Promise<string> {
  const base = slugify(title);
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
    if (!(await tx.event.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${randomBytes(6).toString("hex")}`;
}

// ───────────────────────────── Organizer: create / update / status ─────────────────────────────

export async function createEvent(actor: Actor, input: CreateEventInput) {
  if (!canCreateEvents(actor)) throw forbidden();
  return getDb().$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, input.title);
    const host = await tx.organization.findFirst({ where: { type: "PLATFORM_OPERATOR" }, select: { id: true } });
    const event = await tx.event.create({
      data: {
        slug,
        title: input.title,
        category: input.category,
        summary: input.summary,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        registrationOpensAt: input.registrationOpensAt,
        registrationClosesAt: input.registrationClosesAt,
        submissionDeadline: input.submissionDeadline ?? null,
        judgingStartsAt: input.judgingStartsAt ?? null,
        judgingEndsAt: input.judgingEndsAt ?? null,
        resultsAnnouncementAt: input.resultsAnnouncementAt ?? null,
        capacity: input.capacity ?? null,
        locationType: input.locationType,
        location: input.location ?? null,
        eligibility: input.eligibility ?? null,
        timezone: "UTC",
        registrationMode: "INDIVIDUAL",
        status: "DRAFT",
        createdById: actor.id,
        organizers: { create: { userId: actor.id, isLead: true } },
        ...(host ? { hosts: { create: { organizationId: host.id, role: "HOST" } } } : {}),
      },
    });
    await writeAudit({ actorId: actor.id, action: "event.create", entityType: "event", entityId: event.id, after: { slug, status: "DRAFT" } }, tx);
    return event;
  });
}

const EDITABLE = [
  "title", "category", "summary", "description", "startsAt", "endsAt", "registrationOpensAt", "registrationClosesAt",
  "submissionDeadline", "judgingStartsAt", "judgingEndsAt", "resultsAnnouncementAt", "capacity", "locationType", "location", "eligibility",
] as const;

export async function updateEvent(actor: Actor, eventId: string, input: UpdateEventInput) {
  return getDb().$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const event = await loadManagedEvent(actor, eventId, tx);
    if (event.status === "CANCELLED" || event.status === "ARCHIVED") throw conflict("A cancelled or archived event can no longer be edited.");

    // The merged timeline must still satisfy the same rules the database enforces.
    const issues = timelineIssues({
      startsAt: input.startsAt ?? event.startsAt,
      endsAt: input.endsAt ?? event.endsAt,
      registrationOpensAt: input.registrationOpensAt ?? event.registrationOpensAt,
      registrationClosesAt: input.registrationClosesAt ?? event.registrationClosesAt,
      submissionDeadline: input.submissionDeadline !== undefined ? input.submissionDeadline : event.submissionDeadline,
      judgingStartsAt: input.judgingStartsAt !== undefined ? input.judgingStartsAt : event.judgingStartsAt,
      judgingEndsAt: input.judgingEndsAt !== undefined ? input.judgingEndsAt : event.judgingEndsAt,
    });
    if (issues.length) throw new AppError(400, "invalid_timeline", issues[0].message);

    if (input.capacity !== undefined && input.capacity !== null) {
      const confirmed = await tx.registration.count({ where: { eventId, status: "CONFIRMED" } });
      if (input.capacity < confirmed) throw conflict(`${confirmed} people are already confirmed, so the capacity cannot be lower than ${confirmed}.`);
    }

    const data: Record<string, unknown> = {};
    for (const k of EDITABLE) if (input[k] !== undefined) data[k] = input[k];
    const updated = await tx.event.update({ where: { id: eventId }, data: data as Prisma.EventUpdateInput });
    if (input.capacity !== undefined) await promoteWaitlist(tx, eventId);
    await writeAudit({ actorId: actor.id, action: "event.update", entityType: "event", entityId: eventId, after: { fields: Object.keys(data) } }, tx);
    return updated;
  });
}

const VERB: Record<EventStatusAction, string> = { publish: "published", unpublish: "unpublished", cancel: "cancelled", archive: "archived" };

export async function setEventStatus(actor: Actor, eventId: string, action: EventStatusAction, clock: Clock = realClock) {
  return getDb().$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const event = await loadManagedEvent(actor, eventId, tx);
    const to = nextState(event.status, action);
    if (!to) throw conflict(`This event is ${event.status.toLowerCase()}, so it cannot be ${VERB[action]}.`);
    if (action === "publish" && event.registrationClosesAt <= clock.now()) throw conflict("Registration already closes in the past. Update the dates before publishing.");
    if (action === "unpublish") {
      const registered = await tx.registration.count({ where: { eventId, status: { in: ["CONFIRMED", "WAITLISTED", "PENDING"] } } });
      if (registered > 0) throw conflict("People are already registered, so the event cannot go back to draft. Cancel it instead.");
    }
    const updated = await tx.event.update({ where: { id: eventId }, data: { status: to } });
    await writeAudit({ actorId: actor.id, action: `event.${action}`, entityType: "event", entityId: eventId, before: { status: event.status }, after: { status: to } }, tx);
    return updated;
  });
}

/** Opens or closes registration by hand, independent of the dates. */
export async function setRegistrationClosed(actor: Actor, eventId: string, closed: boolean) {
  return getDb().$transaction(async (tx) => {
    const event = await loadManagedEvent(actor, eventId, tx);
    if (event.status !== "PUBLISHED") throw conflict("Only a published event has registration to open or close.");
    const updated = await tx.event.update({ where: { id: eventId }, data: { registrationManuallyClosed: closed } });
    await writeAudit({ actorId: actor.id, action: closed ? "event.registration_closed" : "event.registration_reopened", entityType: "event", entityId: eventId }, tx);
    return updated;
  });
}

// ───────────────────────────── Organizer dashboard data ─────────────────────────────

export async function listManagedEvents(actor: Actor) {
  const db = getDb();
  const all = hasGlobalRole(actor, "ADMIN");
  const scopedIds = actor.roles.filter((g) => g.role === "ORGANIZER" && g.eventId).map((g) => g.eventId as string);
  const events = await db.event.findMany({
    where: all ? {} : { OR: [{ organizers: { some: { userId: actor.id } } }, { id: { in: scopedIds } }] },
    select: {
      id: true, slug: true, title: true, category: true, status: true, startsAt: true, endsAt: true, registrationOpensAt: true,
      registrationClosesAt: true, capacity: true, registrationManuallyClosed: true, organizers: { select: { userId: true } },
    },
    orderBy: [{ startsAt: "desc" }, { id: "asc" }],
    take: 200,
  });
  const visible = events.filter((e) => canManageEvent(actor, e.id, e.organizers.map((o) => o.userId)));
  const rows = visible.length
    ? await db.registration.groupBy({ by: ["eventId", "status"], where: { eventId: { in: visible.map((e) => e.id) } }, _count: { _all: true } })
    : [];
  return visible.map((e) => {
    const counts = { CONFIRMED: 0, WAITLISTED: 0, PENDING: 0, CANCELLED: 0 };
    for (const r of rows) if (r.eventId === e.id) counts[r.status] = r._count._all;
    const { organizers: _organizers, ...rest } = e;
    void _organizers;
    return { ...rest, counts };
  });
}
