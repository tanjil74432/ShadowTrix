import type { Page } from "@playwright/test";
import { COOKIE, JSON_HEADERS, PASSWORD, createRawSession, db, expect, post, test, uiLogin } from "./helpers/fixtures";
import { stepAt, totpAtStep } from "../src/server/security/totp";

const DAY = 86_400_000;
const withSession = async (userId: string) => ({ ...JSON_HEADERS, Cookie: `${COOKIE}=${await createRawSession(userId)}` });
const alertOf = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

test.describe("Content-Security-Policy", () => {
  test("is sent on pages and API responses with the restrictive directives", async ({ request }) => {
    for (const path of ["/", "/events", "/login", "/api/v1/events"]) {
      const res = await request.get(path);
      const csp = res.headers()["content-security-policy"] ?? "";
      expect(csp, path).toContain("default-src 'self'");
      expect(csp, path).toContain("object-src 'none'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).toContain("base-uri 'self'");
      expect(csp, path).toContain("form-action 'self'");
      expect(csp, path).toContain("connect-src 'self'");
      expect(csp, path).not.toMatch(/script-src[^;]*\*/); // no wildcard script sources
      expect(csp, path).not.toMatch(/https?:\/\//); // nothing external is allowed
    }
  });

  test("real pages and flows run without a single CSP violation", async ({ page, users }) => {
    const violations: string[] = [];
    page.on("console", (m) => /content security policy/i.test(m.text()) && violations.push(m.text()));
    page.on("pageerror", (e) => /content security policy/i.test(e.message) && violations.push(e.message));
    const org = await users.create({ roles: ["ORGANIZER"] });
    await uiLogin(page, org, "/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    for (const path of ["/", "/events", "/about", "/dashboard", "/dashboard/settings", "/organizer", "/organizer/events/new", "/design-system", "/login"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    }
    // client-side interactions that load code and use fetch
    await page.goto("/organizer/events/new");
    await page.getByRole("button", { name: "Create draft event" }).click();
    await expect(alertOf(page).first()).toBeVisible();
    expect(violations).toEqual([]);
  });

  test("blocks an injected external script and framing by other sites", async ({ page }) => {
    await page.goto("/login");
    const blocked = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const s = document.createElement("script");
          s.src = "https://example.com/evil.js";
          s.onerror = () => resolve(true);
          s.onload = () => resolve(false);
          document.head.appendChild(s);
          setTimeout(() => resolve(true), 4000);
        }),
    );
    expect(blocked).toBe(true);
    const res = await page.request.get("/login");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  });
});

