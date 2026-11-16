import "server-only";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/http/errors";
import { can, type Actor } from "@/server/modules/authz/permissions";

/**
 * Platform analytics, computed from the real tables on request (no cached or invented numbers). Totals describe the
 * platform as a whole; "in range" figures use the chosen UTC date range. Every query uses indexes (see
 * docs/operations/performance.md for the measured plans) and aggregates in the database, never in application memory.
 */
const DAY = 86_400_000;
export const MAX_RANGE_DAYS = 366;

export const analyticsQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export interface Range {
  from: Date; // inclusive, 00:00 UTC
  to: Date; // exclusive, 00:00 UTC of the day after the last day
}

/** Defaults to the last 30 days including today. Rejects reversed or over-long ranges. */
export function resolveRange(q: { from?: string; to?: string }, now: Date = new Date()): Range {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const to = q.to ? Date.parse(`${q.to}T00:00:00Z`) + DAY : startOfToday + DAY;
  const from = q.from ? Date.parse(`${q.from}T00:00:00Z`) : to - 30 * DAY;
  if (from >= to) throw new AppError(400, "invalid_range", "The start date must be before the end date.");
  if ((to - from) / DAY > MAX_RANGE_DAYS) throw new AppError(400, "invalid_range", `The range can be at most ${MAX_RANGE_DAYS} days.`);
  return { from: new Date(from), to: new Date(to) };
}

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

