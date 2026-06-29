# Price Provider Swap: Binance → Coinbase — Implementation Plan

## Overview

Production prices are broken: Binance (`data-api.binance.vision`, `api.binance.com`,
`api.binance.us`) returns **HTTP 403** to the Cloudflare Worker's egress IP. `safeFetch`
swallows the 403 to `null`, surfacing as "price unavailable — enter manually" across
every price surface. This plan swaps the price provider in `src/lib/prices.ts` from
Binance to **Coinbase**, which is verified reachable from the Worker for all three
needed capabilities. The module's public API stays identical so its four consumers are
untouched.

## Current State Analysis

- `src/lib/prices.ts` is the only module talking to the price provider. Public surface:
  `searchCoins`, `getCurrentPrice`, `getMultiplePrices`, `getHistoricalPrice`,
  `getHistoricalPriceSeries`, `getPriceForDate`, `CURRENT_PRICE_TTL_MS`.
- Consumers (unchanged by this plan): `src/pages/api/prices.ts` (`getMultiplePrices`,
  `getHistoricalPrice`), `src/lib/portfolio-service.ts:33` (`getMultiplePrices`),
  `src/lib/portfolio-history-service.ts:59` (`getHistoricalPriceSeries`),
  `src/components/portfolio/TransactionForm.tsx:73,108` (calls `/api/prices`).
- `safeFetch` (`prices.ts:42-57`) already has an `AbortController` timeout and degrades
  every failure to `null`. It logs nothing — the root reason this outage (and the prior
  CoinPaprika 402) was invisible (`lessons.md:19-24`).
- `parsePrice` (`prices.ts:24-28`) already guards NaN/Infinity via `Number.isFinite`.
- Stablecoins are pinned to `$1` via `isUsdStablecoin` (`schemas.ts`) — single source of truth.
- `prices.test.ts` mocks `fetch` with **Binance-shaped** responses throughout (ticker
  `{symbol,price}`, kline arrays, batch `symbols=[...]`) — must be re-pointed to Coinbase shapes.
- `ASSET_TICKERS` (`asset-list.ts`) was generated from Binance USDT pairs (437 tickers);
  some have no Coinbase USD pair.

### Verified from the deployed Worker (live probes, PRG colo — the egress that Binance 403s):

- `GET api.coinbase.com/v2/prices/BTC-USD/spot` → 200 `{data:{amount:"59884.955"}}`
- `…/ETH-USD/spot` → 200 (non-BTC works)
- `…/BTC-USD/spot?date=2026-03-01` → 200 `{data:{amount:"66971.665"}}` (historical-by-date)
- `api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=&end=` → 200,
  rows `[time(sec), low, high, open, close, volume]`, **newest-first**. UA requirement is
  **intermittent** (400'd once, 200'd later) → always send a User-Agent defensively.

## Desired End State

Every price surface works on the deployed Worker: New Transaction form current + historical
(DEPOSIT) prices, portfolio view live prices + auto-refresh, and the portfolio history chart.
No consumer signatures change. `prices.test.ts` passes against Coinbase shapes. A future
provider block is visible in `wrangler tail` rather than silent.

### Key Discoveries:

- **Public API is the seam** — rewrite internals only; consumers untouched.
- **No batch endpoint** on Coinbase → `getMultiplePrices` becomes parallel per-symbol calls.
- **Candle series is a different host** (`api.exchange.coinbase.com`), needs a UA header, and
  caps ~300 candles/request → chunk for the ≤365-day window.
- **Coinbase is firewall-blocked from the dev network** (both hosts `HTTP:000`) but works from
  the Worker — inverse of Binance. Local `npm run dev` can't fetch prices; verify on the Worker.
  Asset-list regeneration must run via a temporary Worker endpoint, not a local Node script.
- Candle time is in **seconds** (Binance used ms); close is index **[4]**.

## What We're NOT Doing

