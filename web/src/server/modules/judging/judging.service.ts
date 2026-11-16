import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError, conflict, forbidden, notFound } from "@/server/http/errors";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { revokeAllUserSessions } from "@/server/modules/auth/session.service";
import { canManageEvent, type Actor } from "@/server/modules/authz/permissions";
import { loadManagedEvent } from "@/server/modules/events/events.service";
import { getSubmission, submissionDeadlineOf } from "@/server/modules/submissions/submissions.service";
import type { CriterionInput, ScorecardInput } from "./judging.schema";
import { scorecardPercent, type CriterionSpec } from "./scoring";

type Tx = Prisma.TransactionClient;

const toSpec = (c: { id: string; maxScore: Prisma.Decimal; weight: Prisma.Decimal }): CriterionSpec => ({ id: c.id, maxScore: c.maxScore.toNumber(), weight: c.weight.toNumber() });

// ───────────────────────────── criteria ─────────────────────────────

async function assertCriteriaEditable(tx: Tx, eventId: string) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { resultsPublishedAt: true } });
  if (event.resultsPublishedAt) throw conflict("Results are published, so the criteria can no longer change.");
  const scores = await tx.score.count({ where: { submission: { eventId } } });
  if (scores > 0) throw conflict("Judges have already started scoring, so the criteria can no longer change.");
}

export async function listCriteria(actor: Actor, eventId: string) {
  const db = getDb();
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, status: true, organizers: { select: { userId: true } } } });
  if (!event) throw notFound("Event");
  const manages = canManageEvent(actor, event.id, event.organizers.map((o) => o.userId));
  const judges = !manages && !!(await db.judgeAssignment.findUnique({ where: { eventId_judgeId: { eventId, judgeId: actor.id } } }));
  if (!manages && !judges) throw event.status === "DRAFT" || event.status === "ARCHIVED" ? notFound("Event") : forbidden();
  const rows = await db.judgingCriterion.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map((c) => ({ id: c.id, name: c.name, description: c.description, maxScore: c.maxScore.toNumber(), weight: c.weight.toNumber(), sortOrder: c.sortOrder }));
}

export async function createCriterion(actor: Actor, eventId: string, input: CriterionInput) {
  return getDb().$transaction(async (tx) => {
    await loadManagedEvent(actor, eventId, tx);
    await assertCriteriaEditable(tx, eventId);
    try {
      const c = await tx.judgingCriterion.create({ data: { eventId, name: input.name, description: input.description ?? null, maxScore: input.maxScore, weight: input.weight, sortOrder: input.sortOrder } });
      await writeAudit({ actorId: actor.id, action: "criterion.created", entityType: "event", entityId: eventId, after: { criterionId: c.id, name: c.name, maxScore: input.maxScore, weight: input.weight } }, tx);
      return { id: c.id };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new AppError(409, "criterion_name_taken", "A criterion with this name already exists.");
      throw e;
    }
  });
}

