import path from "node:path";
import { expect, test, uiLogin, uniqueEmail } from "./helpers/fixtures";

/**
 * Captures documentation screenshots of the account screens. Skipped unless SCREENSHOTS=1, so normal runs are unaffected:
 *   SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
 */
test.skip(!process.env.SCREENSHOTS, "documentation screenshots only");
const OUT = path.resolve(__dirname, "../../docs/design/screenshots");

test("account screens", async ({ page, users }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const shot = (name: string, full = false) => page.screenshot({ path: path.join(OUT, `m4-${name}.png`), fullPage: full });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot("login-desktop");

  await page.goto("/register");
  await page.getByLabel(/^Full name/).fill("Ada Lovelace");
  await page.getByLabel(/^Email address/).fill("not-an-email");
  await page.getByLabel(/^Password/).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await shot("register-errors-desktop");

  await page.goto("/forgot-password");
  await page.getByLabel(/^Email address/).fill(uniqueEmail("shot"));
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await shot("forgot-sent-desktop");

  const participant = await users.create({ fullName: "Ada Lovelace" });
  await uiLogin(page, participant);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
  await shot("dashboard-desktop");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("You do not have access");
  await shot("access-denied-desktop");

  await page.context().clearCookies();
  const admin = await users.create({ roles: ["ADMIN"], fullName: "Grace Hopper" });
  await uiLogin(page, admin, "/admin");
  await expect(page.getByRole("table")).toBeVisible();
  await shot("admin-desktop");

  await page.context().clearCookies();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot("login-mobile");
  await uiLogin(page, participant);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome"); // wait for the streamed content
  await shot("dashboard-mobile");
});
