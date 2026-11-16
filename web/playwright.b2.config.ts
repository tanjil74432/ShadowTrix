/**
 * Real-browser test of direct uploads to the PRIVATE Backblaze bucket. Run from web/ (after the bucket's CORS rule exists):
 *   B2_BROWSER=1 npx playwright test --config=playwright.b2.config.ts
 *
 * The app runs locally on port 3012 against the LOCAL development database with STORAGE_DRIVER=s3 and the real bucket from
 * web/.env.storage. It never touches the Neon production database. The one test creates one tiny object under
 * submissions/<submission>/<uuid> and removes it again (all versions), then proves it is gone.
 * The origin http://localhost:3012 must be listed in the bucket's CORS rule.
 */
import "dotenv/config"; // web/.env (local development database)
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { defineConfig } from "@playwright/test";

const PORT = 3012;
const ORIGIN = `http://localhost:${PORT}`;
const storage = dotenv.config({ path: ".env.storage", quiet: true, processEnv: {} }).parsed ?? {};
process.env.E2E_CRON_SECRET ??= randomBytes(24).toString("hex");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /b2-browser-upload\.spec\.ts/,
  globalSetup: "./e2e/global-cleanup.ts",
  globalTeardown: "./e2e/global-cleanup.ts",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: { baseURL: ORIGIN, trace: "retain-on-failure", channel: process.env.CI ? undefined : "msedge" },
  projects: [{ name: "b2-chromium" }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      APP_URL: ORIGIN,
      AUTH_SECRET: randomBytes(48).toString("base64url"),
      TRUST_PROXY: "false",
      CRON_SECRET: process.env.E2E_CRON_SECRET,
      STORAGE_DRIVER: "s3", // the CSP connect-src is built from S3_ENDPOINT at build time, so these are set for the build too
      S3_ENDPOINT: storage.S3_ENDPOINT ?? "",
      S3_REGION: storage.S3_REGION ?? "",
      S3_BUCKET: storage.S3_BUCKET ?? "",
      S3_ACCESS_KEY_ID: storage.S3_ACCESS_KEY_ID ?? "",
      S3_SECRET_ACCESS_KEY: storage.S3_SECRET_ACCESS_KEY ?? "",
    },
  },
});