- Not changing any consumer (`portfolio-service`, `portfolio-history-service`, `api/prices`,
  `TransactionForm`) — public API is stable.
- Not adding a fiat/USD vs USDT migration — existing `avg_cost_usd` values remain valid
  (Binance USDT-denominated ≈ USD; Coinbase quotes true USD).
- Not building a user-facing "prices unavailable" banner (the per-field hint already covers it).
- Not proxying Binance, not keeping Binance as a fallback.
- Not adding a shared/cross-user price cache (out of scope, as in the prior change).

## Implementation Approach

Internal rewrite of `prices.ts` in two capability slices (current/historical, then series),
each independently deployable and verifiable on the Worker, so the user-visible outage is
fixed first. The asset-list regeneration and docs land last as polish. Always send a
`User-Agent` header; add a `console.warn` on boundary failure for observability.

## Critical Implementation Details

- **Coinbase response shapes**: spot/dated → `{data:{amount:"<string>"}}` (parse `data.amount`
  with the existing `parsePrice`). Candles → array of `[time, low, high, open, close, volume]`
  with `time` in **seconds** and rows **newest-first**; close is `[4]`. Multiply time by 1000
  before `new Date(...)`.
- **Candle chunking**: Coinbase Exchange returns at most ~300 candles. For a window of up to
  365 daily points, split `[start, today]` into ≤300-day sub-ranges (≤2 requests/asset), merge
  into the day→price map. Order within/between chunks is irrelevant because the result is a Map
  keyed by `YYYY-MM-DD`.
- **User-Agent**: send `User-Agent: VaultView/1.0` on every `fetch` (the candle host requires it
  intermittently; harmless elsewhere). workerd's `fetch` sends none by default.
- **Stablecoin pin**: keep `isUsdStablecoin(id) → 1` short-circuits before any fetch.

## Phase 1: Coinbase adapter core (current + historical-by-date) + observability

### Overview

Replace the Binance current-price and single-date historical paths with Coinbase, drop the
batch path in favor of parallel per-symbol fetches, and add boundary failure logging. This
phase ends the outage on the form and portfolio view.

### Changes Required:

#### 1. Price adapter — host, symbol mapping, parsing, current + historical

**File**: `src/lib/prices.ts`

**Intent**: Point the adapter at Coinbase's retail price host and rewrite the current-price,
multiple-prices, and single-date historical functions to Coinbase's shapes, keeping every
exported signature, the cache structures, the TTL/stale semantics, NaN guards, and the timeout.

**Contract**:
- `BASE_URL = "https://api.coinbase.com/v2"`.
- `toSymbol(id)` → `` `${id.toUpperCase()}-USD` ``.
- `getCurrentPrice(id)`: `GET /prices/{SYM}/spot` → parse `data.amount` via `parsePrice`;
  null on miss; stablecoin/empty-id short-circuits unchanged; cache unchanged.
- `getMultiplePrices(ids)`: **remove the `symbols=[...]` batch call**; fetch each uncached id
  via `getCurrentPrice` in parallel (`Promise.all`). Preserve the exact fresh/stale/`updated_at`
  return contract and the "retain stale, flag stale on refetch failure" behavior.
- `getHistoricalPrice(id, date)`: `GET /prices/{SYM}/spot?date=YYYY-MM-DD` → parse `data.amount`;
  null on miss; stablecoin short-circuit + per-day cache unchanged.
- `getPriceForDate` unchanged (delegates to current/historical).

#### 2. User-Agent + boundary logging in `safeFetch`

**File**: `src/lib/prices.ts`

**Intent**: Send a `User-Agent` on every request, and emit a `console.warn` on every non-200
or thrown error so a future provider block is visible in `wrangler tail` instead of silent —
directly addressing `lessons.md:19-24`. Still degrade to `null`.

**Contract**: `fetch(url, { headers: { "User-Agent": "VaultView/1.0" }, signal })`. On `!res.ok`
log `status` + `url`; in `catch` log the error + `url`. Return value/degradation behavior unchanged.

