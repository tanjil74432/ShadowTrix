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
import { ZodError } from "zod";
import { passwordIssues, type CompleteRegistrationInput, type LoginInput, type RegisterInput } from "./auth.schema";
import { getSignupsEnabled } from "@/server/modules/admin/admin-management.service";
import { checkSecondFactor, isMfaEnabled } from "./mfa.service";
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
 * Step 1 of signup. Only an email address is accepted, so nobody can attach a password of their own choosing to an
 * address they do not control (the pre-registration takeover). The caller always receives the same response:
 *  - new email           -> pending account (no password) + confirmation email
 *  - pending existing    -> a fresh confirmation email; older links stop working
 *  - verified existing   -> an "you already have an account" email to the real owner; nothing changes
 */
export async function registerUser(input: RegisterInput, ctx: RequestContext, deps: AuthDeps = defaultDeps()): Promise<void> {
  // Administrators can pause new sign-ups (platform setting). Existing accounts and logins are unaffected.
  if (!(await getSignupsEnabled())) throw new AppError(503, "signups_paused", "New registrations are paused for now. Please try again later.");
  await enforceRateLimits(
    [
      { scope: "register:email", id: input.email, policy: POLICIES.registerEmail },
      { scope: "register:ip", id: ctx.ip, policy: POLICIES.registerIp },
    ],
    deps.now(),
  );

  const now = deps.now();
  const result = await getDb()
    .$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: input.email } });

      if (!existing) {
        // The display name is a neutral placeholder; the real name is entered by the verified owner in step 2.
        const user = await tx.user.create({
          data: { email: input.email, fullName: input.email.split("@")[0], passwordHash: null, roles: { create: { role: "PARTICIPANT" } } },
        });
        await writeAudit({ actorId: user.id, action: "auth.register", entityType: "user", entityId: user.id }, tx);
        const token = await issueToken(tx, user.id, "EMAIL_VERIFY", EMAIL_VERIFY_TTL_HOURS * 3_600_000, now);
        return { kind: "verify" as const, token };
      }

      if (!existing.emailVerifiedAt) {
        if (existing.status !== "ACTIVE") return { kind: "none" as const };
        const token = await issueToken(tx, existing.id, "EMAIL_VERIFY", EMAIL_VERIFY_TTL_HOURS * 3_600_000, now);
        return { kind: "verify" as const, token };
      }

      return { kind: "exists" as const, name: existing.fullName };
    })
    .catch((e) => {
      // Two simultaneous registrations of one new address: the loser behaves like "exists".
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { kind: "none" as const };
      throw e;
    });

  if (result.kind === "verify" && result.token) {
    queueMail(deps, verificationEmail(input.email, linkTo("/verify-email", result.token), EMAIL_VERIFY_TTL_HOURS));
  } else if (result.kind === "exists") {
    queueMail(deps, alreadyRegisteredEmail(input.email, result.name, linkTo("/login"), linkTo("/forgot-password")));
  }
}

// ───────────────────────────── Completing registration ─────────────────────────────

/**
 * Step 2 of signup. The person holding the emailed token (so, the mailbox owner) chooses a name and password.
 * In one transaction the token is consumed atomically (exactly one caller can win, even concurrently), the password
 * is stored and the email is marked verified. The link alone never completes anything: this is only reached by an
 * explicit form submission, so mail scanners that open the link cannot burn or use the token.
 * A password the policy rejects is reported before the token is touched, so a typo never wastes the link.
 */
