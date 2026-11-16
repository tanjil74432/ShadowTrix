import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError, conflict } from "@/server/http/errors";
import { writeAudit } from "@/server/modules/audit/audit.service";
import type { Actor } from "@/server/modules/authz/permissions";
import { awardForRank, finalScore, rankEntries, round3, scorecardPercent, type CriterionSpec } from "@/server/modules/judging/scoring";
import { loadManagedEvent } from "@/server/modules/events/events.service";

type Tx = Prisma.TransactionClient;

export interface StandingRow {
  submissionId: string;
  title: string;
  score: number;
  rank: number;
  tied: boolean;
  award: "WINNER" | "RUNNER_UP" | "FINALIST" | "NONE";
  breakdown: { judges: { judgeId: string; percent: number }[]; criteria: { criterionId: string; name: string; average: number }[] };
}
export interface Standings {
  criteria: number;
  judges: number;
  eligible: number;
  rows: StandingRow[];
  /** Eligible submissions that do not yet have a finalized, complete scorecard from every assigned judge. */
  missing: { submissionId: string; title: string; judgesMissing: number }[];
  /** True only when results could be published: criteria, judges and submissions exist and nothing is missing. */
  complete: boolean;
}

/**
 * Computes the standings from FINALIZED scorecards only (see judging/scoring.ts for the formula). Submissions that are
 * still missing a judge's finalized card are listed in `missing` and are not ranked; nothing is estimated or filled in.
 */
export async function computeStandings(db: Pick<Tx, "judgingCriterion" | "judgeAssignment" | "submission" | "score">, eventId: string): Promise<Standings> {
  const [criteriaRows, assignments, subs] = await Promise.all([
    db.judgingCriterion.findMany({ where: { eventId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.judgeAssignment.findMany({ where: { eventId }, select: { judgeId: true } }),
    db.submission.findMany({ where: { eventId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "SCORED"] } }, select: { id: true, title: true } }),
  ]);
  const specs: CriterionSpec[] = criteriaRows.map((c) => ({ id: c.id, maxScore: c.maxScore.toNumber(), weight: c.weight.toNumber() }));
  const judgeIds = assignments.map((a) => a.judgeId);
  const scores = subs.length ? await db.score.findMany({ where: { submissionId: { in: subs.map((s) => s.id) }, finalizedAt: { not: null } } }) : [];

  const entries: { entry: Omit<StandingRow, "rank" | "tied" | "award">; score: number; key: string }[] = [];
  const missing: Standings["missing"] = [];
  for (const s of subs) {
    const judgeResults: { judgeId: string; percent: number; exact: number; byCriterion: Map<string, number> }[] = [];
    for (const j of judgeIds) {
      const mine = scores.filter((x) => x.submissionId === s.id && x.judgeId === j);
      const byCriterion = new Map(mine.map((x) => [x.criterionId, x.score.toNumber()]));
      const exact = specs.length ? scorecardPercent(specs, byCriterion, true) : null;
      if (exact !== null) judgeResults.push({ judgeId: j, percent: round3(exact), exact, byCriterion });
    }
    if (judgeIds.length === 0 || specs.length === 0 || judgeResults.length < judgeIds.length) {
      missing.push({ submissionId: s.id, title: s.title, judgesMissing: judgeIds.length - judgeResults.length });
      continue;
    }
    const final = finalScore(judgeResults.map((r) => r.exact))!;
    entries.push({
      key: s.id,
      score: final,
      entry: {
        submissionId: s.id, title: s.title, score: final,
        breakdown: {
          judges: judgeResults.map((r) => ({ judgeId: r.judgeId, percent: r.percent })),
          criteria: criteriaRows.map((c) => ({ criterionId: c.id, name: c.name, average: round3(judgeResults.reduce((a, r) => a + (r.byCriterion.get(c.id) ?? 0), 0) / judgeResults.length) })),
        },
      },
    });
  }
  const ranked = rankEntries(entries).map((r) => ({ ...r.entry, rank: r.rank, tied: r.tied, award: awardForRank(r.rank) }));
  return {
    criteria: specs.length, judges: judgeIds.length, eligible: subs.length, rows: ranked, missing,
    complete: specs.length > 0 && judgeIds.length > 0 && subs.length > 0 && missing.length === 0,
  };
}

/** Recalculates the DRAFT results (never touches published ones) and returns the standings, for the organizer to review. */
export async function recalculateResults(actor: Actor, eventId: string, now: Date = new Date()): Promise<Standings> {
  return getDb().$transaction(async (tx) => {
    const event = await loadManagedEvent(actor, eventId, tx);
    if (event.resultsPublishedAt) throw conflict("Results are published. Unpublish them before recalculating.");
    const standings = await computeStandings(tx, eventId);
    await tx.result.deleteMany({ where: { eventId, publishedAt: null } });
    for (const r of standings.rows) {
      await tx.result.create({ data: { eventId, submissionId: r.submissionId, finalScore: r.score, rank: r.rank, award: r.award, breakdown: r.breakdown, computedAt: now } });
    }
    await writeAudit({ actorId: actor.id, action: "results.calculated", entityType: "event", entityId: eventId, after: { ranked: standings.rows.length, missing: standings.missing.length, complete: standings.complete } }, tx);
    return standings;
  });
}

/** The draft view for organizers: standings plus completeness (never shown to the public). */
export async function getDraftStandings(actor: Actor, eventId: string) {
  const event = await loadManagedEvent(actor, eventId);
  const standings = await computeStandings(getDb(), eventId);
  return { ...standings, published: !!event.resultsPublishedAt, publishedAt: event.resultsPublishedAt };
}

/**
 * Publishes the results. The standings are recomputed inside the same transaction from finalized scores, and publishing is
 * refused unless they are COMPLETE: every eligible submission scored by every assigned judge. A snapshot of what was
 * published goes into the audit log.
 */
export async function publishResults(actor: Actor, eventId: string, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    const event = await loadManagedEvent(actor, eventId, tx);
    if (event.status !== "PUBLISHED") throw conflict("Only a published event can have published results.");
    if (event.resultsPublishedAt) throw conflict("The results are already published.");
    const standings = await computeStandings(tx, eventId);
    if (standings.criteria === 0) throw new AppError(409, "results_incomplete", "Define the judging criteria first.");
    if (standings.judges === 0) throw new AppError(409, "results_incomplete", "Assign at least one judge first.");
    if (standings.eligible === 0) throw new AppError(409, "results_incomplete", "There are no submitted projects to rank.");
    if (standings.missing.length > 0) {
      throw new AppError(409, "results_incomplete", `${standings.missing.length} submission(s) still need finalized scorecards from every judge, so the results cannot be published: ${standings.missing.slice(0, 5).map((m) => m.title).join(", ")}${standings.missing.length > 5 ? ", ..." : ""}.`);
    }
    await tx.result.deleteMany({ where: { eventId } });
    for (const r of standings.rows) {
      await tx.result.create({ data: { eventId, submissionId: r.submissionId, finalScore: r.score, rank: r.rank, award: r.award, breakdown: r.breakdown, computedAt: now, publishedAt: now } });
    }
    await tx.event.update({ where: { id: eventId }, data: { resultsPublishedAt: now } });
    await writeAudit({
      actorId: actor.id, action: "results.published", entityType: "event", entityId: eventId,
      after: { ranked: standings.rows.length, top: standings.rows.slice(0, 5).map((r) => ({ submissionId: r.submissionId, rank: r.rank, score: r.score, award: r.award })) },
    }, tx);
    return { published: standings.rows.length };
  });
}

