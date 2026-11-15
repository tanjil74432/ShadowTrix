import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db/client";
import { completeRegistrationSchema, registerSchema } from "@/server/modules/auth/auth.schema";
import {
  completeRegistration,
  login,
  logout,
  registerUser,
  requestPasswordReset,
  resendVerification,
  resetPassword,
} from "@/server/modules/auth/auth.service";
import { burnPasswordVerification, hashPassword, verifyPassword } from "@/server/modules/auth/password";
import { createSession, getSessionUser, purgeDeadSessions, revokeAllUserSessions } from "@/server/modules/auth/session.service";
import { RateLimitedError, consumeRateLimit } from "@/server/security/rate-limit";
import { hashToken } from "@/server/security/tokens";
import { NEW_PW, PW, cleanup, createUser, ctx, makeHarness, tokenFrom, uniqueEmail } from "./helpers/auth-harness";

// Wrap (not replace) the two password functions so tests can assert WHEN the expensive work happens.
// Behavioural assertions replace wall-clock thresholds, which depend on how fast the machine is.
vi.mock("@/server/modules/auth/password", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/modules/auth/password")>();
  return { ...real, hashPassword: vi.fn(real.hashPassword), burnPasswordVerification: vi.fn(real.burnPasswordVerification) };
});

const DAY = 86_400_000;
const reg = (email: string) => registerSchema.parse({ email });
const ATTACKER_PW = "an attacker chosen passphrase";
const complete = (token: string, password = PW, fullName = "Ada Lovelace") => completeRegistrationSchema.parse({ token, fullName, password });
/** Stored hash of a user, asserting there is one (pending signups have none). */
const hashOf = async (userId: string) => {
  const h = (await getDb().user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;
  if (!h) throw new Error("expected a stored password hash");
  return h;
};

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await getDb().$disconnect();
});

