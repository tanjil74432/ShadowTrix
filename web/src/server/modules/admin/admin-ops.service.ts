import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { notFound } from "@/server/http/errors";
import { stripNul } from "@/lib/sanitize";
import type { Actor } from "@/server/modules/authz/permissions";
import { getEmailStatus } from "@/server/modules/email/email-config";
import { assertAdmin, scrubAuditJson } from "./admin-management.service";
import { getMaintenanceState } from "./maintenance.service";

/**
 * Read models for the administration pages. Everything is a real query; nothing is cached or invented. Private data is minimized:
 * team views show names and roles (no emails), invitation addresses are masked, and submission views never include storage keys
 * (files are downloaded only through the existing authorized, signed download endpoint).
 */
const q100 = z.string().transform(stripNul).pipe(z.string().trim().max(100)).optional();
const paging = { page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const isoDate = z.iso.date().optional();

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return domain ? `${name.slice(0, 1)}***@${domain}` : "***";
}

// ───────────────────────────── overview ─────────────────────────────

export async function getAdminOverview(actor: Actor, now: Date = new Date()) {
  assertAdmin(actor);
  const db = getDb();
  const [users, verified, active, suspended, eventsByStatus, ongoing, completed, awaitingReview, orgs, orgsUnverified, teams, submissions, pendingJudging, publishedResults, certsIssued, certsRevoked, recent, outbox, maintenance, noJudgesLive] = await Promise.all([
    db.user.count(), db.user.count({ where: { emailVerifiedAt: { not: null } } }), db.user.count({ where: { status: "ACTIVE" } }), db.user.count({ where: { status: "SUSPENDED" } }),
    db.event.groupBy({ by: ["status"], _count: { _all: true } }),
    db.event.count({ where: { status: "PUBLISHED", startsAt: { lte: now }, endsAt: { gt: now } } }),
    db.event.count({ where: { status: "PUBLISHED", endsAt: { lte: now } } }),
    db.event.count({ where: { reviewStatus: "SUBMITTED" } }),
    db.organization.count(), db.organization.count({ where: { verifiedAt: null } }),
    db.team.count({ where: { status: "ACTIVE" } }), db.submission.count({ where: { status: { not: "DRAFT" } } }),
    db.submission.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
    db.event.count({ where: { resultsPublishedAt: { not: null } } }),
    db.certificate.count({ where: { revokedAt: null } }), db.certificate.count({ where: { revokedAt: { not: null } } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { id: true, action: true, entityType: true, createdAt: true, actor: { select: { fullName: true } } } }),
    db.storageDeletion.count({ where: { attempts: { gt: 2 } } }),
    getMaintenanceState(true),
    db.event.count({ where: { status: "PUBLISHED", endsAt: { gt: now }, judges: { none: {} }, submissions: { some: { status: { not: "DRAFT" } } } } }),
  ]);
  const byStatus = Object.fromEntries(eventsByStatus.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const email = getEmailStatus();
  const alerts: { level: "warning" | "info"; text: string; href?: string }[] = [];
  if (maintenance.enabled) alerts.push({ level: "warning", text: "Maintenance mode is ON: public changes are paused.", href: "/admin/maintenance" });
  if (!email.ready) alerts.push({ level: "warning", text: "Email delivery is not configured, so sign-up and password reset are unavailable.", href: "/admin/maintenance" });
  if (outbox > 0) alerts.push({ level: "warning", text: `${outbox} stored-file deletion(s) keep failing.`, href: "/admin/maintenance" });
  if (awaitingReview) alerts.push({ level: "info", text: `${awaitingReview} event(s) await approval.`, href: "/admin/event-approvals?review=SUBMITTED" });
  if (orgsUnverified) alerts.push({ level: "info", text: `${orgsUnverified} organization(s) are not verified yet.`, href: "/admin/organizations" });
  if (noJudgesLive) alerts.push({ level: "warning", text: `${noJudgesLive} live event(s) have submissions but no judges assigned.`, href: "/admin/judging" });
  return {
    users: { total: users, verified, unverified: users - verified, active, suspended },
    events: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), draft: byStatus.DRAFT ?? 0, published: byStatus.PUBLISHED ?? 0, cancelled: byStatus.CANCELLED ?? 0, archived: byStatus.ARCHIVED ?? 0, ongoing, completed, awaitingReview },
    organizations: { total: orgs, unverified: orgsUnverified },
    teams, submissions, pendingJudging, publishedResults, certificates: { issued: certsIssued, revoked: certsRevoked },
    recent: recent.map((r) => ({ id: r.id, action: r.action, entityType: r.entityType, at: r.createdAt, by: r.actor?.fullName ?? "system" })),
    alerts,
  };
}