export async function getAnalytics(actor: Actor, q: { from?: string; to?: string }, now: Date = new Date()) {
  if (!can(actor, "admin:access")) throw new AppError(403, "forbidden", "You do not have access to this resource");
  const range = resolveRange(q, now);
  const db = getDb();
  const { from, to } = range;

  const [
    usersTotal, usersVerified, usersSuspended, usersNew, rolesRows, activeParticipants,
    eventsByStatus, eventsByCategory, eventsCreated,
    regByStatus, regKinds, regSeries,
    organizers, topOrganizers,
    teamsTotal, teamsInRange, teamSizes, teamsRegistered,
    subsByStatus, subsInRange,
    judging, resultsPublished, resultsPublishedInRange, resultsPending,
    certsByType, certsRevoked,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { status: "ACTIVE", emailVerifiedAt: { not: null } } }),
    db.user.count({ where: { status: "SUSPENDED" } }),
    db.user.count({ where: { createdAt: { gte: from, lt: to } } }),
    db.$queryRaw<{ role: string; users: bigint }[]>`SELECT role::text AS role, count(DISTINCT user_id) AS users FROM user_roles GROUP BY role`,
    db.$queryRaw<{ c: bigint }[]>`SELECT count(DISTINCT user_id) AS c FROM registrations WHERE status <> 'CANCELLED' AND registered_at >= ${from} AND registered_at < ${to}`,
    db.event.groupBy({ by: ["status"], _count: { _all: true } }),
    db.event.groupBy({ by: ["category"], where: { status: { in: ["PUBLISHED", "CANCELLED", "ARCHIVED"] } }, _count: { _all: true } }),
    db.event.count({ where: { createdAt: { gte: from, lt: to } } }),
    db.registration.groupBy({ by: ["status"], where: { registeredAt: { gte: from, lt: to } }, _count: { _all: true } }),
    db.$queryRaw<{ team: boolean; c: bigint }[]>`SELECT (team_id IS NOT NULL) AS team, count(*) AS c FROM registrations WHERE status <> 'CANCELLED' AND registered_at >= ${from} AND registered_at < ${to} GROUP BY 1`,
    db.$queryRaw<{ day: Date; c: bigint }[]>`SELECT date_trunc('day', registered_at AT TIME ZONE 'UTC') AS day, count(*) AS c FROM registrations WHERE registered_at >= ${from} AND registered_at < ${to} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ c: bigint }[]>`SELECT count(DISTINCT user_id) AS c FROM user_roles WHERE role = 'ORGANIZER'`,
    db.$queryRaw<{ name: string; events: bigint }[]>`SELECT u.full_name AS name, count(*) AS events FROM event_organizers eo JOIN users u ON u.id = eo.user_id GROUP BY u.id, u.full_name ORDER BY count(*) DESC, u.full_name LIMIT 5`,
    db.team.count({ where: { status: "ACTIVE" } }),
    db.team.count({ where: { createdAt: { gte: from, lt: to } } }),
    db.$queryRaw<{ avg: number | null }[]>`SELECT avg(c)::float AS avg FROM (SELECT count(*) AS c FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE t.status = 'ACTIVE' GROUP BY tm.team_id) x`,
    db.$queryRaw<{ c: bigint }[]>`SELECT count(DISTINCT team_id) AS c FROM registrations WHERE team_id IS NOT NULL AND status <> 'CANCELLED'`,
    db.submission.groupBy({ by: ["status"], _count: { _all: true } }),
    db.submission.count({ where: { submittedAt: { gte: from, lt: to } } }),
    db.$queryRaw<{ judges: bigint; expected: bigint; finalized: bigint }[]>`
      WITH crit AS (SELECT event_id, count(*) AS n FROM judging_criteria GROUP BY event_id),
      subs AS (SELECT event_id, count(*) AS n FROM submissions WHERE status IN ('SUBMITTED','UNDER_REVIEW','SCORED') GROUP BY event_id),
      judges AS (SELECT event_id, count(*) AS n FROM judge_assignments GROUP BY event_id),
      done AS (
        SELECT s.event_id, count(*) AS n FROM (
          SELECT sc.submission_id, sc.judge_id FROM scores sc GROUP BY sc.submission_id, sc.judge_id
          HAVING count(*) FILTER (WHERE sc.finalized_at IS NOT NULL) = count(*)
        ) f JOIN submissions s ON s.id = f.submission_id
        JOIN crit c ON c.event_id = s.event_id
        WHERE (SELECT count(*) FROM scores x WHERE x.submission_id = f.submission_id AND x.judge_id = f.judge_id) = c.n
        GROUP BY s.event_id)
      SELECT coalesce(sum(j.n), 0) AS judges,
             coalesce(sum(j.n * coalesce(s.n, 0)), 0) AS expected,
             coalesce(sum(d.n), 0) AS finalized
      FROM judges j LEFT JOIN subs s ON s.event_id = j.event_id LEFT JOIN done d ON d.event_id = j.event_id`,
    db.event.count({ where: { resultsPublishedAt: { not: null } } }),
    db.event.count({ where: { resultsPublishedAt: { gte: from, lt: to } } }),
    db.event.count({ where: { resultsPublishedAt: null, status: "PUBLISHED", submissions: { some: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "SCORED"] } } } } }),
    db.certificate.groupBy({ by: ["type"], where: { issuedAt: { gte: from, lt: to } }, _count: { _all: true } }),
    db.certificate.count({ where: { revokedAt: { not: null } } }),
  ]);

  const regMap = Object.fromEntries(regByStatus.map((r) => [r.status, r._count._all]));
  const j = judging[0] ?? { judges: BigInt(0), expected: BigInt(0), finalized: BigInt(0) };
  const expected = n(j.expected);
  const finalized = n(j.finalized);
  // Fill days without registrations with zero so the chart has no gaps.
  const series: { day: string; count: number }[] = [];
  const byDay = new Map(regSeries.map((r) => [r.day.toISOString().slice(0, 10), n(r.c)]));
  for (let t = from.getTime(); t < to.getTime(); t += DAY) {
    const key = new Date(t).toISOString().slice(0, 10);
    series.push({ day: key, count: byDay.get(key) ?? 0 });
  }

  return {
    range: { from: from.toISOString().slice(0, 10), to: new Date(to.getTime() - DAY).toISOString().slice(0, 10), days: (to.getTime() - from.getTime()) / DAY },
    users: {
      total: usersTotal, verifiedActive: usersVerified, suspended: usersSuspended, newInRange: usersNew, activeParticipantsInRange: n(activeParticipants[0]?.c),
      byRole: Object.fromEntries(rolesRows.map((r) => [r.role, n(r.users)])),
    },
    events: {
      byStatus: Object.fromEntries(eventsByStatus.map((e) => [e.status, e._count._all])),
      byCategory: Object.fromEntries(eventsByCategory.map((e) => [e.category, e._count._all])),
      createdInRange: eventsCreated,
    },
    registrations: {
      inRange: { CONFIRMED: regMap.CONFIRMED ?? 0, WAITLISTED: regMap.WAITLISTED ?? 0, PENDING: regMap.PENDING ?? 0, CANCELLED: regMap.CANCELLED ?? 0 },
      individual: n(regKinds.find((r) => !r.team)?.c),
      viaTeams: n(regKinds.find((r) => r.team)?.c),
      series,
    },
    organizers: { total: n(organizers[0]?.c), top: topOrganizers.map((o) => ({ name: o.name, events: n(o.events) })) },
    teams: { active: teamsTotal, createdInRange: teamsInRange, averageSize: teamSizes[0]?.avg == null ? null : Math.round(teamSizes[0].avg * 10) / 10, registered: n(teamsRegistered[0]?.c) },
    submissions: { byStatus: Object.fromEntries(subsByStatus.map((s) => [s.status, s._count._all])), submittedInRange: subsInRange },
    judging: { judgeAssignments: n(j.judges), scorecardsExpected: expected, scorecardsFinalized: finalized, completionPercent: expected === 0 ? null : Math.round((finalized / expected) * 1000) / 10 },
    results: { eventsPublished: resultsPublished, publishedInRange: resultsPublishedInRange, awaitingPublication: resultsPending },
    certificates: { issuedInRange: Object.fromEntries(certsByType.map((c) => [c.type, c._count._all])), revokedTotal: certsRevoked },
  };
}

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