#### 3. Re-point unit tests (current / historical / multiple)

**File**: `src/lib/prices.test.ts`

**Intent**: Replace Binance-shaped mocks with Coinbase shapes for the current-price,
single-date historical, and `getMultiplePrices` describe-blocks, preserving every degradation
assertion (non-200, throw, malformed body, NaN-guard, stablecoin short-circuit, stale retention).

**Contract**: success mock → `{ data: { amount: "64000.00" } }`; the `-1121` invalid-symbol case
becomes a Coinbase miss (e.g. non-200 or a body with no `data.amount`); the batch test is
replaced by a parallel-per-symbol test (two `/spot` responses → both prices resolved).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npm run lint`
- Unit tests pass: `npx vitest run src/lib/prices.test.ts`
- Production build succeeds: `npm run build`

#### Manual Verification:

- After `npm run deploy`: New Transaction form shows a live BTC current price (not "unavailable").
- DEPOSIT with a past date shows a suggested historical cost-basis price.
- Portfolio view shows current prices and unrealized P&L; auto-refresh updates them.

**Implementation Note**: After this phase and all automated verification passes, pause for
manual confirmation (on the deployed Worker — not localhost) before proceeding.

---

## Phase 2: Candle series + chunking (history chart)

### Overview

Rewrite `getHistoricalPriceSeries` against Coinbase's candle endpoint with range chunking, so
the portfolio history chart works across the ~1-year window.

### Changes Required:

#### 1. `getHistoricalPriceSeries` → Coinbase candles + chunking

**File**: `src/lib/prices.ts`

**Intent**: Fetch daily candles from the Coinbase Exchange host with a User-Agent, split the
window into ≤300-day chunks, parse each row's close into the existing day→price Map, and keep
back-filling the per-day cache. Preserve the signature `(coinId, startDate, days) → Map`,
the stablecoin short-circuit, and empty-map-on-failure behavior.

**Contract**:
- Host `https://api.exchange.coinbase.com`; URL
  `/products/{SYM}/candles?granularity=86400&start={ISO}&end={ISO}` per chunk.
- Split `[startDate, startDate+days)` into sub-ranges of ≤300 days; fetch chunks concurrently.
- Row shape `[time, low, high, open, close, volume]`: `time` is **seconds** → `time*1000`;
  close is `[4]`; parse via `parsePrice`; skip non-finite closes (no NaN entries). Rows may be
  newest-first — irrelevant since the result is a `YYYY-MM-DD`→price Map.
- Back-fill `historicalPriceCache` per day as today.

#### 2. Deep-history fallback for `getHistoricalPrice`

**File**: `src/lib/prices.ts`

**Intent**: Coinbase's retail `spot?date` endpoint only covers ~2 years (verified: 2024-06 works,
2023-01 returns 404 "rate not found"). When it misses, fall back to a single daily candle from the
exchange host (which goes back years) so DEPOSITs dated >2 years ago still auto-suggest a cost basis.

**Contract**: in `getHistoricalPrice`, when the `spot?date` parse yields null, fetch
`api.exchange.coinbase.com/products/{SYM}-USD/candles?granularity=86400&start={day}T00:00:00Z&end={day}T23:59:59Z`
(UA header) and take close `[4]` of the single row. Cache + stablecoin/empty-id short-circuits
unchanged. Reuse the candle-row parsing introduced for the series.

#### 3. Refresh stale provider comments

**File**: `src/lib/portfolio-history-service.ts`

**Intent**: Update comments that reference "Binance klines / multi-year history" to Coinbase
candles + the ≤300/request chunking reality. Keep `WINDOW_FLOOR_DAYS = 364` as the deliberate
product bound (no longer a CoinPaprika 365→402 workaround).

**Contract**: comment-only edits at `:10-13`, `:46`, `:57`; no logic change.