export async function updateCriterion(actor: Actor, eventId: string, criterionId: string, input: Partial<CriterionInput>) {
  return getDb().$transaction(async (tx) => {
    await loadManagedEvent(actor, eventId, tx);
    await assertCriteriaEditable(tx, eventId);
    const existing = await tx.judgingCriterion.findFirst({ where: { id: criterionId, eventId } });
    if (!existing) throw notFound("Criterion");
    try {
      await tx.judgingCriterion.update({
        where: { id: criterionId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.maxScore !== undefined ? { maxScore: input.maxScore } : {}),
          ...(input.weight !== undefined ? { weight: input.weight } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new AppError(409, "criterion_name_taken", "A criterion with this name already exists.");
      throw e;
    }
    await writeAudit({ actorId: actor.id, action: "criterion.updated", entityType: "event", entityId: eventId, after: { criterionId, fields: Object.keys(input) } }, tx);
  });
}

export async function deleteCriterion(actor: Actor, eventId: string, criterionId: string) {
  return getDb().$transaction(async (tx) => {
    await loadManagedEvent(actor, eventId, tx);
    await assertCriteriaEditable(tx, eventId);
    const res = await tx.judgingCriterion.deleteMany({ where: { id: criterionId, eventId } });
    if (res.count !== 1) throw notFound("Criterion");
    await writeAudit({ actorId: actor.id, action: "criterion.deleted", entityType: "event", entityId: eventId, after: { criterionId } }, tx);
  });
}

// ───────────────────────────── judge assignment ─────────────────────────────

/**
 * Assigns an existing, verified, active account as a judge of THIS event only. The assignment also records an
 * event-scoped JUDGE role, so the judge area appears for them and no platform-wide role is granted. Their sessions are
 * ended (like any role change) so they sign in again with the new role.
 */
export async function assignJudge(actor: Actor, eventId: string, email: string) {
  return getDb().$transaction(async (tx) => {
    const event = await loadManagedEvent(actor, eventId, tx);
    if (event.status !== "PUBLISHED") throw conflict("Judges can be assigned to a published event.");
    const user = await tx.user.findUnique({ where: { email }, select: { id: true, status: true, emailVerifiedAt: true, fullName: true } });
    if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) throw new AppError(404, "judge_not_found", "No active, confirmed account has that email address. The judge must register first.");
    const member = await tx.teamMember.findUnique({ where: { eventId_userId: { eventId, userId: user.id } } });
    const submitter = await tx.submission.findFirst({ where: { eventId, ownerId: user.id }, select: { id: true } });
    if (member || submitter) throw new AppError(409, "conflict_of_interest", "This person is taking part in the event and cannot also be a judge.");
    const existing = await tx.judgeAssignment.findUnique({ where: { eventId_judgeId: { eventId, judgeId: user.id } } });
    if (existing) return { judgeId: user.id, created: false };
    await tx.judgeAssignment.create({ data: { eventId, judgeId: user.id } });
    const hasScoped = await tx.userRoleAssignment.findFirst({ where: { userId: user.id, role: "JUDGE", eventId } });
    if (!hasScoped) await tx.userRoleAssignment.create({ data: { userId: user.id, role: "JUDGE", eventId, grantedById: actor.id } });
    await revokeAllUserSessions(user.id, "role_changed", tx);
    await writeAudit({ actorId: actor.id, action: "judge.assigned", entityType: "event", entityId: eventId, after: { judgeId: user.id } }, tx);
    return { judgeId: user.id, created: true };
  });
}

export async function unassignJudge(actor: Actor, eventId: string, judgeId: string) {
  return getDb().$transaction(async (tx) => {
    await loadManagedEvent(actor, eventId, tx);
    const scored = await tx.score.count({ where: { judgeId, submission: { eventId } } });
    if (scored > 0) throw conflict("This judge has already entered scores, so they cannot be removed.");
    const res = await tx.judgeAssignment.deleteMany({ where: { eventId, judgeId } });
    if (res.count !== 1) throw notFound("Judge");
    await tx.userRoleAssignment.deleteMany({ where: { userId: judgeId, role: "JUDGE", eventId } });
    await revokeAllUserSessions(judgeId, "role_changed", tx);
    await writeAudit({ actorId: actor.id, action: "judge.unassigned", entityType: "event", entityId: eventId, after: { judgeId } }, tx);
  });
}

export async function listJudges(actor: Actor, eventId: string) {
  await loadManagedEvent(actor, eventId);
  const db = getDb();
  const [assignments, criteria, submissions] = await Promise.all([
    db.judgeAssignment.findMany({ where: { eventId }, include: { judge: { select: { id: true, fullName: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.judgingCriterion.count({ where: { eventId } }),
    db.submission.findMany({ where: { eventId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "SCORED"] } }, select: { id: true } }),
  ]);
  const finals = await db.score.groupBy({ by: ["judgeId", "submissionId"], where: { submission: { eventId }, finalizedAt: { not: null } }, _count: { _all: true } });
  return assignments.map((a) => ({
    judgeId: a.judge.id, fullName: a.judge.fullName, email: a.judge.email,
    finalized: finals.filter((f) => f.judgeId === a.judgeId && f._count._all === criteria).length,
    total: submissions.length,
  }));
}

// ───────────────────────────── judging a submission ─────────────────────────────

async function requireAssignedJudge(tx: Pick<Tx, "judgeAssignment">, judgeId: string, eventId: string) {
  const a = await tx.judgeAssignment.findUnique({ where: { eventId_judgeId: { eventId, judgeId } } });
  if (!a) throw notFound("Submission"); // unassigned people cannot tell the submission exists
}

async function isAuthorOf(tx: Pick<Tx, "teamMember">, sub: { ownerId: string; teamId: string | null; eventId: string }, userId: string) {
  if (sub.ownerId === userId) return true;
  return !!(await tx.teamMember.findUnique({ where: { eventId_userId: { eventId: sub.eventId, userId } } }));
}

export type ScorecardState = "NOT_STARTED" | "DRAFT" | "FINAL";

/** The submissions a judge may score, anonymized (no author or team names), without the judge's own work. */
export async function listAssignedSubmissions(actor: Actor, eventId: string) {
  const db = getDb();
  await requireAssignedJudge(db, actor.id, eventId);
  const [subs, criteria, mine] = await Promise.all([
    db.submission.findMany({ where: { eventId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "SCORED"] }, NOT: { ownerId: actor.id } }, select: { id: true, title: true, status: true, teamId: true, ownerId: true }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }] }),
    db.judgingCriterion.count({ where: { eventId } }),
    db.score.findMany({ where: { judgeId: actor.id, submission: { eventId } }, select: { submissionId: true, finalizedAt: true } }),
  ]);
  const myTeam = await db.teamMember.findUnique({ where: { eventId_userId: { eventId, userId: actor.id } }, select: { teamId: true } });
  return subs
    .filter((s) => !(myTeam && s.teamId === myTeam.teamId))
    .map((s) => {
      const rows = mine.filter((m) => m.submissionId === s.id);
      const state: ScorecardState = rows.length === 0 ? "NOT_STARTED" : criteria > 0 && rows.length === criteria && rows.every((r) => r.finalizedAt) ? "FINAL" : "DRAFT";
      return { id: s.id, title: s.title, status: s.status, state };
    });
}

/** What the judging screen shows: the project (anonymized), the criteria, and this judge's own scores. */
export async function getScorecard(actor: Actor, submissionId: string) {
  const db = getDb();
  const sub = await db.submission.findUnique({ where: { id: submissionId }, select: { id: true, eventId: true, ownerId: true, teamId: true, status: true } });
  if (!sub) throw notFound("Submission");
  await requireAssignedJudge(db, actor.id, sub.eventId);
  if (await isAuthorOf(db, sub, actor.id)) throw new AppError(403, "conflict_of_interest", "You took part in this project, so you cannot judge it.");
  const view = await getSubmission(actor, submissionId); // also enforces "submitted work only"
  const [criteria, scores] = await Promise.all([
    listCriteria(actor, sub.eventId),
    db.score.findMany({ where: { submissionId, judgeId: actor.id }, select: { criterionId: true, score: true, feedback: true, finalizedAt: true } }),
  ]);
  const { team: _team, ...anonymous } = view; // blind judging: never show who the authors are
  void _team;
  return {
    submission: anonymous, criteria,
    scores: scores.map((s) => ({ criterionId: s.criterionId, score: s.score.toNumber(), feedback: s.feedback })),
    finalized: scores.length > 0 && scores.every((s) => s.finalizedAt),
  };
}

export interface ScorecardResult {
  percent: number | null;
  finalized: boolean;
  missing: string[];
}

/**
 * Saves a judge's scores for a submission, optionally finalizing. Rules, all enforced here and (for the maximum) again by a
 * database trigger: only assigned judges; not your own project; submitted work only; judging has opened (after the
 * submission deadline, and not before judgingStartsAt) and has not closed; results are not published; every score is
 * within 0..max with at most two decimals; a finalized scorecard cannot change (an organizer must reopen it); finalizing
 * needs every criterion scored. One transaction per (submission, judge) under an advisory lock, so two requests from the
 * same judge cannot interleave. Nothing incomplete can become final.
 */
export async function saveScorecard(actor: Actor, submissionId: string, input: ScorecardInput, now: Date = new Date()): Promise<ScorecardResult> {
  return getDb().$transaction(async (tx) => {
    const sub = await tx.submission.findUnique({ where: { id: submissionId }, include: { event: true } });
    if (!sub) throw notFound("Submission");
    await requireAssignedJudge(tx, actor.id, sub.eventId);
    if (await isAuthorOf(tx, sub, actor.id)) throw new AppError(403, "conflict_of_interest", "You took part in this project, so you cannot judge it.");
    if (sub.status === "DRAFT") throw notFound("Submission");
    if (sub.status === "DISQUALIFIED") throw new AppError(409, "submission_disqualified", "This submission was disqualified.");
    if (sub.event.resultsPublishedAt) throw new AppError(409, "results_published", "Results are published, so scores can no longer change.");
    const opensAt = sub.event.judgingStartsAt ?? submissionDeadlineOf(sub.event);
    if (now < opensAt) throw new AppError(409, "judging_not_open", "Judging has not opened yet.");
    if (sub.event.judgingEndsAt && now > sub.event.judgingEndsAt) throw new AppError(409, "judging_closed", "Judging has closed.");

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scorecard:${submissionId}:${actor.id}`}))`;
    const criteria = await tx.judgingCriterion.findMany({ where: { eventId: sub.eventId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    if (criteria.length === 0) throw new AppError(409, "no_criteria", "The organizers have not defined judging criteria yet.");
    const existing = await tx.score.findMany({ where: { submissionId, judgeId: actor.id } });
    if (existing.some((s) => s.finalizedAt)) throw new AppError(409, "scorecard_final", "This scorecard is final. Ask an organizer to reopen it.");

    const byId = new Map(criteria.map((c) => [c.id, c]));
    const seen = new Set<string>();
    for (const row of input.scores) {
      const c = byId.get(row.criterionId);
      if (!c) throw new AppError(400, "unknown_criterion", "A score refers to a criterion that does not belong to this event.");
      if (seen.has(row.criterionId)) throw new AppError(400, "duplicate_criterion", "Each criterion can be scored once.");
      seen.add(row.criterionId);
      if (row.score > c.maxScore.toNumber()) throw new AppError(400, "score_out_of_range", `The score for "${c.name}" cannot exceed ${c.maxScore.toNumber()}.`);
    }

    for (const row of input.scores) {
      await tx.score.upsert({
        where: { submissionId_judgeId_criterionId: { submissionId, judgeId: actor.id, criterionId: row.criterionId } },
        create: { submissionId, judgeId: actor.id, criterionId: row.criterionId, score: row.score, feedback: row.feedback ?? null },
        update: { score: row.score, feedback: row.feedback ?? null },
      });
    }
    const all = await tx.score.findMany({ where: { submissionId, judgeId: actor.id } });
    const have = new Map(all.map((s) => [s.criterionId, s.score.toNumber()]));
    const missing = criteria.filter((c) => !have.has(c.id)).map((c) => c.name);
    const percent = missing.length === 0 ? scorecardPercent(criteria.map(toSpec), have) : null;

    if (sub.status === "SUBMITTED") await tx.submission.update({ where: { id: submissionId }, data: { status: "UNDER_REVIEW" } });
    if (!input.finalize) {
      await writeAudit({ actorId: actor.id, action: "score.saved", entityType: "submission", entityId: submissionId, after: { criteria: input.scores.length } }, tx);
      return { percent, finalized: false, missing };
    }
    if (missing.length > 0) throw new AppError(400, "scorecard_incomplete", `Score every criterion before finalizing. Missing: ${missing.join(", ")}.`);
    await tx.score.updateMany({ where: { submissionId, judgeId: actor.id }, data: { finalizedAt: now } });
    await writeAudit({ actorId: actor.id, action: "score.finalized", entityType: "submission", entityId: submissionId, after: { percent } }, tx);

    // Every assigned judge done? Then the submission counts as scored.
    const judges = await tx.judgeAssignment.findMany({ where: { eventId: sub.eventId }, select: { judgeId: true } });
    const done = await tx.score.groupBy({ by: ["judgeId"], where: { submissionId, finalizedAt: { not: null } }, _count: { _all: true } });
    const finishedJudges = new Set(done.filter((d) => d._count._all === criteria.length).map((d) => d.judgeId));
    if (judges.length > 0 && judges.every((j) => finishedJudges.has(j.judgeId))) await tx.submission.update({ where: { id: submissionId }, data: { status: "SCORED" } });
    return { percent, finalized: true, missing: [] };
  });
}

/** An organizer reopens one judge's finalized scorecard (before results are published). Recorded with the reason. */
export async function reopenScorecard(actor: Actor, submissionId: string, judgeId: string, reason: string) {
  return getDb().$transaction(async (tx) => {
    const sub = await tx.submission.findUnique({ where: { id: submissionId }, include: { event: { select: { resultsPublishedAt: true } } } });
    if (!sub) throw notFound("Submission");
    await loadManagedEvent(actor, sub.eventId, tx);
    if (sub.event.resultsPublishedAt) throw conflict("Results are published. Unpublish them before reopening a scorecard.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scorecard:${submissionId}:${judgeId}`}))`;
    const res = await tx.score.updateMany({ where: { submissionId, judgeId, finalizedAt: { not: null } }, data: { finalizedAt: null } });
    if (res.count === 0) throw conflict("That scorecard is not finalized.");
    if (sub.status === "SCORED") await tx.submission.update({ where: { id: submissionId }, data: { status: "UNDER_REVIEW" } });
    await writeAudit({ actorId: actor.id, action: "score.reopened", entityType: "submission", entityId: submissionId, after: { judgeId, reason: reason.slice(0, 500) } }, tx);
  });
}

/** Events the caller is assigned to judge, with how much of their own scoring is done (own work excluded). */
export async function listJudgedEvents(actor: Actor) {
  const db = getDb();
  const rows = await db.judgeAssignment.findMany({
    where: { judgeId: actor.id, event: { status: "PUBLISHED" } },
    select: { event: { select: { id: true, title: true, slug: true, submissionDeadline: true, endsAt: true, judgingStartsAt: true, judgingEndsAt: true, resultsPublishedAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const out = [];
  for (const r of rows) {
    const list = await listAssignedSubmissions(actor, r.event.id);
    out.push({ ...r.event, total: list.length, finalized: list.filter((s) => s.state === "FINAL").length });
  }
  return out;
}

/** For organizers: each assigned judge's scorecard state on one submission (names, never scores' authors elsewhere). */
export async function listScorecardStates(actor: Actor, submissionId: string) {
  const db = getDb();
  const sub = await db.submission.findUnique({ where: { id: submissionId }, select: { eventId: true } });
  if (!sub) throw notFound("Submission");
  await loadManagedEvent(actor, sub.eventId);
  const [assignments, criteria, scores] = await Promise.all([
    db.judgeAssignment.findMany({ where: { eventId: sub.eventId }, include: { judge: { select: { id: true, fullName: true } } } }),
    db.judgingCriterion.count({ where: { eventId: sub.eventId } }),
    db.score.findMany({ where: { submissionId }, select: { judgeId: true, finalizedAt: true } }),
  ]);
  return assignments.map((a) => {
    const mine = scores.filter((x) => x.judgeId === a.judgeId);
    const state: ScorecardState = mine.length === 0 ? "NOT_STARTED" : criteria > 0 && mine.length === criteria && mine.every((x) => x.finalizedAt) ? "FINAL" : "DRAFT";
    return { judgeId: a.judge.id, name: a.judge.fullName, state };
  });
}
