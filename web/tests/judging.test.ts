import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { getCertificatePdf, issueCertificates, listEventCertificates, listMyCertificates, newPublicCode, revokeCertificate, saveTemplate, templateSchema, verifyCertificate } from "@/server/modules/certificates/certificates.service";
import { fillTemplate, renderCertificatePdf, unknownPlaceholders } from "@/server/modules/certificates/certificate-pdf";
import { registerForEvent } from "@/server/modules/events/registrations.service";
import { assignJudge, createCriterion, deleteCriterion, getScorecard, listAssignedSubmissions, listCriteria, listJudges, reopenScorecard, saveScorecard, unassignJudge, updateCriterion } from "@/server/modules/judging/judging.service";
import { criterionSchema, scorecardSchema } from "@/server/modules/judging/judging.schema";
import { awardForRank, finalScore, hasAtMostTwoDecimals, rankEntries, scorecardPercent } from "@/server/modules/judging/scoring";
import { getDraftStandings, getMyResult, getPublicResults, publishResults, recalculateResults, unpublishResults } from "@/server/modules/results/results.service";
import { disqualifySubmission, submitProject } from "@/server/modules/submissions/submissions.service";
import { submissionSchema } from "@/server/modules/submissions/submissions.schema";
import { setStorageForTests } from "@/server/storage";
import { createLocalStorage } from "@/server/storage/local-storage";
import { createSession, getSessionUser } from "@/server/modules/auth/session.service";
import { actorOf, cleanup, createUser, makeHarness, tokenFrom } from "./helpers/auth-harness";
import { DAY, iso, organizer, participant, publishedEvent, teamEvent } from "./helpers/event-fixtures";
import { createTeam, inviteMember, registerTeam, respondToInvitation } from "@/server/modules/teams/teams.service";
import { createTeamSchema } from "@/server/modules/teams/teams.schema";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "st-test-storage-"));
  setStorageForTests(createLocalStorage(dir));
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  setStorageForTests(undefined);
  rmSync(dir, { recursive: true, force: true });
  await getDb().$disconnect();
});

const AFTER_DEADLINE = () => new Date(Date.now() + 9 * DAY); // the submission deadline is day 8
const project = (title: string) => submissionSchema.parse({ title, description: `Description of ${title}, long enough.`, repoUrl: "https://github.com/example/repo" });

describe("scoring formula (pure)", () => {
  const criteria = [
    { id: "a", maxScore: 10, weight: 2 },
    { id: "b", maxScore: 100, weight: 1 },
  ];
  it("normalizes each score by its maximum, then applies the weights", () => {
    // (2 * 8/10 + 1 * 50/100) / 3 * 100 = 70
    expect(scorecardPercent(criteria, new Map([["a", 8], ["b", 50]]))).toBe(70);
    expect(scorecardPercent(criteria, new Map([["a", 10], ["b", 100]]))).toBe(100);
    expect(scorecardPercent(criteria, new Map([["a", 0], ["b", 0]]))).toBe(0);
    expect(scorecardPercent([{ id: "x", maxScore: 3, weight: 1 }], new Map([["x", 1]]))).toBe(33.333); // rounded to 3 decimals
  });
  it("never produces a percentage from an incomplete or out-of-range scorecard", () => {
    expect(scorecardPercent(criteria, new Map([["a", 8]]))).toBeNull();
    expect(scorecardPercent([], new Map())).toBeNull();
    expect(() => scorecardPercent(criteria, new Map([["a", 11], ["b", 1]]))).toThrow(RangeError);
    expect(() => scorecardPercent(criteria, new Map([["a", -1], ["b", 1]]))).toThrow(RangeError);
    expect(() => scorecardPercent(criteria, new Map([["a", Number.NaN], ["b", 1]]))).toThrow(RangeError);
  });
  it("averages the judges and ranks with ties (1, 2, 2, 4) and no hidden tie-breaker", () => {
    expect(finalScore([70, 80])).toBe(75);
    expect(finalScore([])).toBeNull();
    const ranked = rankEntries([
      { entry: "d", score: 70, key: "d" }, { entry: "a", score: 90, key: "a" }, { entry: "c", score: 80, key: "c" }, { entry: "b", score: 80, key: "b" },
    ]);
    expect(ranked.map((r) => [r.entry, r.rank, r.tied])).toEqual([["a", 1, false], ["b", 2, true], ["c", 2, true], ["d", 4, false]]);
    expect(ranked.map((r) => awardForRank(r.rank))).toEqual(["WINNER", "RUNNER_UP", "RUNNER_UP", "FINALIST"]);
    expect([6, 7].map(awardForRank)).toEqual(["NONE", "NONE"]);
    expect(rankEntries([])).toEqual([]);
    // input order does not change the outcome
    expect(rankEntries([{ entry: 1, score: 5, key: "1" }, { entry: 2, score: 5, key: "2" }]).map((r) => r.rank)).toEqual([1, 1]);
  });
  it("accepts at most two decimals for scores", () => {
    expect([0, 1, 7.5, 9.99, 10].every(hasAtMostTwoDecimals)).toBe(true);
    expect([7.555, 0.001].some(hasAtMostTwoDecimals)).toBe(false);
  });
});