// ───────────────────────────── teams ─────────────────────────────

export const teamsQuerySchema = z.object({ q: q100, eventId: z.uuid().optional(), status: z.enum(["ACTIVE", "DISBANDED"]).optional(), ...paging });

export async function listAdminTeams(actor: Actor, q: z.infer<typeof teamsQuerySchema>) {
  assertAdmin(actor);
  const db = getDb();
  const where: Prisma.TeamWhereInput = {
    ...(q.eventId ? { eventId: q.eventId } : {}), ...(q.status ? { status: q.status } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { event: { title: { contains: q.q, mode: "insensitive" } } }, { leader: { fullName: { contains: q.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, items] = await Promise.all([
    db.team.count({ where }),
    db.team.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, name: true, status: true, createdAt: true, event: { select: { id: true, title: true } }, leader: { select: { fullName: true } }, _count: { select: { members: true, invitations: true } }, submission: { select: { status: true } } },
    }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, items };
}

export async function getAdminTeam(actor: Actor, teamId: string) {
  assertAdmin(actor);
  const db = getDb();
  const t = await db.team.findUnique({
    where: { id: teamId },
    select: {
      id: true, name: true, description: true, status: true, createdAt: true, event: { select: { id: true, title: true, status: true } }, leader: { select: { id: true, fullName: true } },
      members: { orderBy: { joinedAt: "asc" }, select: { role: true, joinedAt: true, user: { select: { id: true, fullName: true } } } },
      invitations: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, status: true, inviteeEmail: true, createdAt: true, expiresAt: true, respondedAt: true } },
      registrations: { select: { status: true, registeredAt: true }, take: 1 },
      submission: { select: { id: true, title: true, status: true, submittedAt: true } },
    },
  });
  if (!t) throw notFound("Team");
  // Participation history: the other events this team's members took part in with a team (names only).
  const memberIds = t.members.map((m) => m.user.id);
  const otherTeams = memberIds.length ? await db.teamMember.findMany({ where: { userId: { in: memberIds }, teamId: { not: teamId } }, select: { team: { select: { id: true, name: true, event: { select: { title: true } } } } }, take: 30 }) : [];
  const activity = await db.auditLog.findMany({ where: { entityType: "team", entityId: teamId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, createdAt: true, after: true, actor: { select: { fullName: true } } } });
  return {
    ...t, invitations: t.invitations.map((i) => ({ ...i, inviteeEmail: maskEmail(i.inviteeEmail) })),
    memberHistory: [...new Map(otherTeams.map((o) => [o.team.id, o.team])).values()].map((x) => ({ id: x.id, name: x.name, event: x.event.title })),
    activity: activity.map((a) => ({ id: a.id, action: a.action, at: a.createdAt, by: a.actor?.fullName ?? "system", details: scrubAuditJson(a.after) })),
  };
}

// ───────────────────────────── submissions ─────────────────────────────

export const submissionsQuerySchema = z.object({
  q: q100, eventId: z.uuid().optional(), teamId: z.uuid().optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "SCORED", "DISQUALIFIED"]).optional(), from: isoDate, to: isoDate, ...paging,
});

