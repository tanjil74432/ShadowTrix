import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { COOKIE, createRawSession, db, expect, test } from "./helpers/fixtures";

/**
 * Responsive and runtime-health sweep: every important page, for every role, at 320, 360, 390, tablet and desktop widths.
 * Fails on horizontal overflow, console errors (this includes React hydration errors and CSP violations), failed same-origin
 * requests, broken images, and a missing main heading. Screenshots go to the git-ignored web/ui-review/sweep/ folder.
 */
const OUT = path.resolve(__dirname, "../ui-review/sweep");
const WIDTHS = [
  { name: "320", width: 320, height: 640 },
  { name: "360", width: 360, height: 740 },
  { name: "390", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1100 },
  { name: "desktop", width: 1440, height: 900 },
];
const DAY = 86_400_000;

test("every important page is clean at every width, for every role", async ({ page, users }) => {
  test.setTimeout(540_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  fs.mkdirSync(OUT, { recursive: true });
  const tag = randomUUID().slice(0, 6);
  const now = Date.now();
  const organizer = await users.create({ roles: ["ORGANIZER"], fullName: "Sweep Organizer" });
  const participant = await users.create({ fullName: "Sweep Participant" });
  const judge = await users.create({ roles: ["JUDGE"], fullName: "Sweep Judge" });
  const admin = await users.create({ roles: ["ADMIN"], fullName: "Sweep Admin" });
  const event = await db().event.create({
    data: {
      slug: `e2e-sweep-${tag}`, title: `Sweep Hackathon ${tag}`, category: "HACKATHON", summary: "A sweep event with a reasonably long summary to exercise wrapping on narrow screens.", description: "Teams build a working prototype.\n\nJudges score innovation.",
      status: "PUBLISHED", createdById: organizer.id, organizers: { create: { userId: organizer.id, isLead: true } }, registrationOpensAt: new Date(now - DAY), registrationClosesAt: new Date(now + 5 * DAY),
      startsAt: new Date(now + 6 * DAY), endsAt: new Date(now + 8 * DAY), submissionDeadline: new Date(now + 7 * DAY), capacity: 50,
    },
  });
  await db().registration.create({ data: { eventId: event.id, userId: participant.id, status: "CONFIRMED" } });

  const problems: string[] = [];
  let where = "";
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${where}: console error: ${m.text().replace(/https?:\/\/\S+/g, "<url>").slice(0, 140)}`); });
  page.on("pageerror", (e) => problems.push(`${where}: page error: ${e.message.slice(0, 140)}`));
  page.on("response", (r) => { const u = new URL(r.url()); if (u.origin === new URL(page.url() || "http://localhost:3011").origin && r.status() >= 500) problems.push(`${where}: HTTP ${r.status()} ${u.pathname}`); });

  const groups: { who: { id: string } | null; label: string; pages: string[] }[] = [
    { who: null, label: "public", pages: ["/", "/events", `/events/${event.slug}`, "/login", "/register", "/forgot-password", "/about", "/about/team", "/community", "/contact", "/verify"] },
    { who: participant, label: "participant", pages: ["/dashboard", "/dashboard/settings", "/dashboard/banner", `/events/${event.slug}/submission`] },
    { who: organizer, label: "organizer", pages: ["/organizer", `/organizer/events/${event.id}`, "/organizer/events/new"] },
    { who: judge, label: "judge", pages: ["/judge"] },
    { who: admin, label: "admin", pages: ["/admin", "/admin/users", "/admin/events", "/admin/organizations", "/admin/leadership", "/admin/analytics", "/admin/audit", "/admin/settings"] },
  ];

  let checked = 0;
  for (const g of groups) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height });
      if (g.who) await page.context().addCookies([{ name: COOKIE, value: await createRawSession(g.who.id), url: "http://localhost:3011" }]);
      else await page.context().clearCookies();
      for (const url of g.pages) {
        where = `${g.label} ${url} @${w.name}`;
        await page.goto(url, { waitUntil: "load" });
        await expect(page.locator("h1").first(), `${where}: main heading`).toBeVisible();
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && !i.closest("[hidden]")).map((i) => i.currentSrc.split("/").pop()),
          clipped: [...document.querySelectorAll("h1,h2,h3")].filter((h) => { const r = h.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1); }).map((h) => (h.textContent ?? "").slice(0, 30)),
        }));
        if (m.overflow > 0) {
          const culprit = await page.evaluate(() => [...document.querySelectorAll("body *")].map((e) => ({ tag: e.tagName.toLowerCase(), cls: (e.getAttribute("class") ?? "").slice(0, 50), right: Math.round(e.getBoundingClientRect().right) })).filter((x) => x.right > innerWidth + 0.5).slice(0, 3));
          problems.push(`${where}: horizontal overflow ${m.overflow}px, widest elements: ${JSON.stringify(culprit)}`);
        }
        if (m.broken.length) problems.push(`${where}: broken image(s) ${m.broken.join(",")}`);
        if (m.clipped.length) problems.push(`${where}: heading(s) outside the viewport: ${m.clipped.join(" | ")}`);
        // a few screenshots for human review (not every page, to keep the run bounded)
        if (["/", "/events", `/events/${event.slug}`, "/dashboard", "/admin", "/dashboard/banner"].includes(url) && ["320", "360", "tablet"].includes(w.name)) {
          await page.screenshot({ path: path.join(OUT, `${g.label}-${url.replace(/[^a-z0-9]+/gi, "_")}-${w.name}.png`), fullPage: true });
        }
        checked++;
      }
    }
  }
  expect(checked).toBe(5 * (11 + 4 + 3 + 1 + 8));
  expect(problems, `${problems.length} problem(s):\n${problems.join("\n")}`).toEqual([]);
});

test("reduced motion: staggered entrances never keep content invisible (no animation delay)", async ({ page, users }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const admin = await users.create({ roles: ["ADMIN"], fullName: "Motion Admin" });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.context().addCookies([{ name: COOKIE, value: await createRawSession(admin.id), url: "http://localhost:3011" }]);
  await page.goto("/admin");
  await expect(page.locator("h1").first()).toBeVisible();
  const hidden = await page.evaluate(() => [...document.querySelectorAll("dl > *, main *")].filter((e) => { const s = getComputedStyle(e); return parseFloat(s.animationDelay) > 0 || (s.animationName !== "none" && parseFloat(s.opacity) < 1); }).length);
  expect(hidden).toBe(0);
  // the last KPI card is fully visible immediately, not after its stagger delay
  const cards = page.locator(".shadow-card", { has: page.locator("dt") });
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(5);
  expect(Number(await cards.nth(n - 1).evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
});

test("no horizontal overflow in ANY frame while the page streams in (the header placeholder bug)", async ({ page }) => {
  // Watches every animation frame from the first paint, so an element that is only wide during loading (a streaming placeholder) is caught
  // however fast or slow the machine is.
  await page.addInitScript(() => {
    (window as unknown as { __maxOverflow: number }).__maxOverflow = 0;
    const tick = () => {
      const ov = document.documentElement.scrollWidth - window.innerWidth;
      const w = window as unknown as { __maxOverflow: number };
      if (ov > w.__maxOverflow) w.__maxOverflow = ov;
      if (performance.now() < 2500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (const width of [320, 340]) {
    await page.setViewportSize({ width, height: 640 });
    for (const url of ["/login", "/register", "/forgot-password", "/events", "/"]) {
      await page.goto(url, { waitUntil: "commit" });
      await page.waitForTimeout(2600);
      const max = await page.evaluate(() => (window as unknown as { __maxOverflow: number }).__maxOverflow);
      expect(max, `${url} @${width}: widest transient overflow`).toBeLessThanOrEqual(0);
    }
  }
});
