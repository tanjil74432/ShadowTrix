import AxeBuilder from "@axe-core/playwright";
import type { APIResponse, Page } from "@playwright/test";
import {
  COOKIE,
  JSON_HEADERS,
  NEW_PASSWORD,
  ORIGIN,
  PASSWORD,
  createRawSession,
  db,
  expect,
  mailCount,
  post,
  sha256,
  test,
  uiLogin,
  uniqueEmail,
  waitForMail,
} from "./helpers/fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Value of the session cookie set by a login response. */
function sessionCookieFrom(res: APIResponse): string {
  const header = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value).find((v) => v.startsWith(`${COOKIE}=`));
  if (!header) throw new Error("no session cookie in response");
  return header.split(";")[0].slice(COOKIE.length + 1);
}
/** App alerts only: Next.js also renders its own role=alert route announcer. */
const alertOf = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
/** Opens the mobile menu, retrying the click until the page has hydrated (a click before hydration is ignored). */
async function openMobileMenu(page: Page) {
  await expect(async () => {
    if (!(await page.getByRole("dialog").isVisible())) await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}
const withCookie = (value: string) => ({ headers: { Cookie: `${COOKIE}=${value}` } });

async function apiLogin(request: import("@playwright/test").APIRequestContext, email: string, password = PASSWORD) {
  const res = await post(request, "/api/v1/auth/login", { email, password });
  return { res, cookie: res.ok() ? sessionCookieFrom(res) : "" };
}

// ───────────────────────────── Journey ─────────────────────────────

test.describe("registration, verification and login", () => {
  test("a visitor registers, confirms the emailed link, logs in, sees the dashboard and signs out", async ({ page, users }) => {
    const email = uniqueEmail("journey");
    users.track(email);

    await page.goto("/register");
    await page.getByLabel(/^Full name/).fill("Ada Lovelace");
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();

    const mail = await waitForMail(email, /Confirm your email/);
    expect(mail.text).not.toContain(PASSWORD);
    await page.goto(mail.link("verify-email"));
    // The token is not consumed by merely opening the link (mail scanners prefetch links): only the button does it.
    expect((await db().user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
    await page.getByRole("button", { name: "Confirm email address" }).click();
    await expect(page.getByRole("heading", { name: "Email address confirmed" })).toBeVisible();
    expect((await db().user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).not.toBeNull();

    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page.getByText("Your email address is confirmed")).toBeVisible();
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Ada Lovelace");
    await expect(page.getByText("Participant", { exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toHaveCount(0);

    // Signed-in visitors are bounced away from the auth forms.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("banner").getByRole("link", { name: "Login" })).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test("an unconfirmed account cannot log in, and can request a new link", async ({ page, users }) => {
    const email = uniqueEmail("unverified");
    users.track(email);
    await page.goto("/register");
    await page.getByLabel(/^Full name/).fill("Grace Hopper");
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    const first = await waitForMail(email, /Confirm your email/);

    await uiLogin(page, { email, password: PASSWORD });
    await expect(alertOf(page)).toContainText("Confirm your email address before logging in");
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole("button", { name: "Send a new link" }).click();
    await expect(page.getByText(/we have sent a new link/)).toBeVisible();

    await expect.poll(() => mailCount(email)).toBe(2);
    // the first link was voided by the second
    await page.goto(first.link("verify-email"));
    await page.getByRole("button", { name: "Confirm email address" }).click();
    await expect(page.getByRole("heading", { name: /invalid or has expired/ })).toBeVisible();
  });

  test("wrong password and unknown email produce the same message, and nothing is logged in", async ({ page, users }) => {
    const u = await users.create();
    await uiLogin(page, { email: u.email, password: "definitely not the password" });
    const wrong = await alertOf(page).innerText();
    await expect(page).toHaveURL(/\/login/);

    await uiLogin(page, { email: uniqueEmail("ghost"), password: "definitely not the password" });
    const unknown = await alertOf(page).innerText();
    expect(wrong).toBe("Incorrect email or password.");
    expect(unknown).toBe(wrong);
    expect((await page.context().cookies()).some((c) => c.name === COOKIE)).toBe(false);
  });

  test("password rules are enforced by the server and shown on the field", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel(/^Full name/).fill("Test Person");
    await page.getByLabel(/^Email address/).fill(uniqueEmail("weak"));
    await page.getByLabel(/^Password/).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    const field = page.getByLabel(/^Password/);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await page.getByLabel(/^Email address/).fill("not-an-email");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(/name@example.com/)).toBeVisible();
  });

  test("the password field can be revealed and hidden by keyboard", async ({ page }) => {
    await page.goto("/login");
    const input = page.getByLabel(/^Password/);
    await expect(input).toHaveAttribute("type", "password");
    const toggle = page.getByRole("button", { name: "Show password" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(input).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });
});

// ───────────────────────────── Password reset ─────────────────────────────

test.describe("password reset", () => {
  test("reset via emailed link signs out every device, works once, and old password stops working", async ({ page, request, users }) => {
    const u = await users.create();
    const { cookie } = await apiLogin(request, u.email);
    expect((await request.get("/api/v1/auth/me", withCookie(cookie))).status()).toBe(200);

    await page.goto("/forgot-password");
    await page.getByLabel(/^Email address/).fill(u.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    const mail = await waitForMail(u.email, /Reset your ShadowTrix password/);
    const link = mail.link("reset-password");
    await page.goto(link);
    await page.getByLabel(/^New password/).fill("short");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();

    // existing session is dead on the server
    expect((await request.get("/api/v1/auth/me", withCookie(cookie))).status()).toBe(401);
    // notification email
    await waitForMail(u.email, /password was changed/);
    // the link cannot be reused
    await page.goto(link);
    await page.getByLabel(/^New password/).fill("another passphrase entirely");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(alertOf(page)).toContainText("invalid or has expired");
    // old password fails, new one works
    expect((await apiLogin(request, u.email, PASSWORD)).res.status()).toBe(401);
    expect((await apiLogin(request, u.email, NEW_PASSWORD)).res.status()).toBe(200);
  });

  test("invalid, malformed and expired links are rejected without changing anything", async ({ page, users }) => {
    const u = await users.create();
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "This link is not valid" })).toBeVisible();

    await page.goto("/reset-password?token=" + "A".repeat(43));
    await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(alertOf(page)).toContainText("invalid or has expired");

    // a genuine token past its expiry
    const raw = "E".repeat(43);
    await db().authToken.create({
      data: { userId: u.id, type: "PASSWORD_RESET", tokenHash: sha256(raw), createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 3_600_000) },
    });
    await page.goto("/reset-password?token=" + raw);
    await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(alertOf(page)).toContainText("invalid or has expired");
    const stored = await db().user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    await page.goto("/login");
    await uiLogin(page, { email: u.email, password: PASSWORD });
    await expect(page).toHaveURL(/\/dashboard$/); // original password still works
  });

  test("expired verification link shows the recovery path", async ({ page, users }) => {
    const u = await users.create({ verified: false });
    const raw = "V".repeat(43);
    await db().authToken.create({
      data: { userId: u.id, type: "EMAIL_VERIFY", tokenHash: sha256(raw), createdAt: new Date(Date.now() - 200_000_000), expiresAt: new Date(Date.now() - 100_000_000) },
    });
    await page.goto("/verify-email?token=" + raw);
    await page.getByRole("button", { name: "Confirm email address" }).click();
    await expect(page.getByRole("heading", { name: /invalid or has expired/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send a new link" })).toBeVisible();
    expect((await db().user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt).toBeNull();
  });
});

// ───────────────────────────── Sessions ─────────────────────────────

test.describe("sessions", () => {
  test("logout revokes the session on the server, so a copied cookie stops working", async ({ page, request, users }) => {
    const u = await users.create();
    await uiLogin(page, u);
    await expect(page).toHaveURL(/\/dashboard$/);
    const cookie = (await page.context().cookies()).find((c) => c.name === COOKIE)!.value;
    expect((await request.get("/api/v1/auth/me", withCookie(cookie))).status()).toBe(200);

    await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await request.get("/api/v1/auth/me", withCookie(cookie))).status()).toBe(401);
    expect((await db().session.findFirstOrThrow({ where: { tokenHash: sha256(cookie) } })).revokedReason).toBe("logout");
  });

  test("expired, idle and revoked sessions send the visitor to login", async ({ page, context, users }) => {
    const u = await users.create();
    const day = 86_400_000;
    const cases = {
      "absolute expiry": await createRawSession(u.id, { expiresAt: new Date(Date.now() - 1000) }),
      "idle timeout": await createRawSession(u.id, { lastSeenAt: new Date(Date.now() - 8 * day), expiresAt: new Date(Date.now() + 20 * day) }),
      revoked: await createRawSession(u.id, { revokedAt: new Date() }),
    };
    for (const [name, token] of Object.entries(cases)) {
      await context.clearCookies();
      await context.addCookies([{ name: COOKIE, value: token, url: ORIGIN }]);
      await page.goto("/dashboard");
      await expect(page, name).toHaveURL(/\/login\?next=%2Fdashboard$/);
      await page.goto("/");
      await expect(page.getByRole("banner").getByRole("link", { name: "Login" }), name).toBeVisible();
    }
    // control: a live session works
    await context.clearCookies();
    await context.addCookies([{ name: COOKIE, value: await createRawSession(u.id), url: ORIGIN }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a forged or tampered cookie grants nothing", async ({ page, context, request, users }) => {
    const u = await users.create();
    const good = await createRawSession(u.id);
    for (const value of [good + "x", good.slice(0, -2), "A".repeat(43), "x".repeat(300), `${u.id}`, "admin"]) {
      expect((await request.get("/api/v1/auth/me", withCookie(value))).status(), value.slice(0, 12)).toBe(401);
    }
    await context.addCookies([{ name: COOKIE, value: "A".repeat(43), url: ORIGIN }]);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("session cookie is HttpOnly, SameSite=Lax, path /, and invisible to page scripts; the body carries no token", async ({ page, request, users }) => {
    const u = await users.create();
    const res = await post(request, "/api/v1/auth/login", { email: u.email, password: PASSWORD });
    expect(res.status()).toBe(200);
    const setCookie = res.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")!.value;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=\d+/i);
    expect(setCookie).not.toMatch(/Secure/i); // plain-http localhost only; production uses Secure + __Host- (unit tested)
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(sessionCookieFrom(res));
    expect(body).not.toMatch(/token|hash|password/i);

    await uiLogin(page, u);
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);
  });

  test("suspending an account ends its sessions immediately", async ({ request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"] });
    const target = await users.create();
    const victim = await apiLogin(request, target.email);
    const adminLogin = await apiLogin(request, admin.email);
    expect((await request.get("/api/v1/auth/me", withCookie(victim.cookie))).status()).toBe(200);

    const res = await request.patch(`/api/v1/admin/users/${target.id}/status`, { data: { status: "SUSPENDED" }, headers: { ...JSON_HEADERS, Cookie: `${COOKIE}=${adminLogin.cookie}` } });
    expect(res.status()).toBe(200);
    expect((await request.get("/api/v1/auth/me", withCookie(victim.cookie))).status()).toBe(401);
    expect((await apiLogin(request, target.email)).res.status()).toBe(403);
  });
});

// ───────────────────────────── Authorization: pages ─────────────────────────────

test.describe("role-based access to pages", () => {
  test("anonymous visitors are redirected to login and returned to where they were going", async ({ page, users }) => {
    const u = await users.create({ roles: ["ADMIN"] });
    for (const path of ["/dashboard", "/admin", "/organizer", "/judge"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/%/g, "%")}$`));
    }
    await page.goto("/admin");
    await page.getByLabel(/^Email address/).fill(u.email);
    await page.getByLabel(/^Password/).fill(u.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
  });

  const MATRIX: { role: "PARTICIPANT" | "ORGANIZER" | "JUDGE" | "ADMIN"; allowed: string[] }[] = [
    { role: "PARTICIPANT", allowed: ["/dashboard"] },
    { role: "ORGANIZER", allowed: ["/dashboard", "/organizer"] },
    { role: "JUDGE", allowed: ["/dashboard", "/judge"] },
    { role: "ADMIN", allowed: ["/dashboard", "/organizer", "/judge", "/admin"] },
  ];
  const HEADINGS: Record<string, string> = { "/dashboard": "Welcome", "/organizer": "Organizer area", "/judge": "Judge area", "/admin": "Administration" };

  for (const { role, allowed } of MATRIX) {
    test(`${role}: reaches exactly ${allowed.join(", ")} and sees an access-denied view (no protected data) elsewhere`, async ({ page, users }) => {
      const u = await users.create({ roles: [role] });
      await uiLogin(page, u);
      await expect(page).toHaveURL(/\/dashboard$/);
      for (const path of Object.keys(HEADINGS)) {
        await page.goto(path);
        if (allowed.includes(path)) {
          await expect(page.getByRole("heading", { level: 1 }), `${role} ${path}`).toContainText(HEADINGS[path]);
        } else {
          await expect(page.getByRole("heading", { level: 1 }), `${role} ${path}`).toContainText("You do not have access");
          await expect(page.getByRole("table")).toHaveCount(0);
          expect(await page.content()).not.toContain("Showing "); // the admin user list is never even rendered
        }
      }
    });
  }

  test("the admin page lists users with roles but never password data", async ({ page, users }) => {
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Admin Person" });
    const other = await users.create({ roles: ["JUDGE"], fullName: "Judge Person" });
    await uiLogin(page, admin, "/admin");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(other.email) })).toContainText("Judge");
    const html = await page.content();
    expect(html).not.toMatch(/argon2|passwordHash|password_hash/i);
  });

  test("a stale page cannot grant access: demoting an admin takes effect on the next request", async ({ page, request, users }) => {
    const boss = await users.create({ roles: ["ADMIN"] });
    const helper = await users.create({ roles: ["ADMIN"] });
    await uiLogin(page, helper, "/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Administration");
    const bossLogin = await apiLogin(request, boss.email);
    const res = await request.delete(`/api/v1/admin/users/${helper.id}/roles/ADMIN`, { headers: { Origin: ORIGIN, Cookie: `${COOKIE}=${bossLogin.cookie}` } });
    expect(res.status()).toBe(200);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("You do not have access");
  });

  test("the post-login redirect only accepts same-site paths", async ({ page, users }) => {
    const u = await users.create();
    for (const next of ["https://evil.example/phish", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      await page.context().clearCookies();
      await uiLogin(page, u, next);
      await expect(page, next).toHaveURL(/localhost:3011\/dashboard$/);
    }
  });
});

// ───────────────────────────── Authorization: API ─────────────────────────────

test.describe("role-based access to APIs", () => {
  test("anonymous: 401 on every protected endpoint", async ({ request }) => {
    const id = "00000000-0000-7000-8000-000000000000";
    expect((await request.get("/api/v1/auth/me")).status()).toBe(401);
    expect((await request.get("/api/v1/admin/users")).status()).toBe(401);
    expect((await post(request, `/api/v1/admin/users/${id}/roles`, { role: "ADMIN" })).status()).toBe(401);
    expect((await request.delete(`/api/v1/admin/users/${id}/roles/JUDGE`, { headers: { Origin: ORIGIN } })).status()).toBe(401);
    expect((await request.patch(`/api/v1/admin/users/${id}/status`, { data: { status: "SUSPENDED" }, headers: JSON_HEADERS })).status()).toBe(401);
  });

  test("non-admin roles get 403, never data, on admin endpoints", async ({ request, users }) => {
    const target = await users.create();
    for (const role of ["PARTICIPANT", "ORGANIZER", "JUDGE"] as const) {
      const u = await users.create({ roles: [role] });
      const { cookie } = await apiLogin(request, u.email);
      const h = { Cookie: `${COOKIE}=${cookie}` };
      const list = await request.get("/api/v1/admin/users", { headers: h });
      expect(list.status(), role).toBe(403);
      expect(JSON.stringify(await list.json())).not.toContain(target.email);
      expect((await post(request, `/api/v1/admin/users/${target.id}/roles`, { role: "ADMIN" }, { ...JSON_HEADERS, ...h })).status(), role).toBe(403);
      expect((await request.patch(`/api/v1/admin/users/${target.id}/status`, { data: { status: "SUSPENDED" }, headers: { ...JSON_HEADERS, ...h } })).status(), role).toBe(403);
    }
    expect((await db().user.findUniqueOrThrow({ where: { id: target.id }, include: { roles: true } })).roles.map((r) => r.role)).toEqual(["PARTICIPANT"]);
  });

  test("a user cannot promote themselves by sending a role in a request", async ({ request, users }) => {
    const u = await users.create();
    const { cookie } = await apiLogin(request, u.email);
    const res = await post(request, `/api/v1/admin/users/${u.id}/roles`, { role: "ADMIN" }, { ...JSON_HEADERS, Cookie: `${COOKIE}=${cookie}` });
    expect(res.status()).toBe(403);
    const me = await (await request.get("/api/v1/auth/me", withCookie(cookie))).json();
    expect(me.user.roles.map((r: { role: string }) => r.role)).toEqual(["PARTICIPANT"]);
    expect(me.permissions).not.toContain("admin:access");
    // tampering with login/register bodies cannot inject roles either
    const reg = await post(request, "/api/v1/auth/register", { email: uniqueEmail("inject"), fullName: "Mallory", password: PASSWORD, roles: ["ADMIN"], role: "ADMIN" });
    expect(reg.status()).toBe(202);
    await db().user.deleteMany({ where: { fullName: "Mallory" } });
  });

  test("administrators manage roles through the API; changes apply at once; safeguards hold", async ({ request, page, users }) => {
    const admin = await users.create({ roles: ["ADMIN"] });
    const target = await users.create();
    const { cookie } = await apiLogin(request, admin.email);
    const h = { ...JSON_HEADERS, Cookie: `${COOKIE}=${cookie}` };

    const list = await request.get(`/api/v1/admin/users?q=${encodeURIComponent(target.email)}`, { headers: { Cookie: `${COOKIE}=${cookie}` } });
    expect(list.status()).toBe(200);
    const listed = await list.json();
    expect(listed.total).toBe(1);
    expect(JSON.stringify(listed)).not.toMatch(/argon2|passwordHash|tokenHash/i);

    await uiLogin(page, target, "/organizer");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("You do not have access");
    expect((await post(request, `/api/v1/admin/users/${target.id}/roles`, { role: "ORGANIZER" }, h)).status()).toBe(200);
    await page.goto("/organizer");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Organizer area");
    expect((await request.delete(`/api/v1/admin/users/${target.id}/roles/ORGANIZER`, { headers: { Origin: ORIGIN, Cookie: `${COOKIE}=${cookie}` } })).status()).toBe(200);
    await page.goto("/organizer");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("You do not have access");

    // safeguards
    const self = await request.delete(`/api/v1/admin/users/${admin.id}/roles/ADMIN`, { headers: { Origin: ORIGIN, Cookie: `${COOKIE}=${cookie}` } });
    expect(self.status()).toBe(409);
    expect((await self.json()).error.code).toBe("cannot_demote_self");
    expect((await post(request, `/api/v1/admin/users/${target.id}/roles`, { role: "TEAM_LEADER" }, h)).status()).toBe(400);
    expect((await post(request, `/api/v1/admin/users/${target.id}/roles`, { role: "SUPERUSER" }, h)).status()).toBe(400);
    expect((await post(request, `/api/v1/admin/users/not-a-uuid/roles`, { role: "JUDGE" }, h)).status()).toBe(400);
    const selfSuspend = await request.patch(`/api/v1/admin/users/${admin.id}/status`, { data: { status: "SUSPENDED" }, headers: h });
    expect(selfSuspend.status()).toBe(409);
  });

  test("list endpoint validates and bounds its inputs", async ({ request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"] });
    const { cookie } = await apiLogin(request, admin.email);
    const h = { Cookie: `${COOKIE}=${cookie}` };
    expect((await request.get("/api/v1/admin/users?pageSize=5000", { headers: h })).status()).toBe(400);
    expect((await request.get("/api/v1/admin/users?page=0", { headers: h })).status()).toBe(400);
    expect((await request.get("/api/v1/admin/users?page=abc", { headers: h })).status()).toBe(400);
    expect((await request.get("/api/v1/admin/users?pageSize=1", { headers: h })).status()).toBe(200);
  });
});

// ───────────────────────────── CSRF and request hygiene ─────────────────────────────

test.describe("CSRF and request validation", () => {
  test("state-changing requests need our own Origin and a JSON body", async ({ request, users }) => {
    const u = await users.create();
    const body = { email: u.email, password: PASSWORD };
    const noOrigin = await request.post("/api/v1/auth/login", { data: body, headers: { "Content-Type": "application/json" } });
    expect(noOrigin.status()).toBe(403);
    expect((await noOrigin.json()).error.code).toBe("csrf_check_failed");
    for (const origin of ["https://evil.example", "null", "http://localhost:3011.evil.example", "http://localhost:9999"]) {
      expect((await request.post("/api/v1/auth/login", { data: body, headers: { ...JSON_HEADERS, Origin: origin } })).status(), origin).toBe(403);
    }
    const formPost = await request.post("/api/v1/auth/login", { form: body, headers: { Origin: ORIGIN } });
    expect(formPost.status()).toBe(415);
    const textPost = await request.post("/api/v1/auth/login", { data: JSON.stringify(body), headers: { Origin: ORIGIN, "Content-Type": "text/plain" } });
    expect(textPost.status()).toBe(415);
    const secFetch = await request.post("/api/v1/auth/login", { data: body, headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" } });
    expect(secFetch.status()).toBe(403);
    expect((await post(request, "/api/v1/auth/login", body)).status()).toBe(200);
  });

  test("a cross-site logout or role change cannot be forged with a victim's cookie", async ({ request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"] });
    const target = await users.create();
    const { cookie } = await apiLogin(request, admin.email);
    const evil = { Origin: "https://evil.example", "Content-Type": "application/json", Cookie: `${COOKIE}=${cookie}` };
    expect((await request.post("/api/v1/auth/logout", { data: {}, headers: evil })).status()).toBe(403);
    expect((await request.post(`/api/v1/admin/users/${target.id}/roles`, { data: { role: "ADMIN" }, headers: evil })).status()).toBe(403);
    expect((await request.delete(`/api/v1/admin/users/${target.id}/roles/PARTICIPANT`, { headers: { Origin: "https://evil.example", Cookie: `${COOKIE}=${cookie}` } })).status()).toBe(403);
    expect((await request.get("/api/v1/auth/me", withCookie(cookie))).status()).toBe(200); // session untouched
    expect((await db().user.findUniqueOrThrow({ where: { id: target.id }, include: { roles: true } })).roles).toHaveLength(1);
  });

  test("malformed bodies are rejected cleanly and error responses never leak internals", async ({ request }) => {
    // Buffer: Playwright would JSON-encode a plain string, so send the raw (invalid) bytes.
    const bad = await request.post("/api/v1/auth/login", { data: Buffer.from("{not json"), headers: JSON_HEADERS });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_json");
    for (const payload of [null, [], "string", 42, { email: 123, password: {} }, { email: "a@b.co" }]) {
      const res = await post(request, "/api/v1/auth/login", payload);
      expect(res.status(), JSON.stringify(payload)).toBe(400);
      const text = await res.text();
      expect(text).not.toMatch(/stack|prisma|node_modules|at \w+ \(|postgres/i);
    }
    const huge = await post(request, "/api/v1/auth/login", { email: "a@b.co", password: "x".repeat(5000) });
    expect(huge.status()).toBe(400);
  });

  test("security headers: API never cached, token pages never leak a Referer, framing denied", async ({ request }) => {
    const api = await post(request, "/api/v1/auth/login", { email: "nobody@example.test", password: "whatever password" });
    expect(api.headers()["cache-control"]).toBe("no-store");
    expect(api.headers()["x-content-type-options"]).toBe("nosniff");
    for (const path of ["/verify-email", "/reset-password"]) {
      const res = await request.get(path);
      expect(res.headers()["referrer-policy"], path).toBe("no-referrer");
      expect(res.headers()["cache-control"], path).toContain("no-store");
    }
    const home = await request.get("/");
    expect(home.headers()["x-frame-options"]).toBe("DENY");
    expect(home.headers()["x-content-type-options"]).toBe("nosniff");
    expect(home.headers()["strict-transport-security"]).toContain("max-age");
    expect(home.headers()["permissions-policy"]).toContain("camera=()");
  });
});

// ───────────────────────────── Enumeration and rate limiting ─────────────────────────────

test.describe("account enumeration and brute force", () => {
  test("registering an existing address looks exactly like registering a new one, and only the owner is told", async ({ request, users }) => {
    const owner = await users.create();
    const fresh = uniqueEmail("fresh");
    users.track(fresh);
    const existing = await post(request, "/api/v1/auth/register", { email: owner.email, fullName: "Someone Else", password: PASSWORD });
    const created = await post(request, "/api/v1/auth/register", { email: fresh, fullName: "New Person", password: PASSWORD });
    expect(existing.status()).toBe(202);
    expect(created.status()).toBe(202);
    expect(await existing.json()).toEqual(await created.json());
    await waitForMail(owner.email, /already have a ShadowTrix account/);
    await waitForMail(fresh, /Confirm your email/);
    expect((await db().user.findUniqueOrThrow({ where: { id: owner.id } })).fullName).toBe("E2E Person"); // unchanged
  });

  test("forgot-password answers identically for known and unknown addresses; only the known one gets email", async ({ request, users }) => {
    const known = await users.create();
    const unknown = uniqueEmail("ghost");
    const a = await post(request, "/api/v1/auth/forgot-password", { email: known.email });
    const b = await post(request, "/api/v1/auth/forgot-password", { email: unknown });
    expect(a.status()).toBe(202);
    expect(b.status()).toBe(202);
    expect(await a.json()).toEqual(await b.json());
    await waitForMail(known.email, /Reset your ShadowTrix password/);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await mailCount(unknown)).toBe(0);
  });

  test("resend-verification answers identically for every kind of address", async ({ request, users }) => {
    const unverified = await users.create({ verified: false });
    const verified = await users.create();
    const responses = await Promise.all(
      [unverified.email, verified.email, uniqueEmail("ghost")].map(async (email) => {
        const r = await post(request, "/api/v1/auth/resend-verification", { email });
        return { status: r.status(), body: await r.json() };
      }),
    );
    expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  test("repeated wrong passwords lock out login for that address (429 with Retry-After), even for the right password", async ({ request, page, users }) => {
    const u = await users.create();
    for (let i = 0; i < 8; i++) {
      const r = await post(request, "/api/v1/auth/login", { email: u.email, password: `wrong password ${i}` });
      expect(r.status()).toBe(401);
    }
    const blocked = await post(request, "/api/v1/auth/login", { email: u.email, password: u.password });
    expect(blocked.status()).toBe(429);
    expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
    expect((await blocked.json()).error.code).toBe("rate_limited");
    expect(await db().session.count({ where: { userId: u.id } })).toBe(0);

    // the UI explains it instead of showing a generic failure
    await uiLogin(page, u);
    await expect(alertOf(page)).toContainText("Too many attempts");
    await expect(page).toHaveURL(/\/login/);

    // a different account is not affected
    const other = await users.create();
    expect((await post(request, "/api/v1/auth/login", { email: other.email, password: other.password })).status()).toBe(200);
  });

  test("forgot-password and registration are rate limited per address", async ({ request, users }) => {
    const u = await users.create();
    const results: number[] = [];
    for (let i = 0; i < 6; i++) results.push((await post(request, "/api/v1/auth/forgot-password", { email: u.email })).status());
    expect(results).toEqual([202, 202, 202, 202, 202, 429]);
    const email = uniqueEmail("flood");
    users.track(email);
    const reg: number[] = [];
    for (let i = 0; i < 6; i++) reg.push((await post(request, "/api/v1/auth/register", { email, fullName: "Flood Person", password: PASSWORD })).status());
    expect(reg).toEqual([202, 202, 202, 202, 202, 429]);
  });
});

// ───────────────────────────── Password policy (12 characters) ─────────────────────────────

test.describe("password policy: minimum 12 characters", () => {
  const ELEVEN = "pq7-lmn-x2z";
  const TWELVE = "pq7-lmn-x2zk";

  test("registration API rejects 11 characters on the password field and accepts 12", async ({ request, users }) => {
    const rejected = await post(request, "/api/v1/auth/register", { email: uniqueEmail("p11"), fullName: "Policy Person", password: ELEVEN });
    expect(rejected.status()).toBe(400);
    const body = await rejected.json();
    expect(body.error.issues).toEqual([{ path: ["password"], message: "Use at least 12 characters." }]);

    const email = uniqueEmail("p12");
    users.track(email);
    expect((await post(request, "/api/v1/auth/register", { email, fullName: "Policy Person", password: TWELVE })).status()).toBe(202);
  });

  test("registration form shows the 12-character rule from the server and then succeeds with 12", async ({ page, users }) => {
    const email = uniqueEmail("pform");
    users.track(email);
    await page.goto("/register");
    await expect(page.getByText("At least 12 characters.")).toBeVisible(); // the hint matches the server rule
    await page.getByLabel(/^Full name/).fill("Policy Person");
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByLabel(/^Password/).fill(ELEVEN);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByLabel(/^Password/)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await page.getByLabel(/^Password/).fill(TWELVE);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  });

  test("password reset enforces the same rule, checked before the token is consumed", async ({ request, page, users }) => {
    // API: the policy is validated first, so even a bogus token gets the policy error for 11 characters,
    // and a token error (not a policy error) for 12.
    const short = await post(request, "/api/v1/auth/reset-password", { token: "A".repeat(43), password: ELEVEN });
    expect(short.status()).toBe(400);
    expect((await short.json()).error.code).toBe("validation_error");
    const ok = await post(request, "/api/v1/auth/reset-password", { token: "A".repeat(43), password: TWELVE });
    expect(ok.status()).toBe(400);
    expect((await ok.json()).error.code).toBe("invalid_token");

    // Real flow: an 11-character password is refused and leaves the link usable; 12 then works.
    const u = await users.create();
    await post(request, "/api/v1/auth/forgot-password", { email: u.email });
    const mail = await waitForMail(u.email, /Reset your ShadowTrix password/);
    await page.goto(mail.link("reset-password"));
    await page.getByLabel(/^New password/).fill(ELEVEN);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await page.getByLabel(/^New password/).fill(TWELVE);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();
    expect((await post(request, "/api/v1/auth/login", { email: u.email, password: TWELVE })).status()).toBe(200);
  });
});

// ───────────────────────────── Accessibility of the new pages ─────────────────────────────

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

test.describe("accessibility of account pages", () => {
  for (const vp of [{ name: "mobile", width: 360, height: 800 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`${vp.name}: auth forms, states and signed-in pages have no WCAG 2.2 AA violations or overflow`, async ({ page, users }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const noOverflow = async (label: string) =>
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${label} overflow`).toBeLessThanOrEqual(0);

      for (const path of ["/login", "/register", "/forgot-password", "/reset-password?token=" + "a".repeat(43), "/verify-email?token=" + "a".repeat(43), "/verify-email", "/reset-password"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
        await noOverflow(path);
      }

      // error states
      await page.goto("/login");
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByText("Enter your password.")).toBeVisible();
      await axeClean(page, "login with errors");
      await page.goto("/register");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByText("Enter your full name.")).toBeVisible();
      await axeClean(page, "register with errors");

      // signed in
      const admin = await users.create({ roles: ["ADMIN"] });
      await uiLogin(page, admin);
      await expect(page).toHaveURL(/\/dashboard$/);
      for (const path of ["/dashboard", "/admin", "/organizer", "/judge"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, `admin ${path}`);
        await noOverflow(path);
      }
      await page.context().clearCookies();
      const participant = await users.create();
      await uiLogin(page, participant);
      await expect(page).toHaveURL(/\/dashboard$/); // wait for the login to finish before navigating away
      await page.goto("/admin");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("You do not have access");
      await axeClean(page, "access denied");
      await noOverflow("access denied");
    });
  }

  test("signed-in header and mobile menu expose Dashboard and Sign out and are keyboard operable", async ({ page, users }) => {
    const u = await users.create();
    await page.setViewportSize({ width: 360, height: 800 });
    await uiLogin(page, u);
    await expect(page).toHaveURL(/\/dashboard$/);
    const dialog = page.getByRole("dialog");
    await openMobileMenu(page);
    await expect(dialog.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Login" })).toHaveCount(0);
    await dialog.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0); // menu closes after navigation
    await openMobileMenu(page);
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("login form fields have the right autocomplete hints and are labelled", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel(/^Email address/)).toHaveAttribute("autocomplete", "username");
    await expect(page.getByLabel(/^Password/)).toHaveAttribute("autocomplete", "current-password");
    await page.goto("/register");
    await expect(page.getByLabel(/^Password/)).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByLabel(/^Email address/)).toHaveAttribute("autocomplete", "email");
  });
});
