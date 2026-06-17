# DEPOSIT with Historical Cost Basis (S-05) Implementation Plan

## Overview

Lift the stablecoin-only restriction on DEPOSIT so a user can record any asset they already hold (e.g. "1 BTC bought 3 months ago on another exchange"). The deposit's cost basis is derived from CoinPaprika's historical USD price at the user-specified original purchase date, with a manual override always available. Once a deposit carries a real cost basis, the existing P&L engine and portfolio views show its unrealized P&L automatically. Implements PRD **US-04 / FR-005**.

## Current State Analysis

DEPOSIT is intentionally stubbed for this change:

- `schemas.ts:23-29` — `createTransactionSchema` rejects any non-stablecoin DEPOSIT with the message _"S-01 DEPOSIT is limited to USD stablecoins (usdt-tether, usdc-usd-coin). Use S-05 for other assets."_
- `transaction-service.ts:55` — `resolvePriceUsd` hard-returns `1` for every DEPOSIT, so cost basis is always $1/unit (correct only for stablecoins).
- `transaction-service.ts:119-123` — the stored `price` for a DEPOSIT is forced to `1`.
- `TransactionForm.tsx` — the DEPOSIT tab filters the asset autocomplete to `USD_STABLECOINS` (`filterIds={USD_STABLECOINS}`, label "Stablecoin"), renders **no** price field, and the price-suggestion effect (`:59-83`) early-returns for DEPOSIT.

What already exists and is reusable:

- Historical price lookup: `getPriceForDate` / `getHistoricalPrice` (`coinpaprika.ts:131-162`), already exposed via `GET /api/prices?ids=<id>&date=<YYYY-MM-DD>` (`prices.ts:24-40`). The BUY/SELL form already consumes this for live suggestions.
- The P&L engine handles arbitrary cost basis: `computePositions` builds a deposit position as `quantity × tx.price_usd` (`pnl-engine.ts:62-66`) — no special-casing of `1`. Aggregate unrealized P&L (`portfolio-service.ts:47-48`) follows from there.
- Override plumbing: `resolvePriceUsd` already honors `source_price_usd_override` first (`transaction-service.ts:53`); the schema already accepts `source_price_usd_override` (`schemas.ts:16`).

Constraints discovered:

- CoinPaprika historical data spans only ~1 year and can return `null` (tech-stack.md). Deposits are exactly the long-ago-purchase case, so a no-price path is a first-class concern, not an edge.
- No `transaction-service.test.ts` exists yet; `resolvePriceUsd` is module-private. Test command is `vitest run` (`package.json`). Existing test patterns: `pnl-engine.test.ts`, `portfolio-summary.test.ts`, `asset-allocation.test.ts`.

## Desired End State

A user opens "Add Transaction" → Deposit, picks **any** asset, enters a quantity, picks the original purchase date, sees a suggested cost-basis price for that date (overridable), picks a location, and submits. The deposit is stored with `price_usd` = the resolved/overridden cost basis, and the portfolio per-asset and summary views show the deposited holding with correct unrealized P&L against that cost basis. Stablecoin deposits continue to work exactly as before ($1 cost basis, no price field). A future-dated deposit is rejected.

Verify by: depositing a non-stablecoin asset dated in the past → portfolio shows the holding with non-zero, arithmetically correct unrealized P&L; depositing a stablecoin → unchanged $1 behavior; a date older than the API window with no suggestion → manual cost basis required before submit; a future date → blocked.

### Key Discoveries:

- DEPOSIT gate to remove: `schemas.ts:23-29` (the `isUsdStablecoin` rejection inside the `type === "DEPOSIT"` branch).
- Cost-basis resolution point: `resolvePriceUsd` DEPOSIT branch (`transaction-service.ts:55`) and the `price` assignment (`transaction-service.ts:119-123`).
- Engine needs no change — `pnl-engine.ts:65` already multiplies by `price_usd`.
- Form reuse: the BUY/SELL price-suggestion effect (`TransactionForm.tsx:59-83`) and price field (`:253-268`) are the pattern to extend to DEPOSIT.
- Override flows directly: sending `source_price_usd_override` makes `resolvePriceUsd` return it verbatim (`:53`).

## What We're NOT Doing

