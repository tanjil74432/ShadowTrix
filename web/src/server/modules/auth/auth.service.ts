import "server-only";
import { after } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/http/errors";
import { log } from "@/server/logging/logger";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { smtpMailer, type Mail, type Mailer } from "@/server/modules/email/mailer";
import {
  alreadyRegisteredEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from "@/server/modules/email/templates";
import { enforceRateLimits, POLICIES } from "@/server/security/rate-limit";
import { generateToken, hashToken } from "@/server/security/tokens";
import type { LoginInput, RegisterInput } from "./auth.schema";
import { burnPasswordVerification, hashPassword, needsRehash, verifyPassword } from "./password";
import { createSession, revokeAllUserSessions, revokeSessionByToken, type SessionLimits, type SessionUser } from "./session.service";

export const EMAIL_VERIFY_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_MINUTES = 60;

/** Everything with side effects is injectable so the service can be tested without SMTP or a request scope. */
export interface AuthDeps {
  mailer: Mailer;
  /** Runs email sending after the response is sent. Failures are logged, never surfaced (that would reveal account state). */
  schedule: (task: () => Promise<void>) => void;
  now: () => Date;
  sessionLimits?: Partial<SessionLimits>;
}

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export function defaultDeps(): AuthDeps {
  return {
    mailer: smtpMailer,
    now: () => new Date(),
    schedule: (task) => {
      const run = () =>
        task().catch((err) => log.error("auth.email_failed", err));
      try {
        after(run);
      } catch {
        void run(); // outside a request scope (scripts, tests)
      }
    },
  };
}

const linkTo = (path: string, token?: string) => {
  const url = new URL(path, getEnv().APP_URL);
  if (token) url.searchParams.set("token", token);
  return url.toString();
};

type Tx = Prisma.TransactionClient;
type TokenType = "EMAIL_VERIFY" | "PASSWORD_RESET";

/**
 * Issues a single-use token. Any earlier live token of the same type is invalidated first, so only the
 * newest emailed link works. Returns null if a concurrent request already issued one (unique index).
 */
async function issueToken(tx: Tx, userId: string, type: TokenType, ttlMs: number, now: Date): Promise<string | null> {
  await tx.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: now } });
  const token = generateToken();
  try {
    await tx.authToken.create({
      data: { userId, type, tokenHash: hashToken(token), createdAt: now, expiresAt: new Date(now.getTime() + ttlMs) },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
  return token;
}

/**
 * Atomically consumes a token: it succeeds for exactly one caller even under concurrent requests, because the
 * conditional UPDATE only matches an unused, unexpired row. Returns the owner's id or null.
 */
async function consumeToken(tx: Tx, rawToken: string, type: TokenType, now: Date): Promise<string | null> {
  const tokenHash = hashToken(rawToken);
  const claimed = await tx.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return null;
  const row = await tx.authToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  return row?.userId ?? null;
}

const invalidToken = () => new AppError(400, "invalid_token", "This link is invalid or has expired. Request a new one.");

function queueMail(deps: AuthDeps, mail: Mail) {
  deps.schedule(() => deps.mailer.send(mail));
}

// ───────────────────────────── Registration ─────────────────────────────

/**
 * Creates an account, or quietly does the right thing for an existing address. The caller always receives the
 * same response, so the endpoint cannot be used to discover which emails are registered:
 *  - new email           -> account + verification email
 *  - unverified existing -> credentials replaced by the newest registration + fresh verification email
 *                           (so someone cannot squat an address they do not control)
 *  - verified existing   -> an "you already have an account" email to the real owner; nothing changes
 * The password is hashed on every path so response time does not differ either.
 */
export async function registerUser(input: RegisterInput, ctx: RequestContext, deps: AuthDeps = defaultDeps()): Promise<void> {
  await enforceRateLimits(
    [
      { scope: "register:email", id: input.email, policy: POLICIES.registerEmail },
      { scope: "register:ip", id: ctx.ip, policy: POLICIES.registerIp },
    ],
    deps.now(),
  );

  const passwordHash = await hashPassword(input.password);
  const now = deps.now();
  const db = getDb();

  const result = await db
    .$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: input.email } });

      if (!existing) {
        const user = await tx.user.create({
          data: {
            email: input.email,
            fullName: input.fullName,
            passwordHash,
            roles: { create: { role: "PARTICIPANT" } },
          },
        });
        await writeAudit({ actorId: user.id, action: "auth.register", entityType: "user", entityId: user.id }, tx);
        const token = await issueToken(tx, user.id, "EMAIL_VERIFY", EMAIL_VERIFY_TTL_HOURS * 3_600_000, now);
        return { kind: "verify" as const, name: user.fullName, token };
      }

      if (!existing.emailVerifiedAt) {
        if (existing.status !== "ACTIVE") return { kind: "none" as const };
        await tx.user.update({ where: { id: existing.id }, data: { passwordHash, fullName: input.fullName } });
        // Anyone holding a session for the old registration is signed out.
        await revokeAllUserSessions(existing.id, "re-registered", tx);
        const token = await issueToken(tx, existing.id, "EMAIL_VERIFY", EMAIL_VERIFY_TTL_HOURS * 3_600_000, now);
        return { kind: "verify" as const, name: input.fullName, token };
      }

      return { kind: "exists" as const, name: existing.fullName };
    })
    .catch((e) => {
      // Two simultaneous registrations of one new address: the loser behaves like "exists".
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { kind: "none" as const };
      throw e;
    });

  if (result.kind === "verify" && result.token) {
    queueMail(deps, verificationEmail(input.email, result.name, linkTo("/verify-email", result.token), EMAIL_VERIFY_TTL_HOURS));
  } else if (result.kind === "exists") {
    queueMail(deps, alreadyRegisteredEmail(input.email, result.name, linkTo("/login"), linkTo("/forgot-password")));
  }
}