export async function listAdminSubmissions(actor: Actor, q: z.infer<typeof submissionsQuerySchema>) {
  assertAdmin(actor);
  const db = getDb();
  const where: Prisma.SubmissionWhereInput = {
    ...(q.eventId ? { eventId: q.eventId } : {}), ...(q.teamId ? { teamId: q.teamId } : {}), ...(q.status ? { status: q.status } : {}),
    ...(q.from || q.to ? { submittedAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } : {}) } } : {}),
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { team: { name: { contains: q.q, mode: "insensitive" } } }, { owner: { fullName: { contains: q.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, items] = await Promise.all([
    db.submission.count({ where }),
    db.submission.findMany({
      where, orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, title: true, status: true, submittedAt: true, currentVersion: true, event: { select: { id: true, title: true } }, team: { select: { id: true, name: true } }, owner: { select: { fullName: true } }, _count: { select: { files: true } } },
    }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, items };
}

/** Metadata only. File rows carry id, name, type and size, never the storage key; downloads go through /api/v1/submissions/{id}/files/{fileId}. */
export async function getAdminSubmission(actor: Actor, submissionId: string) {
  assertAdmin(actor);
  const db = getDb();
  const s = await db.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true, title: true, description: true, repoUrl: true, demoUrl: true, extraLinks: true, status: true, submittedAt: true, currentVersion: true, createdAt: true,
      event: { select: { id: true, title: true, resultsPublishedAt: true }, }, team: { select: { id: true, name: true } }, owner: { select: { fullName: true } },
      files: { orderBy: { createdAt: "asc" }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } },
      versions: { orderBy: { version: "desc" }, select: { version: true, createdAt: true, createdBy: { select: { fullName: true } } } },
      result: { select: { rank: true, finalScore: true, award: true, publishedAt: true } },
    },
  });
  if (!s) throw notFound("Submission");
  const [criteria, judges, scores, history] = await Promise.all([
    db.judgingCriterion.count({ where: { eventId: s.event.id } }),
    db.judgeAssignment.findMany({ where: { eventId: s.event.id }, select: { judge: { select: { id: true, fullName: true } } } }),
    db.score.groupBy({ by: ["judgeId"], where: { submissionId, finalizedAt: { not: null } }, _count: { _all: true } }),
    db.auditLog.findMany({ where: { entityType: "submission", entityId: submissionId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, createdAt: true, after: true, actor: { select: { fullName: true } } } }),
  ]);
  const done = new Map(scores.map((g) => [g.judgeId, g._count._all]));
  return {
    ...s,
    judging: { criteria, judges: judges.map((j) => ({ name: j.judge.fullName, complete: criteria > 0 && (done.get(j.judge.id) ?? 0) >= criteria })) },
    history: history.map((h) => ({ id: h.id, action: h.action, at: h.createdAt, by: h.actor?.fullName ?? "system", details: scrubAuditJson(h.after) })),
  };
}

// ───────────────────────────── judging ─────────────────────────────

export const judgingQuerySchema = z.object({ q: q100, incomplete: z.enum(["1"]).optional(), ...paging });

