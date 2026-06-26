# Portfolio History Chart Implementation Plan

## Overview

Build a historical portfolio-valuation data source — which does not exist today — and render it as a toggleable line chart above the portfolio. Two metrics (total **portfolio value** over time, and **total earned P&L** = cumulative realized + unrealized at each day) share one chart, switched by a toggle. A range selector (1d / 15d / 30d / 180d / 365d) zooms a single 365-day daily series client-side. The most-recent point updates live from the existing price poll. The series is reconstructed on each request (no new table) by replaying the date-sorted transaction ledger against a per-asset year-range historical price fetch.

## Current State Analysis

The entire P&L system is **present-tense and stateless**. `getPortfolio` (`src/lib/portfolio-service.ts:15`) replays the full transaction history through `computePositions` and marks positions to **current** prices only (`getMultiplePrices`). Nothing computes or stores portfolio value at a past date — confirmed by frame investigation:

- **No persistence**: only two migrations exist (`supabase/migrations/`), the `transactions` table and a `price_usd` column. No snapshot/balance-history table.
- **No temporal engine path**: `computePositions(transactions)` (`pnl-engine.ts:50`) and `getPortfolio(supabase, userId)` take no "as-of date".
- **No time-series type or endpoint**: `src/types.ts` carries only present-tense shapes; `src/pages/api/` has no history route.
- **Charting precedent is hand-rolled SVG, no library**: `AssetAllocationChart.tsx` (S-09) renders a pure-SVG donut; its math is a tested pure function `computeAllocation` (`src/lib/asset-allocation.ts` + `asset-allocation.test.ts`). `package.json` confirms no charting dependency.
- **Range fetch is one change away**: `coinpaprika.ts:142` hardcodes `limit=1`; the same `/tickers/{id}/historical?start=…&interval=1d&limit=N` endpoint returns a full year's daily series in **one** call. `historicalPriceCache` (`coinpaprika.ts:13`) is a per-`coinId:date` scalar map with no TTL (historical prices are immutable).
- **Realized P&L is already date-attributable**: `computePositions` sorts by `(transaction_date, created_at)` (`pnl-engine.ts:60-64`) and records `realizedByTx` keyed by tx id (`:90`); SELL **and** WITHDRAW flow through the disposal arm, so withdrawn profit is captured.
- **The live-point host exists**: `PortfolioView.tsx` holds `assets` state and runs a 20s `/api/prices` poll (`:61-119`); `AssetAllocationChart` already sits above the table at `:153`.

### Key Discoveries:

- `getTransactions` returns rows pre-sorted by `(transaction_date, created_at)` (`transaction-service.ts:241-247`) — reuse this ordering for replay; do not re-sort differently (lessons.md: deterministic tie-break is part of correctness).
- `computePositions` already yields per-position `quantity`, `total_cost_usd`, `realized_pnl`, and `realizedByTx` (`pnl-engine.ts:42-107`) — the engine to reuse, evaluated incrementally per day.
- `portfolio-summary.ts` + `SummaryCards.tsx` compute today's total value and total P&L from the live `assets` array — reuse for the live "today" point so client and server valuation share one definition.
- CoinPaprika free tier: 20K calls/month, 1-year daily historical depth (`context/foundation/tech-stack.md`) — exactly the 365-point window; a per-asset range fetch costs ~N calls per render.
- `coinpaprika.ts` boundary degrades to `null` on non-200/throw/missing-field but has no response-type guard or timeout (lessons.md) — treat any series price as possibly missing.

## Desired End State

A logged-in user with transaction history sees, above the portfolio table, a line chart that:

- defaults to **Portfolio Value** over the last 365 days (daily), with a toggle to **Total P&L**;
- offers range buttons **1d / 15d / 30d / 180d / 365d** that zoom the same series without new network calls;
- shows a **live final point** that moves with the existing 20s price refresh;
- degrades gracefully: assets with no historical price contribute **0** that day (chosen behavior), and the chart shows an empty state when there are fewer than two plottable points.

Verify: `GET /api/portfolio/history` returns a daily series; the chart renders, toggles metric, zooms range, and its last point ticks when prices refresh; engine unit tests reproduce hand-computed P&L and value for a fixture ledger.

## What We're NOT Doing

