# Swap Price Provider CoinPaprika → Binance — Implementation Plan

## Overview

The deployed app's price/asset data is broken because CoinPaprika's keyless free tier (20k
calls/month, rate-limited by origin IP) is permanently over quota from the Worker's shared
Cloudflare IP — and `safeFetch` swallows the 402 into an empty UI. This plan replaces the
price provider with Binance's public market-data host `data-api.binance.vision` behind a
renamed, provider-neutral adapter that preserves the existing function contract, switches the
canonical asset identifier to the uppercase ticker, surfaces failures instead of blanking,
and verifies on production. The shared price cache is explicitly out of scope (deferred).

## Current State Analysis

- `src/lib/coinpaprika.ts` is the sole price boundary, exposing six functions
  (`searchCoins`, `getCurrentPrice`, `getMultiplePrices`, `getHistoricalPrice`,
  `getHistoricalPriceSeries`, `getPriceForDate`) and a module-global in-memory cache.
- Imported by 5 non-test files: `portfolio-service.ts`, `portfolio-history-service.ts`,
  `transaction-service.ts`, `src/pages/api/prices.ts`, `src/pages/api/assets/search.ts`.
- The persisted asset id (in `transactions.source_asset`/`target_asset`) is the CoinPaprika
  id (`btc-bitcoin`). It is used as an opaque map key throughout `pnl-engine.ts`,
  `portfolio-service.ts`, `portfolio-history-service.ts`, and `/api/prices`.
- The id **format** is interpreted in exactly three places: `symbolFromId` (`format.ts:25`,
  already handles no-dash by uppercasing), `USD_STABLECOINS`/`isUsdStablecoin`
  (`schemas.ts:3-7`), and a hardcoded `"usdt-tether"` in `SellAllDialog.tsx:39`.
- Stablecoins are already priced at exactly `$1` by the engine (`transaction-service.ts:68,73`;
  `portfolio-history.ts:32`), and excluded from history fetches (`portfolio-history-service.ts:54-55`).
- The production `transactions` table was freshly migrated this session and is **empty** — no
  data migration is required regardless of id format.
- `lessons.md` documents two unguarded boundary gaps (no response-type/`Number.isFinite`
  guard, no request timeout) and the CoinPaprika 364-day historical-window quirk.

## Desired End State

On production, asset autocomplete returns results, price suggestions populate, and live
portfolio + history prices load — all sourced from `data-api.binance.vision`. When the
provider is unreachable, the UI shows a clear error/manual-entry affordance rather than a
blank dropdown or empty value. Verify by: running the app, searching an asset, adding a BUY,
seeing prices + history render, and adding a DEPOSIT with a past date that resolves a
historical cost basis.

### Key Discoveries:

- Binance coverage verified live against `data-api.binance.vision`: current
  `/api/v3/ticker/price` (batch via `symbols=[...]`), historical `/api/v3/klines`
  (`startTime`/`endTime`, read close index `[4]`), asset list `/api/v3/exchangeInfo`
  (~17 MB → must be trimmed + committed, not fetched per request).
- Binance rate limit is **6000 weight/min per IP, resets every minute** — structurally
  resilient to shared-IP contention, unlike CoinPaprika's monthly cap (frame D5: LOW risk).
- Symbol rule: canonical id `BTC` → Binance symbol `BTCUSDT` (`baseAsset + "USDT"`).
- Invalid symbol → `{"code":-1121,"msg":"Invalid symbol."}` (HTTP 200 body); no data for a
  date → `[]`. Both must degrade to null, not throw.
- `USDTUSDT` does not exist; only USDT among TRADING base assets lacks a USDT pair → handle
  via the stablecoin short-circuit.

## What We're NOT Doing

- **No shared Supabase price cache** — deferred; Binance's per-minute budget makes it
  unnecessary for a small-group evaluation (frame Narrowing Signals).
- **No hardening of the 20s live poll** — on-load pricing is sufficient (frame).
- **No coin-name registry** — autocomplete shows ticker-only labels for now.
- **No CoinPaprika API key / fallback provider** — single-provider swap.
- **No data migration** — the table is empty.
- **No richer retry/toast UX** — minimal distinct error states only.

