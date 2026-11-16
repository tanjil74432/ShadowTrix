import { expect, test } from "./helpers/fixtures";

/**
 * When the server cannot deliver mail it answers 503 email_unavailable (see tests/email-config.test.ts for the server rules). The pages must
 * show that clearly and must NOT show the usual "check your email" success screen, which would be a lie.
 */
const UNAVAILABLE = { error: { code: "email_unavailable", message: "Email delivery is not available right now. Please try again later or contact the administrator." } };

for (const [path, api, button] of [
  ["/register", "/api/v1/auth/register", /continue|create|register|send/i],
  ["/forgot-password", "/api/v1/auth/forgot-password", /send|reset|continue/i],
] as const) {
  test(`${path}: a 503 email_unavailable is shown as an error, not as success`, async ({ page }) => {
    await page.route(`**${api}`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify(UNAVAILABLE) }));
    await page.goto(path);
    await page.getByLabel(/email/i).first().fill("someone@example.com");
    await page.getByRole("button", { name: button }).first().click();
    await expect(page.getByText("Email delivery is not available right now.")).toBeVisible();
    await expect(page.getByText(/check your (email|inbox)/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: button }).first()).toBeEnabled(); // the user can try again
  });
}