/** Withdraws published results (for a correction). Refused while valid certificates exist, so no certificate is left without results. */
export async function unpublishResults(actor: Actor, eventId: string, reason: string) {
  return getDb().$transaction(async (tx) => {
    const event = await loadManagedEvent(actor, eventId, tx);
    if (!event.resultsPublishedAt) throw conflict("The results are not published.");
    const certs = await tx.certificate.count({ where: { eventId, revokedAt: null } });
    if (certs > 0) throw conflict("Certificates have been issued from these results. Revoke them first.");
    await tx.result.updateMany({ where: { eventId }, data: { publishedAt: null } });
    await tx.event.update({ where: { id: eventId }, data: { resultsPublishedAt: null } });
    await writeAudit({ actorId: actor.id, action: "results.unpublished", entityType: "event", entityId: eventId, after: { reason: reason.slice(0, 500) } }, tx);
  });
}

// ───────────────────────────── public and participant views ─────────────────────────────

/**
 * The public leaderboard of a PUBLISHED event: rank, award, final score, project title and the team (or the individual's)
 * name. No judge identities, no per-judge scores, no feedback, no emails. Returns null for unknown events and for events whose
 * results are not published, so unpublished results are indistinguishable from nonexistent ones.
 */
export async function getPublicResults(slug: string) {
  const db = getDb();
  const event = await db.event.findFirst({ where: { slug, status: { in: ["PUBLISHED", "CANCELLED"] }, resultsPublishedAt: { not: null } }, select: { id: true, title: true, slug: true, timezone: true, resultsPublishedAt: true } });
  if (!event) return null;
  const rows = await db.result.findMany({
    where: { eventId: event.id, publishedAt: { not: null }, submission: { status: { not: "DISQUALIFIED" } } },
    orderBy: [{ rank: "asc" }, { id: "asc" }],
    select: { rank: true, award: true, finalScore: true, submission: { select: { title: true, team: { select: { name: true } }, owner: { select: { fullName: true } } } } },
  });
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.rank ?? 0, (counts.get(r.rank ?? 0) ?? 0) + 1);
  return {
    event,
    entries: rows.map((r) => ({
      rank: r.rank as number, tied: (counts.get(r.rank ?? 0) ?? 0) > 1, award: r.award, score: r.finalScore.toNumber(),
      title: r.submission.title, name: r.submission.team?.name ?? r.submission.owner.fullName,
    })),
  };
}

/** The caller's own published result (their team's, for team events) with anonymous per-criterion averages and feedback. */
export async function getMyResult(actor: Actor, eventId: string) {
  const db = getDb();
  const reg = await db.registration.findUnique({ where: { eventId_userId: { eventId, userId: actor.id } }, select: { teamId: true } });
  const sub = await db.submission.findFirst({ where: reg?.teamId ? { eventId, teamId: reg.teamId } : { eventId, ownerId: actor.id, teamId: null }, select: { id: true, title: true } });
  if (!sub) return null;
  const result = await db.result.findUnique({ where: { submissionId: sub.id }, select: { rank: true, award: true, finalScore: true, publishedAt: true, breakdown: true } });
  if (!result?.publishedAt) return null;
  const feedback = await db.score.findMany({ where: { submissionId: sub.id, feedback: { not: null }, finalizedAt: { not: null } }, select: { feedback: true, criterion: { select: { name: true } } }, orderBy: { id: "asc" } });
  const breakdown = result.breakdown as { criteria?: { name: string; average: number }[] } | null;
  return {
    title: sub.title, rank: result.rank, award: result.award, score: result.finalScore.toNumber(),
    criteria: breakdown?.criteria ?? [],
    feedback: feedback.map((f) => ({ criterion: f.criterion.name, text: f.feedback as string })), // judges are not named
  };
}

