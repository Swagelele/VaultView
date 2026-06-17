# Summary Dashboard Implementation Plan

## Overview

Add a flat-totals summary to the top of `/dashboard` (PRD FR-010, roadmap S-03): **Total Realized P&L**, **Total Unrealized P&L**, **Total Fees (USD)**, plus a derived **Net P&L** (realized + unrealized). No charts, no time-series. The data is already produced by the S-01 P&L engine; this slice aggregates it and adds fee summation.

## Current State Analysis

- `getPortfolio()` (`src/lib/portfolio-service.ts:13`) fetches all user transactions, runs `computePositions` → `aggregateByAsset`, fetches current prices, and returns `PortfolioResponse { data: PortfolioAsset[]; stale; updated_at }`. Each `PortfolioAsset` carries `total_realized_pnl_usd` and `unrealized_pnl_usd` (null when price is unavailable).
- `PortfolioView.tsx` fetches `/api/portfolio` once, then polls `/api/prices` every 20s and **recomputes each asset's `unrealized_pnl_usd` client-side** (`PortfolioView.tsx:79`). Any summary of unrealized P&L must therefore be computed from the live client `assets` array, or it will drift out of sync with the table after a refresh.
- **Realized P&L** per asset (`total_realized_pnl_usd`) is price-independent and includes fully-closed positions (`aggregateByAsset` keeps `is_closed` assets in the array, `pnl-engine.ts:132`).
- **Fees**: `fee` is stored on every transaction (`schemas.ts:17`, defaults to 0) but is **never aggregated and never denominated** — the form label is just "Fee (optional)" (`TransactionForm.tsx:319`), and the migration comment notes it is "stored but NOT YET used in P&L". Per the decision below, fees are treated as USD.
- Test infra exists: Vitest (`npm test` → `vitest run`), with `src/lib/pnl-engine.test.ts` and `src/lib/schemas.test.ts` as patterns to follow.
- `formatUsd` and `pnlColor` helpers currently live locally in `PortfolioTable.tsx:14-28`. shadcn `Card` is **not** yet in `src/components/ui/`.

## Desired End State

