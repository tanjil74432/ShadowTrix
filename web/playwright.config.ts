import "dotenv/config";
import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3011; // separate from the dev port (3010) so tests never collide with a running dev server
export const E2E_ORIGIN = `http://localhost:${PORT}`;
// Shared with the test workers (they inherit this process's environment) so the cleanup endpoint can be tested.
// (The config is evaluated again inside every worker, so keep the value the main process already generated.)
process.env.E2E_CRON_SECRET ??= randomBytes(24).toString("hex");

export default defineConfig({
  testDir: "./e2e",
  // Sweep the reserved test-account namespace before and after the run (interrupted runs cannot leave data behind).
  globalSetup: "./e2e/global-cleanup.ts",
  globalTeardown: "./e2e/global-cleanup.ts",
  fullyParallel: true,
  // Every login costs a deliberate 64 MiB Argon2 computation and the tests share a machine with the server,
  // so keep concurrency modest and budgets realistic.
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 }, // a shared machine, a production server and 64 MiB Argon2 hashes: 10 s was occasionally too tight under two workers
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // In CI the "github" reporter turns failures into annotations that are visible on the run without log access.
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
  },
  /**
   * `chromium` is the full suite (the installed Microsoft Edge locally, Playwright's Chromium in CI). The `x-*` projects run
   * only the cross-browser journeys (e2e/cross-browser.spec.ts) in Chromium, Firefox and WebKit at desktop, tablet and phone
   * sizes: `npm run test:e2e:cross` (needs `npx playwright install firefox webkit`).
   */
  projects: [
    { name: "chromium", testIgnore: /cross-browser\.spec\.ts/, use: { channel: process.env.CI ? undefined : "msedge" } },
    { name: "x-chromium-desktop", testMatch: /cross-browser\.spec\.ts/, use: { ...devices["Desktop Chrome"], channel: process.env.CI ? undefined : "msedge" } },
    { name: "x-firefox-desktop", testMatch: /cross-browser\.spec\.ts/, use: { ...devices["Desktop Firefox"] } },
    { name: "x-webkit-desktop", testMatch: /cross-browser\.spec\.ts/, use: { ...devices["Desktop Safari"] } },
    { name: "x-webkit-tablet", testMatch: /cross-browser\.spec\.ts/, use: { ...devices["iPad (gen 7)"] } },
    { name: "x-webkit-phone", testMatch: /cross-browser\.spec\.ts/, use: { ...devices["iPhone 13"] } },
    { name: "x-chromium-phone", testMatch: /cross-browser\.spec\.ts/, use: { ...devices["Pixel 7"], channel: process.env.CI ? undefined : "msedge" } },
  ],
  // Tests run against a production build made with the SAME environment as the server that serves it
  // (APP_URL is baked into the prerendered metadata, so build and runtime values must agree).
  // Requires PostgreSQL (migrated) and Mailpit.
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: E2E_ORIGIN,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      ENABLE_STYLEGUIDE: "true",
      // Links in emails and the CSRF origin check must match the server the tests talk to.
      APP_URL: E2E_ORIGIN,
      // A fresh random secret per run: nothing predictable, nothing committed.
      AUTH_SECRET: randomBytes(48).toString("base64url"),
      TRUST_PROXY: "false",
      CRON_SECRET: process.env.E2E_CRON_SECRET,
      // Uploaded files of the e2e server go to a throwaway directory that the global cleanup removes.
      STORAGE_LOCAL_DIR: ".e2e-storage",
    },
  },
});