test.describe("optional administrator MFA", () => {
  test("an administrator turns it on in settings, then needs the code at login; recovery code works once; turning off restores password-only", async ({ page, request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Mia Admin" });
    await uiLogin(page, admin, "/dashboard/settings");
    await expect(page.getByRole("heading", { name: "Two-step verification (optional)" })).toBeVisible();
    await page.getByRole("button", { name: "Set up two-step verification" }).click();
    const secret = (await page.locator("code").first().innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    // a wrong code is refused with a message and nothing is enabled
    await page.getByLabel(/^6-digit code/).fill("000000");
    await page.getByRole("button", { name: "Turn on two-step verification" }).click();
    await expect(page.getByText(/That code is not correct/)).toBeVisible();
    expect(await db().userMfa.findUnique({ where: { userId: admin.id } }).then((m) => m?.enabledAt ?? null)).toBeNull();
    // the right one (next time step: the window allows one step of drift) turns it on and shows the recovery codes once
    await page.getByLabel(/^6-digit code/).fill(totpAtStep(secret, stepAt(Date.now()) + 1));
    await page.getByRole("button", { name: "Turn on two-step verification" }).click();
    await expect(page.getByText("Save these recovery codes now.")).toBeVisible();
    const codes = await page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").allInnerTexts();
    expect(codes).toHaveLength(10);
    await page.getByRole("button", { name: "I have saved them" }).click();
    await expect(page.getByText("Two-step verification is on. 10 recovery codes are left.")).toBeVisible();
    const stored = await db().userMfa.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(stored.secretEnc).not.toContain(secret);

    // log out; the login now asks for the second step after the password
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel(/^Email address/).fill(admin.email);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByLabel(/^Authenticator or recovery code/)).toBeVisible();
    await expect(page.getByText(/Enter the 6-digit code/)).toBeVisible();
    await page.getByLabel(/^Authenticator or recovery code/).fill("123456");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("That code is not correct.")).toBeVisible();
    await page.getByLabel(/^Authenticator or recovery code/).fill(codes[0]);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // the used recovery code is dead; the API shows the same behavior
    const api = await post(request, "/api/v1/auth/login", { email: admin.email, password: PASSWORD, code: codes[0] });
    expect(api.status()).toBe(401);
    expect((await api.json()).error.code).toBe("invalid_mfa_code");
    expect((await post(request, "/api/v1/auth/login", { email: admin.email, password: PASSWORD })).status()).toBe(401);
    expect((await post(request, "/api/v1/auth/login", { email: admin.email, password: "wrong wrong wrong" })).status()).toBe(401);

    // turn it off: needs the password and a code
    await page.goto("/dashboard/settings");
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByLabel(/^Authenticator or recovery code/).fill(codes[1]);
    await page.getByRole("button", { name: "Turn off two-step verification" }).click();
    await expect(page.getByRole("button", { name: "Set up two-step verification" })).toBeVisible();
    expect((await post(request, "/api/v1/auth/login", { email: admin.email, password: PASSWORD })).status()).toBe(200);
  });

  test("it is optional and for administrators only: a participant has no MFA section and the API refuses them", async ({ page, request, users }) => {
    const p = await users.create();
    const admin = await users.create({ roles: ["ADMIN"] });
    expect((await post(request, "/api/v1/auth/mfa/enroll", undefined, JSON_HEADERS)).status()).toBe(401); // anonymous (before any login on this client)
    expect((await post(request, "/api/v1/auth/login", { email: admin.email, password: PASSWORD })).status()).toBe(200); // no MFA: password only
    await uiLogin(page, p, "/dashboard/settings");
    await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Two-step verification/ })).toHaveCount(0);
    const asParticipant = await withSession(p.id);
    expect((await post(request, "/api/v1/auth/mfa/enroll", undefined, asParticipant)).status()).toBe(403);
    expect((await post(request, "/api/v1/auth/mfa/confirm", { code: "123456" }, asParticipant)).status()).toBe(409);
  });
});

test.describe("scheduled cleanup endpoint", () => {
  const secret = () => process.env.E2E_CRON_SECRET ?? "";

  test("requires the bearer secret; with it, removes stale pending signups and nothing else", async ({ request, users }) => {
    const keep = await users.create(); // verified user
    const stale = await db().user.create({
      data: { email: `e2e-stale-${Date.now()}@example.test`, fullName: "stale", passwordHash: null, createdAt: new Date(Date.now() - 30 * DAY), roles: { create: { role: "PARTICIPANT" } } },
    });
    users.track(stale.email);
    const url = "/api/v1/internal/cleanup";
    expect((await request.post(url)).status()).toBe(401);
    expect((await request.post(url, { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await request.post(url, { headers: { Authorization: `Bearer ${secret().slice(0, -1)}x` } })).status()).toBe(401);
    expect((await request.get(url)).status()).toBe(405);
    expect(await db().user.count({ where: { id: stale.id } })).toBe(1);

    const ok = await request.post(url, { headers: { Authorization: `Bearer ${secret()}` } });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ sessions: expect.any(Number), tokens: expect.any(Number), rateLimits: expect.any(Number), unverifiedAccounts: expect.any(Number) });
    expect(body.unverifiedAccounts).toBeGreaterThanOrEqual(1);
    expect(await db().user.count({ where: { id: stale.id } })).toBe(0);
    expect(await db().user.count({ where: { id: keep.id } })).toBe(1);
    await db().auditLog.deleteMany({ where: { action: "maintenance.cleanup", entityId: "cleanup" } });
  });
});
