# Transaction List with Filters — Implementation Plan

## Overview

Add a dedicated `/transactions` page where the user browses their full transaction history, filtered by type (BUY/SELL/SWAP/DEPOSIT/WITHDRAW), location, and asset. Each row shows the core trade fields (date, type, source asset + quantity, target asset + quantity, price, fee, location) plus a computed **per-transaction realized P&L**. This satisfies PRD **FR-011** (roadmap slice **S-04**).

The data already exists — `GET /api/transactions` returns the full list — so the only backend work is enriching each row with realized P&L (a clean extension of the existing P&L engine). The rest is a new React island + Astro page following established conventions.

## Current State Analysis

- **Transactions are already queryable.** `getTransactions()` (`src/lib/transaction-service.ts:222`) returns all of a user's transactions ordered by `transaction_date` asc, then `created_at` asc. `GET /api/transactions` (`src/pages/api/transactions.ts:34`) exposes this as `{ data: Transaction[] }`.
- **No transaction list UI exists.** `dashboard.astro` mounts `PortfolioView`, which shows only the *aggregated* portfolio (positions per asset/location) — never the raw transaction rows.
- **Realized P&L is computed, but only in aggregate.** `computePositions()` (`src/lib/pnl-engine.ts:37`) replays transactions and, at the disposal step (lines 66–72), computes `realizedPnl = source_quantity * (price_usd − avgCost)` for the source position — but folds it into the position total. It is never surfaced per transaction.
- **Assets are stored as CoinPaprika IDs**, not symbols — `source_asset`/`target_asset` hold values like `btc-bitcoin`, `usdt-tether`, `usdc-usd-coin`. The `Transaction` row has no symbol field. CoinPaprika IDs follow the `{symbol}-{name}` convention, so the symbol is the substring before the first `-`.
- **Filter inputs are partly ready.** `GET /api/locations` (`src/pages/api/locations.ts`) returns distinct locations; the type set is the fixed `TransactionType` enum (`src/types.ts:1`). Assets must be derived from the transaction rows themselves.
- **Strong UI conventions exist.** shadcn `Table`, `Select`, `Badge`, `Card`, `Button` are installed under `src/components/ui/`. Formatting helpers `formatUsd` / `pnlColor` live in `src/lib/format.ts`. React islands fetch their own data client-side and are mounted with `client:load` (`PortfolioView` / `dashboard.astro` pattern). Dark theme throughout (`bg-neutral-950`, `border-white/10`, `text-white/70`).

### Key Discoveries:

- Per-transaction realized P&L is a **pure extension** of the existing engine math — capture the already-computed `realizedPnl` value (`pnl-engine.ts:68`) into a `Map<txId, number>` instead of only summing it. No change to the numbers the portfolio already shows.
- The DEPOSIT branch (`pnl-engine.ts:58`) has no disposal → no realized P&L (display `—`). Every other type flows through the generic source path, so **WITHDRAW is forward-compatible** when S-06 lands — it will get realized P&L for free.
- The `quantity > 0` clamp (`pnl-engine.ts:66`) means an over-sell records `0` realized P&L for the skipped portion. The deterministic `(transaction_date, created_at)` sort (`pnl-engine.ts:46`) is what makes this correct — see `context/foundation/lessons.md` ("Order P&L transactions deterministically"). The per-tx map must be populated **inside** that same sorted loop so it inherits the correct ordering.
- Unpriced transactions (`price_usd === null`, `pnl-engine.ts:53`) are skipped by the engine → their realized P&L is unknown → display `—` (null), not `0`.
- Adding a nullable `realized_pnl_usd` field to the `GET /api/transactions` response is **non-breaking** — no current consumer depends on the shape beyond reading existing fields.

## Desired End State

Navigating to `/transactions` (linked from the dashboard header) shows a table of all the user's transactions, newest first, each row displaying: date, type (as a badge), source (symbol + quantity), target (symbol + quantity, or `—` for one-sided ops), price, fee, location, and realized P&L (green/red, or `—` where not applicable). Three `Select` filters (Type, Location, Asset) above the table narrow results with AND logic; Location and Asset options are derived from the user's own transactions; each defaults to "All". An empty filter result shows a clear message. The page fetches once on load (no polling).

