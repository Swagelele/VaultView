# Core Trade & Portfolio Implementation Plan

## Overview

Build the north-star slice (S-01): a complete opening-balance + trade entry flow for USD-stablecoin DEPOSIT and BUY/SELL/SWAP transactions with CoinPaprika-powered price suggestions, an Average Cost P&L engine, and a portfolio dashboard showing consolidated positions with per-location breakdown and auto-refreshing prices. This is the foundation every subsequent slice (S-02 through S-08) builds on.

## Current State Analysis

### What exists:

- **Auth:** Fully implemented — email/password signin/signup/signout with cookie sessions, middleware route protection, UI pages
- **Schema:** `transactions` table with RLS policies (F-02 done) — supports all 5 transaction types, two-sided trades, location labels
- **Types:** `Transaction` and `TransactionInsert` interfaces in `src/types.ts`
- **UI framework:** Astro 6 SSR + React 19 islands, Tailwind CSS 4, shadcn/ui infrastructure (button only), `cn()` utility
- **Dashboard:** Placeholder page at `/dashboard` with auth check and sign-out button

### What's missing:

- No CoinPaprika integration (no API client, no proxy endpoints)
- No business logic layer (no services, no P&L computation)
- No JSON API endpoints (existing endpoints are auth-only, redirect-based)
- No transaction form or portfolio view
- No shadcn/ui form components (input, dialog, select, command, table, etc.)
- No Zod schemas for request validation
- Schema lacks `price_usd` field needed for USD-denominated P&L

### Key Discoveries:

- Existing API routes (`src/pages/api/auth/*`) use redirect-based responses for HTML forms; new routes need JSON responses — different pattern
- `createClient()` returns `null` when Supabase env vars missing — all new service code must handle this
- Middleware protects routes via `PROTECTED_ROUTES` array with page redirect; API routes need JSON 401 instead
- CoinPaprika free tier: 20K calls/month, no API key needed, 10 req/sec, asset IDs use `{symbol}-{name}` format (e.g., `btc-bitcoin`)
- CoinPaprika free tier historical data limited to 1 year of daily OHLCV — storing `price_usd` at transaction creation time avoids repeated historical lookups
- Cloudflare Workers runtime — only `fetch` available for HTTP calls (no Node.js `http` module)

## Desired End State

A logged-in user can:

1. Open `/dashboard` and see a portfolio table listing each held asset with: symbol, total quantity (across all locations), average cost (USD), current price (USD, auto-refreshing every 20s), and unrealized P&L (USD)
2. Expand any asset row to see per-location breakdown (quantity + unrealized P&L at each location)
3. Click "Add Transaction" to open a dialog with a form supporting DEPOSIT, BUY, SELL, and SWAP types — with asset autocomplete from CoinPaprika, price suggestion from CoinPaprika where relevant (overridable), location autocomplete from prior transactions, date/time picker, and fee input for trades
4. Record an initial USD-stablecoin DEPOSIT before spending that stablecoin in a BUY/SWAP
5. After submitting a deposit or trade, see the portfolio update immediately with recalculated positions and P&L
6. Toggle visibility of zero-balance assets (fully closed positions)

**Verification:** Create a sequence of DEPOSIT, BUY, SELL, and SWAP transactions for known assets at known prices. Manually compute the expected Average Cost and P&L in a spreadsheet. Compare against the portfolio view — numbers must match exactly.

## What We're NOT Doing

- **Full DEPOSIT import for existing non-stablecoin assets** — S-05 handles historical-cost imports of already-owned crypto. S-01 only supports USD-stablecoin opening-balance DEPOSIT so a user can fund the first trade without negative cash-like balances.
- **WITHDRAW transaction type** — S-06 handles withdrawals/cash-out
- **Per-buy P&L breakdown** — S-02; we build aggregate Average Cost only
- **Summary dashboard (total realized/unrealized/fees)** — S-03; we show per-asset P&L but not portfolio totals
- **Transaction list with filters** — S-04; transactions are created but no list view
- **Sell-all auto-fill** — S-07/S-08
- **Fee impact on cost basis** — fees are stored per transaction but do not affect Average Cost calculations in this slice; fee-adjusted cost basis is a refinement for a later iteration
- **Mobile responsive layout** — PRD non-goal for MVP
- **Transaction editing or deletion** — create-only for this slice

## Implementation Approach

Six phases, each independently verifiable:

1. **Schema & Dependencies** — extend the data model with `price_usd`, install UI and validation libraries
2. **CoinPaprika Integration** — build the API client and proxy endpoints for asset search and price lookup
3. **Transaction Backend** — service layer with validation, CRUD API, locations endpoint, middleware update
4. **Transaction Form UI** — React island with adaptive DEPOSIT/BUY/SELL/SWAP form, autocomplete, price suggestion, dialog
5. **P&L Engine & Portfolio API** — Average Cost engine replaying transactions, portfolio endpoint
6. **Portfolio Dashboard UI** — React island with table, per-location breakdown, auto-refresh, dialog integration

Source/target convention: **source = what leaves the portfolio, target = what enters** for two-sided BUY/SELL/SWAP trades. For S-01 DEPOSIT, `source_asset` and `source_quantity` store the asset entering the portfolio, while target fields remain null. The P&L engine treats BUY/SELL/SWAP identically: realized P&L on source disposal, new cost basis on target acquisition. DEPOSIT is a one-sided acquisition that creates the opening holding needed before the first trade.

