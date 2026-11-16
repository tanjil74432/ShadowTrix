/**
 * The scoring formula, as pure functions (no database, no clock) so it can be tested exhaustively and documented exactly.
 *
 * ── Definitions ──────────────────────────────────────────────────────────────────────────────────────────────────────
 *  A criterion c has a maximum score M_c > 0 and a weight W_c > 0.
 *  A judge's SCORECARD for one submission gives every criterion a score s_c with 0 <= s_c <= M_c.
 *
 *  Scorecard result (a percentage, 0 to 100):
 *        P_judge = 100 * ( sum_c W_c * s_c / M_c ) / ( sum_c W_c )
 *
 *  Final score of a submission: the arithmetic mean of P_judge over ALL assigned judges, each of whom must have FINALIZED a
 *  complete scorecard:
 *        F = ( sum_j P_judge_j ) / J
 *
 *  Rounding: intermediate values are NOT rounded. Only the numbers that are stored or displayed (a scorecard percentage and the
 *  final score) are rounded to 3 decimals, so rounding never accumulates or changes a ranking by itself.
 *
 *  Ranking: submissions are sorted by F, highest first. Equal F (at 3 decimals) share a rank and the next rank is skipped
 *  ("competition ranking": 1, 2, 2, 4). There is no hidden tie-breaker: a tie stays a tie.
 *
 *  Awards (derived from rank only): rank 1 = WINNER, rank 2 = RUNNER_UP, ranks 3 to 5 = FINALIST, others = NONE.
 *  With ties, everyone on a shared rank receives that rank's award.
 *
 *  Why percentages: criteria may have different maxima (a 0-10 criterion and a 0-100 criterion). Normalizing each score by
 *  its maximum first makes the weights mean what organizers expect.
 */
export interface CriterionSpec {
  id: string;
  maxScore: number;
  weight: number;
}

export const round3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000;

/** Scores have at most two decimals (the database column is numeric(6,2)). */
export const hasAtMostTwoDecimals = (x: number) => Math.abs(Math.round(x * 100) - x * 100) < 1e-9;

/**
 * The percentage of one complete scorecard, or null when any criterion has no score. Throws on out-of-range scores.
 * Rounded to 3 decimals unless `exact` is set (used when this value feeds another calculation).
 */
export function scorecardPercent(criteria: readonly CriterionSpec[], scores: ReadonlyMap<string, number>, exact = false): number | null {
  if (criteria.length === 0) return null;
  let weighted = 0;
  let weights = 0;
  for (const c of criteria) {
    const s = scores.get(c.id);
    if (s === undefined) return null;
    if (!Number.isFinite(s) || s < 0 || s > c.maxScore) throw new RangeError(`score ${s} is outside 0..${c.maxScore}`);
    weighted += (c.weight * s) / c.maxScore;
    weights += c.weight;
  }
  const percent = (100 * weighted) / weights;
  return exact ? percent : round3(percent);
}

export function finalScore(judgePercents: readonly number[]): number | null {
  if (judgePercents.length === 0) return null;
  return round3(judgePercents.reduce((a, b) => a + b, 0) / judgePercents.length);
}

export interface RankedEntry<T> {
  entry: T;
  score: number;
  rank: number;
  tied: boolean;
}

/** Competition ranking with ties. Input order does not matter; output is sorted by rank, then by the input's stable key. */
export function rankEntries<T>(entries: readonly { entry: T; score: number; key: string }[]): RankedEntry<T>[] {
  const sorted = [...entries].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out: RankedEntry<T>[] = [];
  sorted.forEach((e, i) => {
    const rank = i > 0 && e.score === sorted[i - 1].score ? out[i - 1].rank : i + 1;
    out.push({ entry: e.entry, score: e.score, rank, tied: false });
  });
  for (const r of out) r.tied = out.filter((o) => o.rank === r.rank).length > 1;
  return out;
}

export type Award = "WINNER" | "RUNNER_UP" | "FINALIST" | "NONE";
export const awardForRank = (rank: number): Award => (rank === 1 ? "WINNER" : rank === 2 ? "RUNNER_UP" : rank <= 5 ? "FINALIST" : "NONE");