**Verification:** With seeded transactions, the page lists them newest-first; selecting `Type = SELL` shows only SELL rows; adding a `Location` filter narrows further (AND); the Asset filter matches transactions where the asset is on **either** the source or target side; realized P&L on a SELL row matches an independent average-cost spreadsheet calculation; DEPOSIT and unpriced rows show `—` for realized P&L.

## What We're NOT Doing

- **No editing or deleting** transactions from this view — read-only list.
- **No pagination / virtualization** — MVP scale is small; render all rows. (Noted as a future option, not built.)
- **No new price/API calls** — realized P&L uses stored `price_usd`; symbols are derived from IDs, not fetched.
- **No change to the portfolio/dashboard P&L numbers** — the engine's aggregate output is untouched; we only add a parallel per-transaction map.
- **No date-range filter, search box, or sorting controls** — only the three filters FR-011 specifies; sort is fixed newest-first.
- **No CSV/export** — out of scope.

## Implementation Approach

Two phases, each independently verifiable:

1. **Engine + API** — Extend `computePositions()` to also return a `realizedByTx: Map<string, number>` populated in the existing sorted loop. Add a `symbolFromId()` helper. Add a service function that fetches transactions and annotates each with `realized_pnl_usd`. Enrich `GET /api/transactions` to return the annotated rows (nullable field, non-breaking).
2. **UI** — New `/transactions` Astro page mounting a `TransactionList` React island: filter `Select`s (type/location/asset) with "All" defaults and data-derived options, a shadcn `Table` of core fields + realized P&L, newest-first, empty states, plus a nav link from the dashboard.

## Critical Implementation Details

**State sequencing.** The per-transaction realized P&L map MUST be written inside the existing sorted-loop in `computePositions` (`pnl-engine.ts:52`), at the same point the disposal P&L is computed (line 68), so it inherits the deterministic `(transaction_date, created_at)` ordering. Computing it in a separate pass — or after sorting differently — reintroduces the phantom-position / dropped-realized-P&L bug documented in `context/foundation/lessons.md`. Record `0` realized P&L for clamped over-sells (the `else` of `quantity > 0`), and leave DEPOSIT / unpriced transactions absent from the map (→ surfaced as `null`).

## Phase 1: Engine + API — per-transaction realized P&L

### Overview

Surface realized P&L per transaction without altering the aggregate P&L the portfolio already shows, and expose it on the transactions API. Add a shared `symbolFromId` helper for display.

### Changes Required:

#### 1. P&L engine — emit realized P&L per transaction

**File**: `src/lib/pnl-engine.ts`

**Intent**: Capture the per-disposal realized P&L (already computed at line 68) into a transaction-keyed map so callers can show it per row, while keeping the existing aggregate behavior identical.

**Contract**: `computePositions(transactions)` return type gains `realizedByTx: Map<string, number>` (key = `Transaction.id`, value = realized P&L in USD). Populated inside the existing sorted loop: for each non-DEPOSIT priced transaction, set `realizedByTx.set(tx.id, realizedPnl)` where `realizedPnl` is the value already computed for the source disposal — `0` when the `quantity > 0` clamp skips the disposal. DEPOSIT and unpriced transactions are not added to the map. `ComputeResult` interface extended accordingly; existing `positions` / `unpriced` fields unchanged.

#### 2. Symbol-from-ID helper

**File**: `src/lib/format.ts`

**Intent**: Render readable asset symbols (`BTC`) from CoinPaprika IDs (`btc-bitcoin`) without an API call, reusable by the list UI and filter options.

**Contract**: `symbolFromId(id: string): string` — returns the uppercased substring before the first `-` (e.g. `btc-bitcoin` → `BTC`, `usdt-tether` → `USDT`); returns the uppercased input unchanged when there is no `-`.

#### 3. Transaction-list service — annotate rows with realized P&L

