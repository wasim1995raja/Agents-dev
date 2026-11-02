import { defineConfig, devices } from "@playwright/test";

/**
 * Dashboard E2E. It expects the API (`pnpm dev:api`, port 3001) and Postgres to
 * be running; the web dev server is started by Playwright if it is not already
 * up. The scenario creates a real project, waits for the orchestrator, approves
 * the release gate in the UI and inspects the generated artifacts.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
