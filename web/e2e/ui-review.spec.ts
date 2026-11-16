import path from "node:path";
import { randomUUID } from "node:crypto";
import { COOKIE, createRawSession, db, expect, test, uiLogin } from "./helpers/fixtures";

/**
 * Visual review helper: captures the main screens at desktop, tablet and phone sizes into web/ui-review/ (git-ignored).
 * Opt-in (UI_REVIEW=1) so normal runs are unaffected:   UI_REVIEW=1 npx playwright test e2e/ui-review.spec.ts --project=chromium
 * It uses real database records created for the run (and removed by the normal cleanup), never fake screenshots.
 */
test.skip(!process.env.UI_REVIEW, "visual review only");
const OUT = path.resolve(__dirname, "../ui-review", process.env.UI_REVIEW_LABEL ?? "current");
const DAY = 86_400_000;
const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1100 },
  { name: "phone", width: 390, height: 844 },
];

test("capture the main screens", async ({ page, users }) => {
  test.setTimeout(600_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tag = randomUUID().slice(0, 6);
  const now = Date.now();
  const organizer = await users.create({ roles: ["ORGANIZER"], fullName: "Olga Organizer" });
  const participant = await users.create({ fullName: "Priya Participant" });
  const mate = await users.create({ fullName: "Mo Mate" });
  const judge = await users.create({ roles: ["JUDGE"], fullName: "Jade Judge" });
  const admin = await users.create({ roles: ["ADMIN"], fullName: "Ada Admin" });

  const mk = (title: string, o: Record<string, unknown> = {}) =>
    db().event.create({
      data: {
        slug: `e2e-ui-${tag}-${Math.random().toString(36).slice(2, 6)}`, title, category: "HACKATHON", summary: "Build, test and present a working prototype with your team in one weekend.",
        description: "Teams build a working prototype over a weekend.\n\nJudges score innovation, impact and execution.", status: "PUBLISHED", createdById: organizer.id,
        organizers: { create: { userId: organizer.id, isLead: true } }, registrationOpensAt: new Date(now - DAY), registrationClosesAt: new Date(now + 5 * DAY),
        startsAt: new Date(now + 6 * DAY), endsAt: new Date(now + 8 * DAY), submissionDeadline: new Date(now + 7 * DAY), capacity: 120, ...o,
      },
    });
  const open = await mk(`UI Review Hackathon ${tag}`);
  await mk(`UI Review Datathon ${tag}`, { category: "DATATHON", capacity: 40 });
  await mk(`UI Review AI Challenge ${tag}`, { category: "AI_ML" });
  const teamEvent = await mk(`UI Review Team Sprint ${tag}`, { registrationMode: "TEAM", minTeamSize: 2, maxTeamSize: 4 });
  const done = await mk(`UI Review Finished ${tag}`, {
    registrationOpensAt: new Date(now - 20 * DAY), registrationClosesAt: new Date(now - 12 * DAY), startsAt: new Date(now - 10 * DAY), endsAt: new Date(now + 5 * DAY), submissionDeadline: new Date(now - DAY),
  });
  await db().registration.create({ data: { eventId: open.id, userId: participant.id, status: "CONFIRMED" } });
  const team = await db().team.create({ data: { eventId: teamEvent.id, name: `Night Owls ${tag}`, leaderId: participant.id, description: "We build things after midnight." } });
  for (const [u, role] of [[participant, "LEADER"], [mate, "MEMBER"]] as const) {
    await db().teamMember.create({ data: { teamId: team.id, eventId: teamEvent.id, userId: u.id, role } });
    await db().registration.create({ data: { eventId: teamEvent.id, userId: u.id, teamId: team.id, status: "CONFIRMED" } });
  }
  await db().registration.create({ data: { eventId: done.id, userId: participant.id, status: "CONFIRMED" } });
  const sub = await db().submission.create({ data: { eventId: done.id, ownerId: participant.id, title: "Shadow Scanner", description: "A scanner that finds shadows in data.", repoUrl: "https://github.com/example/shadow", status: "SUBMITTED", submittedAt: new Date(now - 2 * DAY), currentVersion: 1 } });
  const crit = await db().judgingCriterion.create({ data: { eventId: done.id, name: "Innovation", maxScore: 10, weight: 2 } });
  await db().judgingCriterion.create({ data: { eventId: done.id, name: "Impact", maxScore: 100, weight: 1 } });
  await db().judgeAssignment.create({ data: { eventId: done.id, judgeId: judge.id } });
  await db().userRoleAssignment.create({ data: { userId: judge.id, role: "JUDGE", eventId: done.id } });
  await db().score.create({ data: { submissionId: sub.id, judgeId: judge.id, criterionId: crit.id, score: 8, finalizedAt: new Date() } });

  const shots = async (name: string, url: string, who?: { id: string }) => {
    for (const s of SIZES) {
      await page.setViewportSize({ width: s.width, height: s.height });
      if (who) await page.context().addCookies([{ name: COOKIE, value: await createRawSession(who.id), url: "http://localhost:3011" }]);
      else await page.context().clearCookies();
      await page.goto(url);
      await expect(page.locator("h1").first()).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${name}-${s.name}.png`), fullPage: true });
    }
  };

  await shots("home", "/");
  await shots("events", "/events");
  await shots("event-detail", `/events/${open.slug}`);
  await shots("login", "/login");
  await shots("register", "/register");
  await shots("verify-cert", "/verify/certificate/ST-AAAAA-BBBBB-CCCCC");
  await shots("dashboard", "/dashboard", participant);
  await shots("settings", "/dashboard/settings", participant);
  await shots("team", `/teams/${team.id}`, participant);
  await shots("submission", `/events/${open.slug}/submission`, participant);
  await shots("organizer", "/organizer", organizer);
  await shots("organizer-event", `/organizer/events/${open.id}`, organizer);
  await shots("organizer-judging", `/organizer/events/${done.id}/judging`, organizer);
  await shots("judge", "/judge", judge);
  await shots("judge-score", `/judge/submissions/${sub.id}`, judge);
  await shots("admin", "/admin", admin);
  await shots("admin-users", "/admin/users", admin);
  await shots("admin-events", "/admin/events", admin);
  await shots("admin-analytics", "/admin/analytics", admin);
  await shots("admin-leadership", "/admin/leadership", admin);
  await shots("admin-audit", "/admin/audit", admin);
  void uiLogin;
});

test("capture interaction states of event cards and controls", async ({ page, users }) => {
  test.setTimeout(120_000);
  const tag = randomUUID().slice(0, 6);
  const now = Date.now();
  const organizer = await users.create({ roles: ["ORGANIZER"] });
  await db().event.create({
    data: {
      slug: `e2e-ui-${tag}-s`, title: `UI Review States ${tag}`, category: "HACKATHON", summary: "Card hover and focus review.", description: "Review.", status: "PUBLISHED", createdById: organizer.id,
      organizers: { create: { userId: organizer.id, isLead: true } }, registrationOpensAt: new Date(now - DAY), registrationClosesAt: new Date(now + 5 * DAY),
      startsAt: new Date(now + 6 * DAY), endsAt: new Date(now + 8 * DAY), submissionDeadline: new Date(now + 7 * DAY), capacity: 10,
    },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/events?q=${tag}`);
  const card = page.locator("article").first();
  await expect(card).toBeVisible();
  await page.waitForTimeout(500);
  const clip = async (name: string) => { await page.waitForTimeout(450); await card.screenshot({ path: path.join(OUT, `state-card-${name}.png`) }); };
  await clip("rest");
  await card.hover();
  await clip("hover");
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await page.screenshot({ path: path.join(OUT, "state-focus.png"), clip: { x: 0, y: 0, width: 1440, height: 900 } });
});

test("capture navbar, menus and leadership close-ups", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "close-navbar-desktop.png"), clip: { x: 0, y: 0, width: 1440, height: 80 } });
  await page.getByRole("button", { name: /about us/i }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "close-menu-about.png"), clip: { x: 300, y: 0, width: 800, height: 260 } });
  await page.keyboard.press("Escape");
  const lead = page.locator("section[aria-labelledby='leadership-title'] article").first();
  await lead.scrollIntoViewIfNeeded();
  await lead.hover();
  await page.waitForTimeout(500);
  await lead.screenshot({ path: path.join(OUT, "close-leadership-card.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "close-navbar-phone.png"), clip: { x: 0, y: 0, width: 390, height: 80 } });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "close-menu-phone.png") });
});

test("capture sticky navbar, tablet navigation, disabled and focus states, and the glass fallback", async ({ page, users }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const admin = await users.create({ roles: ["ADMIN"], fullName: "Ada Admin" });
  const user = await users.create({ fullName: "Priya Participant" });
  const login = async (who: { id: string }) => page.context().addCookies([{ name: COOKIE, value: await createRawSession(who.id), url: "http://localhost:3011" }]);

  // Sticky navbar over page content (events list is long; admin analytics has charts).
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(admin);
  await page.goto("/admin/analytics");
  await expect(page.locator("h1").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "sticky-admin-analytics.png") });
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, 1100));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "sticky-home.png"), clip: { x: 0, y: 0, width: 1440, height: 420 } });

  // Tablet navigation: closed bar and open menu.
  await page.setViewportSize({ width: 820, height: 1100 });
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "tablet-nav-closed.png"), clip: { x: 0, y: 0, width: 820, height: 120 } });
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) { await menu.click(); await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, "tablet-nav-open.png") }); }

  // Disabled and focus states: the login form submit button while the page is busy is not reachable, so use the banner creator
  // (disabled designation select, disabled crop fieldset) and keyboard focus on its controls.
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(user);
  await page.goto("/dashboard/banner");
  await expect(page.locator("h1").first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "state-disabled-banner.png"), clip: { x: 0, y: 80, width: 720, height: 820 } });
  await page.getByLabel(/^Name/).focus();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "state-focus-field.png"), clip: { x: 0, y: 80, width: 720, height: 820 } });
  await page.getByRole("button", { name: /Download PNG/ }).focus();
  await page.screenshot({ path: path.join(OUT, "state-focus-button.png"), clip: { x: 0, y: 380, width: 720, height: 520 } });

  // Glass fallback: this applies the exact declarations of the `@supports not (backdrop-filter)` block without needing a browser that
  // lacks the feature, and removes the blur, so the navbar, a dropdown and the admin sidebar are seen on their solid backgrounds.
  await login(admin);
  await page.goto("/admin");
  await page.addStyleTag({ content: ".glass-nav,.glass{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}.glass-nav{background:#1a120c!important}.glass{background:#1b120c!important}" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "fallback-admin.png") });
  await page.getByRole("button", { name: /about us/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "fallback-menu.png"), clip: { x: 300, y: 0, width: 800, height: 300 } });
});