## Implementation Approach

Anti-corruption adapter: create `src/lib/prices.ts` exposing the **same six signatures and
return types** as `coinpaprika.ts`, keyed by the asset id, with all Binance specifics
(host, symbol mapping, string→number parsing, stablecoin short-circuit, degradation)
confined inside. Consumers change only their import path. The canonical id becomes the
uppercase ticker, sourced from a committed static asset list. Then surface failures and
verify on production.

## Critical Implementation Details

- **Stablecoin short-circuit lives in the adapter.** `getCurrentPrice`/`getPriceForDate`/
  `getHistoricalPrice`/`getMultiplePrices`/`getHistoricalPriceSeries` must return `1` for any
  `isUsdStablecoin(id)` asset *before* calling Binance. This simultaneously fixes the
  `USDTUSDT`-invalid gap and keeps USDC consistent at `1.00` with the engine (which already
  treats both stablecoins as exactly `$1`), avoiding a 1.00-vs-1.001 split across views.
- **Binance returns prices as strings.** Parse with a `Number.isFinite` guard at the boundary;
  a non-finite parse degrades to `null`/skips the tick (closes a documented `lessons.md` gap).
- **Historical date → kline window.** For a target day `YYYY-MM-DD`: `startTime =
  Date.UTC(y,m-1,d)` ms, `endTime = startTime + 86_399_999`, `interval=1d` → exactly one
  candle; use close `[4]`. For the series, request `interval=1d` with `startTime` at the
  window start and `limit = days`; key each candle by `new Date(openTime).toISOString()
  .slice(0,10)`. Binance has multi-year history, so the CoinPaprika 364-day floor is no longer
  a provider constraint — leave `WINDOW_FLOOR_DAYS` as-is (still a valid window) but update its
  comment to drop the CoinPaprika rationale.
- **AbortController timeout** around every Binance `fetch` (closes the second documented gap).

## Phase 1: Binance price adapter + static asset list

### Overview