**File**: `src/lib/transaction-service.ts`

**Intent**: Provide a single call that returns transactions enriched with their realized P&L, reusing the engine so the math stays in one place.

**Contract**: New exported `TransactionWithPnl = Transaction & { realized_pnl_usd: number | null }` (declare in `src/types.ts`). New function `getTransactionsWithPnl(supabase, userId): Promise<TransactionWithPnl[]>` — calls `getTransactions()`, runs `computePositions()`, and maps each transaction to include `realized_pnl_usd = realizedByTx.get(tx.id) ?? null`. Returns rows in the engine's chronological order (the API/UI handles display ordering).

#### 4. Enrich the transactions API response

**File**: `src/pages/api/transactions.ts`

**Intent**: Serve the annotated rows so the list page gets realized P&L without a second round-trip.

**Contract**: `GET` handler calls `getTransactionsWithPnl()` instead of `getTransactions()`; response stays `{ data: TransactionWithPnl[] }` (additive `realized_pnl_usd` field). `POST` handler unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or `npx astro check`)
- Linting passes: `npm run lint`
- `computePositions()` returns a `realizedByTx` map whose entries match the realized P&L folded into positions for the same inputs (existing aggregate unchanged).

#### Manual Verification:

- `GET /api/transactions` returns each row with a `realized_pnl_usd` field; a known SELL's value matches a hand-computed average-cost figure.
- DEPOSIT rows and any unpriced rows show `realized_pnl_usd: null`.
- The dashboard portfolio numbers are unchanged (no regression in aggregate P&L).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Transaction list page + filters

### Overview

Build the `/transactions` page and its `TransactionList` island: filter controls, the table, newest-first ordering, empty states, and a dashboard nav link.

### Changes Required:

#### 1. TransactionList React island

**File**: `src/components/portfolio/TransactionList.tsx` (new)

**Intent**: Fetch the enriched transactions once, render them newest-first in a table, and provide three AND-combined `Select` filters whose Location/Asset options come from the data.

**Contract**: Default-exported (or named) React component, no props; fetches `GET /api/transactions` on mount (`useEffect`), stores `TransactionWithPnl[]`. Derives filter option lists from the loaded data: Type = the fixed `TransactionType` set actually present; Location = distinct `location` values; Asset = distinct `source_asset` ∪ `target_asset` IDs, displayed via `symbolFromId`. Three `Select` controls (shadcn `ui/select`) each defaulting to an "All" sentinel. Filtering is AND across the three; the Asset filter matches when the selected ID equals `source_asset` **or** `target_asset`. Rows sorted newest-first (reverse of the chronological fetch — sort by `transaction_date` desc, `created_at` desc). Columns: Date, Type (badge), Source (symbol + qty), Target (symbol + qty or `—`), Price, Fee, Location, Realized P&L. Use `formatUsd` for price/fee/P&L, `pnlColor` for the P&L cell, `symbolFromId` for assets; reuse `formatQty` (lift from `PortfolioTable` into `format.ts` if shared, otherwise local). Loading and "no matching transactions" empty states. No polling.

**Contract (formatQty reuse)**: If `formatQty` is shared, move it to `src/lib/format.ts` and update `PortfolioTable.tsx:15` import; otherwise define a local copy. Implementer's choice — prefer extraction to avoid duplication.

#### 2. /transactions Astro page

**File**: `src/pages/transactions.astro` (new)

**Intent**: Server-rendered protected page that mounts the island, matching the dashboard's layout shell.

**Contract**: `export const prerender = false`. Wraps `Layout` with the dark page shell (`min-h-screen bg-neutral-950 p-6 text-white`, `max-w-5xl` container) and a header (`Transactions` title + a link back to the dashboard). Mounts `<TransactionList client:load />`. Add `/transactions` to `PROTECTED_ROUTES` in `src/middleware.ts`.

#### 3. Dashboard nav link

**File**: `src/pages/dashboard.astro`

**Intent**: Let users reach the new page from the portfolio.

