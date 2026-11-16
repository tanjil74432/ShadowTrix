import { randomUUID } from "node:crypto";
import { COOKIE, JSON_HEADERS, createRawSession, db, expect, test, uiLogin, uniqueEmail, type TestUser } from "./helpers/fixtures";

/**
 * Maintenance mode is a PLATFORM-WIDE switch, so this file runs in its own Playwright project (`chromium-global-state`) after the rest
 * of the suite: while it is on, every public write is refused, which would break unrelated tests running at the same time.
 */
const asUser = async (u: TestUser) => ({ ...JSON_HEADERS, Cookie: `${COOKIE}=${await createRawSession(u.id)}` });

test.describe("maintenance mode", () => {
  test("administrator switches it on and off in the UI; the public is paused, administrators and sign-in keep working", async ({ page, request, users }) => {
    test.setTimeout(180_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Maint Admin" });
    const person = await users.create({ fullName: "Maint Person" });
    const message = `Planned upgrade ${randomUUID().slice(0, 6)}, back soon.`;
    try {
      await uiLogin(page, admin, "/admin/maintenance");
      await expect(page.getByRole("heading", { level: 1, name: "Maintenance" })).toBeVisible();
      await expect(page.getByText("Connected")).toBeVisible(); // database health
      await expect(page.getByRole("heading", { name: "Platform health" })).toBeVisible();
      expect(await page.content()).not.toMatch(/AUTH_SECRET|DATABASE_URL|S3_SECRET|SMTP_PASSWORD/);

      // a too-short message is refused with a field error
      page.once("dialog", (d) => void d.accept());
      await page.getByLabel(/^Message shown/).fill("no");
      await page.getByRole("button", { name: "Turn maintenance mode on" }).click();
      await expect(page.getByRole("form", { name: "Maintenance message" }).getByRole("alert")).toContainText(/at least 5/i);
      expect(await db().siteSetting.count({ where: { key: "maintenance_mode" } })).toBe(0);

      // declining the confirmation does nothing; accepting turns it on
      page.once("dialog", (d) => void d.dismiss());
      await page.getByLabel(/^Message shown/).fill(message);
      await page.getByRole("button", { name: "Turn maintenance mode on" }).click();
      expect(await db().siteSetting.count({ where: { key: "maintenance_mode" } })).toBe(0);
      page.once("dialog", (d) => void d.accept());
      await page.getByRole("button", { name: "Turn maintenance mode on" }).click();
      await expect(page.getByRole("button", { name: "Turn maintenance mode off" })).toBeVisible();
      await expect(page.getByText("On (read-only)")).toBeVisible();

      // public writes are paused (503 with the message); reads, sign-in and administration are not
      const paused = await request.post("/api/v1/auth/forgot-password", { headers: JSON_HEADERS, data: { email: uniqueEmail("m") } });
      expect(paused.status()).toBe(503);
      expect(paused.headers()["retry-after"]).toBe("300");
      expect(await paused.text()).toContain(message);
      expect((await request.post("/api/v1/auth/register", { headers: JSON_HEADERS, data: { email: uniqueEmail("m") } })).status()).toBe(503);
      expect((await request.get("/api/v1/events")).status()).toBe(200);
      const personHeaders = await asUser(person);
      expect((await request.post("/api/v1/auth/logout", { headers: personHeaders })).status()).not.toBe(503);
      expect((await request.get("/api/v1/admin/overview", { headers: await asUser(admin) })).status()).toBe(200);
      expect((await request.post("/api/v1/auth/login", { headers: JSON_HEADERS, data: { email: person.email, password: "wrong password here" } })).status()).toBe(401); // reaches the login check

      // a banner shows on public pages
      await page.goto("/events");
      await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();

      // administrators can turn it off again (no lock-out)
      await page.goto("/admin/maintenance");
      await page.getByRole("button", { name: "Turn maintenance mode off" }).click();
      await expect(page.getByRole("button", { name: "Turn maintenance mode on" })).toBeVisible();
      await expect(page.getByText("Off", { exact: true })).toBeVisible();
      expect((await request.post("/api/v1/auth/forgot-password", { headers: JSON_HEADERS, data: { email: uniqueEmail("m") } })).status()).not.toBe(503);

      const rows = await db().auditLog.findMany({ where: { action: "maintenance.mode_changed", actorId: admin.id }, orderBy: { createdAt: "asc" } });
      expect(rows.map((r) => (r.after as { enabled: boolean }).enabled)).toEqual([true, false]);
      await page.reload();
      await expect(page.getByText("maintenance mode turned on")).toBeVisible(); // history
    } finally {
      await db().siteSetting.deleteMany({ where: { key: "maintenance_mode" } });
    }
  });

  test("only an administrator can change it", async ({ request, users }) => {
    const participant = await users.create({ fullName: "Maint Nobody" });
    expect((await request.put("/api/v1/admin/maintenance", { headers: await asUser(participant), data: { enabled: true } })).status()).toBe(403);
    expect((await request.put("/api/v1/admin/maintenance", { headers: JSON_HEADERS, data: { enabled: true } })).status()).toBe(401);
    expect(await db().siteSetting.count({ where: { key: "maintenance_mode" } })).toBe(0);
  });
});
