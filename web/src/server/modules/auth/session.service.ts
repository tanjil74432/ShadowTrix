import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/config/env";
import type { RoleGrant } from "@/server/modules/authz/permissions";
import { generateToken, hashToken } from "@/server/security/tokens";

type Db = Pick<Prisma.TransactionClient, "session">;

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  roles: RoleGrant[];
}

export interface SessionLimits {
  absoluteDays: number;
  idleDays: number;
}

const DAY_MS = 86_400_000;
/** Only write lastSeenAt this often, to avoid a database write on every request. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

function limits(override?: Partial<SessionLimits>): SessionLimits {
  const env = getEnv();
  return {
    absoluteDays: override?.absoluteDays ?? env.SESSION_ABSOLUTE_TTL_DAYS,
    idleDays: override?.idleDays ?? env.SESSION_IDLE_TTL_DAYS,
  };
}

export function sessionMaxAgeSeconds(): number {
  return limits().absoluteDays * 86_400;
}

/**
 * Creates a session and returns the raw token (shown to the browser once, never stored).
 * A fresh random token is minted at every login, which prevents session fixation.
 */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null } = {},
  now: Date = new Date(),
  override?: Partial<SessionLimits>,
  db: Db = getDb(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + limits(override).absoluteDays * DAY_MS);
  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 200) : null,
    },
  });
  return { token, expiresAt };
}

/**
 * Resolves a raw session token to its user, or null. Enforced on every call:
 * not revoked, within the absolute lifetime, within the idle timeout, user still ACTIVE and verified.
 */
export async function getSessionUser(
  token: string | undefined | null,
  now: Date = new Date(),
  override?: Partial<SessionLimits>,
): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!token || token.length > 200) return null;
  const db = getDb();
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { roles: true } } },
  });
  if (!session || session.revokedAt) return null;
  const { idleDays } = limits(override);
  if (session.expiresAt <= now) return null;
  if (session.lastSeenAt.getTime() + idleDays * DAY_MS <= now.getTime()) return null;
  const u = session.user;
  if (u.status !== "ACTIVE" || !u.emailVerifiedAt) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }

  return {
    sessionId: session.id,
    user: {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      roles: u.roles.map((r) => ({ role: r.role, eventId: r.eventId, organizationId: r.organizationId })),
    },
  };
}

export async function revokeSessionByToken(token: string | undefined | null, reason: string, db: Db = getDb()) {
  if (!token) return;
  await db.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Signs a user out everywhere (password change/reset, suspension, security events). */
export async function revokeAllUserSessions(userId: string, reason: string, db: Db = getDb()): Promise<number> {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return res.count;
}

/** Removes sessions that can never be valid again. Safe to run periodically. */
export async function purgeDeadSessions(now: Date = new Date(), keepDays = 30): Promise<number> {
  const cutoff = new Date(now.getTime() - keepDays * DAY_MS);
  const res = await getDb().session.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return res.count;
}
