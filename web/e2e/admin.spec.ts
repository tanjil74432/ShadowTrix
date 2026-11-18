import { portraitPng } from "./helpers/portrait";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { COOKIE, JSON_HEADERS, ORIGIN, PASSWORD, createRawSession, db, expect, post, test, uiLogin, type TestUser } from "./helpers/fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DAY = 86_400_000;
const tag = () => randomUUID().slice(0, 6);
const asUser = async (u: TestUser, extra: Record<string, string> = {}) => ({ ...JSON_HEADERS, ...extra, Cookie: `${COOKIE}=${await createRawSession(u.id)}` });
const cookieOnly = async (u: TestUser) => ({ Cookie: `${COOKIE}=${await createRawSession(u.id)}` });
const PNG = portraitPng(); // a real, decodable image: the member is public while other specs browse the site, and a broken image there would be a real defect

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}
const acceptDialog = (page: Page) => page.once("dialog", (d) => void d.accept());

async function seedEvent(ownerId: string, title: string, status: "DRAFT" | "PUBLISHED" = "PUBLISHED") {
  const now = Date.now();
  return db().event.create({
    data: {
      slug: `e2e-adm-${tag()}`, title, category: "SUMMIT", summary: "Summary of an admin test event.", description: "Description that is long enough for the event.", status, createdById: ownerId,
      registrationOpensAt: new Date(now - DAY), registrationClosesAt: new Date(now + 5 * DAY), startsAt: new Date(now + 6 * DAY), endsAt: new Date(now + 8 * DAY),
      organizers: { create: { userId: ownerId, isLead: true } },
    },
  });
}

test.describe("administration access", () => {
  test("only administrators reach any admin page or endpoint; everyone else is refused without data", async ({ page, request, users }) => {
    test.setTimeout(180_000); // many pages are visited as three different kinds of user
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Ada Admin" });
    const participant = await users.create({ fullName: "Pat Participant" });
    const organizer = await users.create({ roles: ["ORGANIZER"] });
    const paths = ["/admin", "/admin/users", `/admin/users/${participant.id}`, "/admin/events", "/admin/organizations", "/admin/leadership", "/admin/analytics", "/admin/audit", "/admin/settings"];

    // anonymous: redirected to login for every page, 401 for every endpoint
    for (const path of paths) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login\?next=/);
    }
    for (const url of ["/api/v1/admin/analytics", "/api/v1/admin/audit", "/api/v1/admin/events", "/api/v1/admin/organizations", "/api/v1/admin/settings", "/api/v1/admin/leadership", "/api/v1/admin/members", `/api/v1/admin/users/${participant.id}`]) {
      expect((await request.get(url)).status(), url).toBe(401);
    }

    // participants and organizers: access denied page, never the data; endpoints 403
    for (const who of [participant, organizer]) {
      await page.context().clearCookies();
      await uiLogin(page, who, "/dashboard");
      await expect(page).toHaveURL(/\/dashboard$/);
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }), `${who.email} ${path}`).toContainText("You do not have access");
        const html = await page.content();
        expect(html).not.toContain(admin.email);
        expect(html).not.toContain("Ada Admin");
      }
      for (const url of ["/api/v1/admin/analytics", "/api/v1/admin/audit", "/api/v1/admin/events", "/api/v1/admin/organizations", "/api/v1/admin/settings", "/api/v1/admin/leadership", "/api/v1/admin/members", `/api/v1/admin/users/${admin.id}`]) {
        expect((await request.get(url, { headers: await cookieOnly(who) })).status(), url).toBe(403);
      }
      const writes: [string, unknown][] = [
        ["/api/v1/admin/organizations", { name: "E2E Hijack Org" }], ["/api/v1/admin/members", { fullName: "E2E Hijack Person" }], ["/api/v1/admin/leadership/units", { name: "E2E Hijack Unit" }],
        ["/api/v1/admin/leadership/designations", { title: "E2E Hijack" }], ["/api/v1/admin/leadership/terms", { label: "E2E Hijack", startsOn: "2040-01-01" }],
      ];
      for (const [url, body] of writes) expect((await post(request, url, body, await asUser(who))).status(), url).toBe(403);
      expect((await request.patch("/api/v1/admin/settings", { headers: await asUser(who), data: { signupsEnabled: false } })).status()).toBe(403);
      expect((await post(request, `/api/v1/admin/events/${randomUUID()}/organizers`, { email: who.email }, await asUser(who))).status()).toBe(403);
    }
    expect(await db().organization.count({ where: { name: { startsWith: "E2E Hijack" } } })).toBe(0);
    expect(await db().orgMember.count({ where: { fullName: { startsWith: "E2E Hijack" } } })).toBe(0);
    // CSRF: even an administrator's session is refused from another origin
    expect((await post(request, "/api/v1/admin/organizations", { name: "E2E Forged" }, await asUser(admin, { Origin: "https://evil.example" }))).status()).toBe(403);
    expect(await db().organization.count({ where: { name: "E2E Forged" } })).toBe(0);

    // the administrator sees everything
    await page.context().clearCookies();
    await uiLogin(page, admin, "/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
    for (const path of paths.slice(1, 5)) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).not.toContainText("You do not have access");
    }
  });
});

