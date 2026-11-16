import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { COOKIE, JSON_HEADERS, PASSWORD, createRawSession, db, expect, test, uiLogin, waitForMail } from "./helpers/fixtures";

/**
 * Core journeys that must work the same in Chromium, Firefox and WebKit (Safari's engine), at phone, tablet and desktop
 * sizes. Run with `npm run test:e2e:cross` (projects named x-*). These need real browser behavior: form submission, file
 * uploads with FormData, focus handling, CSP enforcement and layout.
 */
const DAY = 86_400_000;
const tag = () => randomUUID().slice(0, 6);
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function watch(page: Page) {
  const problems: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  // WebKit reports a prefetch (`?_rsc=`) that was cancelled by navigating away as "access control checks": not an application error.
  page.on("pageerror", (e) => !/_rsc=.*access control checks/.test(e.message) && problems.push(`pageerror: ${e.message}`));
  return {
    problems,
    async csp() {
      return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    },
  };
}

const noOverflow = async (page: Page, label: string) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${label} horizontal overflow`).toBeLessThanOrEqual(0);

async function openMenuIfCollapsed(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) >= 768) return;
  await expect(async () => {
    if (!(await page.getByRole("dialog").isVisible())) await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

test.describe("cross-browser core journeys", () => {
  test("home, events and the design hold up: layout, keyboard skip link, no script errors, no CSP violations, axe clean", async ({ page, users, browserName }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // axe measures contrast, so entrance animations must not be mid-fade
    const w = await watch(page);
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const now = Date.now();
    const event = await db().event.create({
      data: {
        slug: `e2e-x-${tag()}`, title: `Cross Browser Event ${tag()}`, category: "HACKATHON", summary: "A published event for the cross-browser run.", description: "Description that is long enough for the page.", status: "PUBLISHED", createdById: owner.id,
        organizers: { create: { userId: owner.id, isLead: true } }, registrationOpensAt: new Date(now - DAY), registrationClosesAt: new Date(now + 5 * DAY), startsAt: new Date(now + 6 * DAY), endsAt: new Date(now + 8 * DAY),
      },
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await noOverflow(page, "home");
    // keyboard: the first Tab stop is the skip link, and it moves focus to the main content
    // (Safari/WebKit does not Tab to links unless the user enables it in the system settings, so there the link is focused directly.)
    if (browserName === "webkit") await page.getByRole("link", { name: "Skip to main content" }).focus();
    else await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);

    await page.goto(`/events?q=${encodeURIComponent(event.title)}`);
    await expect(page.getByRole("heading", { level: 2, name: event.title })).toBeVisible();
    await noOverflow(page, "events");
    await page.goto(`/events/${event.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: event.title })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in to register" })).toBeVisible();
    await noOverflow(page, "event details");
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);

    await openMenuIfCollapsed(page); // the mobile menu is a real dialog everywhere
    expect(await w.csp()).toEqual([]);
    expect(w.problems).toEqual([]);
  });

  test("signup in two steps works in the browser, with the real email", async ({ page, users }) => {
    const email = `e2e-xsignup-${tag()}@example.test`;
    users.track(email);
    await page.goto("/register");
    await page.getByLabel(/^Email address/).fill(email);
    await page.getByRole("button", { name: "Send confirmation link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const mail = await waitForMail(email, /Confirm your email/);
    await page.goto(mail.link("verify-email"));
    await page.getByLabel(/^Full name/).fill("Cross Browser");
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Confirm email and activate account" }).click();
    await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
    await noOverflow(page, "signup done");
  });

  test("login, dashboard, settings form, logout; no CSP violations in the signed-in area", async ({ page, users }) => {
    const w = await watch(page);
    const u = await users.create({ fullName: "Cross Browser User" });
    await uiLogin(page, u, "/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Cross Browser User");
    await noOverflow(page, "dashboard");
    await page.goto("/dashboard/settings");
    await page.getByLabel(/^Short bio/).fill("Written in this browser.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await noOverflow(page, "settings");
    await openMenuIfCollapsed(page);
    if ((page.viewportSize()?.width ?? 1280) < 768) await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    else await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    expect(await w.csp()).toEqual([]);
    expect(w.problems).toEqual([]);
  });

  test("project submission form and private file upload behave the same in every engine", async ({ page, request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const p = await users.create();
    const now = Date.now();
    const event = await db().event.create({
      data: {
        slug: `e2e-xs-${tag()}`, title: `Cross Submission ${tag()}`, category: "HACKATHON", summary: "Summary for the upload run.", description: "Description that is long enough for the page.", status: "PUBLISHED", createdById: owner.id,
        organizers: { create: { userId: owner.id, isLead: true } }, registrationOpensAt: new Date(now - DAY), registrationClosesAt: new Date(now + 5 * DAY), startsAt: new Date(now + 6 * DAY), endsAt: new Date(now + 12 * DAY), submissionDeadline: new Date(now + 9 * DAY),
      },
    });
    await db().registration.create({ data: { eventId: event.id, userId: p.id, status: "CONFIRMED" } });
    await uiLogin(page, p, `/events/${event.slug}/submission`);
    await page.getByLabel(/^Project title/).fill("Cross Browser Project");
    await page.getByLabel(/^Description/).fill("A project written and submitted in this browser, with a file.");
    await page.getByLabel(/^Repository link/).fill("https://github.com/example/cross");
    await page.getByLabel(/^Add a file/).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello from the browser") });
    await page.getByRole("button", { name: "Upload file" }).click();
    await expect(page.getByText("File uploaded.")).toBeVisible();
    await page.getByRole("button", { name: "Submit project" }).click();
    await expect(page.getByText("Project submitted.")).toBeVisible();
    await expect(page.getByText("Submitted (version 1)")).toBeVisible();
    const link = page.getByRole("link", { name: "notes.txt" });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href"))!;
    const res = await request.get(href, { headers: { Cookie: `${COOKIE}=${await createRawSession(p.id)}` } });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    expect((await request.get(href)).status()).toBe(401);
    await noOverflow(page, "submission");
    void JSON_HEADERS;
  });

  test("forms report errors accessibly: focus, aria-invalid and a live alert, in every engine", async ({ page, browserName }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByLabel(/^Email address/)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__):visible').first()).toBeVisible();
    await page.getByLabel(/^Email address/).fill("nobody@example.test");
    await page.getByLabel(/^Password/).fill("definitely wrong password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__):visible').filter({ hasText: "Incorrect email or password." })).toBeVisible();
    await noOverflow(page, "login errors");
    // Known tooling limit: running axe on a page in this error state crashes Playwright's Firefox build (the identical state is
    // axe-clean in Chromium and WebKit, and axe is clean in Firefox on every other page). Documented in docs/operations/qa-report.md.
    test.skip(browserName === "firefox", "axe crashes Playwright's Firefox on this page state");
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
});
