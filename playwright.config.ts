import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for VaultView (M3L4).
 *
 * Layering (test-plan.md §5): E2E runs locally, then in CI — not per-edit.
 * Auth is handled once by the `setup` project (e2e/auth.setup.ts), which logs in
 * and writes the session to playwright/.auth/user.json. Every real test then starts
 * already authenticated via `storageState`, so individual tests never log in through
 * the UI (see e2e-quality-rules.md).
 *
 * Prereqs to run: local Supabase up (`npx supabase start`) and a test user that
 * matches E2E_EMAIL / E2E_PASSWORD (defaults below point at the local test account).
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "./e2e",
  // Unique-id + cleanup discipline (anti-pattern #5) means tests are safe in parallel.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },

  projects: [
    // 1. Log in once, persist the session to disk.
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    // 2. Real tests reuse that session — no UI login per test.
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],

  // Convenience: start the dev server if it isn't already running. Supabase must be
  // started separately. Remove this block if you prefer to manage the server yourself.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
