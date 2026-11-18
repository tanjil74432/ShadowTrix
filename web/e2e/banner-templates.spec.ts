import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { COOKIE, JSON_HEADERS, createRawSession, db, expect, test, uiLogin, type TestUser } from "./helpers/fixtures";
import { addPhoto, expectExportMatches, pngSize, samePicture, settle } from "./helpers/banner";

/**
 * The two banner templates: Classic (everybody) and Matrix (administrators only), checked over real HTTP and in the real editor, plus the
 * fixed-preview layout. Authorization is decided on the server for every operation; nothing here relies on the selector being hidden.
 */
const SHOTS = process.env.BANNER_SHOTS ? path.resolve(__dirname, "../../docs/reports/banner-templates") : path.resolve(__dirname, "../ui-review/banner-templates");
const T = "/api/v1/banner/templates";
const RENDERER = "/api/v1/banner/templates/matrix/renderer";
const ACCESS = "/api/v1/banner/template-access";

const asUser = async (u: TestUser) => ({ ...JSON_HEADERS, Cookie: `${COOKIE}=${await createRawSession(u.id)}` });

test.describe("banner template authorization (server side)", () => {
  test("anonymous callers get 401 from every template operation", async ({ request }) => {
    for (const url of [T, RENDERER, `${ACCESS}?template=classic`, `${ACCESS}?template=matrix`]) {
      const r = await request.get(url, { headers: JSON_HEADERS });
      expect(r.status(), url).toBe(401);
      expect(await r.text()).not.toMatch(/drawMatrixBanner|export default/);
    }
  });

  test("a participant, an organizer and a judge see and may use only Classic; asking for Matrix by any route is refused", async ({ request, users }) => {
    for (const roles of [[], ["ORGANIZER"], ["JUDGE"]] as const) {
      const person = await users.create({ roles: [...roles], fullName: "Ordinary Template Person" });
      const headers = await asUser(person);
      const list = await request.get(T, { headers });
      expect(list.status()).toBe(200);
      const text = await list.text();
      expect((JSON.parse(text) as { templates: { id: string }[] }).templates.map((t) => t.id)).toEqual(["classic"]);
      expect(text, "the response must not mention Matrix at all").not.toMatch(/matrix/i);

      const code = await request.get(RENDERER, { headers });
      expect(code.status()).toBe(403);
      const body = await code.text();
      expect(body, "no part of the Matrix code may reach this caller").not.toMatch(/drawMatrixBanner|export default|createLinearGradient|SHADOWTRIX/);
      expect(code.headers()["content-type"] ?? "").not.toMatch(/javascript/);

      expect((await request.get(`${ACCESS}?template=matrix`, { headers })).status()).toBe(403);
      expect((await request.get(`${ACCESS}?template=classic`, { headers })).status()).toBe(200);
      // parameter tampering: unknown names, case and encoding tricks, repeated parameters
      for (const bad of ["founder", "Matrix", "MATRIX", "matrix%20", "%6datrix", "classic,matrix", "", "co-founder", "judge"]) {
        const r = await request.get(`${ACCESS}?template=${bad}`, { headers });
        expect([400, 403], `template=${bad}`).toContain(r.status());
        if (r.status() === 200) throw new Error("must not be allowed");
      }
      expect((await request.get(`${ACCESS}`, { headers })).status()).toBe(400);
      const twice = await request.get(`${ACCESS}?template=classic&template=matrix`, { headers });
      expect([200, 403]).toContain(twice.status()); // the server reads one value; either way Matrix is never granted
      expect((await request.get(`${ACCESS}?template=matrix&template=classic`, { headers })).status()).toBe(403);
    }
  });

  test("an event-scoped administrator grant does not unlock Matrix (it is platform administration only)", async ({ request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"], fullName: "Event Owner" });
    const person = await users.create({ fullName: "Scoped Admin" });
    const now = Date.now();
    const event = await db().event.create({
      data: { slug: `e2e-bt-${randomUUID().slice(0, 6)}`, title: "E2E Scope Event", category: "HACKATHON", summary: "s", description: "d", createdById: owner.id, status: "PUBLISHED", startsAt: new Date(now + 86_400_000), endsAt: new Date(now + 2 * 86_400_000), registrationOpensAt: new Date(now - 86_400_000), registrationClosesAt: new Date(now + 43_200_000) },
    });
    try {
      await db().userRoleAssignment.create({ data: { userId: person.id, role: "ADMIN", eventId: event.id } });
      const headers = await asUser(person);
      expect((await request.get(RENDERER, { headers })).status()).toBe(403);
      expect((await request.get(`${ACCESS}?template=matrix`, { headers })).status()).toBe(403);
      const list = await (await request.get(T, { headers })).json() as { templates: { id: string }[] };
      expect(list.templates.map((t) => t.id)).toEqual(["classic"]);
    } finally {
      await db().event.deleteMany({ where: { id: event.id } });
    }
  });

  test("an administrator sees and may use both templates, and receives the renderer as a never-cached module", async ({ request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Template Admin" });
    const headers = await asUser(admin);
    const list = await (await request.get(T, { headers })).json() as { templates: { id: string; label: string }[] };
    expect(list.templates.map((t) => t.id)).toEqual(["classic", "matrix"]);
    const code = await request.get(RENDERER, { headers });
    expect(code.status()).toBe(200);
    expect(code.headers()["content-type"]).toMatch(/text\/javascript/);
    expect(code.headers()["cache-control"]).toMatch(/no-store/);
    expect(code.headers()["x-content-type-options"]).toBe("nosniff");
    expect(await code.text()).toMatch(/^export default \(/);
    for (const t of ["classic", "matrix"]) expect((await request.get(`${ACCESS}?template=${t}`, { headers })).status()).toBe(200);
    expect((await request.get(`${ACCESS}?template=founder`, { headers })).status()).toBe(400);
    // existing Admin Panel permissions are unchanged
    expect((await request.get("/api/v1/admin/overview", { headers })).status()).toBe(200);
    const person = await users.create({ fullName: "Not An Admin" });
    expect((await request.get("/api/v1/admin/overview", { headers: await asUser(person) })).status()).toBe(403);
  });

  test("the permission is checked on every request: when the administrator role is removed, the next request is refused", async ({ request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Soon Not Admin" });
    const headers = await asUser(admin); // one session, used before and after the change
    expect((await request.get(RENDERER, { headers })).status()).toBe(200);
    expect((await request.get(`${ACCESS}?template=matrix`, { headers })).status()).toBe(200);
    await db().userRoleAssignment.deleteMany({ where: { userId: admin.id, role: "ADMIN" } });
    expect((await request.get(RENDERER, { headers })).status()).toBe(403);
    expect((await request.get(`${ACCESS}?template=matrix`, { headers })).status()).toBe(403);
    const list = await (await request.get(T, { headers })).json() as { templates: { id: string }[] };
    expect(list.templates.map((t) => t.id)).toEqual(["classic"]);
  });
});

test.describe("banner templates in the editor", () => {
  test("a participant sees no template choice, nothing about Matrix reaches the page, and the renderer cannot be loaded", async ({ page, users }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    const scripts: string[] = []; // every script the page downloads from the public static folder
    page.on("response", (r) => { if (r.url().includes("/_next/static/") && /\.js(\?|$)/.test(r.url())) scripts.push(r.url()); });
    const person = await users.create({ fullName: "Plain Template Person" });
    await uiLogin(page, person, "/dashboard/banner");
    await expect(page.getByRole("heading", { name: "Your ShadowTrix banner" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.locator("main").getByText(/template/i)).toHaveCount(0);
    expect(await page.content()).not.toMatch(/ShadowTrix Matrix|matrix\/renderer|drawMatrixBanner/);
    await expect(page.getByTestId("banner-canvas")).toHaveAttribute("aria-label", /^ShadowTrix Classic banner preview/);
    await addPhoto(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
    expect(pngSize(fs.readFileSync((await dl.path())!))).toEqual({ w: 1080, h: 1350 });
    expect(requested.filter((p) => p.includes("/matrix/")), "the editor never asks for Matrix on its own").toEqual([]);
    // the public JavaScript contains no Matrix drawing code at all: it exists only on the server and in administrators' browsers
    expect(scripts.length).toBeGreaterThan(3);
    for (const url of scripts) {
      const text = await (await page.request.get(url)).text();
      // (the endpoint's path may appear: the editor has to know where to ask; the drawing code itself must not)
      expect(text, url).not.toMatch(/1999031|#070707|drawMatrixBanner/);
    }
    // trying to pull the renderer in from the page itself is refused by the server
    const outcome = await page.evaluate(async () => {
      const url = "/api/v1/banner/templates/matrix/renderer";
      const res = await fetch(url);
      let loaded = "blocked";
      try { await import(/* webpackIgnore: true */ url); loaded = "loaded"; } catch { /* refused */ }
      return { status: res.status, text: (await res.text()).slice(0, 200), loaded };
    });
    expect(outcome.status).toBe(403);
    expect(outcome.loaded).toBe("blocked");
    expect(outcome.text).not.toMatch(/drawMatrixBanner|export default/);
  });

  test("an administrator sees both templates, Classic is the default, Matrix renders and exports at 1080 x 1350, and Classic comes back unchanged", async ({ page, users }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    fs.mkdirSync(SHOTS, { recursive: true });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Aarav Admin Rahman" });
    await uiLogin(page, admin, "/dashboard/banner");
    await expect(page.getByRole("heading", { name: "Your ShadowTrix banner" })).toBeVisible();
    expect(await page.getByRole("radio").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["classic", "matrix"]);
    await expect(page.getByRole("radio", { name: "ShadowTrix Classic" })).toBeChecked(); // the default
    await addPhoto(page);
    await page.getByLabel(/^University name/).fill("Bangladesh University of Engineering and Technology");
    await page.getByLabel(/^Department/).fill("Computer Science and Engineering");
    await page.getByLabel(/^Event name/).fill("ShadowTrix Spring Hackathon 2026");
    await page.getByLabel(/^Team or organization name/).fill("Team Matrix");
    await page.getByLabel(/^Tagline/).fill("Enter the Matrix of Innovation.");
    await page.getByLabel(/^Identity text/).fill("FOUNDER");
    const canvas = page.getByTestId("banner-canvas");
    await settle(page);
    const classic = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
    fs.writeFileSync(path.join(SHOTS, "classic.png"), Buffer.from(classic.split(",")[1], "base64"));

    const renderer = page.waitForResponse((r) => r.url().includes("/matrix/renderer") && r.status() === 200);
    await page.getByText("ShadowTrix Matrix", { exact: true }).click();
    await renderer;
    await expect(canvas).toHaveAttribute("aria-label", /^ShadowTrix Matrix banner preview/);
    await expect(page.getByRole("radio", { name: "ShadowTrix Matrix" })).toBeChecked();
    await settle(page);
    const matrix = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
    expect(await samePicture(page, classic, matrix), "Matrix looks different from Classic").toBe(false);
    for (const text of ["CO-FOUNDER", "SHADOWTRIX", "PARTICIPANT"]) {
      await page.getByLabel(/^Identity text/).fill(text);
      await settle(page);
      const shot = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
      expect(await samePicture(page, matrix, shot), `identity text ${text} changes the Matrix artwork`).toBe(false);
      fs.writeFileSync(path.join(SHOTS, `matrix-${text.toLowerCase()}.png`), Buffer.from(shot.split(",")[1], "base64"));
    }
    await page.getByLabel(/^Identity text/).fill("FOUNDER");
    await settle(page);
    const matrixFinal = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));

    // exporting Matrix asks the server again, and the file is exactly the canvas
    const check = page.waitForResponse((r) => r.url().includes("/api/v1/banner/template-access") && r.url().includes("template=matrix") && r.status() === 200);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
    await check;
    const buf = fs.readFileSync((await dl.path())!);
    expect(pngSize(buf)).toEqual({ w: 1080, h: 1350 });
    await expectExportMatches(page, canvas, matrixFinal, buf);
    fs.writeFileSync(path.join(SHOTS, "matrix-export.png"), buf);

    // back to Classic: the same picture as before, and its export is also 1080 x 1350
    await page.getByText("ShadowTrix Classic", { exact: true }).click();
    await expect(canvas).toHaveAttribute("aria-label", /^ShadowTrix Classic banner preview/);
    await settle(page);
    expect(await samePicture(page, classic, await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png")))).toBe(true);
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PNG/ }).click()]);
    expect(pngSize(fs.readFileSync((await dl2.path())!))).toEqual({ w: 1080, h: 1350 });
  });

  test("the administrator's editor with the template choice has no accessibility violations and the choice works with the keyboard", async ({ page, users }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Keyboard Admin" });
    await uiLogin(page, admin, "/dashboard/banner");
    await expect(page.getByRole("radiogroup", { name: "Banner template" })).toBeVisible();
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `${vp.width}x${vp.height}`).toEqual([]);
    }
    // keyboard: focus the template group, arrow to Matrix; the choice is announced as checked
    await page.getByRole("radio", { name: "ShadowTrix Classic" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "ShadowTrix Matrix" })).toBeChecked();
    await expect(page.getByTestId("banner-canvas")).toHaveAttribute("aria-label", /^ShadowTrix Matrix/);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("radio", { name: "ShadowTrix Classic" })).toBeChecked();
    await expect(page.getByTestId("banner-canvas")).toHaveAttribute("aria-label", /^ShadowTrix Classic/);
  });

  test("if the administrator role is removed while the page is open, Matrix can no longer be exported", async ({ page, users }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Revoked Admin" });
    await uiLogin(page, admin, "/dashboard/banner");
    await expect(page.getByRole("radio", { name: "ShadowTrix Matrix" })).toBeAttached();
    await addPhoto(page);
    await page.getByText("ShadowTrix Matrix", { exact: true }).click();
    await expect(page.getByTestId("banner-canvas")).toHaveAttribute("aria-label", /^ShadowTrix Matrix/);
    await db().userRoleAssignment.deleteMany({ where: { userId: admin.id, role: "ADMIN" } });
    let downloaded = false;
    page.on("download", () => { downloaded = true; });
    await page.getByRole("button", { name: /Download PNG/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: /do not have access to this template/i })).toBeVisible();
    await page.waitForTimeout(800);
    expect(downloaded, "no file is produced for a template the server refused").toBe(false);
  });
});

