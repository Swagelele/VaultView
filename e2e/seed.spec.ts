import { test, expect } from "@playwright/test";

/**
 * SEED TEST — the exemplar every /10x-e2e–generated test is modeled on.
 * "What you show is what you get": the patterns below (role locators, wait-for-state,
 * unique ids, risk-tied name) are what the Generator will reproduce. See
 * .claude/skills/10x-e2e/references/seed-test-pattern.md.
 *
 * Risk covered — test-plan.md §2 Risk #3 / §3 Phase 4:
 *   "A transaction save reports success but the data does not survive a full
 *    user path." This crosses auth → API → DB → SSR render → reload, so no unit
 *    test can prove it. The assertion must fail if that data loss materializes.
 *
 * Auth: provided by the `setup` project via storageState — this test never logs in.
 *
 * Selector note (real app): the transaction form's <Label> elements are not yet
 * associated with their <Input> (no htmlFor/id), so getByLabel('Amount'/'Location')
 * depends on adding that association — the recommended fix, and an a11y win. The seed
 * deliberately uses the ideal locators to set the standard; /10x-e2e (step 4) validates
 * them against the live app and heals or proposes the association as needed.
 */
test("deposited holding persists after page reload", async ({ page }) => {
  // Unique identifier (anti-pattern #5 defense): a per-run location so parallel runs
  // and re-runs never collide — VaultView has no transaction-delete endpoint, so this
  // unique-id strategy is the primary isolation lever. Destructive teardown belongs in
  // a Playwright teardown project with a service-role Supabase client (see lesson Deep
  // Dive + test-plan.md §6.3); wire that in alongside /10x-e2e in step 4.
  const location = `E2E ${Date.now()}`;
  const amount = "100";

  await page.goto("/dashboard");

  // --- setup + action: record a USDT deposit (stablecoin → no cost-basis price needed)
  await page.getByRole("button", { name: "Add Transaction" }).click();
  await expect(page.getByRole("heading", { name: "New Transaction" })).toBeVisible();

  await page.getByRole("tab", { name: "Deposit" }).click();
  await page.getByLabel("Amount").fill(amount);

  // AssetAutocomplete is a popover: open it, type in the command input, pick the option.
  await page.getByRole("button", { name: "Search asset..." }).click();
  await page.getByPlaceholder("Search asset...").fill("USDT");
  await page.getByRole("option", { name: /USDT/i }).first().click();

  // exact: true so "Location" doesn't substring-match "Asset allocation by value" (the chart).
  await page.getByLabel("Location", { exact: true }).fill(location);
  await page.getByRole("button", { name: "Save Transaction" }).click();

  // Wait for state, not time: the dialog closes once the save succeeds.
  await expect(page.getByRole("heading", { name: "New Transaction" })).toBeHidden();

  // The new USDT position must be visible in the portfolio.
  await expect(page.getByRole("cell", { name: "USDT" })).toBeVisible();

  // --- the actual risk: does it survive a reload (i.e. did it really persist)?
  await page.reload();

  // Risk-tied assertion: this fails exactly when Risk #3 materializes (save looked
  // OK but the row did not persist), which is the whole point of the test.
  await expect(page.getByRole("cell", { name: "USDT" })).toBeVisible();
});
