import "server-only";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/http/errors";
import { hmacId } from "./tokens";

export interface RateLimitPolicy {
  /** Maximum attempts allowed in one window. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limiter backed by Postgres, so the limit holds across processes and restarts
 * without extra infrastructure. One atomic upsert per check. `now` is injectable for tests.
 */
export async function consumeRateLimit(
  key: string,
  policy: RateLimitPolicy,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const rows = await getDb().$queryRaw<{ count: number; window_start: Date }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, ${now}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start <= ${now}::timestamptz - make_interval(secs => ${policy.windowSeconds})
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start <= ${now}::timestamptz - make_interval(secs => ${policy.windowSeconds})
                          THEN ${now}::timestamptz ELSE rate_limits.window_start END
    RETURNING count, window_start`;
  const { count, window_start } = rows[0];
  const resetAt = window_start.getTime() + policy.windowSeconds * 1000;
  return {
    allowed: count <= policy.limit,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
  };
}

/** Throws a 429 AppError (with Retry-After) when any of the keys is over its limit. */
export async function enforceRateLimits(
  checks: { scope: string; id: string | null; policy: RateLimitPolicy }[],
  now: Date = new Date(),
): Promise<void> {
  let worst = 0;
  for (const c of checks) {
    if (!c.id) continue; // identifier unavailable (e.g. client IP unknown): skip this dimension
    const key = `${c.scope}:${hmacId(c.scope, c.id)}`;
    const r = await consumeRateLimit(key, c.policy, now);
    if (!r.allowed) worst = Math.max(worst, r.retryAfterSeconds);
  }
  if (worst > 0) throw new RateLimitedError(worst);
}

export class RateLimitedError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super(429, "rate_limited", "Too many attempts. Please wait before trying again.", {
      "Retry-After": String(retryAfterSeconds),
    });
    this.name = "RateLimitedError";
  }
}

/** Housekeeping: drop counters whose window ended long ago. Safe to call often. */
export async function purgeExpiredRateLimits(olderThanSeconds = 86_400, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanSeconds * 1000);
  const res = await getDb().rateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } });
  return res.count;
}

/** Policies. Email dimensions stop credential stuffing against one account; IP dimensions stop spraying. */
export const POLICIES = {
  loginEmail: { limit: 8, windowSeconds: 15 * 60 },
  loginIp: { limit: 40, windowSeconds: 15 * 60 },
  registerIp: { limit: 10, windowSeconds: 60 * 60 },
  registerEmail: { limit: 5, windowSeconds: 60 * 60 },
  forgotEmail: { limit: 5, windowSeconds: 60 * 60 },
  forgotIp: { limit: 20, windowSeconds: 60 * 60 },
  resendEmail: { limit: 5, windowSeconds: 60 * 60 },
  resendIp: { limit: 20, windowSeconds: 60 * 60 },
  tokenSubmitIp: { limit: 20, windowSeconds: 15 * 60 },
} satisfies Record<string, RateLimitPolicy>;