test.describe("fixed preview layout", () => {
  for (const vp of [{ w: 1440, h: 900 }, { w: 1920, h: 1080 }, { w: 1366, h: 768 }, { w: 1280, h: 720 }, { w: 1024, h: 768 }]) {
    test(`${vp.w}x${vp.h}: the page does not scroll, the whole banner is visible at 4:5, and the form scrolls by itself`, async ({ page, users }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const person = await users.create({ fullName: "Fixed Preview Person" });
      await uiLogin(page, person, "/dashboard/banner");
      await addPhoto(page);
      await settle(page);
      const measure = () => page.evaluate(() => {
        const c = document.querySelector('[data-testid="banner-canvas"]')!.getBoundingClientRect();
        const nav = document.querySelector("header")!.getBoundingClientRect();
        const form = document.querySelector(".banner-form")!;
        return {
          pageScroll: document.documentElement.scrollHeight - window.innerHeight,
          canvas: { x: c.x, y: c.y, w: c.width, h: c.height, right: c.right, bottom: c.bottom },
          navBottom: nav.bottom,
          formScrollable: form.scrollHeight > form.clientHeight,
          formTop: form.scrollTop,
          vw: window.innerWidth, vh: window.innerHeight,
        };
      });
      const m = await measure();
      expect(m.pageScroll, "no page-level vertical scrolling").toBeLessThanOrEqual(0);
      expect(m.canvas.y).toBeGreaterThanOrEqual(m.navBottom - 1); // below the fixed navigation header
      expect(m.canvas.bottom).toBeLessThanOrEqual(m.vh + 0.5);
      expect(m.canvas.x).toBeGreaterThanOrEqual(0);
      expect(m.canvas.right).toBeLessThanOrEqual(m.vw + 0.5);
      expect(Math.abs(m.canvas.w / m.canvas.h - 1080 / 1350), "the 4:5 shape is never stretched").toBeLessThan(0.004);
      expect(m.canvas.h, "the preview uses the available height").toBeGreaterThan(m.vh * 0.5);
      expect(m.formScrollable, "the form is longer than the screen, so it scrolls by itself").toBe(true);
      // scrolling the form moves the form only
      await page.evaluate(() => { document.querySelector(".banner-form")!.scrollTop = 700; });
      await page.waitForTimeout(250);
      const after = await measure();
      expect(after.formTop).toBeGreaterThan(300);
      expect(after.canvas.y).toBe(m.canvas.y);
      expect(after.canvas.bottom).toBe(m.canvas.bottom);
      expect(after.pageScroll).toBeLessThanOrEqual(0);
      // the page really cannot be scrolled with the mouse wheel either
      await page.mouse.move(m.canvas.x + m.canvas.w / 2, m.canvas.y + m.canvas.h / 2);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      // the whole banner is visible at once: the heading, the photo and the bottom information are all inside the canvas that is in view
      await page.screenshot({ path: path.join(SHOTS, `fixed-preview-${vp.w}x${vp.h}.png`) });
    });
  }

  test("a preview that is the whole banner: it is sized from the viewport and a taller window gives a larger preview", async ({ page, users }) => {
    test.setTimeout(90_000);
    const person = await users.create({ fullName: "Size Person" });
    await page.setViewportSize({ width: 1440, height: 760 });
    await uiLogin(page, person, "/dashboard/banner");
    // boundingBox() does not wait for visibility: right after login the route is still being shown and the canvas can be in the page but not yet visible
    // (it returned null in that window). Wait until it is on screen, then measure.
    const canvas = page.getByTestId("banner-canvas");
    await expect(canvas).toBeVisible();
    const small = (await canvas.boundingBox())!;
    await page.setViewportSize({ width: 1440, height: 1100 });
    await expect.poll(async () => (await canvas.boundingBox())?.height ?? 0, { message: "a taller window gives a larger preview" }).toBeGreaterThan(small.height + 150);
    const large = (await canvas.boundingBox())!;
    expect(Math.abs(large.width / large.height - 0.8)).toBeLessThan(0.004);
  });

  test("phone width: a clean stacked layout, the preview comes first, nothing is clipped sideways and the page scrolls normally", async ({ page, users }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const person = await users.create({ fullName: "Phone Person" });
    await uiLogin(page, person, "/dashboard/banner");
    await addPhoto(page);
    const m = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="banner-canvas"]')!.getBoundingClientRect();
      const f = document.querySelector(".banner-form")!.getBoundingClientRect();
      return { overflowX: document.documentElement.scrollWidth - window.innerWidth, pageScroll: document.documentElement.scrollHeight - window.innerHeight, c: { x: c.x, right: c.right, w: c.width, h: c.height, top: c.top }, formTop: f.top, bodyOverflow: getComputedStyle(document.documentElement).overflowY };
    });
    expect(m.overflowX).toBeLessThanOrEqual(0);
    expect(m.pageScroll).toBeGreaterThan(300); // stacked: the page scrolls
    expect(m.bodyOverflow).not.toBe("hidden");
    expect(m.c.x).toBeGreaterThanOrEqual(0);
    expect(m.c.right).toBeLessThanOrEqual(390.5);
    expect(Math.abs(m.c.w / m.c.h - 0.8)).toBeLessThan(0.004);
    expect(m.c.top, "the preview comes before the controls").toBeLessThan(m.formTop);
    await expect(page.getByRole("button", { name: /Download PNG/ })).toBeVisible();
    await page.getByRole("button", { name: /Download PNG/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "fixed-preview-phone-390.png"), fullPage: true });
  });
});

