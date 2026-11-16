import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { conflict, notFound } from "@/server/http/errors";
import { stripNul } from "@/lib/sanitize";
import { writeAudit } from "@/server/modules/audit/audit.service";
import type { Actor } from "@/server/modules/authz/permissions";
import { APPROVAL_KEY, getApprovalRequired } from "@/server/modules/events/approval-setting";
import { loadManagedEvent } from "@/server/modules/events/events.service";
import { assertAdmin } from "./admin-management.service";

/**
 * Event review. Distinct from publication: an organizer SUBMITS a draft; an administrator APPROVES, REJECTS or REQUESTS CHANGES (the
 * last two need a written reason). Publication itself is still the organizer's action. It is gated on APPROVED only while the
 * platform setting "event approval required" is on (default off), so existing workflows are unchanged until the owner opts in.
 * History is the audit log (`event.review_*`).
 */
export { getApprovalRequired };

export async function setApprovalRequired(actor: Actor, required: boolean) {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    await tx.siteSetting.upsert({ where: { key: APPROVAL_KEY }, create: { key: APPROVAL_KEY, value: required }, update: { value: required } });
    await writeAudit({ actorId: actor.id, action: "admin.setting_changed", entityType: "setting", entityId: APPROVAL_KEY, after: { required } }, tx);
  });
}

const reason = z.string().transform(stripNul).pipe(z.string().trim().min(5, "Write a reason of at least 5 characters").max(1000));
export const reviewSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), reason: reason.optional() }),
  z.object({ decision: z.literal("reject"), reason }),
  z.object({ decision: z.literal("request_changes"), reason }),
]);
export type ReviewInput = z.infer<typeof reviewSchema>;

/** Organizer: ask for review. Only a draft that has not been approved yet can be submitted. */
export async function submitEventForReview(actor: Actor, eventId: string) {
  return getDb().$transaction(async (tx) => {
    const event = await loadManagedEvent(actor, eventId, tx);
    if (event.status !== "DRAFT") throw conflict("Only a draft event can be submitted for review.");
    if (event.reviewStatus === "SUBMITTED") throw conflict("This event is already waiting for review.");
    if (event.reviewStatus === "APPROVED") throw conflict("This event is already approved.");
    const res = await tx.event.updateMany({ where: { id: eventId, reviewStatus: { not: "SUBMITTED" } }, data: { reviewStatus: "SUBMITTED", reviewNote: null, reviewedAt: null, reviewedById: null } });
    if (res.count !== 1) throw conflict("This event is already waiting for review.");
    await writeAudit({ actorId: actor.id, action: "event.review_submitted", entityType: "event", entityId: eventId, before: { reviewStatus: event.reviewStatus } }, tx);
  });
}

const TO = { approve: "APPROVED", reject: "REJECTED", request_changes: "CHANGES_REQUESTED" } as const;
const AUDIT = { approve: "event.review_approved", reject: "event.review_rejected", request_changes: "event.review_changes_requested" } as const;

/** Administrator decision on a submitted event. Atomic: only an event that is still SUBMITTED can be decided, once. */
export async function reviewEvent(actor: Actor, eventId: string, input: ReviewInput, now: Date = new Date()) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { id: true, reviewStatus: true, status: true } });
    if (!event) throw notFound("Event");
    if (event.reviewStatus !== "SUBMITTED") throw conflict("This event is not waiting for review.");
    const note = input.reason?.trim() || null;
    const res = await tx.event.updateMany({ where: { id: eventId, reviewStatus: "SUBMITTED" }, data: { reviewStatus: TO[input.decision], reviewNote: note, reviewedAt: now, reviewedById: actor.id } });
    if (res.count !== 1) throw conflict("This event was already decided.");
    await writeAudit({ actorId: actor.id, action: AUDIT[input.decision], entityType: "event", entityId: eventId, before: { reviewStatus: event.reviewStatus }, after: { reviewStatus: TO[input.decision], reason: note } }, tx);
  });
}

export const reviewQuerySchema = z.object({
  q: z.string().transform(stripNul).pipe(z.string().trim().max(100)).optional(),
  review: z.enum(["NOT_SUBMITTED", "SUBMITTED", "APPROVED", "CHANGES_REQUESTED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listEventReviews(actor: Actor, q: z.infer<typeof reviewQuerySchema>) {
  assertAdmin(actor);
  const db = getDb();
  const where: Prisma.EventWhereInput = {
    reviewStatus: q.review ?? { not: "NOT_SUBMITTED" },
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { slug: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  const [total, items] = await Promise.all([
    db.event.count({ where }),
    db.event.findMany({
      where, orderBy: [{ reviewStatus: "asc" }, { updatedAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, title: true, slug: true, category: true, status: true, reviewStatus: true, reviewNote: true, reviewedAt: true, startsAt: true, updatedAt: true, organizers: { select: { user: { select: { fullName: true } } } } },
    }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, items };
}

/** Everything a reviewer needs to decide, plus the review history. Organizer contact details are limited to name and email. */
export async function getEventForReview(actor: Actor, eventId: string) {
  assertAdmin(actor);
  const db = getDb();
  const e = await db.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, slug: true, title: true, category: true, summary: true, description: true, status: true, reviewStatus: true, reviewNote: true, reviewedAt: true, reviewedBy: { select: { fullName: true } },
      startsAt: true, endsAt: true, registrationOpensAt: true, registrationClosesAt: true, submissionDeadline: true, judgingStartsAt: true, judgingEndsAt: true, resultsAnnouncementAt: true,
      capacity: true, registrationMode: true, minTeamSize: true, maxTeamSize: true, eligibility: true, locationType: true, location: true, timezone: true,
      organizers: { select: { isLead: true, user: { select: { id: true, fullName: true, email: true } } } },
      hosts: { select: { role: true, organization: { select: { name: true, verifiedAt: true } } } },
      schedule: { select: { id: true } },
    },
  });
  if (!e) throw notFound("Event");
  const history = await db.auditLog.findMany({ where: { entityType: "event", entityId: eventId, action: { startsWith: "event.review_" } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, createdAt: true, after: true, actor: { select: { fullName: true } } } });
  return { ...e, scheduleItems: e.schedule.length, history: history.map((h) => ({ id: h.id, action: h.action, at: h.createdAt, by: h.actor?.fullName ?? "system", reason: (h.after as { reason?: string } | null)?.reason ?? null })) };
}