Create the new provider-neutral module and the committed asset list it searches, with its
own boundary tests. No consumers are rewired yet (that's Phase 2), so this phase is verified
in isolation.

### Changes Required:

#### 1. Static asset list (generated once)

**File**: `src/lib/asset-list.ts` (new)

**Intent**: Provide the searchable asset universe so autocomplete never hits the 17 MB
`exchangeInfo` at runtime. Generated once during implementation by fetching `exchangeInfo`,
filtering to `status === "TRADING"` and `quoteAsset === "USDT"`, and emitting distinct
`baseAsset` tickers.

**Contract**: Exports a typed array of `{ id, symbol, name }` where `id === symbol ===`
uppercase ticker (e.g. `"BTC"`) and `name` falls back to the ticker (ticker-only labels).
Common majors (BTC, ETH, USDT, USDC, SOL, BNB, XRP, ADA, DOGE) ordered first, then
alphabetical. Include USDT explicitly even though it has no USDT pair (it's a valid asset to
hold/transact). Document the regeneration command in a header comment.

#### 2. Provider-neutral price adapter

**File**: `src/lib/prices.ts` (new; replaces `src/lib/coinpaprika.ts`)

**Intent**: Re-implement the six price functions against `data-api.binance.vision`, keyed by
asset id, with stablecoin short-circuit, string→number parsing, finite guards, timeout, and
degrade-to-null/[] on every failure (non-200, throw, `-1121`, `[]`, malformed).

**Contract**: Preserve exact signatures and return types:
- `searchCoins(query: string): Promise<CoinSearchResult[]>` — now filters the static
  `asset-list` (case-insensitive substring on id/symbol), returns `{id, name, symbol, rank: 0,
  is_active: true}`. No network call.
- `getCurrentPrice(id): Promise<number|null>` — stablecoin→1; else `/api/v3/ticker/price?
  symbol=${id}USDT`, parse `price`.
- `getMultiplePrices(ids): Promise<PriceLookupResult>` — batch non-stablecoin ids via
  `?symbols=[...]`; stablecoins filled as 1; preserve the existing `{prices, stale,
  updated_at}` shape and the stale-cache-retention semantics covered by the boundary tests.
- `getHistoricalPrice(id, date): Promise<number|null>` — stablecoin→1; else one-candle
  `klines` window, close `[4]`.
- `getHistoricalPriceSeries(id, startDate, days): Promise<Map<string,number>>` — stablecoin→
  empty map (engine prices them at 1 anyway); else `klines` window keyed by day.
- `getPriceForDate(id, date)` — unchanged delegation (today→current, else historical).
- Keep the module-global current-price cache + `CURRENT_PRICE_TTL_MS` export (the boundary
  tests assert stale retention against it).
- `BASE_URL = "https://data-api.binance.vision/api/v3"`.

#### 3. Boundary tests

**File**: `src/lib/prices.test.ts` (new; replaces `coinpaprika.test.ts`)

**Intent**: Port the Risk #5 degradation suite to Binance response shapes — stubbing global
`fetch` — so the parsing/degradation logic is exercised.

**Contract**: Cover, with Binance bodies: current price OK (`{symbol,price:"64000"}`→64000),
non-200→null, throw→null, malformed/`-1121`→null (not NaN), string price parsed; historical
one-candle→close, `[]`→null; series parse to day→price map, failure→empty map, non-finite
tick skipped; `getMultiplePrices` stale retention + uncached-fail omission; stablecoin
short-circuit returns 1 without calling fetch.

#### 4. Delete the old module

**File**: `src/lib/coinpaprika.ts` (delete in Phase 2, after imports are repointed)

**Intent**: Removed once no longer imported. Listed here for traceability; the actual delete
happens in Phase 2 to keep Phase 1 compiling.

### Success Criteria:

#### Automated Verification:

- New module type-checks: `npx astro sync && npm run lint`
- Adapter unit tests pass: `npx vitest run src/lib/prices.test.ts`
- Static list is non-empty and well-formed (a test asserts `>100` entries, includes BTC/ETH/USDT)

#### Manual Verification:

- `src/lib/asset-list.ts` contains the trimmed list (spot-check BTC, ETH, USDT, SOL present)
- A manual `curl` of `data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT` matches what
  the adapter parses

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: Rewire consumers + asset-id format

### Overview

Repoint all consumers to `@/lib/prices`, switch the canonical id to the uppercase ticker
across the three format-aware spots, update test fixtures, delete the old module, and get the
full suite green.

### Changes Required:

#### 1. Repoint imports

**File**: `portfolio-service.ts`, `portfolio-history-service.ts`, `transaction-service.ts`,
`src/pages/api/prices.ts`, `src/pages/api/assets/search.ts`

**Intent**: Change `@/lib/coinpaprika` → `@/lib/prices`. No call-site logic changes (signatures
preserved).

**Contract**: Import-path-only edits across the 5 files; then delete `src/lib/coinpaprika.ts`.

#### 2. Stablecoin constants → ticker form

**File**: `src/lib/schemas.ts`

**Intent**: Recognize stablecoins by ticker now that ids are tickers.

**Contract**: `USD_STABLECOINS = ["usdt", "usdc"]` (`isUsdStablecoin` already lowercases its
input, so uppercase `"USDT"` ids match). Update the sell-all error message text from
`usdt-tether, usdc-usd-coin` to `USDT, USDC`.

#### 3. Sell-all default target

**File**: `src/components/portfolio/SellAllDialog.tsx`

**Intent**: Default sell-all target to the ticker form.

**Contract**: `targetAsset: "usdt-tether"` → `targetAsset: "USDT"` (`:39`).

#### 4. Doc comment

**File**: `src/lib/format.ts`

**Intent**: `symbolFromId` behavior is unchanged (no-dash uppercase path already covers
tickers); update the doc comment to reflect ticker ids instead of `{symbol}-{name}`.

**Contract**: Comment-only edit at `:20-24`.

#### 5. Test fixtures → ticker ids

**File**: `pnl-engine.test.ts`, `portfolio-service.test.ts`, `transaction-service.test.ts`,
`portfolio-history-service.test.ts`, `portfolio-history.test.ts`, `schemas.test.ts`

**Intent**: Replace CoinPaprika-shaped fixture ids with tickers so stablecoin-dependent
assertions stay correct under the new `USD_STABLECOINS`.

**Contract**: Mechanical find-replace `usdt-tether`→`USDT`, `usdc-usd-coin`→`USDC`,
`btc-bitcoin`→`BTC`, `eth-ethereum`→`ETH`, `doge-dogecoin`→`DOGE`. Update mocked module path
from `@/lib/coinpaprika` to `@/lib/prices` where consumer tests `vi.mock` it. Position-map keys
like `"usdt-tether::Binance"` → `"USDT::Binance"`.

### Success Criteria:

#### Automated Verification:

- Type check + lint clean: `npx astro sync && npm run lint`
- Full unit suite passes: `npx vitest run`
- No remaining references: grep for `coinpaprika`, `usdt-tether`, `btc-bitcoin` in `src/` returns nothing

#### Manual Verification:

- `npm run dev` boots; dashboard and transactions pages load without import/runtime errors

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Visible error states

### Overview

Replace the silent-empty failure with clear, minimal error affordances on the two surfaces
where failure currently looks like "no data".

### Changes Required:

#### 1. Asset search error state

**File**: `src/components/portfolio/AssetAutocomplete.tsx`

**Intent**: Distinguish a fetch failure from a genuine no-match so the dropdown never silently
blanks.

**Contract**: Track an error flag in the `handleSearch` catch (`:50`); when set, `CommandEmpty`
renders "Couldn't load assets — try again" instead of "No results found." Reset on the next
successful query.

#### 2. Price-suggestion fallback hint

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: When a price suggestion can't be fetched, tell the user to enter it manually
rather than leaving an unexplained empty field.

**Contract**: On a null/failed `/api/prices` suggestion (`:70,99` flow), show an inline
"price unavailable — enter manually" hint near the price input. Manual override already exists;
this only makes the failure legible.

#### 3. Confirm stale indicator

**File**: `src/components/portfolio/PortfolioView.tsx` (verify only)

**Intent**: Ensure the existing `(stale)` indicator still fires when `getMultiplePrices`
returns `stale: true` from the new adapter.

**Contract**: No code change expected; verify the stale path end-to-end.

### Success Criteria:

#### Automated Verification:

- Lint + type check clean: `npm run lint`
- Existing component tests (if any) pass: `npx vitest run`

#### Manual Verification:

- Temporarily point the adapter `BASE_URL` at an unreachable host (or block the network) and
  confirm: search shows "Couldn't load assets", price suggestion shows the manual-entry hint,
  portfolio shows `(stale)` — none blank silently. Revert the host after.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Deploy + production verification

### Overview

Ship it and confirm the core premise live: `data-api.binance.vision` is reachable from the
Cloudflare Worker region, and all three surfaces work end-to-end in production.

### Changes Required:

#### 1. Deploy

**File**: n/a (deploy step)

**Intent**: Build and deploy the Worker, then exercise the live app.

**Contract**: `npm run deploy`; then `npx wrangler tail` while testing to observe any upstream
fetch failures.

### Success Criteria:

#### Automated Verification:

- Production build succeeds: `npm run build`
- Dry-run bundle check passes: `npm run deploy:dry-run`

#### Manual Verification:

- On the deployed URL: asset autocomplete returns results (search "btc", "sol", "usdt")
- Add a BUY (USDT→BTC) — price suggestion populates; transaction saves; portfolio shows the
  position with a live current price and unrealized P&L
- History chart renders with a non-flat series
- Add a DEPOSIT with a past date — a historical cost basis resolves from `klines`
- `wrangler tail` shows successful Binance calls (no repeated upstream errors), confirming
  `data-api.binance.vision` is reachable from the Worker region

**Implementation Note**: This is the final phase — confirm the manual E2E before closing out.

---

## Testing Strategy

### Unit Tests:

- `prices.test.ts` — the full Risk #5 degradation matrix ported to Binance shapes, plus the
  stablecoin short-circuit (returns 1 without fetching) and string-price parsing.
- Consumer suites (`portfolio-service`, `transaction-service`, `portfolio-history-service`,
  `pnl-engine`, `schemas`) — pass unchanged in behavior with ticker-id fixtures and the
  `@/lib/prices` mock path.

### Integration Tests:

- The existing `getMultiplePrices` stale-retention and uncached-fail paths remain covered.

### Manual Testing Steps:

1. Search several assets in the transaction form (BTC, SOL, USDT) — results appear.
2. Add a BUY and a DEPOSIT (past date) — current and historical prices resolve.
3. Force a provider failure (block network) — error states show, nothing blanks.
4. On production, run the full E2E and watch `wrangler tail`.

## Performance Considerations

`getMultiplePrices` now batches all non-stablecoin ids into one `?symbols=[...]` call (weight
2 for ≤20 symbols), an improvement over CoinPaprika's per-id fetch. The static asset list
eliminates per-keystroke network calls. Avoid the weight-80 trap: never call
`/api/v3/ticker/24hr` without an explicit symbol.

## Migration Notes

None — the production `transactions` table is empty, so the id-format change (CoinPaprika id
→ ticker) requires no backfill. Confirm emptiness before deploying Phase 2; if any rows
exist, a one-time `UPDATE transactions SET source_asset = <ticker(source_asset)>, target_asset
= <ticker(target_asset)>` would be needed.

## References

- Frame brief: `context/changes/binance-price-provider/frame.md`
- Source boundary: `src/lib/coinpaprika.ts` (to be replaced by `src/lib/prices.ts`)
- Consumers: `src/lib/portfolio-service.ts:5`, `src/lib/portfolio-history-service.ts:4`,
  `src/lib/transaction-service.ts:4`, `src/pages/api/prices.ts:4`,
  `src/pages/api/assets/search.ts:4`
- Format-aware spots: `src/lib/format.ts:25`, `src/lib/schemas.ts:3`,
  `src/components/portfolio/SellAllDialog.tsx:39`
- Lessons: `context/foundation/lessons.md` (boundary timeout + finite guard; historical window)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Binance price adapter + static asset list

#### Automated

- [x] 1.1 New module type-checks: `npx astro sync && npm run lint`
- [x] 1.2 Adapter unit tests pass: `npx vitest run src/lib/prices.test.ts`
- [x] 1.3 Static list test asserts >100 entries incl. BTC/ETH/USDT

#### Manual

- [x] 1.4 `asset-list.ts` spot-check (BTC, ETH, USDT, SOL present)
- [x] 1.5 `curl` of Binance ticker matches adapter parse

### Phase 2: Rewire consumers + asset-id format

#### Automated

- [ ] 2.1 Type check + lint clean: `npx astro sync && npm run lint`
- [ ] 2.2 Full unit suite passes: `npx vitest run`
- [ ] 2.3 No remaining `coinpaprika` / `usdt-tether` / `btc-bitcoin` refs in `src/`

#### Manual

- [ ] 2.4 `npm run dev` boots; dashboard + transactions load without errors

### Phase 3: Visible error states

#### Automated

- [ ] 3.1 Lint + type check clean: `npm run lint`
- [ ] 3.2 Existing component tests pass: `npx vitest run`

#### Manual

- [ ] 3.3 Forced-failure check: search error, price hint, `(stale)` all show; nothing blanks

### Phase 4: Deploy + production verification

#### Automated

- [ ] 4.1 Production build succeeds: `npm run build`
- [ ] 4.2 Dry-run bundle check passes: `npm run deploy:dry-run`

#### Manual

- [ ] 4.3 Deployed: autocomplete returns results
- [ ] 4.4 Deployed: BUY saves with live price + unrealized P&L; history chart renders
- [ ] 4.5 Deployed: DEPOSIT past-date resolves historical cost basis
- [ ] 4.6 `wrangler tail` shows successful Binance calls from the Worker region