test.describe("the footer is hidden only on the desktop Banner Creator", () => {
  const footer = (page: import("@playwright/test").Page) => page.locator("body > footer");
  const pageScrolls = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight > 0 && getComputedStyle(document.documentElement).overflowY !== "hidden");

  test("every other page keeps its footer and scrolls normally on a desktop screen", async ({ page, users }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of ["/", "/events", "/about", "/community", "/contact", "/login", "/register"]) {
      await page.goto(route);
      await expect(footer(page), route).toBeVisible();
      await expect(footer(page).getByText(/Operated by Team EU Shadow/), route).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY), route).not.toBe("hidden");
    }
    const person = await users.create({ fullName: "Footer Person" });
    for (const route of ["/dashboard", "/dashboard/settings"]) {
      await uiLogin(page, person, route);
      await expect(footer(page), route).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY), route).not.toBe("hidden");
    }
  });

  test("on the desktop Banner Creator the footer is hidden because the page does not scroll", async ({ page, users }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const person = await users.create({ fullName: "Desktop Footer Person" });
    await uiLogin(page, person, "/dashboard/banner");
    await expect(page.getByTestId("banner-canvas")).toBeVisible();
    await expect(footer(page)).toBeHidden();
    expect(await pageScrolls(page)).toBe(false);
  });

  test("the footer comes back after leaving the Banner Creator through a link, without reloading", async ({ page, users }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const person = await users.create({ fullName: "Navigating Person" });
    await uiLogin(page, person, "/dashboard/banner");
    await expect(footer(page)).toBeHidden();
    for (const [link, url] of [["My dashboard", /\/dashboard$/], ["Account settings", /\/dashboard\/settings/]] as const) {
      await page.getByRole("link", { name: link, exact: true }).first().click();
      await expect(page).toHaveURL(url);
      await expect(footer(page), `after going to ${link}`).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY), `after going to ${link}`).not.toBe("hidden");
      await page.getByRole("link", { name: "Banner creator", exact: true }).first().click();
      await expect(page).toHaveURL(/\/dashboard\/banner/);
      await expect(footer(page)).toBeHidden(); // and it is hidden again when the editor is back
    }
    await page.goBack();
    await expect(footer(page)).toBeVisible();
  });

  test("short desktop windows and phones keep the footer, and the Banner Creator page scrolls normally there", async ({ page, users }) => {
    test.setTimeout(120_000);
    const person = await users.create({ fullName: "Small Screen Person" });
    await page.setViewportSize({ width: 1440, height: 600 }); // short: below the 640 px the fixed layout needs
    await uiLogin(page, person, "/dashboard/banner");
    await expect(page.getByTestId("banner-canvas")).toBeVisible();
    expect(await pageScrolls(page), "short desktop: the page scrolls").toBe(true);
    await footer(page).scrollIntoViewIfNeeded();
    await expect(footer(page)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 }); // phone
    await page.waitForTimeout(300);
    expect(await pageScrolls(page), "phone: the page scrolls").toBe(true);
    await footer(page).scrollIntoViewIfNeeded();
    await expect(footer(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /Download PNG/ })).toBeVisible(); // everything stays reachable
    await page.setViewportSize({ width: 1440, height: 900 }); // growing the window turns the fixed layout back on, live
    await page.waitForTimeout(300);
    await expect(footer(page)).toBeHidden();
  });
});