- **No per-row unrealized P&L for deposits on `/transactions`.** Deposits have no target side; `isMarkableAcquisition` (`transaction-service.ts:238`) stays target-keyed. Deposits get full P&L in the aggregate portfolio/dashboard (which satisfies FR-005); the `/transactions` row keeps showing `—` for unrealized P&L.
- **No fee field for deposits** — a deposit brings existing holdings into tracking, not a trade; stays fee-free (defaults to 0).
- **No current-price fallback** for a missing historical price — we never invent a cost basis (PRD arithmetic guardrail). Missing suggestion → manual entry required.
- **No engine or migration changes** — `price_usd` already supports any asset; existing stablecoin deposits (`price_usd=1`) remain correct.
- **No React component-test harness** — none exists; form behavior is verified manually.
- **No change to BUY/SELL/SWAP** flows.

## Implementation Approach

Vertical slice, backend-first (mirrors the `transaction-list-filters` plan's engine→UI split). Phase 1 makes the server accept and correctly price any-asset deposits, fully unit-tested. Phase 2 surfaces it in the form. The override is the single bridge: the form computes a cost basis (suggested historical price, user-overridable) and sends it as `source_price_usd_override`; the server honors override-first, falling back to historical lookup, and rejecting only when neither a stablecoin shortcut, an override, nor a historical price yields a value.

## Critical Implementation Details

- **Override-first ordering is load-bearing.** `resolvePriceUsd` must check `override` before the stablecoin shortcut and before the historical lookup, so a user's manual cost basis always wins — including for old deposits the API can't price. This ordering already exists at `transaction-service.ts:53`; the DEPOSIT branch must sit *after* it.
- **Cost basis vs. the `price` column.** For a one-sided deposit there is no exchange rate; store `price = price_usd` (the resolved cost basis) rather than the legacy `1`, so the persisted row is self-consistent. `price_usd` is the value the engine reads.
- **Stablecoin shortcut avoids ticker noise.** Keep `isUsdStablecoin(source) → 1` for deposits so the "cash" side never reads `$0.998` from a live ticker and never spends an API call.

## Phase 1: Schema + cost-basis derivation (backend)

### Overview

Make the server accept any-asset deposits and resolve their cost basis from history, with a manual override and a future-date guard. Fully unit-tested.

### Changes Required:

#### 1. Deposit validation: lift the stablecoin gate, add a future-date guard

**File**: `src/lib/schemas.ts`

**Intent**: Allow non-stablecoin DEPOSITs (remove the `isUsdStablecoin` rejection in the `type === "DEPOSIT"` branch) while keeping the "no target asset / no target quantity" deposit invariants. Add a guard rejecting a `transaction_date` in the future for DEPOSIT (a purchase can't have happened in the future).

**Contract**: In `createTransactionSchema.superRefine`, the DEPOSIT branch no longer adds the `source_asset` stablecoin issue; it retains the `target_asset`/`target_quantity` must-be-absent issues and adds a new issue on `transaction_date` when the parsed date is after "now". Keep the future-date check scoped to the DEPOSIT branch to avoid changing BUY/SELL behavior. `source_price_usd_override` (already in `baseSchema`) is the override carrier — no schema change needed for it.

#### 2. DEPOSIT cost-basis resolution

**File**: `src/lib/transaction-service.ts`

**Intent**: Replace the DEPOSIT `return 1` in `resolvePriceUsd` with real resolution: a stablecoin source returns `1`; otherwise derive from `getPriceForDate(source_asset, transaction_date)`. The existing override-first check (`if (override) return override;`) already covers manual entry and old-deposit fallback, so it must remain ahead of this branch. When historical lookup yields `null`, return `null` so `createTransaction` surfaces the existing 400 ("Cannot resolve USD valuation…"). Also set the stored `price` for a DEPOSIT to the resolved `priceUsd` instead of the hardcoded `1`.

**Contract**: `resolvePriceUsd` DEPOSIT path becomes: `override` (already handled) → `isUsdStablecoin(sourceAsset) ? 1` → `getPriceForDate(sourceAsset, transactionDate.slice(0,10))`. In `createTransaction`, the `price` computation (`transaction-service.ts:119-123`) uses `priceUsd` for DEPOSIT rather than `1`. No signature changes to `createTransaction`.

#### 3. Export `resolvePriceUsd` for unit testing

**File**: `src/lib/transaction-service.ts`

**Intent**: Make the cost-basis resolver testable in isolation (it's currently module-private and the highest-risk arithmetic in this change).

**Contract**: Add `export` to `resolvePriceUsd`. No behavior change.

#### 4. Unit tests for cost-basis resolution and deposit engine path

**File**: `src/lib/transaction-service.test.ts` (new), plus a case in `src/lib/pnl-engine.test.ts`

**Intent**: Lock down the resolution branches and confirm a non-$1 deposit cost basis flows through the engine. CoinPaprika calls must be mocked (no network in tests).

**Contract**: New `transaction-service.test.ts` mocks `@/lib/coinpaprika` (`vi.mock`) and asserts `resolvePriceUsd` for DEPOSIT: (a) override wins over everything; (b) stablecoin source → `1` with no API call; (c) non-stablecoin → historical price from `getPriceForDate`; (d) historical `null` → `null`. In `pnl-engine.test.ts`, add a case: a DEPOSIT with `price_usd` ≠ 1 produces `total_cost_usd = quantity × price_usd` and the expected unrealized basis (complements the existing `$1 cost basis` test at `:27`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or `npx astro check`)
- Linting passes: `npm run lint`
- Unit tests pass: `npx vitest run`
- New `resolvePriceUsd` tests cover override / stablecoin / historical / null paths
- Engine test asserts a non-$1 deposit cost basis

#### Manual Verification:

- `POST /api/transactions` with a non-stablecoin DEPOSIT (past date) returns 201 and the stored row has `price_usd` = the historical price
- A future-dated DEPOSIT returns a 400 with a clear date message
- A stablecoin DEPOSIT still stores `price_usd = 1`

**Implementation Note**: After automated verification passes, pause for manual confirmation before starting Phase 2.

---

## Phase 2: DEPOSIT form — any-asset + cost-basis suggestion/override (frontend)

### Overview

Surface any-asset deposits in the Add Transaction form: unrestricted asset picker, a suggested-but-overridable cost-basis price for non-stablecoins, a future-date cap, and submit gating when no cost basis is present.

### Changes Required:

#### 1. Unrestrict the deposit asset and relabel

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Remove `filterIds={USD_STABLECOINS}` from the DEPOSIT `AssetAutocomplete` and relabel it "Asset" so any asset is selectable.

**Contract**: DEPOSIT-branch `AssetAutocomplete` (`:202-211`) drops the `filterIds` prop; label "Stablecoin" → "Asset". A computed `isStablecoinDeposit = USD_STABLECOINS.includes(sourceAsset)` gates stablecoin-specific behavior below.

#### 2. Extend the price-suggestion effect to deposits

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: For a non-stablecoin DEPOSIT, fetch the suggested historical cost-basis price for the selected date — reusing the existing `/api/prices?ids=&date=` effect that BUY/SELL use.

**Contract**: The suggestion effect (`:59-83`) no longer early-returns for DEPOSIT; for DEPOSIT it uses `sourceAsset` as the priced asset and keeps the existing stablecoin skip (`USD_STABLECOINS.includes` → no fetch). Dependency array already includes `sourceAsset`, `type`, `transactionDate`.

#### 3. Cost-basis price field for non-stablecoin deposits

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Render a "Cost basis price per unit (USD)" input in the DEPOSIT branch for non-stablecoin assets, with the "(suggested)" hint when a suggestion loaded and full manual override — mirroring the BUY/SELL price field. Hidden for stablecoins (auto $1).

**Contract**: New field in the DEPOSIT branch bound to the existing `price` state, shown only when `!isStablecoinDeposit`. Reuses the `suggestedPrice` "(suggested)" label pattern (`:254-256`).

#### 4. Future-date cap on the deposit date picker

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Prevent picking a future purchase date in the UI (server already rejects it from Phase 1).

**Contract**: The DEPOSIT `datetime-local` input (`:471-483`) gets `max` set to the current local datetime string (same `slice(0,16)` format used for the initial value).

#### 5. Deposit payload carries the cost basis; gate submit

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Send the resolved cost basis for non-stablecoin deposits and prevent submitting without one. Stablecoins send no price (server applies $1).

**Contract**: `buildPayload` DEPOSIT branch (`:114-116`) adds `source_price_usd_override: Number(price)` when `!isStablecoinDeposit` and `price` is a positive number; omits it for stablecoins. The submit button is disabled for a non-stablecoin deposit when `price` is empty/non-positive (extend the existing `disabled` logic at `:487`). Existing `insufficientBalance` gating is untouched (deposits don't check balance).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or `npx astro check`)
- Linting passes: `npm run lint`

#### Manual Verification:

- Deposit tab lets you search and pick any asset (not just stablecoins)
- Selecting a non-stablecoin asset + past date shows a suggested cost-basis price; editing it overrides; portfolio then shows the holding with correct unrealized P&L
- A stablecoin deposit shows no price field and still records at $1
- The date picker won't allow a future date; submit is disabled for a non-stablecoin deposit with no cost basis
- No regression to BUY / SELL entry

**Implementation Note**: After automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `resolvePriceUsd` (DEPOSIT): override wins; stablecoin → 1 (no API call); non-stablecoin → historical price; historical `null` → `null`. CoinPaprika mocked.
- `computePositions`: a DEPOSIT with `price_usd ≠ 1` yields `total_cost_usd = quantity × price_usd` (complements the existing $1 case).

### Integration Tests:

- None automated (no API/integration harness in repo). Covered by manual API checks in Phase 1.

### Manual Testing Steps:

1. Deposit `1 BTC` dated 3 months ago → suggested price appears; submit → portfolio shows BTC with cost basis ≈ that price and live unrealized P&L.
2. Override the suggested price to a known value → portfolio P&L matches a hand calc (`qty × (current − override)`).
3. Deposit dated >1 year ago (no suggestion) → must type a cost basis; submit blocked until entered.
4. Deposit `100 USDT` → no price field; records at $1; behavior identical to today.
5. Try a future date → picker caps it; if forced via API, server returns 400.

## Performance Considerations

One extra historical-price API call per non-stablecoin deposit entry (debounced by asset/date selection), cached by `historicalPriceCache` (`coinpaprika.ts:13`). Negligible against the 20k/month budget.

## Migration Notes

No migration. Existing stablecoin deposits already have `price_usd = 1`, which remains the correct cost basis. The `transactions` table already stores `price_usd` for any asset.

## References

- Roadmap: `context/foundation/roadmap.md` (S-05)
- PRD: US-04, FR-005, FR-007
- Lesson (cost basis vs. form price): `context/foundation/lessons.md` ("Always verify cost basis matches form price")
- Reused price path: `src/lib/coinpaprika.ts:131-162`, `src/pages/api/prices.ts:24-40`
- Engine deposit handling: `src/lib/pnl-engine.ts:62-66`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + cost-basis derivation (backend)

#### Automated

- [x] 1.1 Type checking passes (`npm run build` / `npx astro check`) — 6dc57f2
- [x] 1.2 Linting passes (`npm run lint`) — 6dc57f2
- [x] 1.3 Unit tests pass (`npx vitest run`) — 6dc57f2
- [x] 1.4 `resolvePriceUsd` tests cover override / stablecoin / historical / null paths — 6dc57f2
- [x] 1.5 Engine test asserts a non-$1 deposit cost basis — 6dc57f2

#### Manual

- [x] 1.6 Non-stablecoin DEPOSIT (past date) returns 201 with `price_usd` = historical price — 6dc57f2
- [x] 1.7 Future-dated DEPOSIT returns 400 with a clear date message — 6dc57f2
- [x] 1.8 Stablecoin DEPOSIT still stores `price_usd = 1` — 6dc57f2

### Phase 2: DEPOSIT form — any-asset + cost-basis suggestion/override (frontend)

#### Automated

- [x] 2.1 Type checking passes (`npm run build` / `npx astro check`)
- [x] 2.2 Linting passes (`npm run lint`)

#### Manual

- [x] 2.3 Deposit tab lets you pick any asset (not just stablecoins)
- [x] 2.4 Non-stablecoin + past date shows suggested cost basis; override works; portfolio shows correct unrealized P&L
- [x] 2.5 Stablecoin deposit shows no price field and records at $1
- [x] 2.6 Date picker blocks future dates; submit disabled for non-stablecoin deposit with no cost basis
- [x] 2.7 No regression to BUY / SELL entry
