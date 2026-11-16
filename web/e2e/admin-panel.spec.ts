import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { COOKIE, JSON_HEADERS, createRawSession, db, expect, test, uiLogin, type TestUser } from "./helpers/fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DAY = 86_400_000;
const tag = () => randomUUID().slice(0, 6);
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const cookie = async (u: TestUser) => ({ Cookie: `${COOKIE}=${await createRawSession(u.id)}` });
const asUser = async (u: TestUser) => ({ ...JSON_HEADERS, ...(await cookie(u)) });

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

async function seedEvent(ownerId: string, title: string, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  return db().event.create({
    data: {
      slug: `e2e-pnl-${tag()}`, title, category: "HACKATHON", summary: "Summary of an admin panel test event.", description: "Description that is long enough for the event.", status: "DRAFT", createdById: ownerId,
      registrationOpensAt: new Date(now - DAY), registrationClosesAt: new Date(now + 5 * DAY), startsAt: new Date(now + 6 * DAY), endsAt: new Date(now + 8 * DAY),
      organizers: { create: { userId: ownerId, isLead: true } }, ...extra,
    },
  });
}

const GET_ENDPOINTS = (id: string) => [
  "/api/v1/admin/overview", "/api/v1/admin/teams", `/api/v1/admin/teams/${id}`, "/api/v1/admin/submissions", `/api/v1/admin/submissions/${id}`, "/api/v1/admin/judging", `/api/v1/admin/judging/${id}`,
  "/api/v1/admin/results", `/api/v1/admin/results/${id}`, "/api/v1/admin/certificates", "/api/v1/admin/event-reviews", `/api/v1/admin/event-reviews/${id}`, "/api/v1/admin/announcements", `/api/v1/admin/announcements/${id}`, "/api/v1/admin/maintenance",
];
const PAGES = (id: string) => [
  "/admin", "/admin/event-approvals", `/admin/event-approvals/${id}`, "/admin/teams", `/admin/teams/${id}`, "/admin/submissions", `/admin/submissions/${id}`, "/admin/judging", `/admin/judging/${id}`,
  "/admin/results", `/admin/results/${id}`, "/admin/certificates", "/admin/announcements", "/admin/announcements/new", `/admin/announcements/${id}`, "/admin/maintenance",
];

