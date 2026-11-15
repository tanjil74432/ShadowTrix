import { defineConfig } from "@playwright/test";

const PORT = 3011; // separate from the dev port (3010) so tests never collide with a running dev server

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Locally use the installed Microsoft Edge (no browser download). CI installs Playwright's Chromium.
    channel: process.env.CI ? undefined : "msedge",
    trace: "retain-on-failure",
  },
  // Tests run against the production build: `npm run build` first.
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ENABLE_STYLEGUIDE: "true" },
  },
});
