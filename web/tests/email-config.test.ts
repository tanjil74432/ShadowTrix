import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { registerSchema } from "@/server/modules/auth/auth.schema";
import { defaultDeps, registerUser, requestPasswordReset, resendVerification, type AuthDeps } from "@/server/modules/auth/auth.service";
import { describeMailError, evaluateEmailConfig, type EmailConfigInput } from "@/server/modules/email/email-config";
import { checkHealth } from "@/server/modules/health/health.service";
import { cleanup, ctx, makeHarness, uniqueEmail } from "./helpers/auth-harness";

afterEach(async () => {
  await getDb().auditLog.deleteMany({ where: { action: "email.delivery_failed" } });
  await cleanup();
});

const prod: EmailConfigInput = { appUrl: "https://shadow-trix-woad.vercel.app", nodeEnv: "production", host: "smtp.gmail.com", user: "owner@gmail.com", password: "a-google-app-password", from: "ShadowTrix <owner@gmail.com>" };
const NOT_READY = { ready: false, problems: ["SMTP_USER is not set", "SMTP_PASSWORD is not set"] };

describe("email readiness (pure, secret-free)", () => {
  it("a complete provider configuration on a public deployment is ready", () => {
    expect(evaluateEmailConfig(prod)).toEqual({ ready: true, problems: [] });
    expect(evaluateEmailConfig({ ...prod, from: "owner@gmail.com" }).ready).toBe(true);
  });

  it("the three production variables missing (the real situation) are reported by NAME, never by value", () => {
    const s = evaluateEmailConfig({ ...prod, user: undefined, password: undefined, from: "ShadowTrix <no-reply@shadowtrix.local>" });
    expect(s.ready).toBe(false);
    expect(s.problems).toEqual(["SMTP_USER is not set", "SMTP_PASSWORD is not set", "EMAIL_FROM is not set to a real sender address"]);
  });

  it("each problem is detected on its own: missing user, missing password, default sender, invalid sender, local sink", () => {
    expect(evaluateEmailConfig({ ...prod, user: "" }).problems).toEqual(["SMTP_USER is not set"]);
    expect(evaluateEmailConfig({ ...prod, password: "" }).problems).toEqual(["SMTP_PASSWORD is not set"]);
    expect(evaluateEmailConfig({ ...prod, from: "ShadowTrix <no-reply@shadowtrix.local>" }).problems).toEqual(["EMAIL_FROM is not set to a real sender address"]);
    for (const bad of ["not an address", "<>", "owner@", "@gmail.com", ""]) expect(evaluateEmailConfig({ ...prod, from: bad }).ready, bad || "(empty)").toBe(false);
    for (const host of ["localhost", "127.0.0.1", "::1", "mailpit", "host.docker.internal"]) {
      expect(evaluateEmailConfig({ ...prod, host }).problems[0], host).toMatch(/local mail sink/);
    }
  });

  it("development, CI and end-to-end runs (local APP_URL, or not a production build) are always ready: they use a local sink on purpose", () => {
    const sink = { ...prod, host: "localhost", user: undefined, password: undefined, from: "ShadowTrix <no-reply@shadowtrix.local>" };
    expect(evaluateEmailConfig({ ...sink, appUrl: "http://localhost:3010" }).ready).toBe(true);
    expect(evaluateEmailConfig({ ...sink, appUrl: "http://localhost:3011", nodeEnv: "production" }).ready).toBe(true); // the e2e server
    expect(evaluateEmailConfig({ ...sink, nodeEnv: "development" }).ready).toBe(true);
    expect(evaluateEmailConfig({ ...sink, nodeEnv: "test" }).ready).toBe(true);
    expect(evaluateEmailConfig({ ...sink, appUrl: "https://127.0.0.1", nodeEnv: "production" }).ready).toBe(true); // a local https address is still not a public deployment
  });
});

describe("environment validation", () => {
  const base = { DATABASE_URL: "postgresql://u:p@localhost:5433/db" };
  it("half a login is an error in any environment; both or neither are fine", () => {
    expect(() => parseEnv({ ...base, SMTP_USER: "me@gmail.com" })).toThrow(/SMTP_PASSWORD: SMTP_USER and SMTP_PASSWORD must be set together/);
    expect(() => parseEnv({ ...base, SMTP_PASSWORD: "x" })).toThrow(/SMTP_USER: SMTP_USER and SMTP_PASSWORD must be set together/);
    expect(parseEnv({ ...base, SMTP_USER: "me@gmail.com", SMTP_PASSWORD: "x" }).SMTP_USER).toBe("me@gmail.com");
    expect(parseEnv(base).SMTP_USER).toBeUndefined();
    expect(parseEnv({ ...base, SMTP_USER: "", SMTP_PASSWORD: "" }).SMTP_PASSWORD).toBe("");
  });
  it("the validation error never echoes a value", () => {
    try { parseEnv({ ...base, SMTP_USER: "private-user-name@gmail.com" }); } catch (e) { expect(String((e as Error).message)).not.toContain("private-user-name"); return; }
    throw new Error("expected an error");
  });
});