Price field semantics: `price` stores the user-visible exchange rate between source and target assets. `price_usd` stores the executed USD value of 1 source unit at the transaction date/time, after applying the user's accepted or manually overridden price. The P&L engine must never replace this with "current price at submit time."

Valuation rules for `price_usd`:

- Stablecoin source assets (`usdt-tether`, `usdc-usd-coin`, and other configured USD-pegged assets) use `1`.
- Stablecoin target assets derive `price_usd` from the submitted exchange rate (for example, SELL 1 BTC for 62000 USDT means source `price_usd = 62000`).
- S-01 DEPOSIT supports configured USD stablecoins only; `price_usd = 1`, `price = 1`, and target fields are null.
- Crypto-to-crypto swaps derive source USD value from the target side: `price_usd = target_quantity * target_usd_price_at_transaction_date / source_quantity`.
- When the transaction date is not today, use `getHistoricalPrice()` for the selected date; current prices are only valid for same-day suggestions.
- Manual override controls the stored execution valuation. If valuation cannot be resolved from stablecoins, submitted quantities, manual price, or CoinPaprika, reject creation with a validation error rather than storing a transaction that the P&L engine silently skips.

## Critical Implementation Details

### Source/target mapping per transaction type

The form presents user-friendly fields and maps them to the source/target schema:

| Type    | User enters              | source_asset | source_qty | target_asset | target_qty | price (exchange rate) |
| ------- | ------------------------ | ------------ | ---------- | ------------ | ---------- | --------------------- |
| DEPOSIT | Deposit 100 USDT         | USDT         | 100        | null         | null       | 1                     |
| BUY     | Buy 1 BTC at 60000 USDT  | USDT         | 60000      | BTC          | 1          | 60000                 |
| SELL    | Sell 1 BTC at 62000 USDT | BTC          | 1          | USDT         | 62000      | 62000                 |
| SWAP    | Swap 10 ETH for 0.5 BTC  | ETH          | 10         | BTC          | 0.5        | 0.05                  |

For DEPOSIT: `source_qty = amount`, `source_asset = stablecoin asset`, `target_* = null`, `price = 1`, `price_usd = 1`.
For BUY: `source_qty = amount * price`, `target_qty = amount` (user enters amount + price).
For SELL: `target_qty = amount * price`, `source_qty = amount` (user enters amount + price).
For SWAP: user enters both quantities; `price = target_qty / source_qty`.

### Average Cost algorithm

```
For each transaction (chronological order):
  1. If DEPOSIT:
     positions[source, location].qty += source_qty
     positions[source, location].total_cost_usd += source_qty × price_usd
     continue

  2. DISPOSE source:
     avg_cost = positions[source, location].total_cost_usd / positions[source, location].qty
     realized_pnl = source_qty × (price_usd − avg_cost)
     positions[source, location].qty −= source_qty
     positions[source, location].total_cost_usd −= source_qty × avg_cost

  3. ACQUIRE target (if two-sided):
     cost_basis_usd = source_qty × price_usd
     positions[target, location].qty += target_qty
     positions[target, location].total_cost_usd += cost_basis_usd
```

Unrealized P&L per position: `qty × (current_usd_price − avg_cost_usd)`

---

## Phase 1: Schema & Dependencies

### Overview

Extend the database schema with the `price_usd` field needed for USD P&L calculations, install shadcn/ui form components plus Zod/Vitest for validation and arithmetic tests, and create shared API response helpers.

### Changes Required:

#### 1. Database migration

**File**: `supabase/migrations/YYYYMMDDHHMMSS_add_price_usd_to_transactions.sql`

**Intent**: Add a `price_usd` column to store the executed USD value of 1 source unit at transaction time. The P&L engine uses this to compute cost basis and realized P&L in USD without repeated historical API lookups.

**Contract**: New nullable `numeric` column `price_usd` on `transactions` table. Nullable because existing rows (if any from testing) won't have this value; new S-01 transaction creation must populate it. If the server cannot resolve execution-time USD valuation, it returns a validation/service error instead of inserting `price_usd = null`.

#### 2. TypeScript type updates

**File**: `src/types.ts`

**Intent**: Add `price_usd` to the `Transaction` interface and define new types for portfolio positions and CoinPaprika API responses.

**Contract**: Add `price_usd: number | null` to `Transaction`. Add new exported interfaces: `Position` (asset, location, quantity, total_cost_usd, avg_cost_usd), `PortfolioAsset` (asset, positions by location, totals, current_price_usd, price_stale, unrealized_pnl), `CoinSearchResult` (id, name, symbol, rank), `CoinPrice` (id, price_usd), `PriceLookupResult` (prices: Record<string, number>, stale: boolean, updated_at: string | null). Update `TransactionInsert` so its `Omit<Transaction, ...>` list explicitly includes `price_usd` because the server sets it.

#### 3. Install shadcn/ui components

**Intent**: Install the UI components needed for the transaction form and portfolio table.

**Contract**: Run `npx shadcn@latest add dialog input label select table tabs command badge popover` to scaffold component files into `src/components/ui/`. Also `npm install zod` as a direct dependency for server-side validation and `npm install -D vitest` for executable arithmetic and schema tests.

#### 4. Test script

**File**: `package.json`