- **No snapshot/balance-history table, no cron, no migration** — reconstruct-on-read only.
- **No intraday/hourly granularity** — daily series only; "1d" = yesterday's close + the live point.
- **No charting library** — hand-rolled SVG, matching S-09.
- **No carry-forward price fill** — a missing historical price counts as 0 for that day (explicit decision; see Open Risks).
- **No per-location or per-asset historical breakdown** — one portfolio-wide curve per metric.
- **No change to the present-tense `/api/portfolio` or the P&L engine's existing outputs.**
- **No roadmap-wide refactor** — the roadmap "Parked → Wykres bilansu w czasie" item is promoted to this slice as a closeout doc edit, not code.

## Implementation Approach

Reconstruct-on-read in four layers, bottom-up: (1) a price-series fetch that turns one CoinPaprika call into a date→price map per asset; (2) a pure reconstruction engine that, walking days from window-start to today, maintains a running `PositionMap` (reusing the same average-cost arithmetic as `pnl-engine`) and emits a daily point of value + realized + unrealized + total P&L; (3) a service + endpoint that assembles per-asset series and runs the engine; (4) a hand-rolled SVG chart with metric toggle and range zoom, whose final point is overridden client-side by the live portfolio totals already in `PortfolioView`. Correctness is protected by unit tests on the engine with a hand-verifiable fixture, per the PRD arithmetic guardrail.

## Critical Implementation Details

- **Day boundary & ordering.** Reconstruction must advance through transactions in the exact `(transaction_date, created_at)` order `getTransactions` returns, applying all of a day's transactions before snapshotting that day's holdings — otherwise a same-day BUY-then-SELL mis-prices the day. The engine builds positions incrementally; it must not re-run `computePositions` from scratch per day (O(days × txns²)).
- **Live-point/server-point seam.** Past days use historical prices; "today" is computed server-side in the series but **overridden client-side** by `PortfolioView`'s live totals (`value = Σ qty×price`, `totalPnl = Σ realized + Σ unrealized`). Both sides derive value from the same per-asset cost basis, so the seam is continuous; the override only swaps today's price source from "daily close" to "live tick".
- **Missing price = 0 consequence.** An asset older than CoinPaprika's 1-year window, or with a gap, drops to 0 on affected days, producing a visible dip/cliff. This is the chosen behavior; surface it honestly (an "N assets had no price on some days" note), do not silently smooth it.

## Phase 1: Historical price series fetch

### Overview

Add a range-fetch to the CoinPaprika boundary that returns a year of daily prices per asset in one call, and let the existing per-day cache absorb the result.

### Changes Required:

#### 1. Range price series fetch

**File**: `src/lib/coinpaprika.ts`

**Intent**: Add a function that fetches a daily price series for one asset over a date range in a single request, so reconstruction costs ~N calls (not 365×N). Back-fill the existing per-day `historicalPriceCache` from the response so single-day lookups stay warm and re-renders are cheap.

**Contract**: `getHistoricalPriceSeries(coinId: string, startDate: string, days: number): Promise<Map<string, number>>` — keys are `YYYY-MM-DD`, values USD price. Builds the URL with `interval=1d&limit=<days>` (reuse `safeFetch`, parse the existing `HistoricalTick[]` shape). On fetch failure returns an empty map (caller treats absent dates as missing → 0). For each returned tick, also `historicalPriceCache.set(`${coinId}:${date}`, price)`. Stablecoins (`isUsdStablecoin`) short-circuit to a map-free constant of 1 at the caller, not here.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Type checking passes: `npx astro sync && npm run lint`
- New tests cover: happy-path series parse, fetch-failure → empty map, and cache back-fill (a subsequent `getHistoricalPrice` for an in-range date hits cache without a new fetch).

#### Manual Verification:

- A scratch call for a real coin (e.g. `btc-bitcoin`) over 365 days returns ~365 dated prices in one request (observed via `wrangler tail` or a temporary log).

---

## Phase 2: Reconstruction engine

### Overview

A pure function that turns the transaction ledger plus per-asset price series into a daily time-series of portfolio value and P&L. This is the correctness-critical core (PRD arithmetic guardrail).

### Changes Required:

#### 1. Portfolio-history engine

**File**: `src/lib/portfolio-history.ts` (new)

