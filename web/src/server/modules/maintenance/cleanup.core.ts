/**
 * Housekeeping that keeps tables bounded and removes stale, unverified signups. Free of Next.js and app imports so the
 * same code runs from the command line, from the protected HTTP endpoint and from tests.
 *
 * What is removed, and why it is safe:
 *  - sessions that can never validate again (expired or revoked more than `keepDays` ago)
 *  - auth tokens that are expired or used more than `keepDays` ago (a live token is never touched)
 *  - rate-limit counters from windows that ended long ago
 *  - UNVERIFIED accounts older than the grace period that have no password, no activity and only the base role
 *    (these are pending signups nobody confirmed). A verified account is never deleted by this job.
 */
import type { PrismaClient } from "@/generated/prisma/client";

const DAY_MS = 86_400_000;

export interface CleanupOptions {
  now?: Date;
  keepDays?: number;
  unverifiedGraceDays?: number;
  /** Write one summary audit row (default true). */
  audit?: boolean;
}

export interface CleanupResult {
  sessions: number;
  tokens: number;
  rateLimits: number;
  unverifiedAccounts: number;
}

export async function runCleanup(db: PrismaClient, opts: CleanupOptions = {}): Promise<CleanupResult> {
  const now = opts.now ?? new Date();
  const keep = new Date(now.getTime() - (opts.keepDays ?? 7) * DAY_MS);
  const grace = new Date(now.getTime() - (opts.unverifiedGraceDays ?? 7) * DAY_MS);

  const sessions = await db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: keep } }, { revokedAt: { lt: keep } }] } });
  const tokens = await db.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: keep } }, { usedAt: { lt: keep } }] } });
  const rateLimits = await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - DAY_MS) } } });

  const stale = await db.user.findMany({
    where: {
      emailVerifiedAt: null,
      passwordHash: null,
      createdAt: { lt: grace },
      lastLoginAt: null,
      roles: { every: { role: "PARTICIPANT", eventId: null, organizationId: null } },
      registrations: { none: {} },
      createdEvents: { none: {} },
      sessions: { none: {} },
    },
    select: { id: true },
    take: 1000,
  });
  const ids = stale.map((u) => u.id);
  if (ids.length) {
    await db.auditLog.deleteMany({ where: { entityType: "user", entityId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids }, emailVerifiedAt: null, passwordHash: null } }); // re-checked in the delete itself
  }
  const result = { sessions: sessions.count, tokens: tokens.count, rateLimits: rateLimits.count, unverifiedAccounts: ids.length };
  if (opts.audit !== false) await db.auditLog.create({ data: { actorId: null, action: "maintenance.cleanup", entityType: "system", entityId: "cleanup", after: result } });
  return result;
}