**Intent**: Make the plan's unit and integration tests executable via a standard command.

**Contract**: Add a `test` script that runs Vitest once in CI-friendly mode: `"test": "vitest run"`.

#### 5. API response helpers

**File**: `src/lib/api-helpers.ts`

**Intent**: Provide consistent JSON response factory functions for all new API routes, replacing the redirect pattern used by auth endpoints.

**Contract**: Export `jsonResponse(data, status?)`, `errorResponse(message, status?)`, `unauthorizedResponse()`. Each returns a `Response` with `Content-Type: application/json`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Type checking passes: `npm run lint`
- Build passes: `npm run build`
- shadcn/ui components exist in `src/components/ui/` (dialog, input, label, select, table, tabs, command, badge, popover)
- Zod is in `package.json` dependencies
- Vitest is in `package.json` devDependencies and `npm run test` is defined

#### Manual Verification:

- Supabase Studio shows `price_usd` column on `transactions` table

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: CoinPaprika Integration

### Overview

Build the CoinPaprika API client service and two server-side proxy endpoints — asset search for autocomplete and price lookup for suggestions. These are consumed by the transaction form (Phase 4) and portfolio view (Phase 6).

### Changes Required:

#### 1. CoinPaprika client service

**File**: `src/lib/coinpaprika.ts`

**Intent**: Centralize all CoinPaprika API calls behind typed functions. Uses native `fetch` (available in Cloudflare Workers). Handles errors gracefully — returns `null` on failure rather than throwing, since CoinPaprika unavailability should never break the app.

**Contract**: Export async functions:

- `searchCoins(query: string): Promise<CoinSearchResult[]>` — calls `GET /v1/search/?q={query}&c=currencies&limit=10`, returns matched coins
- `getCurrentPrice(coinId: string): Promise<number | null>` — calls `GET /v1/tickers/{coinId}`, extracts `price_usd`
- `getMultiplePrices(coinIds: string[]): Promise<PriceLookupResult>` — calls `GET /v1/tickers` at most once per cache TTL, filters to requested IDs, returns resolved prices plus `stale` and `updated_at` metadata
- `getHistoricalPrice(coinId: string, date: string): Promise<number | null>` — calls `GET /v1/tickers/{coinId}/historical?start={date}&interval=1d&limit=1`, returns the price
- `getPriceForDate(coinId: string, date: string): Promise<number | null>` — uses current price for today/now and historical price for earlier transaction dates

Add an in-memory module-level cache for current prices with a 120-second TTL and stale fallback. Historical prices can be cached by `coinId + date` for the lifetime of the worker isolate because historical daily values do not change during normal use. All functions return `null` or empty results on network/API errors — never throw. When the current-price refresh fails but cached data exists, return cached stale prices with metadata through the API response.

#### 2. Asset search proxy endpoint

**File**: `src/pages/api/assets/search.ts`

**Intent**: Server-side proxy for CoinPaprika coin search, consumed by the asset autocomplete component. Proxying controls rate limits server-side and avoids CORS issues.

**Contract**: `GET /api/assets/search?q={query}` → returns `{ data: CoinSearchResult[] }`. Requires auth (returns 401 JSON if unauthenticated). Returns empty array if query is fewer than 2 characters.

#### 3. Price lookup proxy endpoint

**File**: `src/pages/api/prices.ts`

**Intent**: Server-side proxy for CoinPaprika price lookups. Supports both single-coin and multi-coin requests (multi-coin used by portfolio auto-refresh).

**Contract**: `GET /api/prices?ids={coinId1,coinId2,...}&date={YYYY-MM-DD}` → returns `{ data: Record<string, number>, stale: boolean, updated_at: string | null }` mapping coin IDs to USD prices. `date` is optional; omit it for current prices, provide it for historical lookup at transaction date. Requires auth. Returns only prices for successfully resolved coins. If CoinPaprika is unavailable or rate-limited and cached prices exist, return them with `stale: true`; if no cached price exists for an ID, omit that ID rather than failing the whole request.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `GET /api/assets/search?q=bitcoin` returns CoinPaprika results with `btc-bitcoin` in the list
- `GET /api/prices?ids=btc-bitcoin,eth-ethereum` returns current USD prices for both
- `GET /api/prices?ids=btc-bitcoin&date=2026-01-15` returns a historical USD price
- Repeated `GET /api/prices` requests inside the current-price TTL use cached values and do not call CoinPaprika again
- If CoinPaprika fails after a successful price lookup, `GET /api/prices` returns cached prices with `stale: true`
- Asset and price endpoints return 401 when not authenticated

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Transaction Backend

### Overview

Build the transaction service layer with Zod validation, USD price enrichment at creation time, and CRUD API endpoints. Also update middleware to return JSON 401 for API routes and add a locations endpoint for autocomplete.

### Changes Required:

#### 1. Zod validation schemas

**File**: `src/lib/schemas.ts`

**Intent**: Define server-side validation schemas for transaction creation requests. Validates types, required fields per transaction type, and value constraints.