// ───────────────────────────── Email verification ─────────────────────────────

export async function verifyEmail(token: string, ctx: RequestContext, deps: AuthDeps = defaultDeps()): Promise<void> {
  await enforceRateLimits([{ scope: "token:ip", id: ctx.ip, policy: POLICIES.tokenSubmitIp }], deps.now());
  const now = deps.now();
  await getDb().$transaction(async (tx) => {
    const userId = await consumeToken(tx, token, "EMAIL_VERIFY", now);
    if (!userId) throw invalidToken();
    await tx.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
    await writeAudit({ actorId: userId, action: "auth.email_verified", entityType: "user", entityId: userId }, tx);
  });
}

/** Always succeeds from the caller's point of view; an email is sent only if there is an unverified, active account. */
export async function resendVerification(email: string, ctx: RequestContext, deps: AuthDeps = defaultDeps()): Promise<void> {
  await enforceRateLimits(
    [
      { scope: "resend:email", id: email, policy: POLICIES.resendEmail },
      { scope: "resend:ip", id: ctx.ip, policy: POLICIES.resendIp },
    ],
    deps.now(),
  );
  const now = deps.now();
  const db = getDb();
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt || user.status !== "ACTIVE") return;
  const token = await db.$transaction((tx) => issueToken(tx, user.id, "EMAIL_VERIFY", EMAIL_VERIFY_TTL_HOURS * 3_600_000, now));
  if (token) queueMail(deps, verificationEmail(user.email, user.fullName, linkTo("/verify-email", token), EMAIL_VERIFY_TTL_HOURS));
}

// ───────────────────────────── Login / logout ─────────────────────────────

export interface LoginResult {
  user: Pick<SessionUser, "id" | "email" | "fullName">;
  sessionToken: string;
  expiresAt: Date;
}

const invalidCredentials = () => new AppError(401, "invalid_credentials", "Incorrect email or password.");

/**
 * Failure modes are deliberately uniform until the password has been proven correct:
 * unknown email and wrong password produce the same error at the same cost. Only after a correct password do we
 * disclose that the email is unverified or the account is suspended.
 */