When a logged-in user opens `/dashboard`, a row of four cards sits above the holdings table showing Total Realized P&L, Total Unrealized P&L, Total Fees (USD), and Net P&L. Realized and fees are static; Unrealized and Net update in lockstep with the existing 20s price refresh and the per-asset table rows. With no transactions, all cards read `$0.00`. When any held asset lacks a current price, Unrealized and Net read `—` (the table's existing convention) rather than a fabricated number.

Verify by: loading `/dashboard` with a seeded portfolio and confirming the four totals equal the manual sum of the table rows; waiting one refresh cycle and confirming Unrealized/Net track the table; viewing a fresh account and seeing zeros.

### Key Discoveries:

- Realized total and unrealized total are both derivable from the existing `PortfolioAsset[]` — no engine change (`portfolio-service.ts:30-53`).
- Unrealized must be computed client-side from live `assets` to match the 20s refresh (`PortfolioView.tsx:79`).
- Fees are the only value not in `PortfolioAsset`; they must be summed server-side from transactions already fetched in `getPortfolio` (`portfolio-service.ts:14`).
- Realized total must include closed positions and must NOT be affected by the "Show closed" toggle (toggle is view-only filtering in `PortfolioTable.tsx:34`).

## What We're NOT Doing

- No time-series charts, no historical P&L, no date range filters (PRD: flat totals only).
- No new route and no nav changes — cards live on the existing `/dashboard`.
- No fee-denomination model, no per-currency fee tracking, no fee migration. Fees are summed as USD.
- No changes to the P&L engine (`computePositions` / `aggregateByAsset`) or to how cost basis / realized P&L are calculated.
- No new API endpoint — the totals ride on the existing `/api/portfolio` response.

## Implementation Approach

Two phases. Phase 1 is non-visual: extend the portfolio response with `total_fees_usd` and introduce a pure, unit-tested `computeSummary()` that turns `(PortfolioAsset[], totalFeesUsd)` into the four totals with null-aware and closed-position handling. Phase 2 builds the UI: scaffold `Card`, extract the shared formatting helpers, render `SummaryCards` from the live client state, and thread `total_fees_usd` through the fetch/state in `PortfolioView`.

Computing the totals in a pure lib function (not inline in the component) makes the null/closed/empty logic unit-testable while still letting the component call it on every render with the live `assets` array — so Unrealized and Net stay live.

## Critical Implementation Details

- **Unrealized total is null-collapsing.** Sum `unrealized_pnl_usd` only over assets with `total_quantity > 0`. If any such asset has `unrealized_pnl_usd === null`, the total Unrealized is `null` (rendered `—`), and Net is therefore `null` too. This mirrors the table, which shows `—` for unpriced assets. Closed assets (qty 0) are skipped for unrealized but still counted for realized.
- **Stale ≠ null.** A stale-but-present price is still a number — Unrealized stays a number; rely on the existing stale indicator in the header (`PortfolioView.tsx:159-164`). Only a `null` price collapses the total to `—`.
- **Realized & fees are price-independent** — they do not change on the 20s refresh, so they come from the server response and the static `total_realized_pnl_usd` fields, not from the price poll.

## Phase 1: Backend — fee summation & summary function

### Overview

Add `total_fees_usd` to the portfolio response and a pure `computeSummary()` aggregation function with unit tests. No UI.

### Changes Required:

#### 1. Portfolio response carries total fees

**File**: `src/lib/portfolio-service.ts`

**Intent**: Sum the `fee` of every fetched transaction and return it on the response so the client doesn't need a second query. Transactions are already loaded at line 14.

**Contract**: Add `total_fees_usd: number` to the `PortfolioResponse` interface. In `getPortfolio`, compute `total_fees_usd = sum(transactions[].fee)` (coerce with `Number(...)`, treat missing as 0) and include it in both the early `transactions.length === 0` return (value `0`) and the main return.

#### 2. Pure summary aggregation function

**File**: `src/lib/portfolio-summary.ts` (new)

**Intent**: Turn the per-asset array plus total fees into the four dashboard totals, with the null-collapsing and closed-position rules from Critical Implementation Details. Pure and React-free so it is unit-testable and can be called client-side on every render.

**Contract**: Export `interface PortfolioSummary { total_realized_pnl_usd: number; total_unrealized_pnl_usd: number | null; net_pnl_usd: number | null; total_fees_usd: number; }` and `export function computeSummary(assets: PortfolioAsset[], totalFeesUsd: number): PortfolioSummary`. Rules: realized = sum of `total_realized_pnl_usd` over all assets; unrealized = sum of `unrealized_pnl_usd` over assets with `total_quantity > 0`, or `null` if any such asset has a `null` `unrealized_pnl_usd`; net = `realized + unrealized` or `null` when unrealized is `null`; fees = `totalFeesUsd`.

#### 3. Unit tests for computeSummary

**File**: `src/lib/portfolio-summary.test.ts` (new)

**Intent**: Lock the aggregation rules. Follow the structure of `src/lib/pnl-engine.test.ts`.

**Contract**: Cases — (a) empty array → all zeros, unrealized `0` and net `0` (no held assets means no nulls; define empty as `0`, not `null`); (b) all assets priced → realized/unrealized/net are correct sums; (c) one held asset with `unrealized_pnl_usd: null` → unrealized and net are `null`, realized still summed; (d) a closed asset (qty 0, non-zero `total_realized_pnl_usd`, `unrealized_pnl_usd: null`) contributes to realized but does not collapse unrealized; (e) fees passed through verbatim.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- None required for this phase (no user-visible change).

**Implementation Note**: After completing this phase and all automated verification passes, proceed to Phase 2 (no manual gate needed — nothing user-visible yet).

---

## Phase 2: UI — summary cards on the dashboard

### Overview

Render the four totals as cards above the holdings table, computed from live client state so Unrealized and Net track the 20s refresh.

### Changes Required:

#### 1. Card primitive

**File**: `src/components/ui/card.tsx` (new)

**Intent**: Provide a shadcn `Card` primitive (new-york style) for the summary tiles; none exists yet.

**Contract**: Add via `npx shadcn@latest add card` (preferred, keeps registry parity) or a minimal hand-written equivalent. Must expose at least `Card` and a content area; styling should match the existing dark surface (`border-white/10`, translucent background) used across `PortfolioTable`/dialogs.

#### 2. Shared formatting helpers

**File**: `src/lib/format.ts` (new), `src/components/portfolio/PortfolioTable.tsx`

**Intent**: `SummaryCards` and `PortfolioTable` should share one `formatUsd` and one `pnlColor` rather than duplicate them.

**Contract**: Move `formatUsd(value: number | null): string` and `pnlColor(value: number | null): string` (currently `PortfolioTable.tsx:14-28`) into `src/lib/format.ts` with identical behavior, and update `PortfolioTable` to import them. `formatQty` may stay in `PortfolioTable` (table-only).

#### 3. Summary cards component

**File**: `src/components/portfolio/SummaryCards.tsx` (new)

**Intent**: Render the four totals using `computeSummary` on the live assets, with P&L color coding and the `—` edge state.

**Contract**: `export function SummaryCards({ assets, totalFeesUsd }: { assets: PortfolioAsset[]; totalFeesUsd: number })`. Calls `computeSummary(assets, totalFeesUsd)` each render. Four cards: Realized P&L, Unrealized P&L, Total Fees (USD), Net P&L. Use `formatUsd` (renders `—` for `null`) and `pnlColor` for Realized/Unrealized/Net; Fees is neutral. No transactions → totals are `0` → `$0.00`.

#### 4. Wire into the dashboard view

**File**: `src/components/portfolio/PortfolioView.tsx`

**Intent**: Capture `total_fees_usd` from the fetch and render `SummaryCards` above the table, passing the live `assets` so Unrealized/Net update on each refresh.

**Contract**: Extend the local `PortfolioApiResponse` interface with `total_fees_usd: number`; add a `totalFees` state (default `0`); set it in both `fetchPortfolioData` consumers (initial load at lines 41-47 and `handleTransactionCreated` at 116-126). Render `<SummaryCards assets={assets} totalFeesUsd={totalFees} />` above the `AddTransactionDialog`/table block (within the existing `space-y-4` container). The price-refresh effect already updates `assets`, so no change there is needed for liveness. Keep the loading skeleton behavior; optionally show a card skeleton while `loading`.

### Success Criteria:

#### Automated Verification:

- Type checking / build passes: `npx astro sync && npm run build`
- Linting passes: `npm run lint`
- Existing tests still pass: `npm test`

#### Manual Verification:

- Four cards appear above the table on `/dashboard`; Realized/Unrealized/Net match the manual sum of the corresponding table columns.
- After one ~20s refresh cycle, Unrealized and Net change in lockstep with the table's per-asset Unrealized values (no drift).
- A brand-new account (no transactions) shows `$0.00` on all cards, no errors.
- When an asset has no current price (stale/unavailable), Unrealized and Net show `—`, while Realized and Fees still show numbers.
- "Show closed positions" toggle does not change any card total (realized still includes closed positions).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human that the manual testing above succeeded before closing the change.

---

## Testing Strategy

### Unit Tests:

- `computeSummary`: empty input, all-priced sums, null-price collapse for unrealized + net, closed-position realized contribution, fee pass-through (Phase 1, item 3).

### Integration Tests:

- None automated for MVP. The summary rides on the existing `/api/portfolio` response, covered by manual verification.

### Manual Testing Steps:

1. Sign in to an account with several transactions across assets/locations; open `/dashboard`.
2. Manually sum the table's Realized and Unrealized columns; confirm they equal the cards.
3. Wait ~20s; confirm Unrealized and Net move with the table, not independently.
4. Toggle "Show closed positions"; confirm card totals are unchanged.
5. Sign in to a fresh account; confirm all cards read `$0.00`.
6. Simulate/observe an unpriced or stale asset; confirm Unrealized and Net render `—` while Realized and Fees render numbers.

## Performance Considerations

Negligible. `computeSummary` is an O(assets) reduction over an array already in memory; no extra network calls (fees ride on the existing portfolio fetch). It runs on each render of `SummaryCards`, which is cheap at MVP portfolio sizes.

## Migration Notes

None. No schema or data migration; `fee` already exists on `transactions`.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- PRD requirement: `context/foundation/prd.md` (FR-010)
- P&L engine: `src/lib/pnl-engine.ts`
- Portfolio assembly: `src/lib/portfolio-service.ts:13`
- Live unrealized recompute: `src/components/portfolio/PortfolioView.tsx:79`
- Formatting helpers to extract: `src/components/portfolio/PortfolioTable.tsx:14-28`
- Lessons: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — fee summation & summary function

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — f8f2a83
- [x] 1.2 Type checking passes: `npx astro sync && npm run build` — f8f2a83
- [x] 1.3 Linting passes: `npm run lint` — f8f2a83

### Phase 2: UI — summary cards on the dashboard

#### Automated

- [x] 2.1 Type checking / build passes: `npx astro sync && npm run build`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Existing tests still pass: `npm test`

#### Manual

- [x] 2.4 Four cards appear above the table; Realized/Unrealized/Net match the sum of table columns
- [x] 2.5 After one ~20s refresh, Unrealized and Net track the table (no drift)
- [x] 2.6 Fresh account (no transactions) shows `$0.00` on all cards, no errors
- [x] 2.7 Unpriced/stale asset → Unrealized and Net show `—`; Realized and Fees still show numbers
- [x] 2.8 "Show closed positions" toggle does not change any card total