**Contract**: Export `createTransactionSchema` — a Zod object schema validating: `type` (enum DEPOSIT/BUY/SELL/SWAP), `source_asset` (non-empty string), `source_quantity` (positive number), `target_asset` (non-empty string, required for BUY/SELL/SWAP and absent/null for DEPOSIT), `target_quantity` (positive number, required for BUY/SELL/SWAP and absent/null for DEPOSIT), `price` (positive number, optional for DEPOSIT because the server sets `1`), `source_price_usd_override` (positive number, optional), `fee` (non-negative number, optional, defaults to 0), `location` (non-empty string), `transaction_date` (ISO datetime string). Use Zod `.refine()` to enforce that target fields are present for two-sided types and absent for DEPOSIT. DEPOSIT must be limited to configured USD stablecoins in S-01.

#### 2. Transaction service

**File**: `src/lib/transaction-service.ts`

**Intent**: Encapsulate transaction CRUD operations with validation, holdings checking, and USD price enrichment. This is the core business logic layer between API routes and Supabase.

**Contract**: Export functions using a Supabase client + user ID as parameters:

- `createTransaction(supabase, userId, data)` — validates with Zod schema. For DEPOSIT, requires a configured USD stablecoin, sets `price = 1`, `price_usd = 1`, leaves target fields null, and inserts the opening balance. For BUY/SELL/SWAP, resolves execution-time `price_usd` from the submitted trade context (stablecoin source = 1, stablecoin target = submitted exchange rate, otherwise selected-date CoinPaprika current/historical price with manual override respected), checks that the source asset quantity does not exceed current holdings at the location (queries existing transactions to compute current position), then inserts with `user_id` and non-null `price_usd` set server-side. Returns the created transaction or an error object; if valuation cannot be resolved, returns a validation/service error and does not insert.
- `getTransactions(supabase, userId)` — returns all user transactions ordered by `transaction_date ASC`.
- `getDistinctLocations(supabase, userId)` — returns unique location values from user's transactions for autocomplete.
- `getHoldingAtLocation(supabase, userId, asset, location)` — computes current quantity of an asset at a location by summing acquisitions (DEPOSIT source and BUY/SELL/SWAP targets) and subtracting disposals (BUY/SELL/SWAP sources). Used for insufficient-source validation.

#### 3. Transaction CRUD API endpoint

**File**: `src/pages/api/transactions.ts`

**Intent**: JSON API endpoint for creating and listing transactions. POST creates a new transaction via the service; GET returns the user's transaction list.

**Contract**:

- `POST /api/transactions` — accepts JSON body matching `createTransactionSchema`, calls `createTransaction`, returns `{ data: Transaction }` on success or `{ error: string }` with appropriate status (400 for validation, 409 for insufficient source holdings, 500 for server error). Requires auth.
- `GET /api/transactions` — calls `getTransactions`, returns `{ data: Transaction[] }`. Requires auth.

#### 4. Locations API endpoint

**File**: `src/pages/api/locations.ts`

**Intent**: Returns distinct location labels from the user's transactions for autocomplete in the transaction form.

**Contract**: `GET /api/locations` → returns `{ data: string[] }`. Requires auth.

#### 5. Middleware update for JSON API routes

**File**: `src/middleware.ts`

**Intent**: API routes under `/api/` (except `/api/auth/`) need auth protection that returns JSON 401 instead of redirecting to the sign-in page.

**Contract**: Add `/api/transactions`, `/api/portfolio`, `/api/locations` path prefixes to protection logic. When the request path starts with `/api/` and user is unauthenticated, return `new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })` instead of redirecting. The existing page-redirect behavior for non-API routes remains unchanged. Note: `/api/assets/search` and `/api/prices` also need auth — add them to the protected set.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `POST /api/transactions` with a valid USD-stablecoin DEPOSIT creates a transaction with target fields null and `price_usd = 1`
- `POST /api/transactions` with a valid BUY payload after a sufficient DEPOSIT creates a transaction in Supabase with `price_usd` populated from execution valuation
- `POST /api/transactions` with a backdated or manually overridden payload stores `price_usd` from the execution valuation, not the current market price at submit time
- `POST /api/transactions` with a BUY/SELL/SWAP source quantity exceeding holdings returns 409 error
- `POST /api/transactions` with invalid data returns 400 with descriptive Zod error message
- `GET /api/transactions` returns the created transactions
- `GET /api/locations` returns distinct locations from the user's transactions
- All API endpoints return 401 JSON when not authenticated (not a page redirect)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Transaction Form UI

### Overview

Build the React island components for transaction entry: asset autocomplete using CoinPaprika search, location autocomplete from existing transactions, a single adaptive form handling DEPOSIT/BUY/SELL/SWAP types, and a dialog wrapper. Wire the dialog to the dashboard page.

### Changes Required:

#### 1. Asset autocomplete component

**File**: `src/components/portfolio/AssetAutocomplete.tsx`

**Intent**: A combobox input that searches CoinPaprika for crypto assets as the user types. Uses the shadcn/ui Command component (which wraps `cmdk`) for the autocomplete pattern.

**Contract**: React component accepting `value: string`, `onChange: (coinId: string, symbol: string) => void`, `label: string`, and `placeholder: string` props. On input ≥ 2 characters, debounces 300ms then calls `GET /api/assets/search?q={input}`. Displays results as `Symbol — Name` (e.g., `BTC — Bitcoin`). On selection, calls `onChange` with the CoinPaprika coin ID and symbol. Renders inside a Popover to overlay the form.

#### 2. Transaction form component

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: The main form for creating DEPOSIT, BUY, SELL, and SWAP transactions. Adapts field labels and layout based on the selected type. Fetches price suggestion from CoinPaprika when the user selects an asset and date/time for trade types.