**Contract**: Add a `Transactions` link/button in the dashboard header (alongside the existing title / sign-out), navigating to `/transactions`, styled to match existing header controls.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or `npx astro check`)
- Linting passes: `npm run lint`

#### Manual Verification:

- `/transactions` loads while authenticated; unauthenticated access redirects to sign-in (route is protected).
- All transactions render newest-first with correct field values; assets show as symbols (e.g. `BTC`), DEPOSIT/WITHDRAW show `—` for target.
- `Type = SELL` shows only SELL rows; adding `Location = Binance` narrows further (AND); the Asset filter shows rows where the asset is source **or** target; resetting each filter to "All" restores the full list.
- Location and Asset dropdowns list only values present in the user's transactions; each defaults to "All".
- An over-restrictive filter combination shows the "no matching transactions" empty state.
- The dashboard header link navigates to `/transactions` and back.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- The project has no test runner configured; verification is via `npm run build` (type check) + `npm run lint` + manual checks. If a quick sanity check is desired, a throwaway script asserting `computePositions().realizedByTx` sums to each position's `realized_pnl` is sufficient — do not add a test framework as part of this change.

### Manual Testing Steps:

1. Seed (or use existing) transactions spanning multiple types, locations, and assets, including at least one DEPOSIT and one full SELL.
2. Open `/transactions`; confirm newest-first order and correct per-row values.
3. Cross-check one SELL's realized P&L against a manual average-cost computation (per `context/foundation/lessons.md` — verify cost basis matches form price).
4. Exercise each filter individually, then in combination (AND); verify the Asset filter matches both sides.
5. Confirm DEPOSIT and any unpriced row show `—` for realized P&L.
6. Verify empty-state messaging and the dashboard link round-trip.

## Performance Considerations

MVP scale (personal tracker, low transaction count) — rendering all rows client-side and computing realized P&L over the full history per request is acceptable. The engine replay is O(n) and already runs for the portfolio. No indexing or pagination needed; revisit only if a user's history grows into the thousands.

## Migration Notes

No schema or data migration. The `realized_pnl_usd` field is computed at request time, not stored.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-04, `transaction-list-filters`)
- PRD: FR-011 (`context/foundation/prd.md`)
- Lessons: `context/foundation/lessons.md` — deterministic P&L ordering; cost-basis verification
- P&L engine: `src/lib/pnl-engine.ts:37` (`computePositions`)
- Transactions service / API: `src/lib/transaction-service.ts:222`, `src/pages/api/transactions.ts:34`
- UI patterns: `src/components/portfolio/PortfolioTable.tsx`, `src/components/portfolio/PortfolioView.tsx`, `src/pages/dashboard.astro`
- Formatting helpers: `src/lib/format.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Engine + API — per-transaction realized P&L

#### Automated

- [x] 1.1 Type checking passes (`npm run build` / `npx astro check`)
- [x] 1.2 Linting passes (`npm run lint`)
- [x] 1.3 `computePositions().realizedByTx` matches aggregate realized P&L for the same inputs

#### Manual

- [x] 1.4 `GET /api/transactions` rows include `realized_pnl_usd`; a known SELL matches a hand-computed figure
- [x] 1.5 DEPOSIT and unpriced rows return `realized_pnl_usd: null`
- [x] 1.6 Dashboard portfolio aggregate P&L unchanged (no regression)

### Phase 2: Transaction list page + filters

#### Automated

- [ ] 2.1 Type checking passes (`npm run build` / `npx astro check`)
- [ ] 2.2 Linting passes (`npm run lint`)

#### Manual

- [ ] 2.3 `/transactions` loads when authenticated; unauthenticated redirects to sign-in
- [ ] 2.4 Rows render newest-first with correct values; assets show as symbols; DEPOSIT/WITHDRAW target shows `—`
- [ ] 2.5 Filters combine with AND; Asset matches source OR target; "All" resets
- [ ] 2.6 Location/Asset options derived from data, default "All"
- [ ] 2.7 Over-restrictive filter shows empty-state message
- [ ] 2.8 Dashboard header link round-trips to `/transactions`