describe("judging input", () => {
  it("validates criteria and scorecards", () => {
    expect(criterionSchema.safeParse({ name: "Impact", maxScore: 10, weight: 2 }).success).toBe(true);
    for (const bad of [{ name: "I", maxScore: 10 }, { name: "Impact", maxScore: 0 }, { name: "Impact", maxScore: 10, weight: 0 }, { name: "Impact", maxScore: 10.555 }, { name: "Impact", maxScore: 5000 }, { name: "<b>", maxScore: 10 }]) {
      expect(criterionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    const id = "0194d8f2-3b8a-7c11-8d0a-5b7c2d4e6f80";
    expect(scorecardSchema.safeParse({ scores: [{ criterionId: id, score: 5 }] }).success).toBe(true);
    for (const bad of [{ scores: [] }, { scores: [{ criterionId: id, score: -1 }] }, { scores: [{ criterionId: id, score: 5.555 }] }, { scores: [{ criterionId: "nope", score: 5 }] }, { scores: [{ criterionId: id, score: "5" }] }]) {
      expect(scorecardSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

interface World {
  o: Awaited<ReturnType<typeof organizer>>;
  eventId: string;
  slug: string;
  people: Awaited<ReturnType<typeof participant>>[];
  subs: string[];
  judges: Awaited<ReturnType<typeof createUser>>[];
  crit: { innovation: string; impact: string };
}

/** An individual event with submitted projects, two criteria (10 x weight 2, 100 x weight 1) and assigned judges. */
async function world(opts: { projects?: number; judges?: number } = {}): Promise<World> {
  const o = await organizer();
  const e = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
  const people: World["people"] = [];
  const subs: string[] = [];
  for (let i = 0; i < (opts.projects ?? 3); i++) {
    const p = await participant();
    await registerForEvent(p.actor, e.id);
    subs.push((await submitProject(p.actor, e.id, project(`Project ${String.fromCharCode(65 + i)}`))).id);
    people.push(p);
  }
  const innovation = (await createCriterion(o.actor, e.id, criterionSchema.parse({ name: "Innovation", maxScore: 10, weight: 2, sortOrder: 1 }))).id;
  const impact = (await createCriterion(o.actor, e.id, criterionSchema.parse({ name: "Impact", maxScore: 100, weight: 1, sortOrder: 2 }))).id;
  const judges: World["judges"] = [];
  for (let i = 0; i < (opts.judges ?? 2); i++) {
    const j = await createUser({ roles: ["JUDGE"] });
    await assignJudge(o.actor, e.id, j.email);
    judges.push(j);
  }
  return { o, eventId: e.id, slug: e.slug, people, subs, judges, crit: { innovation, impact } };
}

const card = (w: World, a: number, b: number, finalize = true) =>
  scorecardSchema.parse({ scores: [{ criterionId: w.crit.innovation, score: a, feedback: `Feedback for ${a}` }, { criterionId: w.crit.impact, score: b }], finalize });
const judge = (j: Awaited<ReturnType<typeof createUser>>) => actorOf(j);

async function scoreAll(w: World, table: number[][][]) {
  // table[judge][submission] = [innovation, impact]
  for (let j = 0; j < w.judges.length; j++) {
    for (let s = 0; s < w.subs.length; s++) {
      const [a, b] = table[j][s];
      await saveScorecard(judge(w.judges[j]), w.subs[s], card(w, a, b), AFTER_DEADLINE());
    }
  }
}

describe("criteria and judge management", () => {
  it("only organizers of the event manage criteria; names are unique; judges and others only read", async () => {
    const w = await world({ projects: 0, judges: 1 });
    const p = await participant();
    await expect(createCriterion(p.actor, w.eventId, criterionSchema.parse({ name: "Hack", maxScore: 5 }))).rejects.toMatchObject({ status: 403 });
    await expect(createCriterion(judge(w.judges[0]), w.eventId, criterionSchema.parse({ name: "Hack", maxScore: 5 }))).rejects.toMatchObject({ status: 403 });
    await expect(createCriterion((await organizer()).actor, w.eventId, criterionSchema.parse({ name: "Hack", maxScore: 5 }))).rejects.toMatchObject({ status: 403 });
    await expect(createCriterion(w.o.actor, w.eventId, criterionSchema.parse({ name: "Innovation", maxScore: 5 }))).rejects.toMatchObject({ code: "criterion_name_taken" });
    expect((await listCriteria(judge(w.judges[0]), w.eventId)).map((c) => [c.name, c.maxScore, c.weight])).toEqual([["Innovation", 10, 2], ["Impact", 100, 1]]);
    await expect(listCriteria(p.actor, w.eventId)).rejects.toMatchObject({ status: 403 });
    await updateCriterion(w.o.actor, w.eventId, w.crit.impact, { weight: 3 });
    await deleteCriterion(w.o.actor, w.eventId, w.crit.impact);
    expect(await listCriteria(w.o.actor, w.eventId)).toHaveLength(1);
  });

  it("criteria are locked once scoring starts", async () => {
    const w = await world({ projects: 1, judges: 1 });
    await saveScorecard(judge(w.judges[0]), w.subs[0], card(w, 5, 50, false), AFTER_DEADLINE());
    await expect(updateCriterion(w.o.actor, w.eventId, w.crit.impact, { maxScore: 200 })).rejects.toMatchObject({ status: 409 });
    await expect(deleteCriterion(w.o.actor, w.eventId, w.crit.impact)).rejects.toMatchObject({ status: 409 });
    await expect(createCriterion(w.o.actor, w.eventId, criterionSchema.parse({ name: "Late", maxScore: 5 }))).rejects.toMatchObject({ status: 409 });
  });

  it("assigns judges to this event only: scoped role, sessions refreshed, idempotent, no participants, unknown emails refused", async () => {
    const w = await world({ projects: 1, judges: 0 });
    const j = await createUser();
    const session = await createSession(j.id);
    expect(await assignJudge(w.o.actor, w.eventId, j.email)).toMatchObject({ created: true });
    expect(await assignJudge(w.o.actor, w.eventId, j.email)).toMatchObject({ created: false });
    expect(await getSessionUser(session.token)).toBeNull(); // role change signs the judge out
    const roles = await getDb().userRoleAssignment.findMany({ where: { userId: j.id } });
    expect(roles.filter((r) => r.role === "JUDGE")).toEqual([expect.objectContaining({ eventId: w.eventId })]); // event-scoped, never global
    await expect(assignJudge(w.o.actor, w.eventId, "nobody@example.test")).rejects.toMatchObject({ code: "judge_not_found" });
    await expect(assignJudge(w.o.actor, w.eventId, w.people[0].u.email)).rejects.toMatchObject({ code: "conflict_of_interest" });
    await expect(assignJudge(w.people[0].actor, w.eventId, j.email)).rejects.toMatchObject({ status: 403 });
    const unverified = await createUser({ verified: false });
    await expect(assignJudge(w.o.actor, w.eventId, unverified.email)).rejects.toMatchObject({ code: "judge_not_found" });
    expect(await listJudges(w.o.actor, w.eventId)).toMatchObject([{ judgeId: j.id, finalized: 0, total: 1 }]);
    await unassignJudge(w.o.actor, w.eventId, j.id);
    expect(await getDb().judgeAssignment.count({ where: { eventId: w.eventId } })).toBe(0);
    expect(await getDb().userRoleAssignment.count({ where: { userId: j.id, role: "JUDGE" } })).toBe(0);
  });
});

describe("scoring", () => {
  it("only assigned judges can score, and only after the submission deadline", async () => {
    const w = await world({ projects: 1, judges: 1 });
    const outsider = await createUser({ roles: ["JUDGE"] }); // a JUDGE role elsewhere is not enough
    await expect(saveScorecard(actorOf(outsider), w.subs[0], card(w, 5, 50), AFTER_DEADLINE())).rejects.toMatchObject({ status: 404 });
    await expect(saveScorecard(w.people[0].actor, w.subs[0], card(w, 5, 50), AFTER_DEADLINE())).rejects.toMatchObject({ status: 404 });
    await expect(saveScorecard(w.o.actor, w.subs[0], card(w, 5, 50), AFTER_DEADLINE())).rejects.toMatchObject({ status: 404 });
    await expect(saveScorecard(judge(w.judges[0]), w.subs[0], card(w, 5, 50))).rejects.toMatchObject({ code: "judging_not_open" });
    await expect(saveScorecard(judge(w.judges[0]), w.subs[0], card(w, 5, 50), AFTER_DEADLINE())).resolves.toMatchObject({ finalized: true, percent: 50 });
    // an explicit judging window is respected
    await getDb().event.update({ where: { id: w.eventId }, data: { judgingEndsAt: new Date(Date.now() + 9.5 * DAY), judgingStartsAt: new Date(Date.now() + 8.5 * DAY) } });
  });

  it("rejects scores above the maximum, duplicates, unknown criteria and incomplete finalization; nothing partial becomes final", async () => {
    const w = await world({ projects: 1, judges: 1 });
    const j = judge(w.judges[0]);
    const now = AFTER_DEADLINE();
    await expect(saveScorecard(j, w.subs[0], card(w, 10.01, 50), now)).rejects.toMatchObject({ code: "score_out_of_range" });
    await expect(saveScorecard(j, w.subs[0], card(w, 5, 100.5), now)).rejects.toMatchObject({ code: "score_out_of_range" });
    await expect(saveScorecard(j, w.subs[0], scorecardSchema.parse({ scores: [{ criterionId: w.crit.impact, score: 1 }, { criterionId: w.crit.impact, score: 2 }] }), now)).rejects.toMatchObject({ code: "duplicate_criterion" });
    const foreign = (await world({ projects: 0, judges: 0 })).crit.impact;
    await expect(saveScorecard(j, w.subs[0], scorecardSchema.parse({ scores: [{ criterionId: foreign, score: 1 }] }), now)).rejects.toMatchObject({ code: "unknown_criterion" });
    expect(await getDb().score.count({ where: { submissionId: w.subs[0] } })).toBe(0); // rejected requests stored nothing

    const partial = await saveScorecard(j, w.subs[0], scorecardSchema.parse({ scores: [{ criterionId: w.crit.innovation, score: 5 }] }), now);
    expect(partial).toMatchObject({ finalized: false, percent: null, missing: ["Impact"] });
    await expect(saveScorecard(j, w.subs[0], scorecardSchema.parse({ scores: [{ criterionId: w.crit.innovation, score: 6 }], finalize: true }), now)).rejects.toMatchObject({ code: "scorecard_incomplete" });
    expect((await getDb().score.findMany({ where: { submissionId: w.subs[0] } })).every((s) => s.finalizedAt === null)).toBe(true);
  });

  it("the database refuses a score above the criterion maximum even if the application were bypassed", async () => {
    const w = await world({ projects: 1, judges: 1 });
    await expect(getDb().score.create({ data: { submissionId: w.subs[0], judgeId: w.judges[0].id, criterionId: w.crit.innovation, score: 10.5 } })).rejects.toThrow(/exceeds criterion max/);
    await expect(getDb().score.create({ data: { submissionId: w.subs[0], judgeId: w.judges[0].id, criterionId: w.crit.innovation, score: -1 } })).rejects.toThrow(/scores_nonneg_chk/);
  });

  it("a saved scorecard can be edited until finalized; a final one is frozen until an organizer reopens it (audited)", async () => {
    const w = await world({ projects: 1, judges: 1 });
    const j = judge(w.judges[0]);
    const now = AFTER_DEADLINE();
    await saveScorecard(j, w.subs[0], card(w, 4, 40, false), now);
    await saveScorecard(j, w.subs[0], card(w, 6, 60, false), now);
    expect(await getDb().score.count({ where: { submissionId: w.subs[0], judgeId: w.judges[0].id } })).toBe(2); // updated, not duplicated
    expect((await getDb().submission.findUniqueOrThrow({ where: { id: w.subs[0] } })).status).toBe("UNDER_REVIEW");
    await saveScorecard(j, w.subs[0], card(w, 8, 80, true), now);
    expect((await getDb().submission.findUniqueOrThrow({ where: { id: w.subs[0] } })).status).toBe("SCORED");
    await expect(saveScorecard(j, w.subs[0], card(w, 1, 1, false), now)).rejects.toMatchObject({ code: "scorecard_final" });
    await expect(reopenScorecard(w.people[0].actor, w.subs[0], w.judges[0].id, "just because")).rejects.toMatchObject({ status: 403 });
    await reopenScorecard(w.o.actor, w.subs[0], w.judges[0].id, "typo in the impact score");
    expect((await getDb().submission.findUniqueOrThrow({ where: { id: w.subs[0] } })).status).toBe("UNDER_REVIEW");
    await expect(saveScorecard(j, w.subs[0], card(w, 9, 90, true), now)).resolves.toMatchObject({ finalized: true, percent: 90 });
    for (const action of ["score.saved", "score.finalized", "score.reopened"]) expect(await getDb().auditLog.count({ where: { entityId: w.subs[0], action } }), action).toBeGreaterThan(0);
    await expect(reopenScorecard(w.o.actor, w.subs[0], w.judges[0].id, "no longer final")).resolves.toBeUndefined();
    await expect(reopenScorecard(w.o.actor, w.subs[0], w.judges[0].id, "twice in a row")).rejects.toMatchObject({ status: 409 });
  });

  it("concurrent saves by one judge never produce duplicate or mixed rows", async () => {
    const w = await world({ projects: 1, judges: 1 });
    const j = judge(w.judges[0]);
    const now = AFTER_DEADLINE();
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => saveScorecard(j, w.subs[0], card(w, i + 1, (i + 1) * 10, i === 7), now)));
    expect(attempts.some((a) => a.status === "fulfilled")).toBe(true);
    const rows = await getDb().score.findMany({ where: { submissionId: w.subs[0], judgeId: w.judges[0].id } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.criterionId)).size).toBe(2);
  });

  it("judging is blind and conflict-free: no author or team names, and never your own project", async () => {
    const w = await world({ projects: 2, judges: 1 });
    const j = judge(w.judges[0]);
    const list = await listAssignedSubmissions(j, w.eventId);
    expect(list.map((s) => s.title).sort()).toEqual(["Project A", "Project B"]);
    expect(list.every((s) => s.state === "NOT_STARTED")).toBe(true);
    const sc = await getScorecard(j, w.subs[0]);
    expect(JSON.stringify(sc)).not.toContain(w.people[0].u.fullName);
    expect(JSON.stringify(sc)).not.toContain(w.people[0].u.email);
    expect(sc.submission).not.toHaveProperty("team");
    expect(sc.criteria).toHaveLength(2);
    // a judge who is also an author (assigned behind the application's back) cannot score their own work
    await getDb().judgeAssignment.create({ data: { eventId: w.eventId, judgeId: w.people[0].u.id } });
    await expect(saveScorecard(w.people[0].actor, w.subs[0], card(w, 10, 100), AFTER_DEADLINE())).rejects.toMatchObject({ code: "conflict_of_interest" });
    await expect(getScorecard(w.people[0].actor, w.subs[0])).rejects.toMatchObject({ code: "conflict_of_interest" });
    expect((await listAssignedSubmissions(w.people[0].actor, w.eventId)).map((s) => s.title)).toEqual(["Project B"]);
  });

  it("draft submissions are invisible to judges and disqualified ones cannot be scored", async () => {
    const w = await world({ projects: 1, judges: 1 });
    await disqualifySubmission(w.o.actor, w.subs[0], "rule violation");
    await expect(saveScorecard(judge(w.judges[0]), w.subs[0], card(w, 5, 50), AFTER_DEADLINE())).rejects.toMatchObject({ code: "submission_disqualified" });
    expect(await listAssignedSubmissions(judge(w.judges[0]), w.eventId)).toHaveLength(0);
  });
});

describe("results and leaderboard", () => {
  it("computes weighted standings from finalized scores only, with ties and awards", async () => {
    const w = await world({ projects: 4, judges: 2 });
    // judge 1 / judge 2 per project: innovation (max 10, w2), impact (max 100, w1)
    await scoreAll(w, [
      [[10, 100], [8, 50], [8, 50], [2, 10]],
      [[10, 100], [6, 50], [6, 50], [4, 30]],
    ]);
    const draft = await recalculateResults(w.o.actor, w.eventId);
    expect(draft.complete).toBe(true);
    // A: 100 and 100 -> 100. B and C: (2*.8+.5)/3*100 = 70 and (2*.6+.5)/3*100 = 56.667 -> mean 63.333. D: (2*.2+.1)/3*100=16.667 and (2*.4+.3)/3*100=36.667 -> 26.667
    expect(draft.rows.map((r) => [r.title, r.score, r.rank, r.tied, r.award])).toEqual([
      ["Project A", 100, 1, false, "WINNER"],
      ["Project B", 63.333, 2, true, "RUNNER_UP"],
      ["Project C", 63.333, 2, true, "RUNNER_UP"],
      ["Project D", 26.667, 4, false, "FINALIST"],
    ]);
    expect(draft.rows[0].breakdown.judges).toHaveLength(2);
    expect(draft.rows[0].breakdown.criteria.map((c) => c.average)).toEqual([10, 100]);
    expect(await getDb().result.count({ where: { eventId: w.eventId, publishedAt: null } })).toBe(4); // drafts stored
    // recalculating replaces drafts instead of duplicating them
    await recalculateResults(w.o.actor, w.eventId);
    expect(await getDb().result.count({ where: { eventId: w.eventId } })).toBe(4);
  });

  it("refuses to publish incomplete results and says what is missing; nothing is estimated", async () => {
    const w = await world({ projects: 2, judges: 2 });
    await saveScorecard(judge(w.judges[0]), w.subs[0], card(w, 9, 90), AFTER_DEADLINE());
    await saveScorecard(judge(w.judges[0]), w.subs[1], card(w, 5, 50), AFTER_DEADLINE());
    await saveScorecard(judge(w.judges[1]), w.subs[0], card(w, 7, 70), AFTER_DEADLINE());
    const standings = await getDraftStandings(w.o.actor, w.eventId);
    expect(standings.complete).toBe(false);
    expect(standings.rows.map((r) => r.title)).toEqual(["Project A"]); // only the fully scored project is ranked
    expect(standings.missing).toEqual([expect.objectContaining({ title: "Project B", judgesMissing: 1 })]);
    await expect(publishResults(w.o.actor, w.eventId)).rejects.toMatchObject({ code: "results_incomplete", message: expect.stringContaining("Project B") });
    expect((await getDb().event.findUniqueOrThrow({ where: { id: w.eventId } })).resultsPublishedAt).toBeNull();
    expect(await getPublicResults(w.slug)).toBeNull();
    // a draft scorecard (not finalized) does not count either
    await saveScorecard(judge(w.judges[1]), w.subs[1], card(w, 5, 50, false), AFTER_DEADLINE());
    await expect(publishResults(w.o.actor, w.eventId)).rejects.toMatchObject({ code: "results_incomplete" });
  });

  it("refuses to publish without criteria, judges or submissions", async () => {
    const o = await organizer();
    const e = await publishedEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
    await expect(publishResults(o.actor, e.id)).rejects.toMatchObject({ code: "results_incomplete", message: expect.stringMatching(/criteria/) });
    await createCriterion(o.actor, e.id, criterionSchema.parse({ name: "Only", maxScore: 10 }));
    await expect(publishResults(o.actor, e.id)).rejects.toMatchObject({ message: expect.stringMatching(/judge/) });
    const j = await createUser({ roles: ["JUDGE"] });
    await assignJudge(o.actor, e.id, j.email);
    await expect(publishResults(o.actor, e.id)).rejects.toMatchObject({ message: expect.stringMatching(/no submitted/) });
  });

  it("publishes complete results with authorization, makes them public without private details, and freezes scoring", async () => {
    const w = await world({ projects: 2, judges: 2 });
    await scoreAll(w, [[[9, 90], [5, 50]], [[7, 70], [5, 50]]]);
    const stranger = await participant();
    await expect(publishResults(stranger.actor, w.eventId)).rejects.toMatchObject({ status: 403 });
    await expect(publishResults(judge(w.judges[0]), w.eventId)).rejects.toMatchObject({ status: 403 });
    await expect(publishResults((await organizer()).actor, w.eventId)).rejects.toMatchObject({ status: 403 });
    expect(await getPublicResults(w.slug)).toBeNull();
    await expect(getMyResult(w.people[0].actor, w.eventId)).resolves.toBeNull(); // nothing leaks before publication

    await expect(publishResults(w.o.actor, w.eventId, new Date())).resolves.toEqual({ published: 2 });
    await expect(publishResults(w.o.actor, w.eventId)).rejects.toMatchObject({ status: 409 });
    const pub = (await getPublicResults(w.slug))!;
    expect(pub.entries.map((e) => [e.rank, e.title, e.score, e.award])).toEqual([[1, "Project A", 80, "WINNER"], [2, "Project B", 50, "RUNNER_UP"]]);
    expect(pub.entries[0].name).toBe(w.people[0].u.fullName);
    const text = JSON.stringify(pub);
    for (const secret of [w.judges[0].email, w.judges[0].id, w.people[0].u.email, "Feedback for", "breakdown"]) expect(text).not.toContain(secret);

    // scoring and criteria are frozen, recalculation is blocked
    await expect(reopenScorecard(w.o.actor, w.subs[0], w.judges[0].id, "after publication")).rejects.toMatchObject({ status: 409 });
    await expect(recalculateResults(w.o.actor, w.eventId)).rejects.toMatchObject({ status: 409 });
    await expect(updateCriterion(w.o.actor, w.eventId, w.crit.impact, { weight: 5 })).rejects.toMatchObject({ status: 409 });
    expect(await getDb().auditLog.count({ where: { entityId: w.eventId, action: "results.published" } })).toBe(1);

    // participants see their own result with anonymous feedback; others see nothing of it
    const mine = (await getMyResult(w.people[0].actor, w.eventId))!;
    expect(mine).toMatchObject({ rank: 1, award: "WINNER", score: 80 });
    expect(mine.feedback.length).toBeGreaterThan(0);
    expect(JSON.stringify(mine)).not.toContain(w.judges[0].email);
    await expect(getMyResult(stranger.actor, w.eventId)).resolves.toBeNull();
  });

  it("disqualified submissions are excluded; unpublishing is audited and blocked while certificates exist", async () => {
    const w = await world({ projects: 3, judges: 1 });
    await scoreAll(w, [[[9, 90], [8, 80], [7, 70]]]);
    await disqualifySubmission(w.o.actor, w.subs[0], "plagiarism confirmed");
    await expect(disqualifySubmission(w.people[1].actor, w.subs[1], "revenge")).rejects.toMatchObject({ status: 404 });
    await publishResults(w.o.actor, w.eventId);
    expect((await getPublicResults(w.slug))!.entries.map((e) => e.title)).toEqual(["Project B", "Project C"]);
    await issueCertificates(w.o.actor, w.eventId);
    await expect(unpublishResults(w.o.actor, w.eventId, "correction needed")).rejects.toMatchObject({ status: 409 });
    for (const c of await listEventCertificates(w.o.actor, w.eventId)) await revokeCertificate(w.o.actor, c.id, "results withdrawn");
    await unpublishResults(w.o.actor, w.eventId, "correction needed");
    expect(await getPublicResults(w.slug)).toBeNull();
    expect(await getDb().auditLog.count({ where: { entityId: w.eventId, action: "results.unpublished" } })).toBe(1);
  });
});

describe("certificates", () => {
  async function published(): Promise<World> {
    const w = await world({ projects: 3, judges: 1 });
    await scoreAll(w, [[[9, 90], [8, 80], [3, 30]]]);
    await publishResults(w.o.actor, w.eventId);
    return w;
  }

  it("cannot be issued before results are published, or by people who do not manage the event", async () => {
    const w = await world({ projects: 1, judges: 1 });
    await expect(issueCertificates(w.o.actor, w.eventId)).rejects.toMatchObject({ code: "results_not_published" });
    await scoreAll(w, [[[9, 90]]]);
    await publishResults(w.o.actor, w.eventId);
    await expect(issueCertificates(w.people[0].actor, w.eventId)).rejects.toMatchObject({ status: 403 });
    await expect(issueCertificates((await organizer()).actor, w.eventId)).rejects.toMatchObject({ status: 403 });
  });

  it("issues one certificate per person of the type their result earned, with unique codes, exactly once", async () => {
    const w = await published();
    expect(await issueCertificates(w.o.actor, w.eventId)).toEqual({ issued: 3, alreadyHad: 0 });
    expect(await issueCertificates(w.o.actor, w.eventId)).toMatchObject({ issued: 0, alreadyHad: 3 }); // repeating is safe
    const certs = await getDb().certificate.findMany({ where: { eventId: w.eventId }, include: { user: true } });
    const typeOf = (i: number) => certs.find((c) => c.userId === w.people[i].u.id)!;
    expect(typeOf(0).type).toBe("WINNER");
    expect(typeOf(1).type).toBe("FINALIST"); // rank 2 = runner-up
    expect(typeOf(2).type).toBe("FINALIST"); // rank 3
    expect(new Set(certs.map((c) => c.publicCode)).size).toBe(3);
    expect(certs.every((c) => /^ST-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(c.publicCode))).toBe(true);
    expect(typeOf(0).recipientName).toBe(w.people[0].u.fullName);
    expect(await getDb().auditLog.count({ where: { entityId: w.eventId, action: "certificates.issued" } })).toBe(2);
    expect(await listMyCertificates(w.people[0].u.id)).toHaveLength(1);
    const history = await listEventCertificates(w.o.actor, w.eventId);
    expect(history).toHaveLength(3);
    expect(history[0]).toHaveProperty("issuedBy");
  });

  it("gives participation certificates to those who took part but did not place", async () => {
    const w = await world({ projects: 7, judges: 1 });
    await scoreAll(w, [[[10, 100], [9, 90], [8, 80], [7, 70], [6, 60], [5, 50], [4, 40]]]);
    await publishResults(w.o.actor, w.eventId);
    await issueCertificates(w.o.actor, w.eventId);
    const types = await getDb().certificate.findMany({ where: { eventId: w.eventId }, orderBy: { recipientName: "asc" } });
    const byUser = (i: number) => types.find((c) => c.userId === w.people[i].u.id)!.type;
    expect([0, 1, 2, 4, 5, 6].map(byUser)).toEqual(["WINNER", "FINALIST", "FINALIST", "FINALIST", "PARTICIPATION", "PARTICIPATION"]);
  });

  it("is verifiable by anyone with the code; unknown codes and malformed codes are indistinguishable; revocation shows", async () => {
    const w = await published();
    await issueCertificates(w.o.actor, w.eventId);
    const cert = await getDb().certificate.findFirstOrThrow({ where: { userId: w.people[0].u.id } });
    const ok = await verifyCertificate(cert.publicCode.toLowerCase());
    expect(ok).toMatchObject({ status: "VALID", recipientName: w.people[0].u.fullName, type: "WINNER" });
    expect(JSON.stringify(ok)).not.toContain(w.people[0].u.email);
    expect(await verifyCertificate(newPublicCode())).toEqual({ status: "NOT_FOUND" });
    expect(await verifyCertificate("garbage")).toEqual({ status: "NOT_FOUND" });
    expect(await verifyCertificate("")).toEqual({ status: "NOT_FOUND" });
    await expect(revokeCertificate(w.people[0].actor, cert.id, "i want it gone")).rejects.toMatchObject({ status: 404 });
    await revokeCertificate(w.o.actor, cert.id, "issued in error");
    expect(await verifyCertificate(cert.publicCode)).toMatchObject({ status: "REVOKED" });
    await expect(revokeCertificate(w.o.actor, cert.id, "issued in error")).rejects.toMatchObject({ status: 409 });
    expect(await getDb().auditLog.count({ where: { entityId: cert.id, action: "certificate.revoked" } })).toBe(1);
    // a revoked certificate is never silently reissued
    expect(await issueCertificates(w.o.actor, w.eventId)).toMatchObject({ issued: 0 });
  });

  it("downloads as a real PDF for the recipient and the event's organizers only; revoked ones are gone for the recipient", async () => {
    const w = await published();
    await issueCertificates(w.o.actor, w.eventId);
    const cert = await getDb().certificate.findFirstOrThrow({ where: { userId: w.people[0].u.id } });
    const { bytes, fileName } = await getCertificatePdf(w.people[0].actor, cert.id);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(fileName).toBe(`certificate-${cert.publicCode}.pdf`);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toContain(w.people[0].u.fullName);
    expect(Math.floor((doc.getCreationDate()?.getTime() ?? 0) / 1000)).toBe(Math.floor(cert.issuedAt.getTime() / 1000)); // PDF dates have whole-second precision
    await expect(getCertificatePdf(w.people[1].actor, cert.id)).rejects.toMatchObject({ status: 404 });
    await expect(getCertificatePdf((await organizer()).actor, cert.id)).rejects.toMatchObject({ status: 404 });
    await expect(getCertificatePdf(w.o.actor, cert.id)).resolves.toBeDefined();
    await expect(getCertificatePdf(w.people[0].actor, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
    await revokeCertificate(w.o.actor, cert.id, "issued in error");
    await expect(getCertificatePdf(w.people[0].actor, cert.id)).rejects.toMatchObject({ status: 410, code: "certificate_revoked" });
    await expect(getCertificatePdf(w.o.actor, cert.id)).resolves.toBeDefined();
  });

  it("templates: custom wording is used, only known placeholders are allowed", async () => {
    const w = await published();
    expect(templateSchema.safeParse({ heading: "Winner!", body: "Hello {{name}}, you won {{event}} with {{project}} (rank {{rank}}).", signatoryName: "A. Person", signatoryTitle: "Director" }).success).toBe(true);
    expect(templateSchema.safeParse({ heading: "Winner!", body: "Hello {{password}} {{name}}" }).success).toBe(false);
    expect(templateSchema.safeParse({ heading: "Winner!", body: "<script>{{name}}</script>" }).success).toBe(false);
    expect(unknownPlaceholders("{{name}} {{ event }} {{oops}}")).toEqual(["oops"]);
    expect(fillTemplate("{{name}} / {{team}} / {{rank}}", { name: "Ada", event: "E", team: "", project: "P", rank: "1" })).toBe("Ada /  / 1");
    await expect(saveTemplate(w.people[0].actor, w.eventId, "WINNER", { heading: "Mine", body: "Custom text for {{name}}." })).rejects.toMatchObject({ status: 403 });
    await saveTemplate(w.o.actor, w.eventId, "WINNER", templateSchema.parse({ heading: "Grand Winner", body: "Custom text for {{name}} in {{event}}.", signatoryName: "A. Person" }));
    await issueCertificates(w.o.actor, w.eventId);
    const cert = await getDb().certificate.findFirstOrThrow({ where: { userId: w.people[0].u.id } });
    const { bytes } = await getCertificatePdf(w.people[0].actor, cert.id);
    expect((await PDFDocument.load(bytes)).getTitle()).toContain("Grand Winner");
  });

  it("renders names with characters the standard PDF fonts cannot encode without failing", async () => {
    const bytes = await renderCertificatePdf({ heading: "Certificate", body: "Body text 九州 ok", recipientName: "Zoë 九州 O'Brien", eventTitle: "Event", issuedAt: new Date("2030-01-01T00:00:00Z"), code: "ST-AAAAA-BBBBB-CCCCC", verifyUrl: "https://example.test/verify/certificate/ST-AAAAA-BBBBB-CCCCC" });
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("team events end to end", () => {
  it("a team's result is public under the team name and certificates go to every confirmed member", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { startsAt: iso(1), endsAt: iso(11), submissionDeadline: iso(8) });
    const h = makeHarness();
    const leader = await participant();
    const mate = await participant();
    const team = await createTeam(leader.actor, e.id, createTeamSchema.parse({ name: `vt winners ${Date.now().toString(36)}` }));
    await inviteMember(leader.actor, team.id, mate.u.email, h.deps);
    await h.flush();
    await respondToInvitation(mate.actor, { token: tokenFrom(h.lastMailTo(mate.u.email)) }, true);
    await registerTeam(leader.actor, team.id);
    const sub = await submitProject(mate.actor, e.id, project("Team Project"));
    const crit = (await createCriterion(o.actor, e.id, criterionSchema.parse({ name: "Quality", maxScore: 10 }))).id;
    const j = await createUser({ roles: ["JUDGE"] });
    await assignJudge(o.actor, e.id, j.email);
    await saveScorecard(actorOf(j), sub.id, scorecardSchema.parse({ scores: [{ criterionId: crit, score: 9 }], finalize: true }), AFTER_DEADLINE());
    await publishResults(o.actor, e.id);
    expect((await getPublicResults(e.slug))!.entries).toEqual([expect.objectContaining({ rank: 1, award: "WINNER", name: team.name, score: 90 })]);
    expect(await issueCertificates(o.actor, e.id)).toMatchObject({ issued: 2 });
    for (const m of [leader, mate]) expect((await listMyCertificates(m.u.id))[0]).toMatchObject({ type: "WINNER" });
    expect((await getMyResult(leader.actor, e.id))?.rank).toBe(1); // the leader sees the team's result although the mate submitted it
  });
});

void iso;