**Contract**: React component accepting `onSuccess: () => void` (called after successful submission to close dialog and refresh). Uses controlled state (no react-hook-form). Layout:

- **Type selector** at top — tabs or segmented control for DEPOSIT / BUY / SELL / SWAP
- **DEPOSIT mode**: fields for "Deposit [Amount] [Stablecoin AssetAutocomplete] to [Location] on [Date/Time]". Limit selectable assets to configured USD stablecoins. No price field is shown; server stores `price = 1` and `price_usd = 1`.
- **BUY mode**: fields for "Buy [Amount] [AssetAutocomplete] at [Price] per unit, paying with [AssetAutocomplete]" + computed payment shown
- **SELL mode**: fields for "Sell [Amount] [AssetAutocomplete] at [Price] per unit, receiving [AssetAutocomplete]" + computed proceeds shown
- **SWAP mode**: fields for "From [Amount] [AssetAutocomplete] → To [Amount] [AssetAutocomplete]" + computed rate shown
- **Common fields**: Location (free-text input with autocomplete from `/api/locations`) and Date/Time. Fee is shown only for BUY/SELL/SWAP and is optional.
- **Price suggestion**: for BUY/SELL/SWAP, when asset + date selected, fetches from `/api/prices?ids={coinId}&date={YYYY-MM-DD}` and pre-fills the price field. Shows "(suggested)" label. User can always override; the submitted override is the execution value used to derive `price_usd`.
- **Submit**: POSTs to `/api/transactions` with the mapped source/target payload. Shows validation errors from the server response. On success, calls `onSuccess`.

#### 3. Add transaction dialog

**File**: `src/components/portfolio/AddTransactionDialog.tsx`

**Intent**: A shadcn/ui Dialog wrapping the TransactionForm. Provides the modal overlay triggered by the "Add Transaction" button on the dashboard.

**Contract**: React component accepting `onTransactionCreated: () => void`. Contains a Dialog with trigger button (text: "Add Transaction", with a plus icon). Dialog title: "New Transaction". On form success, closes the dialog and calls `onTransactionCreated`.

#### 4. Wire dialog to dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the current placeholder dashboard with a minimal page that includes the Add Transaction dialog. The full portfolio table comes in Phase 6; this phase just enables transaction creation.