export async function login(input: LoginInput, ctx: RequestContext, deps: AuthDeps = defaultDeps()): Promise<LoginResult> {
  await enforceRateLimits(
    [
      { scope: "login:email", id: input.email, policy: POLICIES.loginEmail },
      { scope: "login:ip", id: ctx.ip, policy: POLICIES.loginIp },
    ],
    deps.now(),
  );

  const db = getDb();
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user) {
    await burnPasswordVerification(input.password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) throw invalidCredentials();

  if (user.status !== "ACTIVE") throw new AppError(403, "account_suspended", "This account has been suspended. Contact the organizers.");
  if (!user.emailVerifiedAt) throw new AppError(403, "email_not_verified", "Confirm your email address before logging in.");

  const now = deps.now();
  if (needsRehash(user.passwordHash)) {
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } });
  }
  const session = await createSession(user.id, { userAgent: ctx.userAgent }, now, deps.sessionLimits);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  await writeAudit({ actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id });

  return { user: { id: user.id, email: user.email, fullName: user.fullName }, sessionToken: session.token, expiresAt: session.expiresAt };
}

export async function logout(sessionToken: string | undefined, actorId?: string): Promise<void> {
  await revokeSessionByToken(sessionToken, "logout");
  if (actorId) await writeAudit({ actorId, action: "auth.logout", entityType: "user", entityId: actorId });
}

// ───────────────────────────── Password reset ─────────────────────────────

/** Always succeeds from the caller's point of view; never reveals whether the address has an account. */
export async function requestPasswordReset(email: string, ctx: RequestContext, deps: AuthDeps = defaultDeps()): Promise<void> {
  await enforceRateLimits(
    [
      { scope: "forgot:email", id: email, policy: POLICIES.forgotEmail },
      { scope: "forgot:ip", id: ctx.ip, policy: POLICIES.forgotIp },
    ],
    deps.now(),
  );
  const now = deps.now();
  const db = getDb();
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") return;
  const token = await db.$transaction(async (tx) => {
    const t = await issueToken(tx, user.id, "PASSWORD_RESET", PASSWORD_RESET_TTL_MINUTES * 60_000, now);
    if (t) await writeAudit({ actorId: user.id, action: "auth.password_reset_requested", entityType: "user", entityId: user.id }, tx);
    return t;
  });
  if (token) queueMail(deps, passwordResetEmail(user.email, user.fullName, linkTo("/reset-password", token), PASSWORD_RESET_TTL_MINUTES));
}

/**
 * Sets a new password using a single-use token. In one transaction: consume the token, change the hash,
 * mark the email verified (the emailed link proves control of it), and sign the user out everywhere.
 */
export async function resetPassword(
  input: { token: string; password: string },
  ctx: RequestContext,
  deps: AuthDeps = defaultDeps(),
): Promise<void> {
  await enforceRateLimits([{ scope: "token:ip", id: ctx.ip, policy: POLICIES.tokenSubmitIp }], deps.now());
  const newHash = await hashPassword(input.password); // slow work outside the transaction
  const now = deps.now();

  const done = await getDb().$transaction(async (tx) => {
    const userId = await consumeToken(tx, input.token, "PASSWORD_RESET", now);
    if (!userId) throw invalidToken();
    const user = await tx.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
    if (!user.emailVerifiedAt) await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
    // Any other outstanding reset/verify links are void now.
    await tx.authToken.updateMany({ where: { userId, usedAt: null, type: { in: ["PASSWORD_RESET", "EMAIL_VERIFY"] } }, data: { usedAt: now } });
    const revoked = await revokeAllUserSessions(userId, "password_reset", tx);
    await writeAudit({ actorId: userId, action: "auth.password_reset", entityType: "user", entityId: userId, after: { sessionsRevoked: revoked } }, tx);
    return { email: user.email, name: user.fullName };
  });

  queueMail(deps, passwordChangedEmail(done.email, done.name, linkTo("/forgot-password")));
}
