import { test as setup, expect } from "@playwright/test";

/**
 * Auth setup — runs once before the chromium project (see playwright.config.ts).
 * Logs in through the real sign-in form and saves the session so every other test
 * starts authenticated. This is the ONLY place a test logs in through the UI
 * (e2e-quality-rules.md: "Use storageState for authentication").
 *
 * Credentials come from env so they never live in the repo; the defaults target the
 * local Supabase test account. Override with E2E_EMAIL / E2E_PASSWORD as needed.
 */
const authFile = "playwright/.auth/user.json";

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_EMAIL ?? "test@test.com";
  const password = process.env.E2E_PASSWORD ?? "Test1234!";

  await page.goto("/auth/signin");

  // FormField associates <label htmlFor> with its input, so getByLabel resolves.
  // exact: true so "Password" doesn't also match the "Show password" toggle button.
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for state, not time: the middleware redirects away from /auth/signin on success.
  await page.waitForURL((url) => !url.pathname.includes("/auth/signin"));

  // Confirm we landed in an authenticated view before persisting the session.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