#### 4. Re-point series unit tests + add chunking & fallback tests

**File**: `src/lib/prices.test.ts`

**Intent**: Convert the `getHistoricalPriceSeries` describe-block to Coinbase candle mocks
(seconds, close idx 4, newest-first), keep the empty-on-failure / NaN-skip / cache-backfill
assertions, add a test proving a >300-day window issues multiple chunked fetches and merges them,
and add a `getHistoricalPrice` test proving the spot→candle fallback (spot 404 → candle close used).

**Contract**: candle mock helper emits `[Math.floor(Date.parse(iso)/1000), low, high, open,
close, vol]`; chunking test stubs `fetch` to count calls for a ~365-day window (expect ≥2) and
asserts the merged Map spans both chunks; fallback test stubs the spot URL → 404 and the candles
URL → one row, expects the candle close.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/lib/prices.test.ts`
- Related consumers still green: `npx vitest run src/lib/portfolio-history-service.test.ts src/lib/portfolio-history.test.ts`
- Lint + build: `npm run lint && npm run build`

#### Manual Verification:

- After `npm run deploy`: portfolio history chart renders a continuous ~1-year series (no $0 cliff).
- Ranges shorter than the full window slice correctly from the returned series.

**Implementation Note**: Pause for manual confirmation on the deployed Worker before Phase 3.

---

## Phase 3: Asset-list regeneration (Coinbase products) + docs

### Overview

Regenerate `ASSET_TICKERS` from Coinbase's product list so autocomplete only offers priceable
assets, and update the decision docs + lessons. Because the dev network can't reach Coinbase,
the regeneration runs via a temporary Worker endpoint.

### Changes Required:

#### 1. Regenerate the static asset list

**File**: `src/lib/asset-list.ts`

**Intent**: Replace the Binance-derived `ASSET_TICKERS` with Coinbase-derived tickers (assets
that have a USD-quoted, online, tradable product), preserving majors-first ordering and keeping
the stablecoins/assets the engine pins (USDT, USDC) even if not USD-quoted. Update the header
comment + regeneration instructions to reflect the Coinbase source and the **must-run-from-Worker**
constraint.

**Contract**: Filter Coinbase `/products` to `quote_currency === "USD" && status === "online" &&
!trading_disabled`, emit distinct `base_currency`; prepend the existing majors list; force-include
`USDT`,`USDC`. Source the list via a **temporary** unauthenticated Worker endpoint (e.g.
`src/pages/api/diag-assets.ts`) that returns the computed array; curl it, paste the result, then
delete the endpoint and redeploy.

#### 2. Update asset-list tests if the universe assertions changed

**File**: `src/lib/asset-list.test.ts`

**Intent**: Keep the search-behavior assertions valid against the regenerated list (e.g. ensure
the tickers the tests rely on — BTC/ETH/USDT — are still present).

**Contract**: adjust only fixtures that assume specific now-absent tickers; no behavior change.

#### 3. Decision docs + lesson

**File**: `context/foundation/tech-stack.md`, `context/foundation/lessons.md`

**Intent**: Record Coinbase as the active provider (current/historical/candles, hosts, no key,
rate limits), Binance as rejected (Worker egress 403), and the dev-network firewall fact
(Coinbase unreachable locally → verify on the Worker). Append a lesson: "Verify price-provider
reachability from the deployed Worker, never localhost — egress IPs differ and providers block
datacenter IPs."

**Contract**: prose edits mirroring the existing CoinPaprika→Binance section style.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/lib/asset-list.test.ts`
- Full suite green: `npx vitest run`
- Lint + build: `npm run lint && npm run build`
- Temporary `diag-assets` endpoint removed: `test ! -f src/pages/api/diag-assets.ts`

#### Manual Verification:

- After `npm run deploy`: autocomplete shows expected assets; a previously-unpriceable Binance-only
  alt no longer appears (or no longer matters).