/** Scorecard progress for events that have judges, criteria or submissions. A scorecard is complete when a judge finalized every criterion. */
export async function getJudgingOverview(actor: Actor, q: z.infer<typeof judgingQuerySchema>) {
  assertAdmin(actor);
  const db = getDb();
  const where: Prisma.EventWhereInput = {
    OR: [{ judges: { some: {} } }, { criteria: { some: {} } }, { submissions: { some: { status: { not: "DRAFT" } } } }],
    ...(q.q ? { title: { contains: q.q, mode: "insensitive" } } : {}),
  };
  const events = await db.event.findMany({
    where, orderBy: [{ judgingEndsAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { id: true, title: true, judgingStartsAt: true, judgingEndsAt: true, resultsPublishedAt: true, _count: { select: { criteria: true, judges: true } } },
  });
  const ids = events.map((e) => e.id);
  const [subs, groups] = ids.length ? await Promise.all([
    db.submission.groupBy({ by: ["eventId"], where: { eventId: { in: ids }, status: { in: ["SUBMITTED", "UNDER_REVIEW", "SCORED"] } }, _count: { _all: true } }),
    db.score.groupBy({ by: ["submissionId", "judgeId"], where: { finalizedAt: { not: null }, submission: { eventId: { in: ids } } }, _count: { _all: true } }),
  ]) : [[], []];
  const owner = new Map<string, string>();
  if (groups.length) for (const s of await db.submission.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.submissionId))] } }, select: { id: true, eventId: true } })) owner.set(s.id, s.eventId);
  const rows = events.map((e) => {
    const submissions = subs.find((s) => s.eventId === e.id)?._count._all ?? 0;
    const completed = groups.filter((g) => owner.get(g.submissionId) === e.id && g._count._all >= e._count.criteria && e._count.criteria > 0).length;
    const expected = submissions * e._count.judges;
    return { ...e, submissions, expected, completed, percent: expected ? Math.min(100, Math.round((completed / expected) * 100)) : null };
  });
  const filtered = q.incomplete ? rows.filter((r) => r.expected === 0 || r.completed < r.expected) : rows;
  return { total: filtered.length, page: q.page, pageSize: q.pageSize, items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize) };
}

export async function getJudgingEvent(actor: Actor, eventId: string) {
  assertAdmin(actor);
  const db = getDb();
  const e = await db.event.findUnique({ where: { id: eventId }, select: { id: true, title: true, judgingStartsAt: true, judgingEndsAt: true, resultsPublishedAt: true } });
  if (!e) throw notFound("Event");
  const [criteria, judges, subs, finalized, history] = await Promise.all([
    db.judgingCriterion.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, maxScore: true, weight: true } }),
    db.judgeAssignment.findMany({ where: { eventId }, select: { judge: { select: { id: true, fullName: true } } } }),
    db.submission.findMany({ where: { eventId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "SCORED"] } }, orderBy: { submittedAt: "asc" }, select: { id: true, title: true, team: { select: { name: true } } } }),
    db.score.groupBy({ by: ["submissionId", "judgeId"], where: { finalizedAt: { not: null }, submission: { eventId } }, _count: { _all: true } }),
    db.auditLog.findMany({ where: { OR: [{ entityType: "event", entityId: eventId, action: { startsWith: "judg" } }, { action: { startsWith: "score." }, entityId: { in: (await db.submission.findMany({ where: { eventId }, select: { id: true } })).map((s) => s.id) } }] }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, createdAt: true, actor: { select: { fullName: true } } } }),
  ]);
  const need = criteria.length;
  const done = (sid: string, jid: string) => need > 0 && (finalized.find((g) => g.submissionId === sid && g.judgeId === jid)?._count._all ?? 0) >= need;
  return {
    event: e, criteria: criteria.map((c) => ({ ...c, maxScore: Number(c.maxScore), weight: Number(c.weight) })),
    judges: judges.map((j) => ({ id: j.judge.id, name: j.judge.fullName, completed: subs.filter((s) => done(s.id, j.judge.id)).length, total: subs.length })),
    incomplete: subs.map((s) => ({ id: s.id, title: s.title, team: s.team?.name ?? null, missing: judges.filter((j) => !done(s.id, j.judge.id)).map((j) => j.judge.fullName) })).filter((s) => s.missing.length > 0),
    history: history.map((h) => ({ id: h.id, action: h.action, at: h.createdAt, by: h.actor?.fullName ?? "system" })),
  };
}

// ───────────────────────────── results ─────────────────────────────

export const resultsQuerySchema = z.object({ q: q100, published: z.enum(["yes", "no"]).optional(), ...paging });