**Intent**: Walk each day from window-start to today, maintaining a running average-cost `PositionMap` (same arithmetic as `pnl-engine`), applying that day's transactions, then valuing open holdings at that day's price to emit value, cumulative realized, unrealized, and total P&L.

**Contract**: `computePortfolioHistory(transactions: Transaction[], priceSeriesByAsset: Map<string, Map<string, number>>, opts: { startDate: string; endDate: string }): PortfolioHistoryPoint[]`. Each `PortfolioHistoryPoint = { date: string; value_usd: number; realized_pnl_usd: number; unrealized_pnl_usd: number; total_pnl_usd: number }` (add to `src/types.ts`). Rules: transactions applied in `(transaction_date, created_at)` order; a day's holdings are snapshotted **after** applying all that day's transactions; `value_usd = Σ_asset qty(asset,day) × price(asset,day)` with a missing price counted as 0; `realized_pnl_usd` is the cumulative sum of `realizedByTx`-equivalent disposals up to and including that day; `unrealized_pnl_usd = Σ_asset qty(asset,day) × (price(asset,day) − avgCost(asset,day))` (missing price → that asset contributes 0); `total_pnl_usd = realized + unrealized`. Stablecoin assets price at 1. Reuse the average-cost disposal/acquisition logic from `pnl-engine.ts:80-103` rather than forking the math.

#### 2. Shared types

**File**: `src/types.ts`

**Intent**: Add the `PortfolioHistoryPoint` type and the API response wrapper.

**Contract**: `PortfolioHistoryPoint` (above) and `PortfolioHistoryResponse { data: PortfolioHistoryPoint[]; start_date: string; end_date: string; excluded_price_days: number }` (`excluded_price_days` = count of asset-days that fell back to 0, for the honest note).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Type checking passes: `npx astro sync && npm run lint`
- Fixture test reproduces hand-computed value + realized + unrealized + total for a multi-day, multi-asset ledger including a DEPOSIT, a SELL, and a WITHDRAW (mirrors `pnl-engine.test.ts` style).
- Edge tests: a day with a missing price contributes 0 (no NaN); a same-day BUY-then-SELL prices correctly; a fully-closed position shows flat realized and 0 unrealized after close.

#### Manual Verification:

- Spot-check one real curve against the present-tense dashboard: the series' final day total P&L ≈ the dashboard's net P&L (within live-vs-close drift).

---

## Phase 3: Service + API endpoint

### Overview

Assemble the per-asset price series and run the engine behind an authenticated endpoint.

### Changes Required:

#### 1. History service

**File**: `src/lib/portfolio-history-service.ts` (new)

**Intent**: Orchestrate: load transactions, derive the window (`max(first transaction date, 365 days ago)` → today) and the set of non-stablecoin assets ever held, fetch a 365-day series per asset (`getHistoricalPriceSeries`, stablecoins → constant 1), then call `computePortfolioHistory`.

**Contract**: `getPortfolioHistory(supabase: SupabaseClient, userId: string): Promise<PortfolioHistoryResponse>`. Returns `{ data: [], start_date, end_date, excluded_price_days: 0 }` when there are no transactions. Always returns the full window (≤365 daily points); the client slices ranges. Per-asset series fetched concurrently (`Promise.all`). Propagate DB read failures (do not swallow — lessons.md / M3L5).

#### 2. API route

**File**: `src/pages/api/portfolio/history.ts` (new)

**Intent**: Authenticated GET wrapper returning the history response, mirroring `api/portfolio.ts`.

**Contract**: `export const prerender = false; export const GET: APIRoute`. 401 via `unauthorizedResponse()` when no user; 500 `errorResponse` when Supabase unconfigured; else `jsonResponse(await getPortfolioHistory(...))`. Same shape/idioms as `src/pages/api/portfolio.ts`.

### Success Criteria:

#### Automated Verification:

- Unit/integration tests pass: `npm run test`
- Type checking + lint pass: `npx astro sync && npm run lint`
- Service test: empty-history → empty data; a seeded ledger → a series whose length matches the window and whose last point matches a direct engine call.

#### Manual Verification:

- `GET /api/portfolio/history` (authenticated, via the running app) returns a daily series; an unauthenticated request 401s.
- Call volume sanity: one page load issues ~N CoinPaprika calls (N = distinct held assets), observed via `wrangler tail`.

---