**Contract**: The page renders a heading ("Portfolio"), the `AddTransactionDialog` React component (with `client:load` directive for hydration), and a placeholder message for the portfolio table ("Portfolio view coming soon — add your first transaction above"). Keep the sign-out form. Protect the route (already in `PROTECTED_ROUTES`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Clicking "Add Transaction" opens a dialog with the transaction form
- Switching between DEPOSIT/BUY/SELL/SWAP updates field labels and layout
- DEPOSIT mode accepts a USD stablecoin opening balance without showing a price field
- Typing "bitcoin" in an asset field shows autocomplete results from CoinPaprika
- Selecting an asset and a date pre-fills a suggested price
- The price field is always editable (manual override works)
- Typing a location shows autocomplete from previously used locations
- Submitting a valid DEPOSIT transaction succeeds (dialog closes)
- Submitting a valid BUY transaction after a sufficient DEPOSIT succeeds (dialog closes)
- Submitting with missing fields shows validation errors
- The created transaction appears in Supabase Studio

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: P&L Engine & Portfolio API

### Overview

Build the Average Cost P&L calculation engine that replays the full transaction history to derive positions and realized P&L, combine it with current CoinPaprika prices for unrealized P&L, and expose the result via a portfolio API endpoint.

### Changes Required:

#### 1. P&L engine

**File**: `src/lib/pnl-engine.ts`

**Intent**: The core business logic module. Takes a chronologically sorted list of transactions and computes per-(asset, location) positions with average cost, realized P&L per disposal, and position summaries. This must be arithmetically correct — the PRD guardrail makes correctness non-negotiable.

**Contract**: Export function `computePositions(transactions: Transaction[]): PositionMap` where `PositionMap` maps `{asset, location}` to `{ quantity, total_cost_usd, realized_pnl }`. Algorithm:

For each transaction (sorted by `transaction_date` ASC):

1. **DEPOSIT**: if transaction type is DEPOSIT, increase the source asset position by `source_qty` and increase `total_cost_usd` by `source_qty × price_usd`; no realized P&L is recorded.
2. **Dispose source for BUY/SELL/SWAP**: if source position exists with qty > 0, compute `avg_cost = total_cost_usd / qty`. Record `realized_pnl += source_qty × (price_usd − avg_cost)`. Reduce position: `qty -= source_qty`, `total_cost_usd -= source_qty × avg_cost`.
3. **Acquire target for BUY/SELL/SWAP**: if two-sided trade (`target_asset` non-null), compute `cost_basis = source_qty × price_usd`. Increase position: `qty += target_qty`, `total_cost_usd += cost_basis`.

Legacy or incomplete transactions with `price_usd === null` are flagged as unpriced and excluded from P&L, but new S-01 transaction creation must not insert null valuations.

Also export `aggregateByAsset(positionMap): AssetSummary[]` which consolidates per-location positions into per-asset totals with weighted average cost and summed realized P&L.

#### 2. P&L engine tests

**File**: `src/lib/pnl-engine.test.ts`

**Intent**: Lock down Average Cost arithmetic with executable fixtures instead of relying only on spreadsheet/manual verification.

**Contract**: Vitest tests cover: USD-stablecoin DEPOSIT creates opening position at $1 cost basis; BUY after DEPOSIT reduces source stablecoin and creates BTC cost basis; multiple BUYs produce weighted average cost; partial SELL records realized P&L; SWAP disposes source and acquires target; full SELL marks zero-balance position closed; transactions with `price_usd === null` are flagged as unpriced.

#### 3. Schema validation tests

**File**: `src/lib/schemas.test.ts`

**Intent**: Lock down transaction request validation and insufficient-source edge cases before wiring UI behavior.

**Contract**: Vitest tests cover: valid USD-stablecoin DEPOSIT; non-stablecoin DEPOSIT rejected in S-01; DEPOSIT target fields rejected; valid BUY/SELL/SWAP payloads accepted; missing target fields for trades rejected; negative quantities and fees rejected.

#### 4. Portfolio service

**File**: `src/lib/portfolio-service.ts`

**Intent**: Orchestrates the portfolio computation: fetches transactions, runs the P&L engine, fetches current prices from CoinPaprika, and assembles the final portfolio response with unrealized P&L.

**Contract**: Export async function `getPortfolio(supabase, userId): Promise<PortfolioResponse>` where `PortfolioResponse` contains an array of `PortfolioAsset` objects, each with: `asset` (coin ID), `symbol`, `total_quantity`, `avg_cost_usd`, `current_price_usd`, `price_stale`, `unrealized_pnl_usd`, `total_realized_pnl_usd`, and `locations` (array of per-location positions with quantity, avg cost, unrealized P&L). Assets with zero total quantity are included but flagged as `is_closed: true`. The function:

1. Calls `getTransactions` to fetch all user transactions
2. Calls `computePositions` to derive positions and realized P&L
3. Extracts unique asset coin IDs from positions with qty > 0
4. Calls `getMultiplePrices` to fetch current USD prices in one batch
5. Assembles the response, computing `unrealized_pnl = qty × (current_price − avg_cost)` per position and preserving stale-price metadata for the UI

#### 5. Portfolio API endpoint

**File**: `src/pages/api/portfolio.ts`

**Intent**: Serves the computed portfolio data to the frontend. This is the main data source for the portfolio dashboard.

**Contract**: `GET /api/portfolio` → returns `{ data: PortfolioAsset[], stale: boolean, updated_at: string | null }`. Requires auth. Calls `getPortfolio` from the portfolio service. Returns `{ data: [], stale: false, updated_at: null }` if the user has no transactions.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build passes: `npm run build`
- Unit tests pass: `npm run test`

#### Manual Verification:

- With a DEPOSIT transaction (100 USDT), `GET /api/portfolio` returns a 100 USDT position with average cost $1
- With test transactions in the database (e.g., DEPOSIT 60000 USDT, BUY 1 BTC at 60000 USDT, then SELL 0.5 BTC at 62000 USDT):
  - `GET /api/portfolio` returns correct position (0.5 BTC remaining)
  - Average cost matches: $60,000 per BTC
  - Realized P&L on the SELL matches: 0.5 × ($62,000 − $60,000) = $1,000
  - Unrealized P&L computed against current CoinPaprika price
  - Per-location breakdown shows correct quantities
- With a SWAP transaction (10 ETH → 0.5 BTC), verify cost basis of BTC = 10 × ETH_price_usd / 0.5
- With a BUY attempted before the source asset has been deposited, verify the API rejects it with 409
- With a backdated or manually overridden transaction, verify P&L uses the stored execution valuation rather than the current market price
- With zero-balance asset (sold all), position appears with `is_closed: true` and realized P&L preserved

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Portfolio Dashboard UI

### Overview

Build the full portfolio dashboard as a React island: a table showing per-asset positions with expandable per-location breakdown, auto-refreshing prices via 20-second polling, a toggle for zero-balance assets, and the Add Transaction dialog integration. This replaces the placeholder from Phase 4.

### Changes Required:

#### 1. Portfolio table component

**File**: `src/components/portfolio/PortfolioTable.tsx`

**Intent**: Renders the per-asset portfolio table with expandable per-location rows. Each asset row shows consolidated data; clicking expands to reveal location-level detail.

**Contract**: React component accepting `assets: PortfolioAsset[]`, `showClosed: boolean` props. Uses shadcn/ui Table. Columns: Asset (symbol + name), Quantity, Avg Cost (USD), Current Price (USD), Unrealized P&L (USD, colored green/red), Realized P&L (USD). Each row is expandable — clicking reveals sub-rows for each location with: location name, quantity at location, unrealized P&L at location. When `showClosed` is false, assets with `is_closed: true` are hidden. P&L values formatted with $ sign, 2 decimal places, green for positive, red for negative.

#### 2. Portfolio view island component

**File**: `src/components/portfolio/PortfolioView.tsx`

**Intent**: The main React island for the portfolio page. Manages data fetching, auto-refresh, and state. This is the single hydrated island on the dashboard page.

**Contract**: React component. On mount, fetches `GET /api/portfolio` for initial data. Sets up a 20-second interval to fetch `GET /api/prices?ids={held asset IDs}` and update current prices + unrealized P&L in-place (positions don't change, only prices). The interval must pause while `document.visibilityState === "hidden"` and resume with one refresh when the tab becomes visible. Provides:

- A "Show closed positions" toggle (checkbox/switch)
- The PortfolioTable with current data
- The AddTransactionDialog — on transaction created, re-fetches full portfolio data
- A loading state (skeleton) during initial fetch
- An empty state ("No positions yet — add your first transaction") when portfolio is empty
- A subtle "Last updated: HH:MM:SS" indicator showing when prices were last refreshed, plus a stale-price state when the API returns cached stale data

#### 3. Dashboard page rewrite

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the Phase 4 placeholder with the full portfolio dashboard. Server-renders the page shell with the PortfolioView React island.

**Contract**: The Astro page renders the Layout with title "Portfolio — VaultView", a page header with "Portfolio" heading + sign-out button, and the `<PortfolioView client:load />` island. All data fetching happens client-side within the island (the SSR page just provides the shell). Route remains protected via middleware.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Dashboard shows portfolio table with correct data after creating test transactions
- Expanding an asset row shows per-location breakdown
- Prices auto-refresh every ~20 seconds (visible price changes for volatile assets, or "Last updated" timestamp changes)
- Price polling pauses while the browser tab is hidden and resumes when visible
- If the price API returns `stale: true`, the dashboard keeps rendering cached prices with a visible stale-price state
- Adding a transaction via the dialog refreshes the portfolio table with updated positions and P&L
- Zero-balance assets are hidden by default; toggling "Show closed positions" reveals them
- Empty state shown when user has no transactions
- Loading skeleton shown during initial data fetch
- P&L values are colored green (positive) and red (negative)
- No UI errors in browser console

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- P&L engine: test `computePositions` with known transaction sequences and verify against manually calculated results
- P&L edge cases: stablecoin deposit, buy after deposit, buy before deposit rejected, multiple buys at different prices, partial sells, full sells, swaps, zero-balance positions
- Zod schemas: test validation accepts good data and rejects bad data (missing fields, wrong types, negative quantities)

### Integration Tests:

- Transaction creation → portfolio computation → correct P&L (end-to-end through services)
- Insufficient-source validation: attempt to BUY/SELL/SWAP more source asset than held → 409 error
- CoinPaprika client: graceful handling when API is unreachable

### Manual Testing Steps:

1. Sign up and log in
2. Try to BUY 1 BTC without a prior USDT deposit; verify the API/UI returns insufficient source holdings
3. Create a DEPOSIT transaction: Deposit 200000 USDT on Binance
4. Create a BUY transaction: Buy 2 BTC at 60000 USDT on Binance
5. Create another BUY: Buy 1 BTC at 63000 USDT on Binance
6. Verify portfolio shows: BTC — qty 3, avg cost $61,000, unrealized P&L based on current price; USDT reduced by 183000
7. Create a SELL: Sell 1 BTC at 65000 USDT on Binance
8. Verify: BTC — qty 2, avg cost $61,000, realized P&L = $4,000; USDT increases by 65000
9. Attempt a DEPOSIT transaction for 5 ETH on MetaMask; verify it is rejected in S-01 because non-stablecoin historical-cost DEPOSIT belongs to S-05
10. Create a DEPOSIT transaction: Deposit 15000 USDT on MetaMask, then BUY 5 ETH at 3000 USDT on MetaMask
11. Verify: portfolio shows BTC (Binance), ETH (MetaMask), and remaining USDT balances with per-location detail
12. Create a SWAP: Swap 2 ETH for 0.1 BTC on MetaMask
13. Verify: ETH qty decreased by 2 at MetaMask, BTC qty increased by 0.1 at MetaMask with correct cost basis
14. Wait 20+ seconds — verify prices refresh without page reload
15. Toggle "Show closed positions" — verify behavior

## Performance Considerations

- **P&L computation**: O(n) where n = transaction count. Acceptable for MVP (personal tracker with ~hundreds of transactions). If performance degrades, introduce caching or materialized views in a later slice.
- **CoinPaprika calls**: client UI may poll `/api/prices` every 20s while visible, but the server must cache current prices for 120s and dedupe requests across tabs/users in the same worker isolate. Without caching, one always-open dashboard at one external call every 20s is 4,320 calls/day (~129,600/month), which exceeds the 20K/month free tier. With a 120s TTL, one visible dashboard is at most 30 external current-price refreshes/hour; 20K/month supports ~666 active visible dashboard hours/month before historical/search calls. If the cache is stale and CoinPaprika is unavailable or rate-limited, return stale cached prices with a stale flag instead of breaking the dashboard.
- **Supabase queries**: single query to fetch all user transactions per portfolio load. RLS handles filtering. Index on `(user_id, transaction_date DESC)` already exists.

## Migration Notes

- **Schema migration**: adds nullable `price_usd` column — non-breaking, no data migration needed for existing rows
- **Middleware change**: adds JSON 401 behavior for `/api/*` paths — non-breaking, existing auth redirects for page routes unchanged
- **Dashboard rewrite**: replaces the placeholder page — no backwards compatibility concern since it had no real content
- **Run `npx supabase db reset`** after Phase 1 to apply the new migration

## References

- Roadmap: `context/foundation/roadmap.md` — S-01 slice definition
- PRD: `context/foundation/prd.md` — US-01, US-02, FR-003, FR-007, FR-008, FR-012, FR-013
- Tech stack: `context/foundation/tech-stack.md` — CoinPaprika API details
- Existing schema: `supabase/migrations/20260614213523_create_transactions.sql`
- Existing types: `src/types.ts`
- Auth API pattern: `src/pages/api/auth/signin.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & Dependencies

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — bf767fc
- [x] 1.2 Type checking passes: `npm run lint` — bf767fc
- [x] 1.3 Build passes: `npm run build` — bf767fc
- [x] 1.4 shadcn/ui components exist in `src/components/ui/` — bf767fc
- [x] 1.5 Zod is in `package.json` dependencies — bf767fc
- [x] 1.6 Vitest is in devDependencies and `npm run test` is defined — bf767fc

#### Manual

- [x] 1.7 Supabase Studio shows `price_usd` column on `transactions` table — bf767fc

### Phase 2: CoinPaprika Integration

#### Automated

- [x] 2.1 Type checking passes: `npm run lint`
- [x] 2.2 Build passes: `npm run build`

#### Manual

- [x] 2.3 `GET /api/assets/search?q=bitcoin` returns CoinPaprika results
- [x] 2.4 `GET /api/prices?ids=btc-bitcoin,eth-ethereum` returns current USD prices
- [x] 2.5 `GET /api/prices?ids=btc-bitcoin&date=2026-01-15` returns historical USD price
- [x] 2.6 Repeated price requests inside TTL use cached values
- [x] 2.7 Failed price refresh returns cached stale prices
- [x] 2.8 Asset and price endpoints return 401 when unauthenticated

### Phase 3: Transaction Backend

#### Automated

- [ ] 3.1 Type checking passes: `npm run lint`
- [ ] 3.2 Build passes: `npm run build`

#### Manual

- [ ] 3.3 POST valid USD-stablecoin DEPOSIT creates target-null transaction with `price_usd = 1`
- [ ] 3.4 POST valid BUY after sufficient DEPOSIT creates transaction with `price_usd` populated
- [ ] 3.5 POST backdated/manual trade stores execution valuation, not current market price
- [ ] 3.6 POST BUY/SELL/SWAP exceeding source holdings returns 409
- [ ] 3.7 POST invalid data returns 400 with Zod error
- [ ] 3.8 GET /api/transactions returns created transactions
- [ ] 3.9 GET /api/locations returns distinct locations
- [ ] 3.10 All API endpoints return 401 JSON when unauthenticated

### Phase 4: Transaction Form UI

#### Automated

- [ ] 4.1 Type checking passes: `npm run lint`
- [ ] 4.2 Build passes: `npm run build`

#### Manual

- [ ] 4.3 "Add Transaction" button opens dialog with form
- [ ] 4.4 DEPOSIT/BUY/SELL/SWAP toggle updates field labels
- [ ] 4.5 DEPOSIT mode accepts USD stablecoin opening balance without price field
- [ ] 4.6 Asset autocomplete shows CoinPaprika results
- [ ] 4.7 Price suggestion pre-fills on asset selection
- [ ] 4.8 Price field remains editable after suggestion
- [ ] 4.9 Location autocomplete shows prior locations
- [ ] 4.10 Valid DEPOSIT submission succeeds and dialog closes
- [ ] 4.11 Valid BUY submission after sufficient DEPOSIT succeeds and dialog closes
- [ ] 4.12 Invalid submission shows validation errors
- [ ] 4.13 Created transaction appears in Supabase Studio

### Phase 5: P&L Engine & Portfolio API

#### Automated

- [ ] 5.1 Type checking passes: `npm run lint`
- [ ] 5.2 Build passes: `npm run build`
- [ ] 5.3 Unit tests pass: `npm run test`

#### Manual

- [ ] 5.4 Portfolio shows stablecoin position after DEPOSIT
- [ ] 5.5 Portfolio shows correct position after BUY
- [ ] 5.6 Average cost correct after multiple BUYs at different prices
- [ ] 5.7 Realized P&L correct after partial SELL
- [ ] 5.8 Unrealized P&L computed against current CoinPaprika price
- [ ] 5.9 Per-location breakdown shows correct quantities
- [ ] 5.10 SWAP correctly updates both asset positions
- [ ] 5.11 Zero-balance assets marked as closed
- [ ] 5.12 Backdated/manual transaction P&L uses stored execution valuation
- [ ] 5.13 BUY before source DEPOSIT is rejected and cannot produce negative holdings

### Phase 6: Portfolio Dashboard UI

#### Automated

- [ ] 6.1 Type checking passes: `npm run lint`
- [ ] 6.2 Build passes: `npm run build`

#### Manual

- [ ] 6.3 Portfolio table displays correct data
- [ ] 6.4 Asset rows expand to show per-location breakdown
- [ ] 6.5 Prices auto-refresh every ~20 seconds
- [ ] 6.6 Price polling pauses while tab is hidden and resumes when visible
- [ ] 6.7 Stale price state renders when API returns cached stale prices
- [ ] 6.8 Adding transaction via dialog refreshes portfolio
- [ ] 6.9 Zero-balance toggle works correctly
- [ ] 6.10 Empty state shown with no transactions
- [ ] 6.11 Loading skeleton shown during initial fetch
- [ ] 6.12 P&L values colored green/red appropriately
- [ ] 6.13 No console errors during normal usage