export async function listAdminResults(actor: Actor, q: z.infer<typeof resultsQuerySchema>) {
  assertAdmin(actor);
  const db = getDb();
  const where: Prisma.EventWhereInput = {
    results: { some: {} },
    ...(q.published === "yes" ? { resultsPublishedAt: { not: null } } : q.published === "no" ? { resultsPublishedAt: null } : {}),
    ...(q.q ? { title: { contains: q.q, mode: "insensitive" } } : {}),
  };
  const [total, items] = await Promise.all([
    db.event.count({ where }),
    db.event.findMany({ where, orderBy: [{ resultsPublishedAt: { sort: "desc", nulls: "first" } }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, title: true, resultsPublishedAt: true, _count: { select: { results: true } } } }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, items };
}

export async function getAdminResults(actor: Actor, eventId: string) {
  assertAdmin(actor);
  const db = getDb();
  const e = await db.event.findUnique({ where: { id: eventId }, select: { id: true, title: true, resultsPublishedAt: true } });
  if (!e) throw notFound("Event");
  const rows = await db.result.findMany({ where: { eventId }, orderBy: [{ rank: { sort: "asc", nulls: "last" } }, { finalScore: "desc" }], select: { id: true, rank: true, finalScore: true, award: true, publishedAt: true, computedAt: true, breakdown: true, submission: { select: { id: true, title: true, team: { select: { name: true } }, owner: { select: { fullName: true } } } } } });
  const rankCount = new Map<number, number>();
  for (const r of rows) if (r.rank != null) rankCount.set(r.rank, (rankCount.get(r.rank) ?? 0) + 1);
  const history = await db.auditLog.findMany({ where: { entityType: "event", entityId: eventId, action: { startsWith: "results." } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, createdAt: true, after: true, actor: { select: { fullName: true } } } });
  return {
    event: e,
    rows: rows.map((r) => ({ id: r.id, rank: r.rank, tied: r.rank != null && (rankCount.get(r.rank) ?? 0) > 1, finalScore: Number(r.finalScore), award: r.award, title: r.submission.title, by: r.submission.team?.name ?? r.submission.owner.fullName, submissionId: r.submission.id, breakdown: scrubAuditJson(r.breakdown) })),
    history: history.map((h) => ({ id: h.id, action: h.action, at: h.createdAt, by: h.actor?.fullName ?? "system", details: scrubAuditJson(h.after) })),
  };
}

// ───────────────────────────── certificates ─────────────────────────────

export const certificatesQuerySchema = z.object({
  q: q100, eventId: z.uuid().optional(), type: z.enum(["PARTICIPATION", "FINALIST", "WINNER"]).optional(), status: z.enum(["issued", "revoked"]).optional(), ...paging,
});

export async function listAdminCertificates(actor: Actor, q: z.infer<typeof certificatesQuerySchema>) {
  assertAdmin(actor);
  const db = getDb();
  const term = q.q?.toUpperCase();
  const where: Prisma.CertificateWhereInput = {
    ...(q.eventId ? { eventId: q.eventId } : {}), ...(q.type ? { type: q.type } : {}),
    ...(q.status === "revoked" ? { revokedAt: { not: null } } : q.status === "issued" ? { revokedAt: null } : {}),
    ...(q.q ? { OR: [{ publicCode: { contains: term!, mode: "insensitive" } }, { recipientName: { contains: q.q, mode: "insensitive" } }, { event: { title: { contains: q.q, mode: "insensitive" } } }, { user: { teamMemberships: { some: { team: { name: { contains: q.q, mode: "insensitive" } } } } } }] } : {}),
  };
  const [total, items] = await Promise.all([
    db.certificate.count({ where }),
    db.certificate.findMany({
      where, orderBy: [{ issuedAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, publicCode: true, type: true, recipientName: true, issuedAt: true, revokedAt: true, revokedReason: true, event: { select: { id: true, title: true } }, issuedBy: { select: { fullName: true } } },
    }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, items };
}