export async function completeRegistration(input: CompleteRegistrationInput, ctx: RequestContext, deps: AuthDeps = defaultDeps()): Promise<void> {
  await enforceRateLimits([{ scope: "token:ip", id: ctx.ip, policy: POLICIES.tokenSubmitIp }], deps.now());
  const db = getDb();
  const tokenHash = hashToken(input.token);

  // Read-only look first: validate the token and the email-aware password rule without consuming anything.
  const peek = await db.authToken.findUnique({
    where: { tokenHash },
    select: { type: true, usedAt: true, expiresAt: true, user: { select: { email: true, status: true } } },
  });
  if (!peek || peek.type !== "EMAIL_VERIFY" || peek.usedAt || peek.expiresAt <= deps.now() || peek.user.status !== "ACTIVE") {
    // Comparable cost to the success path, so response time does not reveal whether the token ever existed.
    await burnPasswordVerification(input.password);
    throw invalidToken();
  }
  const issue = passwordIssues(input.password, peek.user.email);
  if (issue) throw new ZodError([{ code: "custom", path: ["password"], message: issue, input: undefined }]);

  const passwordHash = await hashPassword(input.password); // slow work outside the transaction
  const now = deps.now();
  await db.$transaction(async (tx) => {
    const userId = await consumeToken(tx, input.token, "EMAIL_VERIFY", now);
    if (!userId) throw invalidToken();
    await tx.user.update({ where: { id: userId }, data: { passwordHash, fullName: input.fullName, emailVerifiedAt: now } });
    // Any other outstanding links for this account are void now.
    await tx.authToken.updateMany({ where: { userId, usedAt: null, type: { in: ["PASSWORD_RESET", "EMAIL_VERIFY"] } }, data: { usedAt: now } });
    await writeAudit({ actorId: userId, action: "auth.registration_completed", entityType: "user", entityId: userId }, tx);
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
  if (token) queueMail(deps, verificationEmail(user.email, linkTo("/verify-email", token), EMAIL_VERIFY_TTL_HOURS));
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
  // A pending signup has no password yet; it fails exactly like an unknown address.
  if (!user || !user.passwordHash) {
    await burnPasswordVerification(input.password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) throw invalidCredentials();

  if (user.status !== "ACTIVE") throw new AppError(403, "account_suspended", "This account has been suspended. Contact the organizers.");
  if (!user.emailVerifiedAt) throw new AppError(403, "email_not_verified", "Confirm your email address before logging in.");

  // Optional second factor. Only reached after the password was proven, so asking reveals nothing to a guesser.
  if (await isMfaEnabled(user.id)) {
    if (!input.code) throw new AppError(401, "mfa_required", "Enter the 6-digit code from your authenticator app, or a recovery code.");
    if (!(await checkSecondFactor(user.id, input.code, deps.now()))) {
      await writeAudit({ actorId: user.id, action: "auth.mfa_failed", entityType: "user", entityId: user.id });
      throw new AppError(401, "invalid_mfa_code", "That code is not correct.");
    }
  }

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

// ───────────────────────────── Change password (signed in) ─────────────────────────────

/**
 * Changes the password of a signed-in user. Requires the current password (a stolen session alone is not enough),
 * applies the same policy as signup and reset, signs the account out EVERYWHERE and mints a fresh session for this
 * browser (rotation), then emails a notice. The new session token is returned so the route can set the cookie.
 */
export async function changePassword(
  input: { userId: string; currentPassword: string; newPassword: string },
  ctx: RequestContext,
  deps: AuthDeps = defaultDeps(),
): Promise<{ sessionToken: string; expiresAt: Date }> {
  await enforceRateLimits([{ scope: "change-password:user", id: input.userId, policy: POLICIES.changePasswordUser }], deps.now());
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) throw new AppError(401, "unauthorized", "Authentication required");
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new AppError(400, "invalid_current_password", "Your current password is not correct.");
  }
  const issue = passwordIssues(input.newPassword, user.email);
  if (issue) throw new ZodError([{ code: "custom", path: ["newPassword"], message: issue, input: undefined }]);
  if (await verifyPassword(user.passwordHash, input.newPassword)) {
    throw new ZodError([{ code: "custom", path: ["newPassword"], message: "Choose a password different from your current one.", input: undefined }]);
  }

  const newHash = await hashPassword(input.newPassword);
  const now = deps.now();
  const session = await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    await tx.authToken.updateMany({ where: { userId: user.id, usedAt: null, type: "PASSWORD_RESET" }, data: { usedAt: now } });
    const revoked = await revokeAllUserSessions(user.id, "password_changed", tx);
    const fresh = await createSession(user.id, { userAgent: ctx.userAgent }, now, deps.sessionLimits, tx);
    await writeAudit({ actorId: user.id, action: "auth.password_changed", entityType: "user", entityId: user.id, after: { sessionsRevoked: revoked } }, tx);
    return fresh;
  });
  queueMail(deps, passwordChangedEmail(user.email, user.fullName, linkTo("/forgot-password")));
  return { sessionToken: session.token, expiresAt: session.expiresAt };
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
  // A pending signup (no password, email unproven) finishes through its confirmation link, not a reset.
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) return;
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