## Phase 4: Chart UI

### Overview

A hand-rolled SVG line chart above the portfolio with a metric toggle and range selector, whose final point tracks the live portfolio.

### Changes Required:

#### 1. Chart geometry helpers

**File**: `src/lib/portfolio-history-chart.ts` (new) + `src/lib/portfolio-history-chart.test.ts`

**Intent**: Pure helpers to slice the series to a range and map points to SVG path coordinates, keeping the component free of in-render accumulators (react-compiler constraint, as in `AssetAllocationChart`).

**Contract**: `sliceRange(points, range: "1d"|"15d"|"30d"|"180d"|"365d"): PortfolioHistoryPoint[]` and `buildLinePath(values: number[], width, height): { path: string; areaPath: string; min: number; max: number }`. Handles ≤1 point (returns empty paths), all-equal values (flat line, no divide-by-zero), and negative values (P&L can go below 0 — baseline at value 0, not chart bottom).

#### 2. Chart component

**File**: `src/components/portfolio/PortfolioHistoryChart.tsx` (new)

**Intent**: Render the SVG line/area inside a `Card` (match `AssetAllocationChart` shell), with a Value | Total P&L metric toggle, 1d/15d/30d/180d/365d range buttons, axis min/max labels, and the excluded-days note. Accept the live "today" override and replace the series' last point with it.

**Contract**: Props `{ history: PortfolioHistoryPoint[]; liveToday: { value_usd: number; total_pnl_usd: number } | null; excludedPriceDays: number }`. Local state for `metric` and `range`. When `liveToday` is present, override the final point's `value_usd`/`total_pnl_usd` before plotting. Empty state ("Not enough history to chart yet") when the sliced series has <2 points. Colors via existing `chart-colors`/Tailwind tokens; P&L line tinted by sign at the latest point. No new deps.

#### 3. Wire into the portfolio view

**File**: `src/components/portfolio/PortfolioView.tsx`

**Intent**: Fetch `/api/portfolio/history` once on mount (alongside the initial portfolio fetch); render `PortfolioHistoryChart` above `AssetAllocationChart`. Derive `liveToday` from existing live state — `value = Σ total_quantity × current_price_usd`, `total_pnl = Σ total_realized_pnl_usd + Σ unrealized_pnl_usd` — so the final point ticks with the existing 20s poll without re-fetching the series.

**Contract**: Add `history`/`excludedPriceDays` state + a one-shot fetch (reuse the 401-redirect pattern of `fetchPortfolioData`). Compute `liveToday` from `assets` (reuse `portfolio-summary` helpers if they expose the totals; otherwise inline the two sums). Place `<PortfolioHistoryChart … />` immediately before the `AssetAllocationChart` line (`PortfolioView.tsx:153`). Re-fetch history in `handleTransactionCreated` (a new transaction changes past reconstruction).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test` (geometry helpers: range slice, path build, <2-point, all-equal, negative values)
- Type checking + lint pass: `npx astro sync && npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Chart renders above the portfolio; toggling Value ↔ Total P&L changes the curve; range buttons zoom 1d/15d/30d/180d/365d.
- The final point updates within ~20s as live prices refresh (watch it move; matches dashboard "Last updated").
- Adding a transaction re-fetches and reshapes the curve.
- A portfolio with an asset lacking history shows the excluded-days note and a 0-dip rather than NaN/blank.
- No regressions in the existing portfolio table, allocation chart, or summary cards.

---

## Testing Strategy

### Unit Tests:

- **Engine (`portfolio-history.test.ts`)** — the correctness core: a hand-computed fixture ledger (multi-day, multi-asset, DEPOSIT + SELL + WITHDRAW) reproduced exactly for value, realized, unrealized, total. Missing-price → 0 (no NaN). Same-day BUY→SELL ordering. Closed-position flatness.
- **Price series (`coinpaprika.test.ts`)** — series parse, failure → empty map, cache back-fill.
- **Chart geometry (`portfolio-history-chart.test.ts`)** — range slicing, path coordinates, ≤1 point, all-equal, negative values, zero baseline.

### Integration Tests:

- History service over a seeded ledger: window length, empty-history path, last-point equals direct engine call.

### Manual Testing Steps:

1. Open the dashboard; confirm the chart renders above the portfolio defaulting to Value / 365d.
2. Toggle to Total P&L; confirm a portfolio with realized + unrealized shows a curve consistent with the dashboard net P&L at the right edge.
3. Click through 1d/15d/30d/180d/365d; confirm zoom with no network calls (range slicing is client-side).
4. Watch the final point tick on the 20s refresh.
5. Add a transaction; confirm the curve re-fetches and updates.
6. With a held asset outside CoinPaprika's 1-year history, confirm the excluded-days note and a 0-contribution dip (chosen behavior), not a crash.

## Performance Considerations

One chart load = ~N CoinPaprika calls (N = distinct non-stablecoin assets ever held) via the range fetch — well within the 20K/month tier; never loop the `limit=1` per-day function (the 365×N trap). Reconstruction is O(days × assets) with an incremental running `PositionMap` — trivial at MVP scale. The 20s live refresh issues **zero** history calls (today's point is recomputed client-side from prices already polled).

## Migration Notes

None — no schema change. Reconstruct-on-read derives everything from existing `transactions`.

## References

- Frame brief: `context/changes/portfolio-history-chart/frame.md`
- Engine to reuse: `src/lib/pnl-engine.ts:50-107` (average-cost, `realizedByTx`, `(transaction_date, created_at)` order)
- Charting precedent: `src/components/portfolio/AssetAllocationChart.tsx`, `src/lib/asset-allocation.ts` (+ test)
- Price boundary: `src/lib/coinpaprika.ts:131-162` (`limit=1` → range fetch), `context/foundation/tech-stack.md` (CoinPaprika limits)
- Live-point host: `src/components/portfolio/PortfolioView.tsx:43-153`
- Lessons: `context/foundation/lessons.md` (deterministic ordering; CoinPaprika unguarded boundary; propagate DB errors)
- Roadmap parked item to promote: `context/foundation/roadmap.md` (Parked → "Wykres bilansu w czasie")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Historical price series fetch

#### Automated

- [x] 1.1 Unit tests pass: `npm run test` — 32d3df4
- [x] 1.2 Type checking + lint pass: `npx astro sync && npm run lint` — 32d3df4
- [x] 1.3 Tests cover series parse, fetch-failure → empty map, and cache back-fill — 32d3df4

#### Manual

- [x] 1.4 Scratch call for a real coin returns ~365 dated prices in one request — 32d3df4

### Phase 2: Reconstruction engine

#### Automated

- [x] 2.1 Unit tests pass: `npm run test` — b15b4fc
- [x] 2.2 Type checking + lint pass: `npx astro sync && npm run lint` — b15b4fc
- [x] 2.3 Fixture test reproduces hand-computed value + realized + unrealized + total (DEPOSIT/SELL/WITHDRAW) — b15b4fc
- [x] 2.4 Edge tests: missing price → 0 (no NaN), same-day BUY→SELL, closed-position flatness — b15b4fc

#### Manual

- [x] 2.5 Series final-day total P&L spot-checks against the dashboard net P&L (within drift)

### Phase 3: Service + API endpoint

#### Automated

- [x] 3.1 Unit/integration tests pass: `npm run test`
- [x] 3.2 Type checking + lint pass: `npx astro sync && npm run lint`
- [x] 3.3 Service test: empty-history → empty data; seeded ledger → window-length series, last point matches engine

#### Manual

- [x] 3.4 `GET /api/portfolio/history` returns a series when authed; 401 when not
- [x] 3.5 One page load issues ~N CoinPaprika calls (observed via `wrangler tail`)

### Phase 4: Chart UI

#### Automated

- [ ] 4.1 Unit tests pass: `npm run test` (geometry helpers)
- [ ] 4.2 Type checking + lint pass: `npx astro sync && npm run lint`
- [ ] 4.3 Build passes: `npm run build`

#### Manual

- [ ] 4.4 Chart renders above the portfolio; metric toggle changes the curve
- [ ] 4.5 Range buttons zoom 1d/15d/30d/180d/365d with no network calls
- [ ] 4.6 Final point updates within ~20s as live prices refresh
- [ ] 4.7 Adding a transaction re-fetches and reshapes the curve
- [ ] 4.8 Asset lacking history shows the excluded-days note and a 0-dip, not NaN/blank
- [ ] 4.9 No regressions in portfolio table, allocation chart, or summary cards