- Final smoke test: form current + historical price, portfolio view, history chart all populate on prod.

**Implementation Note**: Pause for final manual confirmation on the deployed Worker.

---

## Testing Strategy

### Unit Tests:

- `prices.test.ts` re-pointed to Coinbase shapes across all four capability groups, preserving
  every degradation/NaN/stablecoin/stale assertion; new chunking test for the series path.
- `asset-list.test.ts` fixtures kept valid against the regenerated universe.

### Integration Tests:

- None automated (price boundary is network-dependent and unreachable from CI/dev). Coverage is
  the unit boundary tests + on-Worker manual verification.

### Manual Testing Steps (all on the deployed Worker, not localhost):

1. New Transaction → BUY/DEPOSIT → select BTC → current price suggests within ~3s.
2. DEPOSIT with a past date → historical cost-basis price suggests.
3. Portfolio view → current prices + unrealized P&L populate; auto-refresh updates.
4. History chart → continuous ~1-year line, no $0 cliff.
5. Autocomplete → expected assets present.

## Performance Considerations

Per-symbol parallel current-price calls (no batch) and ≤2 chunked candle calls/asset are far
under Coinbase's limits (~10k/hour retail; ~10/s exchange). Caches (TTL current, permanent
historical) unchanged, so steady-state load is minimal.

## Migration Notes

No data migration. Stored `avg_cost_usd` remains valid (USDT≈USD vs true USD). Local dev cannot
fetch prices from this network — accepted; verify on the deployed Worker.

## References

- Frame brief: `context/changes/coinbase-price-provider/frame.md`
- Prior change (same root cause): `context/archive/2026-06-27-binance-price-provider/`
- Priors: `context/foundation/lessons.md:19-24` (silent degrade-to-null boundary)
- Source: `src/lib/prices.ts`, `src/lib/prices.test.ts`, `src/lib/asset-list.ts`,
  `src/lib/portfolio-history-service.ts`, `context/foundation/tech-stack.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Coinbase adapter core (current + historical-by-date) + observability

#### Automated

- [x] 1.1 Type checking + lint pass: `npx astro sync && npm run lint` — 75c229c
- [x] 1.2 Unit tests pass: `npx vitest run src/lib/prices.test.ts` — 75c229c
- [x] 1.3 Production build succeeds: `npm run build` — 75c229c

#### Manual

- [x] 1.4 Form shows live BTC current price on prod (not "unavailable") — 75c229c
- [x] 1.5 DEPOSIT with a past date shows a historical cost-basis price — 75c229c
- [x] 1.6 Portfolio view shows current prices + unrealized P&L; auto-refresh updates — 75c229c

### Phase 2: Candle series + chunking (history chart)

#### Automated

- [x] 2.1 Unit tests pass: `npx vitest run src/lib/prices.test.ts` — 5e8cf26
- [x] 2.2 Consumers green: `npx vitest run src/lib/portfolio-history-service.test.ts src/lib/portfolio-history.test.ts` — 5e8cf26
- [x] 2.3 Lint + build: `npm run lint && npm run build` — 5e8cf26

#### Manual

- [x] 2.4 History chart renders a continuous ~1-year series on prod (no $0 cliff) — 5e8cf26
- [x] 2.5 Shorter ranges slice correctly from the returned series — 5e8cf26

### Phase 3: Asset-list regeneration (Coinbase products) + docs

#### Automated

- [x] 3.1 Asset-list tests pass: `npx vitest run src/lib/asset-list.test.ts`
- [x] 3.2 Full suite green: `npx vitest run`
- [x] 3.3 Lint + build: `npm run lint && npm run build`
- [x] 3.4 Temporary endpoint removed: `test ! -f src/pages/api/diag-assets.ts`

#### Manual

- [x] 3.5 Autocomplete shows expected (priceable) assets on prod
- [x] 3.6 Final smoke test: form current + historical, portfolio view, history chart all populate on prod
