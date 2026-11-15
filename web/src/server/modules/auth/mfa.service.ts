import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getAuthSecret } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/http/errors";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { hasGlobalRole, type Actor } from "@/server/modules/authz/permissions";
import { enforceRateLimits, POLICIES } from "@/server/security/rate-limit";
import { deriveKey, open, seal } from "@/server/security/secret-box";
import { generateTotpSecret, otpauthUri, stepAt, verifyTotp } from "@/server/security/totp";
import { verifyPassword } from "./password";

/**
 * Optional TOTP second factor for administrators. It is never required: an administrator who has not enrolled signs
 * in with the password alone. Once enrolled, login also needs a current code or a one-time recovery code.
 */
const key = () => deriveKey(getAuthSecret(), "mfa-secret");
const RECOVERY_CODE_COUNT = 10;
const hashCode = (code: string) => createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

/** 10 characters from an unambiguous alphabet, shown as XXXXX-XXXXX. */
function newRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export async function getMfaStatus(userId: string): Promise<{ enabled: boolean; recoveryCodesLeft: number }> {
  const db = getDb();
  const mfa = await db.userMfa.findUnique({ where: { userId }, select: { enabledAt: true } });
  const enabled = !!mfa?.enabledAt;
  return { enabled, recoveryCodesLeft: enabled ? await db.mfaRecoveryCode.count({ where: { userId, usedAt: null } }) : 0 };
}

/** Starts (or restarts) enrollment. The secret is not active until a correct code is confirmed. */
export async function beginMfaEnrollment(actor: Actor, email: string): Promise<{ secret: string; uri: string }> {
  if (!hasGlobalRole(actor, "ADMIN")) throw new AppError(403, "forbidden", "Two-step verification is available to administrators.");
  const db = getDb();
  const existing = await db.userMfa.findUnique({ where: { userId: actor.id }, select: { enabledAt: true } });
  if (existing?.enabledAt) throw new AppError(409, "mfa_already_enabled", "Two-step verification is already on. Turn it off first to set it up again.");
  const secret = generateTotpSecret();
  await db.userMfa.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, secretEnc: seal(key(), secret) },
    update: { secretEnc: seal(key(), secret), enabledAt: null, lastUsedStep: null },
  });
  await writeAudit({ actorId: actor.id, action: "mfa.enrollment_started", entityType: "user", entityId: actor.id });
  return { secret, uri: otpauthUri(secret, email) };
}

/** Confirms enrollment with a code from the app and returns the recovery codes, which are shown exactly once. */
export async function confirmMfaEnrollment(actor: Actor, code: string, now: Date = new Date()): Promise<{ recoveryCodes: string[] }> {
  await enforceRateLimits([{ scope: "mfa:user", id: actor.id, policy: POLICIES.changePasswordUser }], now);
  const db = getDb();
  const mfa = await db.userMfa.findUnique({ where: { userId: actor.id } });
  if (!mfa || mfa.enabledAt) throw new AppError(409, "mfa_not_pending", "There is no set-up in progress.");
  const step = verifyTotp(open(key(), mfa.secretEnc), code.trim(), now.getTime());
  if (step === null) throw new AppError(400, "invalid_mfa_code", "That code is not correct. Check the time on your device and try again.");
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await db.$transaction(async (tx) => {
    await tx.userMfa.update({ where: { userId: actor.id }, data: { enabledAt: now, lastUsedStep: BigInt(step) } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: actor.id } });
    await tx.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId: actor.id, codeHash: hashCode(c) })) });
    await writeAudit({ actorId: actor.id, action: "mfa.enabled", entityType: "user", entityId: actor.id }, tx);
  });
  return { recoveryCodes: codes };
}

/** Turning it off needs the password AND a current code (or recovery code), so a stolen session cannot remove it. */
export async function disableMfa(actor: Actor, input: { password: string; code: string }, now: Date = new Date()): Promise<void> {
  await enforceRateLimits([{ scope: "mfa:user", id: actor.id, policy: POLICIES.changePasswordUser }], now);
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true } });
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError(400, "invalid_current_password", "Your password is not correct.");
  }
  if (!(await checkSecondFactor(actor.id, input.code, now))) throw new AppError(400, "invalid_mfa_code", "That code is not correct.");
  await db.$transaction(async (tx) => {
    await tx.userMfa.deleteMany({ where: { userId: actor.id } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: actor.id } });
    await writeAudit({ actorId: actor.id, action: "mfa.disabled", entityType: "user", entityId: actor.id }, tx);
  });
}

/** True when the user has finished MFA enrollment (login must then ask for a code). */
export async function isMfaEnabled(userId: string): Promise<boolean> {
  return !!(await getDb().userMfa.findUnique({ where: { userId }, select: { enabledAt: true } }))?.enabledAt;
}

/**
 * Accepts a current authenticator code (each time step only once, so a captured code cannot be replayed) or an unused
 * recovery code (each works once). Both consumptions are atomic conditional updates, safe under concurrency.
 */
export async function checkSecondFactor(userId: string, rawCode: string, now: Date = new Date()): Promise<boolean> {
  const db = getDb();
  const code = rawCode.trim();
  if (/^\d{6}$/.test(code)) {
    const mfa = await db.userMfa.findUnique({ where: { userId } });
    if (!mfa?.enabledAt) return false;
    const step = verifyTotp(open(key(), mfa.secretEnc), code, now.getTime());
    if (step === null) return false;
    const claimed = await db.$executeRaw`UPDATE user_mfa SET last_used_step = ${BigInt(step)} WHERE user_id = ${userId}::uuid AND (last_used_step IS NULL OR last_used_step < ${BigInt(step)})`;
    return claimed === 1;
  }
  if (code.length >= 10 && code.length <= 12) {
    const claimed = await db.mfaRecoveryCode.updateMany({ where: { userId, codeHash: hashCode(code), usedAt: null }, data: { usedAt: now } });
    if (claimed.count === 1) {
      await writeAudit({ actorId: userId, action: "mfa.recovery_code_used", entityType: "user", entityId: userId });
      return true;
    }
  }
  return false;
}

export const currentStep = (now: Date) => stepAt(now.getTime());