test.describe("user management", () => {
  test("search, details, suspend and reactivate, role changes, activity history", async ({ page, request, users }) => {
    test.setTimeout(120_000); // real Argon2 logins and many page loads: about 21 s alone, so 60 s is too tight on a shared machine
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Ada Admin" });
    const target = await users.create({ fullName: `Target ${tag()}` });
    await db().auditLog.create({ data: { actorId: target.id, action: "auth.login", entityType: "user", entityId: target.id, after: { passwordHash: "LEAKED-HASH", fine: 1 } } });
    const targetSession = await createRawSession(target.id);

    await uiLogin(page, admin, "/admin/users");
    await page.getByRole("searchbox", { name: "Search by name or email" }).fill(target.email);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("row", { name: new RegExp(target.email) })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "1 user" })).toBeVisible();
    await page.getByRole("link", { name: target.fullName }).click();

    await expect(page.getByRole("heading", { level: 1, name: target.fullName })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByText("auth.login")).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("LEAKED-HASH");
    expect(html).not.toMatch(/argon2/i); // the hash value is hidden (only its key name is shown)

    // suspend: sessions end at once and login is blocked; reactivate restores access
    acceptDialog(page);
    await page.getByRole("button", { name: "Suspend account" }).click();
    await expect(page.getByRole("button", { name: "Reactivate account" })).toBeVisible();
    expect((await request.get("/api/v1/auth/me", { headers: { Cookie: `${COOKIE}=${targetSession}` } })).status()).toBe(401);
    expect((await post(request, "/api/v1/auth/login", { email: target.email, password: PASSWORD })).status()).toBe(403);
    await page.getByRole("button", { name: "Reactivate account" }).click();
    await expect(page.getByRole("button", { name: "Suspend account" })).toBeVisible();
    expect((await post(request, "/api/v1/auth/login", { email: target.email, password: PASSWORD })).status()).toBe(200);

    // roles
    await page.getByRole("button", { name: "Grant judge" }).click();
    await expect(page.getByRole("button", { name: "Remove judge" })).toBeVisible();
    expect(await db().userRoleAssignment.count({ where: { userId: target.id, role: "JUDGE", eventId: null } })).toBe(1);
    acceptDialog(page);
    await page.getByRole("button", { name: "Remove judge" }).click();
    await expect(page.getByRole("button", { name: "Grant judge" })).toBeVisible();
    expect(await db().auditLog.count({ where: { entityId: target.id, action: { startsWith: "admin." } } })).toBeGreaterThanOrEqual(3);

    // safeguards still hold: an administrator cannot demote or suspend themselves
    await page.goto(`/admin/users/${admin.id}`);
    acceptDialog(page);
    await page.getByRole("button", { name: "Suspend account" }).click();
    await expect(page.getByText(/cannot suspend yourself|suspend your own/i)).toBeVisible();
    await page.goto("/admin/users?q=%00%27%3B--");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible(); // injection attempts are inert
  });
});