describe("mail requests are refused up front when the deployment cannot deliver mail (no silent success)", () => {
  const unready = (): AuthDeps => ({ ...makeHarness().deps, emailStatus: () => NOT_READY });

  it("registration, resend and password reset answer 503 email_unavailable, create nothing, and reveal no variable names", async () => {
    const email = uniqueEmail("noemail");
    const before = await getDb().user.count();
    for (const call of [
      () => registerUser(registerSchema.parse({ email }), ctx, unready()),
      () => resendVerification(email, ctx, unready()),
      () => requestPasswordReset(email, ctx, unready()),
    ]) {
      const err = await call().then(() => null, (e) => e as { status: number; code: string; message: string });
      expect(err).toMatchObject({ status: 503, code: "email_unavailable" });
      expect(err!.message).not.toMatch(/SMTP|EMAIL_FROM|PASSWORD|variable/i);
    }
    expect(await getDb().user.count()).toBe(before); // no pending account, no token
    expect(await getDb().user.findUnique({ where: { email } })).toBeNull();
  });

  it("the refusal is the same for every caller (it does not depend on whether the address has an account)", async () => {
    const h = makeHarness();
    await registerUser(registerSchema.parse({ email: uniqueEmail("exists") }), ctx, h.deps);
    const a = await requestPasswordReset(uniqueEmail("a"), ctx, { ...h.deps, emailStatus: () => NOT_READY }).catch((e) => e);
    const b = await requestPasswordReset(uniqueEmail("b"), ctx, { ...h.deps, emailStatus: () => NOT_READY }).catch((e) => e);
    expect([a.status, a.code, a.message]).toEqual([b.status, b.code, b.message]);
  });

  it("when mail is ready the flows work exactly as before", async () => {
    const h = makeHarness();
    const email = uniqueEmail("ready");
    await registerUser(registerSchema.parse({ email }), ctx, { ...h.deps, emailStatus: () => ({ ready: true, problems: [] }) });
    await h.flush();
    expect(h.mailsTo(email)).toHaveLength(1);
  });
});

describe("a delivery failure is recorded safely", () => {
  it("only a short code is kept: no message, no recipient, no credentials, in the log or in the audit row", async () => {
    const secretish = "535-5.7.8 Username and Password not accepted for person@example.com using app-password-hunter2";
    const err = Object.assign(new Error(secretish), { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      defaultDeps().schedule(async () => { throw err; });
      await new Promise((r) => setTimeout(r, 400));
      const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("auth.email_failed");
      expect(logged).toContain("EAUTH");
      for (const leak of ["person@example.com", "hunter2", "Username and Password"]) expect(logged).not.toContain(leak);
    } finally {
      spy.mockRestore();
    }
    const rows = await getDb().auditLog.findMany({ where: { action: "email.delivery_failed" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toEqual({ code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" });
    expect(JSON.stringify(rows[0])).not.toMatch(/example\.com|hunter2|Username/);
    expect(rows[0].actorId).toBeNull();
  });

  it("describeMailError keeps only a code, a reply code and a short command, whatever the error contains", () => {
    expect(describeMailError(Object.assign(new Error("secret text"), { code: "ETIMEDOUT" }))).toEqual({ code: "ETIMEDOUT" });
    expect(describeMailError(new Error("boom <script>"))).toEqual({ code: "UNKNOWN" });
    expect(describeMailError(null)).toEqual({ code: "UNKNOWN" });
    expect(describeMailError({ code: "E/../AUTH\n", command: "RCPT TO:<a@b.c>", responseCode: 9999 })).toEqual({ code: "UNKNOWN" }); // anything that is not exactly a code or a verb is dropped whole
    expect(describeMailError({ code: "EAUTH", command: "RCPT TO", responseCode: 550 })).toEqual({ code: "EAUTH", responseCode: 550, command: "RCPT TO" });
    expect(describeMailError({ code: "a@b.c", command: "user@example.com" })).toEqual({ code: "UNKNOWN" });
  });
});

describe("health reports email readiness without naming anything", () => {
  it("includes an email field (ready in tests) and still reports the database", async () => {
    const r = await checkHealth();
    expect(r).toMatchObject({ status: "ok", database: "up", email: "ready" });
    expect(Object.keys(r).sort()).toEqual(["database", "email", "status", "time"]);
  });
});