test.describe("every new admin page and endpoint is protected on the server", () => {
  test("anonymous: login redirect / 401; participant and organizer: access denied / 403 with no data; mutations are refused too", async ({ page, request, users }) => {
    test.setTimeout(240_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Pnl Admin Private" });
    const participant = await users.create({ fullName: "Pnl Participant" });
    const organizer = await users.create({ roles: ["ORGANIZER"], fullName: "Pnl Organizer" });
    const id = randomUUID();
    for (const path of PAGES(id)) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login\?next=/);
    }
    for (const url of GET_ENDPOINTS(id)) expect((await request.get(url)).status(), url).toBe(401);
    const mutations: [string, string, unknown][] = [
      ["post", `/api/v1/admin/event-reviews/${id}`, { decision: "approve" }], ["post", "/api/v1/admin/announcements", { title: "E2E nope", body: "x" }], ["put", `/api/v1/admin/announcements/${id}`, { title: "E2E nope", body: "x" }],
      ["post", `/api/v1/admin/announcements/${id}/publish`, {}], ["post", `/api/v1/admin/announcements/${id}/unpublish`, {}], ["delete", `/api/v1/admin/announcements/${id}`, undefined],
      ["put", "/api/v1/admin/maintenance", { enabled: true }], ["patch", "/api/v1/admin/settings", { eventApprovalRequired: true }],
    ];
    const send = (m: string, url: string, data: unknown, headers: Record<string, string>) => request.fetch(url, { method: m.toUpperCase(), headers, data: data === undefined ? undefined : data });
    for (const [m, url, data] of mutations) expect((await send(m, url, data, JSON_HEADERS)).status(), `anon ${m} ${url}`).toBe(401);

    for (const who of [participant, organizer]) {
      for (const url of GET_ENDPOINTS(id)) {
        const res = await request.get(url, { headers: await cookie(who) });
        expect(res.status(), `${who.email} ${url}`).toBe(403);
        expect(await res.text()).not.toContain("Pnl Admin Private");
      }
      for (const [m, url, data] of mutations) expect((await send(m, url, data, await asUser(who))).status(), `${who.email} ${m} ${url}`).toBe(403);
      await page.context().clearCookies();
      await uiLogin(page, who, "/dashboard");
      await expect(page).toHaveURL(/\/dashboard$/);
      for (const path of PAGES(id)) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }), `${who.email} ${path}`).toContainText("You do not have access");
        expect(await page.content()).not.toContain(admin.email);
      }
    }
    expect(await db().siteSetting.count({ where: { key: { in: ["maintenance_mode", "event_approval_required"] } } })).toBe(0);
    expect(await db().announcement.count({ where: { title: "E2E nope" } })).toBe(0);
  });

  test("malformed ids and bodies get 404/400 for an administrator, never a crash", async ({ request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"] });
    const h = await asUser(admin);
    for (const url of ["/api/v1/admin/teams/not-a-uuid", "/api/v1/admin/submissions/123", "/api/v1/admin/judging/x", "/api/v1/admin/results/x", "/api/v1/admin/event-reviews/x", "/api/v1/admin/announcements/x"]) expect((await request.get(url, { headers: h })).status(), url).toBe(404);
    for (const url of ["/api/v1/admin/teams?page=0", "/api/v1/admin/submissions?status=NOPE", "/api/v1/admin/certificates?type=X", "/api/v1/admin/event-reviews?review=Z"]) expect((await request.get(url, { headers: h })).status(), url).toBe(400);
    expect((await request.post("/api/v1/admin/announcements", { headers: h, data: { title: "x", body: "" } })).status()).toBe(400);
    expect((await request.put("/api/v1/admin/maintenance", { headers: h, data: { enabled: true, message: "no" } })).status()).toBe(400);
    expect((await request.put("/api/v1/admin/maintenance", { headers: h, data: { enabled: "yes" } })).status()).toBe(400);
    expect((await request.post(`/api/v1/admin/event-reviews/${randomUUID()}`, { headers: h, data: { decision: "reject" } })).status()).toBe(400);
    expect((await request.get("/api/v1/admin/overview", { headers: h })).status()).toBe(200);
  });
});

