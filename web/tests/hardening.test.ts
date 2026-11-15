import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { grantRole, revokeRole } from "@/server/modules/admin/admin-users.service";
import { changePassword, login } from "@/server/modules/auth/auth.service";
import { beginMfaEnrollment, checkSecondFactor, confirmMfaEnrollment, disableMfa, getMfaStatus, isMfaEnabled } from "@/server/modules/auth/mfa.service";
import { verifyPassword } from "@/server/modules/auth/password";
import { createSession, getSessionUser } from "@/server/modules/auth/session.service";
import { runCleanup } from "@/server/modules/maintenance/cleanup.core";
import { deriveKey, open, seal } from "@/server/security/secret-box";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, stepAt, totpAtStep, verifyTotp } from "@/server/security/totp";
import { hashToken } from "@/server/security/tokens";
import { NEW_PW, PW, actorOf, cleanup, createUser, ctx, makeHarness, uniqueEmail } from "./helpers/auth-harness";

const DAY = 86_400_000;
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await getDb().$disconnect();
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 Appendix B, SHA-1 secret "12345678901234567890"; the RFC lists 8-digit codes, these are their last 6 digits.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches the published vector at t=%i", (t, code) => {
    expect(totpAtStep(secret, Math.floor(t / 30))).toBe(code);
    expect(verifyTotp(secret, code, t * 1000)).toBe(Math.floor(t / 30));
  });

  it("accepts one step of clock drift either way but not two, and rejects malformed input", () => {
    const t = 1_700_000_000_000;
    const step = stepAt(t);
    expect(verifyTotp(secret, totpAtStep(secret, step - 1), t)).toBe(step - 1);
    expect(verifyTotp(secret, totpAtStep(secret, step + 1), t)).toBe(step + 1);
    expect(verifyTotp(secret, totpAtStep(secret, step - 2), t)).toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345", "１２３４５６"]) expect(verifyTotp(secret, bad, t), bad).toBeNull();
  });

  it("base32 round-trips, secrets are 160 bits and the app URI carries the issuer", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    const s = generateTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(s).not.toBe(generateTotpSecret());
    expect(otpauthUri(s, "a@b.co")).toMatch(/^otpauth:\/\/totp\/ShadowTrix%3Aa%40b\.co\?secret=[A-Z2-7]+&issuer=ShadowTrix/);
  });
});