describe("registration (step 1: email only)", () => {
  it("creates a pending participant with NO password, and emails a confirmation link", async () => {
    const h = makeHarness();
    const email = uniqueEmail();
    await registerUser(reg(email), ctx, h.deps);
    await h.flush();

    const user = await getDb().user.findUniqueOrThrow({ where: { email }, include: { roles: true, authTokens: true } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toBeNull(); // nothing an attacker could have chosen
    expect(user.roles.map((r) => r.role)).toEqual(["PARTICIPANT"]);

    const mail = h.lastMailTo(email)!;
    expect(mail.subject).toMatch(/Confirm your email/);
    const raw = tokenFrom(mail);
    // only the hash is stored; the raw token from the email exists nowhere in the database
    expect(user.authTokens).toHaveLength(1);
    expect(user.authTokens[0].tokenHash).toBe(hashToken(raw));
    expect(user.authTokens[0].tokenHash).not.toBe(raw);
  });

  it("the registration schema accepts only an email: a supplied password or name is stripped, never stored", async () => {
    const parsed = registerSchema.parse({ email: "Someone@Example.test", password: ATTACKER_PW, fullName: "Evil" });
    expect(parsed).toEqual({ email: "someone@example.test" });
    expect(registerSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("answers identically for an existing verified address and tells only the real owner", async () => {
    const h = makeHarness();
    const owner = await createUser();
    const before = await getDb().user.count();
    await expect(registerUser(reg(owner.email), ctx, h.deps)).resolves.toBeUndefined();
    await h.flush();

    expect(await getDb().user.count()).toBe(before); // no new account
    expect(await verifyPassword(await hashOf(owner.id), PW)).toBe(true); // password untouched
    expect(h.mailsTo(owner.email).map((m) => m.subject)).toEqual(["You already have a ShadowTrix account"]);
    expect(await getDb().authToken.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("registering a pending address again sends a fresh link and voids the old one", async () => {
    const h = makeHarness();
    const email = uniqueEmail();
    await registerUser(reg(email), ctx, h.deps);
    const oldToken = tokenFrom(h.lastMailTo(email));
    await registerUser(reg(email), ctx, h.deps);
    await h.flush();
    const newToken = tokenFrom(h.lastMailTo(email));
    expect(newToken).not.toBe(oldToken);

    await expect(completeRegistration(complete(oldToken), ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(completeRegistration(complete(newToken), ctx, h.deps)).resolves.toBeUndefined();
  });

  it("survives two simultaneous registrations of the same new address", async () => {
    const h = makeHarness();
    const email = uniqueEmail();
    const results = await Promise.allSettled([registerUser(reg(email), ctx, h.deps), registerUser(reg(email), ctx, h.deps)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await getDb().user.count({ where: { email } })).toBe(1);
    expect(await getDb().authToken.count({ where: { user: { email }, type: "EMAIL_VERIFY", usedAt: null } })).toBeLessThanOrEqual(1);
  });

  it("rate limits repeated registrations for one address", async () => {
    const h = makeHarness();
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) await registerUser(reg(email), ctx, h.deps);
    await expect(registerUser(reg(email), ctx, h.deps)).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("pre-registration account takeover is closed", () => {
  it("an attacker who registers a victim's address gets no credentials: login fails and the victim's own link sets the victim's password", async () => {
    const h = makeHarness();
    const victim = uniqueEmail("victim");
    // The attacker (who does not control the mailbox) registers the victim's address. No password can be supplied.
    await registerUser(reg(victim), ctx, h.deps);
    await h.flush();

    // The attacker cannot log in: not with the password they would like, nor any other.
    await expect(login({ email: victim, password: ATTACKER_PW }, ctx, h.deps)).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });

    // The victim (who does control the mailbox) opens their link and chooses their own password.
    await completeRegistration(complete(tokenFrom(h.lastMailTo(victim)), "the victims own long passphrase", "Real Victim"), ctx, h.deps);
    const user = await getDb().user.findUniqueOrThrow({ where: { email: victim } });
    expect(user.fullName).toBe("Real Victim");
    expect(await verifyPassword(user.passwordHash!, "the victims own long passphrase")).toBe(true);
    expect(await verifyPassword(user.passwordHash!, ATTACKER_PW)).toBe(false);

    // The attacker still cannot get in; the victim can.
    await expect(login({ email: victim, password: ATTACKER_PW }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(login({ email: victim, password: "the victims own long passphrase" }, ctx, h.deps)).resolves.toMatchObject({ user: { email: victim } });
  });

  it("a pending account is indistinguishable from an unknown one at login (same error, burns a verification)", async () => {
    const h = makeHarness();
    const email = uniqueEmail();
    await registerUser(reg(email), ctx, h.deps);
    vi.mocked(burnPasswordVerification).mockClear();
    const pendingErr = await login({ email, password: PW }, ctx, h.deps).catch((e) => e);
    const unknownErr = await login({ email: uniqueEmail("nobody"), password: PW }, ctx, h.deps).catch((e) => e);
    expect({ status: pendingErr.status, code: pendingErr.code, message: pendingErr.message }).toEqual({
      status: unknownErr.status,
      code: unknownErr.code,
      message: unknownErr.message,
    });
    expect(vi.mocked(burnPasswordVerification)).toHaveBeenCalledTimes(2);
  });

  it("the password-reset flow does not issue a link for a pending signup (no bypass of the confirmation step)", async () => {
    const h = makeHarness();
    const email = uniqueEmail();
    await registerUser(reg(email), ctx, h.deps);
    await h.flush();
    const before = h.mailsTo(email).length;
    await requestPasswordReset(email, ctx, h.deps);
    await h.flush();
    expect(h.mailsTo(email).length).toBe(before);
    expect(await getDb().authToken.count({ where: { user: { email }, type: "PASSWORD_RESET" } })).toBe(0);
  });

  it("the database refuses a verified account without a password", async () => {
    const u = await createUser({ verified: false });
    await getDb().user.update({ where: { id: u.id }, data: { passwordHash: null } });
    await expect(getDb().user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } })).rejects.toThrow(/users_verified_requires_password_chk/);
    // and the inverse: dropping the password of a verified account is refused too
    const v = await createUser();
    await expect(getDb().user.update({ where: { id: v.id }, data: { passwordHash: null } })).rejects.toThrow(/users_verified_requires_password_chk/);
  });
});

describe("completing registration (step 2: token + name + password)", () => {
  async function pendingUser(h: ReturnType<typeof makeHarness>) {
    const email = uniqueEmail();
    await registerUser(reg(email), ctx, h.deps);
    await h.flush();
    return { email, token: tokenFrom(h.lastMailTo(email)) };
  }

  it("verifies the email, stores an Argon2id hash and the chosen name, and logs the event", async () => {
    const h = makeHarness();
    const { email, token } = await pendingUser(h);
    await completeRegistration(complete(token), ctx, h.deps);
    const user = await getDb().user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.fullName).toBe("Ada Lovelace");
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PW);
    expect(await getDb().auditLog.count({ where: { actorId: user.id, action: "auth.registration_completed" } })).toBe(1);
    await expect(login({ email, password: PW }, ctx, h.deps)).resolves.toMatchObject({ user: { email } });
  });

  it("is single-use: reuse, garbage and unknown tokens are rejected with one generic error", async () => {
    const h = makeHarness();
    const { token } = await pendingUser(h);
    await completeRegistration(complete(token), ctx, h.deps);
    for (const bad of [token, "x".repeat(43), "0".repeat(20), token.slice(0, -1) + (token.endsWith("a") ? "b" : "a")]) {
      await expect(completeRegistration(complete(bad), ctx, h.deps), bad).rejects.toMatchObject({ status: 400, code: "invalid_token" });
    }
  });

  it("a replay cannot overwrite the password that was chosen first", async () => {
    const h = makeHarness();
    const { email, token } = await pendingUser(h);
    await completeRegistration(complete(token, PW), ctx, h.deps);
    await expect(completeRegistration(complete(token, ATTACKER_PW, "Evil"), ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });
    const user = await getDb().user.findUniqueOrThrow({ where: { email } });
    expect(user.fullName).toBe("Ada Lovelace");
    expect(await verifyPassword(user.passwordHash!, PW)).toBe(true);
  });

  it("expires after 24 hours", async () => {
    const h = makeHarness();
    const { email, token } = await pendingUser(h);
    h.advance(24 * 3_600_000 + 1000);
    await expect(completeRegistration(complete(token), ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });
    expect((await getDb().user.findUniqueOrThrow({ where: { email } })).passwordHash).toBeNull();
  });

  it("is single-use even when submitted concurrently: exactly one caller wins and the winner's password is the one stored", async () => {
    const h = makeHarness();
    const { email, token } = await pendingUser(h);
    const passwords = Array.from({ length: 8 }, (_, i) => `concurrent passphrase number ${i}`);
    const results = await Promise.allSettled(passwords.map((p) => completeRegistration(complete(token, p, "Ada Lovelace"), ctx, h.deps)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
    const winner = passwords[results.findIndex((r) => r.status === "fulfilled")];
    const stored = (await getDb().user.findUniqueOrThrow({ where: { email } })).passwordHash!;
    expect(await verifyPassword(stored, winner)).toBe(true);
  });

  it("rejects a weak password WITHOUT consuming the link, so the person can try again", async () => {
    const h = makeHarness();
    const { email, token } = await pendingUser(h);
    const localPart = email.split("@")[0];
    // email-aware rule is enforced by the service (the schema alone cannot know the address)
    await expect(completeRegistration({ token, fullName: "Ada Lovelace", password: `${localPart}-extra-words` }, ctx, h.deps)).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["password"], message: expect.stringMatching(/email/) })],
    });
    expect(await getDb().authToken.count({ where: { user: { email }, type: "EMAIL_VERIFY", usedAt: null } })).toBe(1);
    await expect(completeRegistration(complete(token), ctx, h.deps)).resolves.toBeUndefined();
  });

  it("enforces the 12-character minimum at the schema: 11 rejected, 12 accepted", () => {
    const token = "t".repeat(43);
    expect(completeRegistrationSchema.safeParse({ token, fullName: "Ada Lovelace", password: "pq7-lmn-x2z" }).success).toBe(false);
    expect(completeRegistrationSchema.safeParse({ token, fullName: "Ada Lovelace", password: "pq7-lmn-x2zk" }).success).toBe(true);
    expect(completeRegistrationSchema.safeParse({ token, fullName: "<script>", password: PW }).success).toBe(false);
    expect(completeRegistrationSchema.safeParse({ token, fullName: "A", password: PW }).success).toBe(false);
  });

  it("is not interchangeable with a password-reset token, and vice versa", async () => {
    const h = makeHarness();
    const u = await createUser({ verified: false });
    await requestPasswordReset(u.email, ctx, h.deps);
    await h.flush();
    const resetToken = tokenFrom(h.lastMailTo(u.email));
    await expect(completeRegistration(complete(resetToken), ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });
    await expect(resetPassword({ token: await tokenOfType(u.id, "EMAIL_VERIFY"), password: NEW_PW }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("a suspended pending account cannot be completed", async () => {
    const h = makeHarness();
    const { email, token } = await pendingUser(h);
    await getDb().user.update({ where: { email }, data: { status: "SUSPENDED" } });
    await expect(completeRegistration(complete(token), ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });
  });

  async function tokenOfType(userId: string, type: "EMAIL_VERIFY" | "PASSWORD_RESET") {
    // We only know hashes; mint a token the same way production does to prove the type check, not the hash lookup.
    const { generateToken } = await import("@/server/security/tokens");
    const raw = generateToken();
    await getDb().authToken.create({ data: { userId, type, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 3_600_000) } });
    return raw;
  }

  it("resend: new link for unverified accounts only, old link stops working, identical outcome otherwise", async () => {
    const h = makeHarness();
    const { email, token: first } = await pendingUser(h);
    await resendVerification(email, ctx, h.deps);
    await h.flush();
    const second = tokenFrom(h.lastMailTo(email));
    expect(second).not.toBe(first);
    await expect(completeRegistration(complete(first), ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });

    const verified = await createUser();
    const unknown = uniqueEmail("nobody");
    const before = h.mails.length;
    await expect(resendVerification(verified.email, ctx, h.deps)).resolves.toBeUndefined();
    await expect(resendVerification(unknown, ctx, h.deps)).resolves.toBeUndefined();
    await h.flush();
    expect(h.mails.length).toBe(before); // nothing sent, nothing revealed
  });

  it("a user never has more than one live token per type (database guarantee)", async () => {
    const u = await createUser({ verified: false });
    const make = () =>
      getDb().authToken.create({ data: { userId: u.id, type: "EMAIL_VERIFY", tokenHash: hashToken(Math.random().toString()), expiresAt: new Date(Date.now() + 3_600_000) } });
    await make();
    await expect(make()).rejects.toThrow(/auth_tokens_one_live_per_type_idx|Unique constraint/);
  });
});

describe("login", () => {
  it("succeeds for verified users, creates a hashed server-side session, and records the login", async () => {
    const h = makeHarness();
    const u = await createUser();
    const r = await login({ email: u.email, password: PW }, ctx, h.deps);
    expect(r.user).toMatchObject({ id: u.id, email: u.email });
    expect(JSON.stringify(r.user)).not.toMatch(/hash|password/i);

    const rows = await getDb().session.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(r.sessionToken));
    expect(rows[0].tokenHash).not.toBe(r.sessionToken);
    expect(rows[0].userAgent).toBe("vitest");
    expect((await getDb().user.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt).not.toBeNull();
    expect(await getDb().auditLog.count({ where: { actorId: u.id, action: "auth.login" } })).toBe(1);
  });

  it("uses one identical error for unknown email and wrong password", async () => {
    const h = makeHarness();
    const u = await createUser();
    const wrong = await login({ email: u.email, password: "wrong password here" }, ctx, h.deps).catch((e) => e);
    const unknown = await login({ email: uniqueEmail("ghost"), password: "wrong password here" }, ctx, h.deps).catch((e) => e);
    for (const e of [wrong, unknown]) expect(e).toMatchObject({ status: 401, code: "invalid_credentials", message: "Incorrect email or password." });
    expect(wrong.message).toBe(unknown.message);
  });

  it("unknown emails cost the same as wrong passwords (no timing oracle)", async () => {
    const h = makeHarness();
    const u = await createUser();
    await login({ email: u.email, password: "x".repeat(12) }, ctx, h.deps).catch(() => {}); // warm up
    const time = async (email: string) => {
      const s = performance.now();
      await login({ email, password: "wrong password here" }, ctx, h.deps).catch(() => {});
      return performance.now() - s;
    };
    vi.mocked(burnPasswordVerification).mockClear();
    const known = await time(u.email);
    expect(vi.mocked(burnPasswordVerification)).not.toHaveBeenCalled(); // a real verification already ran
    const ghost = await time(uniqueEmail("ghost"));
    expect(vi.mocked(burnPasswordVerification)).toHaveBeenCalledTimes(1); // an unknown address pays for one too
    // and the two paths take comparable time (relative check, so it holds on fast and slow machines alike)
    expect(Math.abs(known - ghost)).toBeLessThan(Math.max(known, ghost) * 0.7);
  });

  it("reveals 'email not verified' or 'suspended' only after the password is proven correct", async () => {
    const h = makeHarness();
    const unverified = await createUser({ verified: false });
    const suspended = await createUser({ status: "SUSPENDED" });
    await expect(login({ email: unverified.email, password: PW }, ctx, h.deps)).rejects.toMatchObject({ status: 403, code: "email_not_verified" });
    await expect(login({ email: suspended.email, password: PW }, ctx, h.deps)).rejects.toMatchObject({ status: 403, code: "account_suspended" });
    await expect(login({ email: unverified.email, password: "wrong password here" }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(login({ email: suspended.email, password: "wrong password here" }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(await getDb().session.count({ where: { userId: { in: [unverified.id, suspended.id] } } })).toBe(0);
  });

  it("blocks brute force: the 9th attempt in 15 minutes is rejected even with the correct password", async () => {
    const h = makeHarness();
    const u = await createUser();
    for (let i = 0; i < 8; i++) await login({ email: u.email, password: "wrong password here" }, ctx, h.deps).catch(() => {});
    const blocked = await login({ email: u.email, password: PW }, ctx, h.deps).catch((e) => e);
    expect(blocked).toBeInstanceOf(RateLimitedError);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["Retry-After"]).toMatch(/^\d+$/);
    expect(await getDb().session.count({ where: { userId: u.id } })).toBe(0);

    // another account is unaffected, and the window resets after 15 minutes
    const other = await createUser();
    await expect(login({ email: other.email, password: PW }, ctx, h.deps)).resolves.toBeDefined();
    h.advance(15 * 60_000 + 1000);
    await expect(login({ email: u.email, password: PW }, ctx, h.deps)).resolves.toBeDefined();
  });

  it("applies the per-IP limit across different accounts when the IP is known", async () => {
    const h = makeHarness();
    const ip = { ip: "203.0.113.50", userAgent: "vitest" };
    for (let i = 0; i < 40; i++) await login({ email: uniqueEmail("spray"), password: "wrong password here" }, ip, h.deps).catch(() => {});
    await expect(login({ email: uniqueEmail("spray"), password: "wrong password here" }, ip, h.deps)).rejects.toBeInstanceOf(RateLimitedError);
  }, 60_000); // 41 real Argon2 attempts at ~120 ms each

  it("transparently upgrades a hash made with weaker parameters", async () => {
    const h = makeHarness();
    const { hash } = await import("@node-rs/argon2");
    const weak = await hash(PW, { algorithm: 2, memoryCost: 8192, timeCost: 1, parallelism: 1 });
    const u = await createUser({ passwordHash: weak });
    await login({ email: u.email, password: PW }, ctx, h.deps);
    const after = (await getDb().user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash!;
    expect(after).toMatch(/m=65536,t=3,p=1/);
    expect(await verifyPassword(after, PW)).toBe(true);
  });

  it("mints a different session token on every login (no session fixation)", async () => {
    const h = makeHarness();
    const u = await createUser();
    const a = await login({ email: u.email, password: PW }, ctx, h.deps);
    const b = await login({ email: u.email, password: PW }, ctx, h.deps);
    expect(a.sessionToken).not.toBe(b.sessionToken);
    expect(await getDb().session.count({ where: { userId: u.id } })).toBe(2);
  });
});

describe("sessions", () => {
  it("validate until revoked, expired (absolute 30 days) or idle (7 days)", async () => {
    const u = await createUser();
    const t0 = new Date();
    const { token } = await createSession(u.id, {}, t0);
    expect((await getSessionUser(token, t0))?.user).toMatchObject({ id: u.id, email: u.email });
    expect(await getSessionUser(token, new Date(t0.getTime() + 6 * DAY))).not.toBeNull(); // within the idle window (and refreshes it)

    // Idle timeout: a session nobody used for 7 days is dead (separate session, so no earlier read refreshes it).
    const idle = await createSession(u.id, {}, t0);
    expect(await getSessionUser(idle.token, new Date(t0.getTime() + 7 * DAY - 1000))).not.toBeNull();
    const idle2 = await createSession(u.id, {}, t0);
    expect(await getSessionUser(idle2.token, new Date(t0.getTime() + 7 * DAY + 1000))).toBeNull();

    const active = await createSession(u.id, {}, t0);
    // keep it warm: touch every 5+ days, still dies at the absolute limit
    for (let d = 5; d <= 25; d += 5) expect(await getSessionUser(active.token, new Date(t0.getTime() + d * DAY))).not.toBeNull();
    expect(await getSessionUser(active.token, new Date(t0.getTime() + 31 * DAY))).toBeNull(); // absolute lifetime
  });

  it("reject tampered, truncated, oversized and empty tokens", async () => {
    const u = await createUser();
    const { token } = await createSession(u.id);
    for (const bad of [token + "x", token.slice(1), token.toUpperCase(), "", undefined, null, "a".repeat(500)]) {
      expect(await getSessionUser(bad as string | undefined)).toBeNull();
    }
  });

  it("logout revokes server-side so a copied cookie is useless", async () => {
    const h = makeHarness();
    const u = await createUser();
    const { sessionToken } = await login({ email: u.email, password: PW }, ctx, h.deps);
    expect(await getSessionUser(sessionToken)).not.toBeNull();
    await logout(sessionToken, u.id);
    expect(await getSessionUser(sessionToken)).toBeNull();
    expect((await getDb().session.findFirstOrThrow({ where: { userId: u.id } })).revokedReason).toBe("logout");
    await expect(logout(sessionToken)).resolves.toBeUndefined(); // idempotent
  });

  it("stop working immediately when the account is suspended or loses verification", async () => {
    const u = await createUser();
    const { token } = await createSession(u.id);
    await getDb().user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    expect(await getSessionUser(token)).toBeNull();
    await getDb().user.update({ where: { id: u.id }, data: { status: "ACTIVE", emailVerifiedAt: null } });
    expect(await getSessionUser(token)).toBeNull();
  });

  it("revokeAll signs out every device; purge removes long-dead rows only", async () => {
    const u = await createUser();
    const a = await createSession(u.id);
    const b = await createSession(u.id);
    expect(await revokeAllUserSessions(u.id, "test")).toBe(2);
    expect(await getSessionUser(a.token)).toBeNull();
    expect(await getSessionUser(b.token)).toBeNull();
    expect(await purgeDeadSessions(new Date(), 30)).toBe(0); // revoked just now: kept for the audit window
    expect(await purgeDeadSessions(new Date(Date.now() + 31 * DAY), 30)).toBeGreaterThanOrEqual(2);
  });

  it("reads roles from the database on each lookup (a client-sent role is never trusted)", async () => {
    const u = await createUser({ roles: ["PARTICIPANT"] });
    const { token } = await createSession(u.id);
    expect((await getSessionUser(token))!.user.roles.map((r) => r.role)).toEqual(["PARTICIPANT"]);
    await getDb().userRoleAssignment.create({ data: { userId: u.id, role: "JUDGE" } });
    expect((await getSessionUser(token))!.user.roles.map((r) => r.role).sort()).toEqual(["JUDGE", "PARTICIPANT"]);
  });
});

describe("password reset", () => {
  async function requested(h: ReturnType<typeof makeHarness>, opts: Parameters<typeof createUser>[0] = {}) {
    const u = await createUser(opts);
    await requestPasswordReset(u.email, ctx, h.deps);
    await h.flush();
    return { u, token: tokenFrom(h.lastMailTo(u.email)) };
  }

  it("answers identically for unknown addresses and sends nothing", async () => {
    const h = makeHarness();
    await expect(requestPasswordReset(uniqueEmail("ghost"), ctx, h.deps)).resolves.toBeUndefined();
    await h.flush();
    expect(h.mails).toHaveLength(0);
  });

  it("does not send to suspended accounts", async () => {
    const h = makeHarness();
    const u = await createUser({ status: "SUSPENDED" });
    await requestPasswordReset(u.email, ctx, h.deps);
    await h.flush();
    expect(h.mailsTo(u.email)).toHaveLength(0);
  });

  it("changes the password, signs out every device, voids other links and notifies the owner", async () => {
    const h = makeHarness();
    const { u, token } = await requested(h);
    const s1 = await login({ email: u.email, password: PW }, ctx, h.deps);
    const s2 = await login({ email: u.email, password: PW }, ctx, h.deps);

    await resetPassword({ token, password: NEW_PW }, ctx, h.deps);
    await h.flush();

    expect(await getSessionUser(s1.sessionToken)).toBeNull();
    expect(await getSessionUser(s2.sessionToken)).toBeNull();
    const fresh = await getDb().user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await verifyPassword(fresh.passwordHash!, NEW_PW)).toBe(true);
    expect(await verifyPassword(fresh.passwordHash!, PW)).toBe(false);
    expect(await getDb().authToken.count({ where: { userId: u.id, usedAt: null } })).toBe(0);
    expect(h.mailsTo(u.email).at(-1)?.subject).toMatch(/password was changed/);
    expect(await getDb().auditLog.count({ where: { actorId: u.id, action: "auth.password_reset" } })).toBe(1);
    await expect(login({ email: u.email, password: PW }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(login({ email: u.email, password: NEW_PW }, ctx, h.deps)).resolves.toBeDefined();
  });

  it("is single-use, including under concurrent submission", async () => {
    const h = makeHarness();
    const { token } = await requested(h);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => resetPassword({ token, password: NEW_PW }, ctx, h.deps)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(resetPassword({ token, password: "yet another passphrase" }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("expires after 60 minutes and a newer request voids the older link", async () => {
    const h = makeHarness();
    const { u, token: first } = await requested(h);
    await requestPasswordReset(u.email, ctx, h.deps);
    await h.flush();
    const second = tokenFrom(h.lastMailTo(u.email));
    await expect(resetPassword({ token: first, password: NEW_PW }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });
    h.advance(61 * 60_000);
    await expect(resetPassword({ token: second, password: NEW_PW }, ctx, h.deps)).rejects.toMatchObject({ code: "invalid_token" });
    // the password never changed
    expect(await verifyPassword((await getDb().user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash!, PW)).toBe(true);
  });

  it("proves control of the mailbox: resetting also verifies an unverified account", async () => {
    const h = makeHarness();
    const { u, token } = await requested(h, { verified: false });
    await resetPassword({ token, password: NEW_PW }, ctx, h.deps);
    expect((await getDb().user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt).not.toBeNull();
  });

  it("rate limits reset requests per address", async () => {
    const h = makeHarness();
    const u = await createUser();
    for (let i = 0; i < 5; i++) await requestPasswordReset(u.email, ctx, h.deps);
    await expect(requestPasswordReset(u.email, ctx, h.deps)).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("rate limiter", () => {
  it("counts within a window, reports Retry-After, and resets after the window", async () => {
    const key = `test:${uniqueEmail("rl")}`;
    const policy = { limit: 3, windowSeconds: 60 };
    const t0 = new Date();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await consumeRateLimit(key, policy, new Date(t0.getTime() + i * 1000)));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results[3].retryAfterSeconds).toBeGreaterThan(50);
    expect(results[3].retryAfterSeconds).toBeLessThanOrEqual(60);
    const later = await consumeRateLimit(key, policy, new Date(t0.getTime() + 61_000));
    expect(later).toMatchObject({ allowed: true, count: 1 });
  });

  it("is atomic under concurrency (no lost updates)", async () => {
    const key = `test:${uniqueEmail("rl")}`;
    const policy = { limit: 10, windowSeconds: 60 };
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 25 }, () => consumeRateLimit(key, policy, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(Math.max(...results.map((r) => r.count))).toBe(25);
  });

  it("stores only HMAC keys, never raw emails or addresses", async () => {
    const h = makeHarness();
    const email = uniqueEmail("privacy");
    await login({ email, password: PW }, { ip: "198.51.100.7", userAgent: null }, h.deps).catch(() => {});
    const keys = (await getDb().rateLimit.findMany()).map((r) => r.key).join("\n");
    expect(keys).not.toContain(email);
    expect(keys).not.toContain("198.51.100.7");
    expect(keys).toMatch(/^login:email:[0-9a-f]{64}$/m);
  });
});

describe("password hashing is in use (sanity)", () => {
  it("stored hashes verify and a fresh hash differs from the stored one", async () => {
    const u = await createUser();
    expect(await verifyPassword(u.passwordHash!, PW)).toBe(true);
    expect(await hashPassword(PW)).not.toBe(u.passwordHash!);
  });
});