test.describe("event and organization management", () => {
  test("lists all events including drafts, manages organizers and hosts, cancels and archives", async ({ page, users }) => {
    const admin = await users.create({ roles: ["ADMIN"] });
    const owner = await users.create({ roles: ["ORGANIZER"], fullName: "Olga Owner" });
    const extra = await users.create({ fullName: "Eve Extra" });
    const title = `Admin Managed ${tag()}`;
    const live = await seedEvent(owner.id, title);
    const draft = await seedEvent(owner.id, `Admin Draft ${tag()}`, "DRAFT");
    const hostOrg = await db().organization.create({ data: { slug: `e2e-host-${tag()}`, name: `E2E Host ${tag()}`, type: "UNIVERSITY" } });

    await uiLogin(page, admin, "/admin/events");
    await page.getByRole("searchbox", { name: "Search" }).fill("Admin");
    await page.getByLabel("Status").selectOption("DRAFT");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("link", { name: draft.title })).toBeVisible();
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);

    await page.goto(`/admin/events/${live.id}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await page.getByLabel(/^Email address of a confirmed account/).first().fill(extra.email);
    await page.getByRole("button", { name: "Add organizer" }).click();
    await expect(page.getByText("Organizer added.")).toBeVisible();
    await expect(page.getByText("Eve Extra")).toBeVisible();
    expect(await db().userRoleAssignment.count({ where: { userId: extra.id, role: "ORGANIZER", eventId: live.id } })).toBe(1);
    acceptDialog(page);
    await page.getByRole("listitem").filter({ hasText: "Eve Extra" }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Eve Extra")).toHaveCount(0);
    // the only remaining organizer cannot be removed
    acceptDialog(page);
    await page.getByRole("listitem").filter({ hasText: "Olga Owner" }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText(/needs at least one organizer/)).toBeVisible();

    await page.locator('select[name="organizationId"]').selectOption({ label: hostOrg.name });
    await page.getByRole("button", { name: "Save host" }).click();
    await expect(page.getByText(hostOrg.name).first()).toBeVisible();
    expect(await db().eventHost.count({ where: { eventId: live.id, organizationId: hostOrg.id } })).toBe(1);

    acceptDialog(page);
    await page.getByRole("button", { name: "Cancel event" }).click();
    await expect(page.getByRole("button", { name: "Cancel event" })).toHaveCount(0);
    expect((await db().event.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("CANCELLED");
    acceptDialog(page);
    await page.getByRole("button", { name: "Archive event" }).click();
    await expect(page.getByText("Archived events are final.")).toBeVisible();
    expect(await db().auditLog.count({ where: { entityId: live.id, action: { startsWith: "admin.event_" } } })).toBeGreaterThanOrEqual(3);
    await db().organization.delete({ where: { id: hostOrg.id } }).catch(() => undefined);
  });

  test("organizations: create, verify, representatives, protection of the operator, hostile input", async ({ page, request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"] });
    const rep = await users.create({ fullName: "Ray Rep" });
    const name = `E2E Org ${tag()}`;
    await uiLogin(page, admin, "/admin/organizations");
    await expect(page.getByText("Platform operator").first()).toBeVisible();
    await page.getByLabel(/^Name/).fill(name);
    await page.getByLabel(/^Website/).fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Add organization" }).click();
    await expect(page.getByText("Enter a full link that starts with https://")).toBeVisible();
    await page.getByLabel(/^Website/).fill("https://org.example.com");
    await page.getByRole("button", { name: "Add organization" }).click();
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.getByRole("button", { name: "Mark as verified" }).click();
    await expect(page.getByRole("button", { name: "Clear verification" })).toBeVisible();
    await page.getByLabel(/^Email address of a confirmed account/).fill(rep.email);
    await page.getByRole("button", { name: "Add representative" }).click();
    await expect(page.getByText("Ray Rep")).toBeVisible();
    acceptDialog(page);
    await page.getByRole("button", { name: "Delete organization" }).click();
    await expect(page).toHaveURL(/\/admin\/organizations$/);
    expect(await db().organization.count({ where: { name } })).toBe(0);

    // the operator cannot be deleted, markup in names is rejected, and the API rejects unknown people
    const operator = await db().organization.findFirstOrThrow({ where: { isOperator: true } });
    expect((await request.delete(`/api/v1/admin/organizations/${operator.id}`, { headers: await asUser(admin) })).status()).toBe(409);
    expect((await post(request, "/api/v1/admin/organizations", { name: "<img src=x onerror=alert(1)>" }, await asUser(admin))).status()).toBe(400);
    expect((await post(request, `/api/v1/admin/organizations/${operator.id}/representatives`, { email: "nobody@example.test" }, await asUser(admin))).status()).toBe(404);
  });
});

test.describe("leadership, photos and the public team page", () => {
  test("members stay private until verified and published; contact details, photos and former members follow the rules", async ({ page, request, users, browser }) => {
    test.setTimeout(120_000); // many real Argon2 logins and page loads: about 30 s alone, so the default 60 s is too tight on a shared machine
    // The "Saved." notice stays on screen after the first save, so wait for each save request itself.
    const saveProfile = async (p: Page) => {
      await Promise.all([p.waitForResponse((r) => /\/api\/v1\/admin\/members\/[0-9a-f-]+$/.test(r.url()) && r.request().method() === "PATCH"), p.getByRole("button", { name: "Save profile" }).click()]);
    };
    const admin = await users.create({ roles: ["ADMIN"] });
    const name = `E2E Member ${tag()}`;
    const unitName = `E2E Unit ${tag()}`;
    const designation = `E2E Lead ${tag()}`;

    await uiLogin(page, admin, "/admin/leadership");
    await expect(page.getByRole("heading", { level: 1, name: /Leadership/ })).toBeVisible();
    // reference data: a unit and a designation (the seeded ones are never touched)
    await page.getByLabel(/^Name/).last().fill(unitName);
    await page.getByRole("button", { name: "Add unit" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: unitName })).toBeVisible();
    await page.getByLabel(/^Title/).fill(designation);
    await page.getByRole("button", { name: "Add designation" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: designation })).toBeVisible();

    // a new member is an unpublished placeholder
    await page.getByLabel(/^Full name/).fill(name);
    await page.getByRole("button", { name: /Add member/ }).click();
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Placeholder").first()).toBeVisible();

    // publishing a placeholder is refused
    await page.getByLabel(/^Visibility/).selectOption("PUBLISHED");
    await page.getByLabel(/^Contact email/).fill("e2e-public@example.test");
    await page.getByLabel("Show the contact email publicly").check();
    await page.getByLabel(/^Bio/).fill("A real bio for the test member.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText(/verified/).first()).toBeVisible();
    const memberId = (await db().orgMember.findFirstOrThrow({ where: { fullName: name } })).id;
    expect((await db().orgMember.findUniqueOrThrow({ where: { id: memberId } })).visibility).toBe("DRAFT");

    // position and photo
    await page.locator('select[name="unitId"]:visible').selectOption({ label: unitName });
    await page.locator('select[name="designationId"]:visible').selectOption({ label: designation });
    await page.getByRole("button", { name: "Add position" }).click();
    await expect(page.getByText(`${designation}, ${unitName}`)).toBeVisible();
    await page.getByLabel(/^Profile photo/).setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg onload=alert(1)>") });
    await page.getByRole("button", { name: "Upload photo" }).click();
    await expect(page.getByText(/Files of this type are not allowed/)).toBeVisible(); // the server's specific refusal (the field hint also contains "PNG or JPEG", so that text alone proves nothing)
    await page.getByLabel(/^Profile photo/).setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Upload photo" }).click();
    await expect(page.getByText("Photo saved.")).toBeVisible();

    // public visitor: nothing yet (still unverified and unpublished); the photo is private too
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto("/about/team");
    await expect(visitor.getByText(name)).toHaveCount(0);
    expect((await request.get(`/api/v1/org-members/${memberId}/photo`)).status()).toBe(404);

    // verify and publish
    await page.getByLabel(/^Placeholder/).uncheck();
    await page.getByLabel(/^Visibility/).selectOption("PUBLISHED");
    await saveProfile(page);
    await visitor.goto("/about/team");
    await expect(visitor.getByRole("heading", { level: 1, name: "Our Team" })).toBeVisible();
    await expect(visitor.getByRole("heading", { name })).toBeVisible();
    await expect(visitor.getByText(designation).first()).toBeVisible();
    await expect(visitor.getByRole("link", { name: "e2e-public@example.test" })).toBeVisible();
    await expect(visitor.getByRole("img", { name: `Photo of ${name}` })).toBeVisible();
    const photo = await request.get(`/api/v1/org-members/${memberId}/photo`);
    expect(photo.status()).toBe(200);
    expect(photo.headers()["content-type"]).toBe("image/png");
    expect(photo.headers()["x-content-type-options"]).toBe("nosniff");
    await axeCleanPublic(visitor);

    // hide the email: it disappears from the public page
    await page.getByLabel("Show the contact email publicly").uncheck();
    await saveProfile(page);
    await visitor.reload();
    await expect(visitor.getByRole("link", { name: "e2e-public@example.test" })).toHaveCount(0);
    expect(await visitor.content()).not.toContain("e2e-public@example.test");

    // archive: the person moves to the former-members archive
    acceptDialog(page);
    await page.getByRole("button", { name: "Archive" }).first().click();
    await expect(page.getByText("Archived").first()).toBeVisible();
    await page.locator('select[name="status"]:visible').selectOption("FORMER");
    await saveProfile(page);
    await visitor.reload();
    await expect(visitor.getByRole("heading", { name: "Former members" })).toBeVisible();
    await expect(visitor.getByRole("heading", { name })).toBeVisible();

    // unpublishing removes the person and the photo from public view again
    await page.getByLabel(/^Visibility/).selectOption("DRAFT");
    await saveProfile(page);
    await visitor.reload();
    await expect(visitor.getByText(name)).toHaveCount(0);
    expect((await request.get(`/api/v1/org-members/${memberId}/photo`)).status()).toBe(404);
    expect((await request.get(`/api/v1/org-members/${memberId}/photo`, { headers: await cookieOnly(admin) })).status()).toBe(200);
    await visitor.context().close();

    // cleanup of what this test created
    await db().orgMember.deleteMany({ where: { fullName: name } });
    await db().orgUnit.deleteMany({ where: { name: unitName } });
    await db().designation.deleteMany({ where: { title: designation } });
  });
});

async function axeCleanPublic(page: Page) {
  await axeClean(page, "public team page");
}

test.describe("analytics, audit log and settings", () => {
  test("analytics show real numbers with a date filter and reject bad ranges", async ({ page, request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"] });
    const a = await users.create();
    const total = await db().user.count();
    await uiLogin(page, admin, "/admin/analytics");
    await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
    await expect(page.getByText("Total users")).toBeVisible();
    await expect(page.getByRole("figure").filter({ hasText: "Registrations per day" })).toBeVisible();

    const api = await request.get("/api/v1/admin/analytics?from=2020-03-01&to=2020-03-10", { headers: await cookieOnly(admin) });
    expect(api.status()).toBe(200);
    const data = await api.json();
    expect(data.range).toMatchObject({ from: "2020-03-01", to: "2020-03-10", days: 10 });
    expect(data.registrations.series).toHaveLength(10);
    expect(data.users.total).toBeGreaterThanOrEqual(total - 5); // other tests create users concurrently; the count is a real, current figure
    expect(data.users.total).toBeGreaterThanOrEqual(2);
    expect(a.id).toBeTruthy();
    for (const bad of ["from=2030-02-01&to=2030-01-01", "from=2000-01-01&to=2030-01-01", "from=not-a-date", "to=31/12/2030"]) {
      expect((await request.get(`/api/v1/admin/analytics?${bad}`, { headers: await cookieOnly(admin) })).status(), bad).toBe(400);
    }
    await page.goto("/admin/analytics?from=2030-02-01&to=2030-01-01");
    await expect(page.locator('p[role="alert"]')).toContainText("before the end date");
    await page.goto("/admin/analytics?from=2020-03-01&to=2020-03-10");
    await expect(page.getByRole("status").filter({ hasText: "Range: 2020-03-01 to 2020-03-10 (10 days)" })).toBeVisible();
  });

  test("the audit log filters, links people, and never shows secrets; the settings page hides every secret", async ({ page, request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Audrey Auditor" });
    const marker = `e2e.marker.${tag()}`;
    await db().auditLog.create({ data: { actorId: admin.id, action: marker, entityType: "test", entityId: "x", after: { resetToken: "LEAKED-TOKEN", visible: "yes" } } });
    await uiLogin(page, admin, "/admin/audit");
    await expect(page.getByRole("heading", { level: 1, name: /Audit and security/ })).toBeVisible();
    await page.getByLabel("Action starts with").fill(marker);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("row", { name: new RegExp(marker) })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("LEAKED-TOKEN");
    expect(html).toContain("[hidden]");
    await page.getByRole("link", { name: "Security events" }).click();
    await expect(page.getByRole("link", { name: "Security events" })).toHaveAttribute("aria-current", "page");
    expect((await request.get("/api/v1/admin/audit?pageSize=5000", { headers: await cookieOnly(admin) })).status()).toBe(400);

    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByText(/New account registration is currently/)).toBeVisible();
    const settings = await page.content();
    const api = JSON.stringify(await (await request.get("/api/v1/admin/settings", { headers: await cookieOnly(admin) })).json());
    for (const secret of [process.env.E2E_CRON_SECRET ?? "x-never", process.env.DATABASE_URL ?? "x-never", ORIGIN.replace("http://", "") + "/secret"]) {
      expect(settings).not.toContain(secret);
      expect(api).not.toContain(secret);
    }
    expect(api).not.toMatch(/AUTH_SECRET|SMTP_PASSWORD|DATABASE_URL|S3_SECRET/);
    expect(JSON.parse(api)).toMatchObject({ cleanupEndpointEnabled: true, storage: { driver: "local", implemented: true } });
    await db().auditLog.deleteMany({ where: { action: marker } });
  });
});

test.describe("accessibility of the administration area", () => {
  for (const vp of [{ name: "mobile", width: 360, height: 800 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`${vp.name}: every admin page has no WCAG 2.2 AA violations or overflow`, async ({ page, users }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const noOverflow = async (label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${label} overflow`).toBeLessThanOrEqual(0);
      const admin = await users.create({ roles: ["ADMIN"], fullName: "Axe Admin" });
      const owner = await users.create({ roles: ["ORGANIZER"] });
      const event = await seedEvent(owner.id, `Axe Admin Event ${tag()}`);
      const member = await db().orgMember.create({ data: { slug: `e2e-axe-${tag()}`, fullName: `E2E Axe ${tag()}` } });
      const org = await db().organization.create({ data: { slug: `e2e-axe-${tag()}`, name: `E2E Axe Org ${tag()}` } });
      await uiLogin(page, admin, "/admin");
      await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
      for (const path of ["/admin", "/admin/users", `/admin/users/${owner.id}`, "/admin/events", `/admin/events/${event.id}`, "/admin/organizations", `/admin/organizations/${org.id}`, "/admin/leadership", `/admin/leadership/members/${member.id}`, "/admin/analytics", "/admin/audit", "/admin/settings", "/admin/audit?view=security"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
        await noOverflow(path);
      }
      await page.goto("/about/team");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeClean(page, "/about/team");
      await db().orgMember.delete({ where: { id: member.id } });
      await db().organization.delete({ where: { id: org.id } });
    });
  }
});