describe("secret box (AES-256-GCM)", () => {
  const key = deriveKey("a-test-secret-that-is-long-enough-123456", "t");
  it("round-trips, never repeats ciphertext, and detects tampering and wrong keys", () => {
    const a = seal(key, "JBSWY3DPEHPK3PXP");
    expect(a).not.toContain("JBSWY3DP");
    expect(seal(key, "JBSWY3DPEHPK3PXP")).not.toBe(a);
    expect(open(key, a)).toBe("JBSWY3DPEHPK3PXP");
    const parts = a.split(".");
    expect(() => open(key, [parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join("."))).toThrow();
    expect(() => open(deriveKey("another-secret-that-is-long-enough-12345", "t"), a)).toThrow();
    expect(() => open(key, "garbage")).toThrow();
  });
});

describe("optional administrator MFA", () => {
  const codeNow = (secret: string, offset = 0) => totpAtStep(secret, stepAt(Date.now()) + offset);

  it("an administrator without MFA signs in with the password alone (MFA is never mandatory)", async () => {
    const h = makeHarness();
    const admin = await createUser({ roles: ["ADMIN"] });
    expect(await isMfaEnabled(admin.id)).toBe(false);
    await expect(login({ email: admin.email, password: PW }, ctx, h.deps)).resolves.toMatchObject({ user: { id: admin.id } });
  });

  it("only administrators can enroll", async () => {
    const p = await createUser();
    const o = await createUser({ roles: ["ORGANIZER"] });
    await expect(beginMfaEnrollment(actorOf(p), p.email)).rejects.toMatchObject({ status: 403 });
    await expect(beginMfaEnrollment(actorOf(o), o.email)).rejects.toMatchObject({ status: 403 });
  });

  it("enrollment stores the secret encrypted, stays inactive until a correct code is confirmed, then requires a code at login", async () => {
    const h = makeHarness();
    const admin = await createUser({ roles: ["ADMIN"] });
    const actor = actorOf(admin);
    const { secret, uri } = await beginMfaEnrollment(actor, admin.email);
    expect(uri).toContain(secret);
    const stored = await getDb().userMfa.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(stored.secretEnc).not.toContain(secret);
    expect(stored.enabledAt).toBeNull();
    expect(await isMfaEnabled(admin.id)).toBe(false);
    // still pending: password alone works
    await login({ email: admin.email, password: PW }, ctx, h.deps);

    await expect(confirmMfaEnrollment(actor, "000000")).rejects.toMatchObject({ code: "invalid_mfa_code" });
    expect(await isMfaEnabled(admin.id)).toBe(false);
    const { recoveryCodes } = await confirmMfaEnrollment(actor, codeNow(secret));
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(await getMfaStatus(admin.id)).toEqual({ enabled: true, recoveryCodesLeft: 10 });
    const hashes = (await getDb().mfaRecoveryCode.findMany({ where: { userId: admin.id } })).map((r) => r.codeHash);
    for (const c of recoveryCodes) expect(hashes).not.toContain(c); // only hashes are stored

    // now a code is required, and only revealed after the password was right
    await expect(login({ email: admin.email, password: PW }, ctx, h.deps)).rejects.toMatchObject({ status: 401, code: "mfa_required" });
    await expect(login({ email: admin.email, password: "wrong password here" }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(login({ email: admin.email, password: PW, code: "123456" }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    await expect(login({ email: admin.email, password: PW, code: codeNow(secret, 1) }, ctx, h.deps)).resolves.toMatchObject({ user: { id: admin.id } });
  });

  it("a code cannot be replayed, but the next time step works", async () => {
    const h = makeHarness();
    const admin = await createUser({ roles: ["ADMIN"] });
    const { secret } = await beginMfaEnrollment(actorOf(admin), admin.email);
    await confirmMfaEnrollment(actorOf(admin), codeNow(secret));
    const c1 = codeNow(secret, 1);
    await login({ email: admin.email, password: PW, code: c1 }, ctx, h.deps);
    await expect(login({ email: admin.email, password: PW, code: c1 }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    // an earlier step than the last accepted one is also refused
    await expect(login({ email: admin.email, password: PW, code: codeNow(secret, 0) }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_mfa_code" });
  });

  it("concurrent use of one code succeeds exactly once", async () => {
    const admin = await createUser({ roles: ["ADMIN"] });
    const { secret } = await beginMfaEnrollment(actorOf(admin), admin.email);
    await confirmMfaEnrollment(actorOf(admin), codeNow(secret));
    const code = codeNow(secret, 1);
    const results = await Promise.all(Array.from({ length: 6 }, () => checkSecondFactor(admin.id, code)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("recovery codes work once each, in any format casing", async () => {
    const h = makeHarness();
    const admin = await createUser({ roles: ["ADMIN"] });
    const { secret } = await beginMfaEnrollment(actorOf(admin), admin.email);
    const { recoveryCodes } = await confirmMfaEnrollment(actorOf(admin), codeNow(secret));
    await expect(login({ email: admin.email, password: PW, code: recoveryCodes[0].toLowerCase() }, ctx, h.deps)).resolves.toBeDefined();
    await expect(login({ email: admin.email, password: PW, code: recoveryCodes[0] }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    await expect(login({ email: admin.email, password: PW, code: recoveryCodes[1] }, ctx, h.deps)).resolves.toBeDefined();
    expect((await getMfaStatus(admin.id)).recoveryCodesLeft).toBe(8);
    expect(await getDb().auditLog.count({ where: { actorId: admin.id, action: "mfa.recovery_code_used" } })).toBe(2);
  });

  it("turning it off needs the password and a valid code, then password-only sign-in works again", async () => {
    const h = makeHarness();
    const admin = await createUser({ roles: ["ADMIN"] });
    const actor = actorOf(admin);
    const { secret } = await beginMfaEnrollment(actor, admin.email);
    const { recoveryCodes } = await confirmMfaEnrollment(actor, codeNow(secret));
    await expect(disableMfa(actor, { password: "wrong password here", code: recoveryCodes[0] })).rejects.toMatchObject({ code: "invalid_current_password" });
    await expect(disableMfa(actor, { password: PW, code: "000000" })).rejects.toMatchObject({ code: "invalid_mfa_code" });
    expect(await isMfaEnabled(admin.id)).toBe(true);
    await disableMfa(actor, { password: PW, code: recoveryCodes[0] });
    expect(await isMfaEnabled(admin.id)).toBe(false);
    expect(await getDb().mfaRecoveryCode.count({ where: { userId: admin.id } })).toBe(0);
    await expect(login({ email: admin.email, password: PW }, ctx, h.deps)).resolves.toBeDefined();
  });

  it("cannot restart enrollment while enabled", async () => {
    const admin = await createUser({ roles: ["ADMIN"] });
    const { secret } = await beginMfaEnrollment(actorOf(admin), admin.email);
    await confirmMfaEnrollment(actorOf(admin), codeNow(secret));
    await expect(beginMfaEnrollment(actorOf(admin), admin.email)).rejects.toMatchObject({ code: "mfa_already_enabled" });
  });
});

describe("change password (signed in)", () => {
  it("needs the current password, applies the policy, rotates every session and emails a notice", async () => {
    const h = makeHarness();
    const u = await createUser();
    const a = await createSession(u.id);
    const b = await createSession(u.id);
    const base = { userId: u.id };

    await expect(changePassword({ ...base, currentPassword: "not the password", newPassword: NEW_PW }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_current_password" });
    await expect(changePassword({ ...base, currentPassword: PW, newPassword: "short" }, ctx, h.deps)).rejects.toMatchObject({ issues: [expect.objectContaining({ path: ["newPassword"] })] });
    await expect(changePassword({ ...base, currentPassword: PW, newPassword: PW }, ctx, h.deps)).rejects.toMatchObject({ issues: [expect.objectContaining({ message: expect.stringMatching(/different/) })] });
    expect(await verifyPassword((await getDb().user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash!, PW)).toBe(true); // nothing changed yet

    const result = await changePassword({ ...base, currentPassword: PW, newPassword: NEW_PW }, ctx, h.deps);
    await h.flush();
    expect(await verifyPassword((await getDb().user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash!, NEW_PW)).toBe(true);
    expect(await getSessionUser(a.token)).toBeNull();
    expect(await getSessionUser(b.token)).toBeNull();
    expect((await getSessionUser(result.sessionToken))?.user.id).toBe(u.id); // rotated: this browser gets a fresh token
    expect(h.mailsTo(u.email).map((m) => m.subject)).toEqual(["Your ShadowTrix password was changed"]);
    expect(await getDb().auditLog.count({ where: { actorId: u.id, action: "auth.password_changed" } })).toBe(1);
    expect(JSON.stringify(await getDb().auditLog.findMany({ where: { actorId: u.id } }))).not.toContain(NEW_PW);
  });

  it("is rate limited and rejects pending or suspended accounts", async () => {
    const h = makeHarness();
    const u = await createUser();
    for (let i = 0; i < 5; i++) await changePassword({ userId: u.id, currentPassword: "wrong wrong wrong", newPassword: NEW_PW }, ctx, h.deps).catch(() => undefined);
    await expect(changePassword({ userId: u.id, currentPassword: PW, newPassword: NEW_PW }, ctx, h.deps)).rejects.toMatchObject({ status: 429 });
    const s = await createUser({ status: "SUSPENDED" });
    await expect(changePassword({ userId: s.id, currentPassword: PW, newPassword: NEW_PW }, ctx, h.deps)).rejects.toMatchObject({ status: 401 });
  });
});

describe("session revocation on privilege change", () => {
  it("granting or revoking a role signs the target out; the acting administrator stays signed in", async () => {
    const admin = await createUser({ roles: ["ADMIN"] });
    const second = await createUser({ roles: ["ADMIN"] });
    const target = await createUser();
    const adminSession = await createSession(admin.id);
    const t1 = await createSession(target.id);

    await grantRole(actorOf(admin), target.id, "ORGANIZER");
    expect(await getSessionUser(t1.token)).toBeNull();
    expect(await getSessionUser(adminSession.token)).not.toBeNull();

    const t2 = await createSession(target.id);
    expect((await getSessionUser(t2.token))?.user.roles.map((r) => r.role)).toContain("ORGANIZER");
    await revokeRole(actorOf(second), target.id, "ORGANIZER");
    expect(await getSessionUser(t2.token)).toBeNull();
    // a repeat grant that changes nothing does not sign anyone out
    await grantRole(actorOf(admin), target.id, "JUDGE");
    const t3 = await createSession(target.id);
    await grantRole(actorOf(admin), target.id, "JUDGE");
    expect(await getSessionUser(t3.token)).not.toBeNull();
  });
});

describe("scheduled cleanup", () => {
  const OLD = new Date(Date.now() - 30 * DAY);
  async function pending(createdAt: Date, extra: Record<string, unknown> = {}) {
    return getDb().user.create({ data: { email: uniqueEmail("pend"), fullName: "pending", passwordHash: null, createdAt, roles: { create: { role: "PARTICIPANT" } }, ...extra } });
  }

  it("removes stale unverified signups only: verified accounts, accounts with a password, recent signups and active users stay", async () => {
    const db = getDb();
    const stale = await pending(OLD);
    const fresh = await pending(new Date());
    const verified = await createUser();
    await db.user.update({ where: { id: verified.id }, data: { createdAt: OLD } });
    const withPassword = await createUser({ verified: false });
    await db.user.update({ where: { id: withPassword.id }, data: { createdAt: OLD } });
    const withRole = await pending(OLD, { roles: { create: [{ role: "PARTICIPANT" }, { role: "ORGANIZER" }] } });
    const loggedIn = await pending(OLD, { lastLoginAt: new Date() });

    const result = await runCleanup(db, { audit: false });
    const left = new Set((await db.user.findMany({ where: { id: { in: [stale.id, fresh.id, verified.id, withPassword.id, withRole.id, loggedIn.id] } }, select: { id: true } })).map((u) => u.id));
    expect(left.has(stale.id)).toBe(false);
    for (const keep of [fresh, verified, withPassword, withRole, loggedIn]) expect(left.has(keep.id)).toBe(true);
    expect(result.unverifiedAccounts).toBeGreaterThanOrEqual(1);
  });

  it("removes expired and spent tokens and dead sessions but never live ones", async () => {
    const db = getDb();
    const u = await createUser();
    const mk = (type: "EMAIL_VERIFY" | "PASSWORD_RESET", over: Record<string, unknown>) =>
      db.authToken.create({ data: { userId: u.id, type, tokenHash: hashToken(Math.random().toString()), expiresAt: new Date(Date.now() + DAY), ...over } });
    const live = await mk("EMAIL_VERIFY", {});
    const expired = await mk("PASSWORD_RESET", { expiresAt: new Date(Date.now() - 30 * DAY), createdAt: new Date(Date.now() - 31 * DAY) });
    const spent = await db.authToken.create({ data: { userId: u.id, type: "PASSWORD_RESET", tokenHash: hashToken("spent"), createdAt: new Date(Date.now() - 25 * DAY), expiresAt: new Date(Date.now() - 20 * DAY), usedAt: new Date(Date.now() - 20 * DAY) } });
    const liveSession = await createSession(u.id);
    const deadSession = await db.session.create({ data: { userId: u.id, tokenHash: hashToken("dead"), createdAt: new Date(Date.now() - 40 * DAY), expiresAt: new Date(Date.now() - 30 * DAY) } });
    const revokedOld = await db.session.create({ data: { userId: u.id, tokenHash: hashToken("rev"), createdAt: new Date(Date.now() - 40 * DAY), expiresAt: new Date(Date.now() + DAY), revokedAt: new Date(Date.now() - 30 * DAY) } });

    await runCleanup(db, { audit: false });
    expect(await db.authToken.findUnique({ where: { id: live.id } })).not.toBeNull();
    expect(await db.authToken.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await db.authToken.findUnique({ where: { id: spent.id } })).toBeNull();
    expect(await db.session.findUnique({ where: { id: deadSession.id } })).toBeNull();
    expect(await db.session.findUnique({ where: { id: revokedOld.id } })).toBeNull();
    expect(await getSessionUser(liveSession.token)).not.toBeNull();
  });

  it("is idempotent and writes one summary audit row", async () => {
    const db = getDb();
    const before = await db.auditLog.count({ where: { action: "maintenance.cleanup" } });
    const first = await runCleanup(db);
    const second = await runCleanup(db);
    expect(second.unverifiedAccounts).toBe(0);
    expect(first).toMatchObject({ sessions: expect.any(Number), tokens: expect.any(Number) });
    expect(await db.auditLog.count({ where: { action: "maintenance.cleanup" } })).toBe(before + 2);
    await db.auditLog.deleteMany({ where: { action: "maintenance.cleanup", entityId: "cleanup" } }); // keep the dev database clean
  });
});