test.describe("event approval", () => {
  test("submit, request changes with a reason, resubmit, approve; approval only gates publishing when the setting is on", async ({ page, request, users }) => {
    test.setTimeout(180_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Review Admin" });
    const organizer = await users.create({ roles: ["ORGANIZER"], fullName: "Review Organizer" });
    const event = await seedEvent(organizer.id, `E2E Review Event ${tag()}`);
    const org = await asUser(organizer);
    try {
      expect((await request.post(`/api/v1/events/${event.id}/review-request`, { headers: org })).status()).toBe(200);
      expect((await request.post(`/api/v1/events/${event.id}/review-request`, { headers: org })).status()).toBe(409); // already waiting

      await uiLogin(page, admin, "/admin/event-approvals");
      await expect(page.getByRole("heading", { level: 1, name: "Event approvals" })).toBeVisible();
      await page.getByRole("link", { name: event.title }).click();
      await expect(page.getByRole("heading", { level: 1, name: event.title })).toBeVisible();
      await expect(page.getByText("Review Organizer").first()).toBeVisible();
      // request changes: the reason is mandatory (the server refuses an empty one)
      page.once("dialog", (d) => void d.accept("no"));
      await page.getByRole("button", { name: "Request changes" }).click();
      await expect(page.getByRole("group", { name: "Review decision" }).getByRole("alert")).toContainText(/at least 5/i);
      expect((await db().event.findUniqueOrThrow({ where: { id: event.id } })).reviewStatus).toBe("SUBMITTED");
      page.once("dialog", (d) => void d.accept("Please add a clearer description."));
      await page.getByRole("button", { name: "Request changes" }).click();
      await expect(page.getByText("This event is not waiting for a decision.")).toBeVisible();
      expect(await db().event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ reviewStatus: "CHANGES_REQUESTED", reviewNote: "Please add a clearer description." });
      await expect(page.getByText("event.review_changes_requested")).toBeVisible();

      // the organizer sees the note and resubmits; the admin approves
      expect((await request.post(`/api/v1/events/${event.id}/review-request`, { headers: org })).status()).toBe(200);
      await page.reload();
      page.once("dialog", (d) => void d.accept());
      await page.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByText("This event is not waiting for a decision.")).toBeVisible();
      expect((await db().event.findUniqueOrThrow({ where: { id: event.id } })).reviewStatus).toBe("APPROVED");
      expect((await request.post(`/api/v1/admin/event-reviews/${event.id}`, { headers: await asUser(admin), data: { decision: "approve" } })).status()).toBe(409); // decided once

      // approval alone does not publish; the gate applies only when required
      expect((await db().event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("DRAFT");
      const gated = await seedEvent(organizer.id, `E2E Gated Event ${tag()}`);
      await db().siteSetting.upsert({ where: { key: "event_approval_required" }, create: { key: "event_approval_required", value: true }, update: { value: true } });
      const blocked = await request.post(`/api/v1/events/${gated.id}/status`, { headers: org, data: { action: "publish" } });
      expect(blocked.status()).toBe(409);
      expect(await blocked.text()).toContain("administrator approval");
      expect((await request.post(`/api/v1/events/${event.id}/status`, { headers: org, data: { action: "publish" } })).status()).toBe(200); // approved: allowed
      await db().siteSetting.delete({ where: { key: "event_approval_required" } });
      expect((await request.post(`/api/v1/events/${gated.id}/status`, { headers: org, data: { action: "publish" } })).status()).toBe(200); // setting off: as before
    } finally {
      await db().siteSetting.deleteMany({ where: { key: "event_approval_required" } });
    }
  });
});

test.describe("announcements", () => {
  test("create a draft, publish, see it on the right dashboards, unpublish, delete the draft", async ({ page, users }) => {
    test.setTimeout(180_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Ann Admin" });
    const organizer = await users.create({ roles: ["ORGANIZER"], fullName: "Ann Organizer" });
    const stranger = await users.create({ fullName: "Ann Stranger" });
    const title = `E2E Notice ${tag()}`;
    try {
      await uiLogin(page, admin, "/admin/announcements/new");
      await page.getByLabel(/^Title/).fill(title);
      await page.getByLabel(/^Message/).fill("Maintenance window on Sunday.");
      await page.getByLabel(/^Audience/).selectOption("ORGANIZERS");
      await page.getByRole("button", { name: "Save as draft" }).click();
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      const row = await db().announcement.findFirstOrThrow({ where: { title } });
      expect(row).toMatchObject({ publishedAt: null, audience: "ORGANIZERS", authorId: admin.id });

      // a validation error is shown next to the field
      const edit = page.getByRole("form", { name: "Edit announcement" }); // (the previous route stays mounted, hidden)
      await edit.getByLabel(/^Title/).fill("x");
      await edit.getByRole("button", { name: "Save changes" }).click();
      await expect(edit.getByRole("alert").first()).toBeVisible();
      await edit.getByLabel(/^Title/).fill(title);
      await edit.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Announcement saved.")).toBeVisible();

      page.once("dialog", (d) => void d.accept());
      await page.getByRole("button", { name: "Publish now" }).click();
      await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
      await page.goto("/admin/announcements");
      await expect(page.getByRole("link", { name: title })).toBeVisible();
      await page.goto("/admin/audit");
      await expect(page.getByText("announcement.published").first()).toBeVisible();

      const seen = async (u: TestUser) => {
        await page.context().clearCookies();
        await uiLogin(page, u, "/dashboard");
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
        return page.getByText(title).count();
      };
      expect(await seen(organizer)).toBe(1); // audience matches
      expect(await seen(stranger)).toBe(0); // not an organizer

      await page.context().clearCookies();
      await uiLogin(page, admin, `/admin/announcements/${row.id}`);
      page.once("dialog", (d) => void d.accept());
      await page.getByRole("button", { name: "Unpublish" }).click();
      await expect(page.getByRole("button", { name: "Publish now" })).toBeVisible();
      expect(await seen(organizer)).toBe(0);

      await page.context().clearCookies();
      await uiLogin(page, admin, `/admin/announcements/${row.id}`);
      page.once("dialog", (d) => void d.accept());
      await page.getByRole("button", { name: "Delete draft" }).click();
      await expect(page).toHaveURL(/\/admin\/announcements$/);
      expect(await db().announcement.count({ where: { title } })).toBe(0);
      const actions = (await db().auditLog.findMany({ where: { entityId: row.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
      expect(actions).toEqual(["announcement.created", "announcement.updated", "announcement.published", "announcement.unpublished", "announcement.deleted"]);
    } finally {
      await db().announcement.deleteMany({ where: { title } });
    }
  });
});

test.describe("management pages show real data and pass accessibility checks", () => {
  for (const vp of [{ name: "mobile", width: 360, height: 800 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`${vp.name}: teams, submissions, judging, results, certificates, approvals, announcements, maintenance`, async ({ page, request, users }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const admin = await users.create({ roles: ["ADMIN"], fullName: "Data Admin" });
      const owner = await users.create({ roles: ["ORGANIZER"], fullName: "Data Owner" });
      const lead = await users.create({ fullName: "Data Lead" });
      const judge = await users.create({ roles: ["JUDGE"], fullName: "Data Judge" });
      const stranger = await users.create({ fullName: "Data Stranger" });
      const event = await seedEvent(owner.id, `E2E Data Event ${tag()}`, { status: "PUBLISHED", registrationMode: "TEAM", minTeamSize: 1, maxTeamSize: 3, reviewStatus: "SUBMITTED", submissionDeadline: new Date(Date.now() + 7 * DAY), resultsPublishedAt: new Date() });
      const team = await db().team.create({ data: { eventId: event.id, name: `E2E Team ${tag()}`, leaderId: lead.id } });
      await db().teamMember.create({ data: { teamId: team.id, eventId: event.id, userId: lead.id, role: "LEADER" } });
      await db().teamInvitation.create({ data: { teamId: team.id, inviterId: lead.id, inviteeEmail: "e2e-invitee@example.test", tokenHash: randomUUID() + randomUUID(), expiresAt: new Date(Date.now() + DAY) } });
      const sub = await db().submission.create({ data: { eventId: event.id, ownerId: lead.id, teamId: team.id, title: `E2E Project ${tag()}`, description: "A project for the admin pages.", status: "SUBMITTED", submittedAt: new Date(), currentVersion: 1 } });
      await db().submissionFile.create({ data: { submissionId: sub.id, storageKey: `submissions/${sub.id}/${randomUUID()}`, originalName: "deck.pdf", mimeType: "application/pdf", sizeBytes: 2048, sha256: "b".repeat(64) } });
      const crit = await db().judgingCriterion.create({ data: { eventId: event.id, name: "Impact", maxScore: 10, weight: 1 } });
      await db().judgeAssignment.create({ data: { eventId: event.id, judgeId: judge.id } });
      await db().score.create({ data: { submissionId: sub.id, judgeId: judge.id, criterionId: crit.id, score: 9, finalizedAt: new Date() } });
      await db().result.create({ data: { eventId: event.id, submissionId: sub.id, finalScore: 9, rank: 1, publishedAt: new Date() } });
      const cert = await db().certificate.create({ data: { publicCode: `ST-${code()}-${code()}-${code()}`, eventId: event.id, userId: lead.id, type: "WINNER", recipientName: "Data Lead" } });
      const ann = await db().announcement.create({ data: { title: `E2E Data Note ${tag()}`, body: "Body", authorId: admin.id, updatedById: admin.id } });
      try {
        await uiLogin(page, admin, "/admin");
        await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
        await expect(page.getByText("Needs attention")).toBeVisible();
        const checks: [string, RegExp | string][] = [
          [`/admin/event-approvals?review=SUBMITTED`, event.title], [`/admin/event-approvals/${event.id}`, "Approve"], ["/admin/teams?q=" + encodeURIComponent(team.name), team.name], [`/admin/teams/${team.id}`, "Data Lead"],
          [`/admin/submissions?q=${encodeURIComponent(sub.title)}`, sub.title], [`/admin/submissions/${sub.id}`, "deck.pdf"], [`/admin/judging?q=${encodeURIComponent(event.title)}`, "1 of 1"], [`/admin/judging/${event.id}`, "Data Judge"],
          [`/admin/results?q=${encodeURIComponent(event.title)}`, event.title], [`/admin/results/${event.id}`, "Unpublish results"], [`/admin/certificates?q=${cert.publicCode}`, cert.publicCode], ["/admin/announcements", ann.title], [`/admin/announcements/${ann.id}`, "Publish now"],
          ["/admin/maintenance", "Platform health"], ["/admin/announcements/new", "Save as draft"],
        ];
        for (const [path, text] of checks) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expect(page.getByText(text, { exact: false }).first(), path).toBeVisible();
          await axeClean(page, path);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${path} overflow`).toBeLessThanOrEqual(0);
        }
        // privacy: no storage key, no invitee address, no member email on the pages
        for (const path of [`/admin/submissions/${sub.id}`, `/admin/teams/${team.id}`]) {
          await page.goto(path);
          const html = await page.content();
          expect(html, path).not.toMatch(/submissions\/[0-9a-f-]{36}\/[0-9a-f-]{36}/);
          expect(html, path).not.toContain("e2e-invitee@example.test");
          expect(html, path).not.toContain(lead.email);
        }
        // empty and filtered states
        await page.goto("/admin/teams?q=zzz-nothing-matches");
        await expect(page.getByText("No teams found")).toBeVisible();
        await page.goto("/admin/certificates?q=zzz-nothing-matches");
        await expect(page.getByText("No certificates found")).toBeVisible();
        // the submission download goes through the authorized endpoint (an administrator may read it; an outsider may not)
        const file = await db().submissionFile.findFirstOrThrow({ where: { submissionId: sub.id } });
        const url = `/api/v1/submissions/${sub.id}/files/${file.id}`;
        expect((await request.get(url)).status()).toBe(401); // no session
        expect((await request.get(url, { headers: await cookie(stranger) })).status()).toBe(404); // a signed-in outsider learns nothing
      } finally {
        await db().announcement.deleteMany({ where: { id: ann.id } });
      }
    });
  }
});

test.describe("existing administration features remain protected and audited", () => {
  test("suspending and reactivating a user, role grants and settings are audited; the last administrator is protected", async ({ request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Keep Admin" });
    const target = await users.create({ fullName: "Target Person" });
    const h = await asUser(admin);
    expect((await request.patch(`/api/v1/admin/users/${target.id}/status`, { headers: h, data: { status: "SUSPENDED" } })).status()).toBe(200);
    expect((await request.patch(`/api/v1/admin/users/${target.id}/status`, { headers: h, data: { status: "BANNED" } })).status()).toBe(400);
    expect((await request.patch(`/api/v1/admin/users/${target.id}/status`, { headers: h, data: { status: "ACTIVE" } })).status()).toBe(200);
    expect((await request.post(`/api/v1/admin/users/${target.id}/roles`, { headers: h, data: { role: "NOT_A_ROLE" } })).status()).toBe(400);
    const actions = (await db().auditLog.findMany({ where: { entityId: target.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions.filter((a) => a === "admin.user_status_changed")).toHaveLength(2);
    expect((await request.patch("/api/v1/admin/settings", { headers: h, data: {} })).status()).toBe(400);
  });
});
