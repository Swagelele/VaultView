# Sell-All Global Implementation Plan

## Overview

Let the user sell an asset across **all** locations in one operation, with per-location target asset and fee (FR-004, roadmap S-08). A "Sell all" control on each portfolio asset row opens a dialog seeded from the row's existing per-location holdings. The user sees one row per location (each deselectable, each with an editable target asset and fee), a single shared editable price and datetime, and an inline proceeds summary. Submitting once creates one SELL transaction per selected location, atomically, via a new batch endpoint. The P&L engine and single-transaction service are untouched — each created row is identical in shape to what today's single-location SELL produces.

## Current State Analysis

The portfolio data layer already exposes everything the dialog needs:

- `PortfolioAsset.locations[]` (`src/types.ts`) carries `{ location, quantity, avg_cost_usd, unrealized_pnl }` per location, and the asset row carries `current_price_usd`. `PortfolioTable.tsx` already renders this as an expandable per-location breakdown. The dialog can be seeded entirely from the `PortfolioAsset` object the table already holds — **no new fetches** to build the form.
- Transactions are created one-at-a-time: `POST /api/transactions` → `createTransaction()` (`src/lib/transaction-service.ts:77`) validates the holding via `getHoldingAtLocation()` and resolves `price_usd` via `resolvePriceUsd()`, then inserts a single row.
- The single-location SELL payload (`TransactionForm.tsx:131-140`, `buildPayload()`) is: `source_asset` = sold asset, `source_quantity` = qty, `target_asset`, `target_quantity = qty × price`, `price` = USD/unit of source, `fee`, `location`, `transaction_date`. Global sell-all mirrors this once per location.
- Locations are free-text strings on `transactions.location` (no locations table); balances are computed per-location and are independent across locations, so a multi-location batch has no cross-row interference.
- `createTransactionSchema` (`src/lib/schemas.ts:22`) validates a single transaction and accepts an optional `source_price_usd_override` and `fee` (default 0).

What's missing:

- No way to create more than one transaction per request.
- No multi-location form UI.
- No trigger on the portfolio rows.

### Key Discoveries:

- Per-location quantities are already on the client in `PortfolioAsset.locations[]` — `src/types.ts` (`PortfolioAssetLocation`), rendered at `PortfolioTable.tsx:89-107`.
- `current_price_usd` on the asset row is the natural default for the shared sell price — `PortfolioTable.tsx:78`.
- `getHoldingAtLocation(supabase, userId, asset, location)` (`transaction-service.ts:12-41`) is the authoritative per-location balance and must be re-checked server-side at submit (the client `locations[]` snapshot can be stale).
- `resolvePriceUsd(...)` (`transaction-service.ts:43-75`) already resolves USD valuation for a SELL; the batch service reuses it per row rather than reimplementing pricing.
- `createTransaction()` does `getHoldingAtLocation` + `resolvePriceUsd` + single `.insert(row)`. The batch service follows the same steps but validates **all** rows before any insert, then bulk-inserts.
- `AddTransactionDialog.tsx` shows the established Dialog + `onTransactionCreated()` refresh pattern; `SellAllDialog` follows it. `PortfolioView.handleTransactionCreated()` (`PortfolioView.tsx:116`) re-fetches `/api/portfolio` — reuse this same refresh callback.
- shadcn components available: `Dialog`, `Button`, `Input`, `Label`, `Table`, `Tabs`, `Popover`, `Command`, `Badge` (`src/components/ui/`). `AssetAutocomplete` is reusable per-row for the target picker.

## Desired End State

On the portfolio table, each asset row with a holding shows a "Sell all" control. Clicking it opens a dialog titled e.g. "Sell all BTC". The dialog lists one row per location where the user holds BTC, each pre-checked, showing the location name and quantity, with an `AssetAutocomplete` target picker (restricted to USD stablecoins) defaulting to USDT and a fee input. Above the rows is one shared "Price per unit (USD)" field (prefilled from current market price, editable) and one shared "Date & Time" field (default now, editable). A summary line reads e.g. "Selling 3 positions → ~$X total proceeds". Clicking "Sell All" creates one SELL per selected location atomically; on success the dialog closes and the portfolio refreshes, showing the sold positions closed. If any location fails validation server-side, nothing is created and the dialog shows which location(s) failed and why.

**Verification**: Deposit USDT and BUY BTC at two locations ("Binance" and "MetaMask") so BTC shows in both. On the portfolio BTC row, click "Sell all" → dialog lists both locations with their quantities, target defaulted to USDT. Submit → two SELL transactions created, BTC position closes to zero across both locations, realized P&L reflects both closes.

## What We're NOT Doing

- No changes to the P&L engine (`pnl-engine.ts`) or to `createTransaction()` — the batch path produces identical row shapes.
- No fix to the pre-existing crypto-to-crypto `target_quantity` modelling (a non-stablecoin target's quantity is stored as a USD figure, giving wrong P&L — see `pnl-engine.ts:67-72`). To stay within the PRD arithmetic-correctness guardrail, **sell-all targets are restricted to USD stablecoins this slice** so the quirk is never triggered. Per-location non-stablecoin targets (FR-004's BTC→ETH example) are **deferred** until the S-01 crypto-to-crypto model is corrected; re-enabling them is then just removing the stablecoin filter.
- No per-location price or per-location datetime (one shared each).
- No best-effort partial submit — it is strictly all-or-nothing.
- No global sell-all entry point in `TransactionForm` (portfolio row only).
- No new migration or schema column — reuses the existing `transactions` table.
- No two-step confirmation modal — a single inline summary + submit.
- No DEPOSIT/BUY/WITHDRAW batching.

## Implementation Approach

Phase 1 builds the server contract: a Zod schema for the batch request, a `createSellAllGlobal()` service function that validates every location (holding sufficiency + USD price resolution) before inserting anything, then performs one bulk insert; and a `POST /api/transactions/batch` endpoint. Phase 2 builds the `SellAllDialog` React component seeded from the `PortfolioAsset` object and wires a "Sell all" trigger into each `PortfolioTable` row, reusing the existing portfolio-refresh callback. Backend-first so the UI builds against a known contract.

## Critical Implementation Details

- **Server-side re-validation is mandatory.** The dialog seeds quantities from the client's `PortfolioAsset.locations[]` snapshot, which can be stale (price polling refreshes the portfolio every 20s, and the user may have other tabs open). `createSellAllGlobal()` must recompute each location's holding via `getHoldingAtLocation()` and use that authoritative quantity — not trust a client-supplied quantity — so a SELL never oversells. Per the all-or-nothing decision, if any location's recomputed holding is ≤ 0 or any row's `price_usd` cannot resolve, abort the whole batch with a descriptive error naming the location(s); insert nothing.
- **Atomicity via single insert.** Build all validated rows first, then call `supabase.from("transactions").insert(rows).select()` once. A single multi-row insert is the atomic unit — either all rows land or the call errors and none do. Do not loop per-row inserts.
- **Price/cost-basis parity (lessons.md).** The shared price the user sees in the dialog must be the `price` and drive `price_usd` for every created row, so recorded cost basis matches what the user saw at submit. Pass the shared price as the per-row `source_price_usd_override` into `resolvePriceUsd` (or set `price_usd` directly from it) rather than re-fetching market price server-side.

## Phase 1: Backend — batch sell-all endpoint + service

### Overview

Add the request schema, the `createSellAllGlobal()` service function (all-or-nothing validation + atomic bulk insert), and the `POST /api/transactions/batch` endpoint. No UI in this phase; verified via build/lint and a manual API call.

### Changes Required:

#### 1. Batch sell-all request schema

**File**: `src/lib/schemas.ts`

**Intent**: Add a Zod schema describing the batch sell-all request: the sold asset, the shared price, the shared transaction date, and an array of per-location rows (location + target asset + optional fee). Quantities are NOT accepted from the client — the server computes them — so the schema deliberately omits per-row quantity.

**Contract**: Export `createSellAllGlobalSchema` and its inferred type `CreateSellAllGlobalInput`. Shape:
- `source_asset: string` (min 1) — the asset being sold.
- `price: number` (positive) — shared USD price per unit of the sold asset.
- `transaction_date: string` (min 1).
- `locations: array` (min 1) of `{ location: string (min 1), target_asset: string (min 1), fee: number (min 0, default 0) }`.

Add a `superRefine` (or `.refine`) that (a) rejects duplicate `location` values within `locations`, and (b) rejects any row whose `target_asset` is not a USD stablecoin via `isUsdStablecoin` — this enforces the F1 scope restriction server-side, so a wrong-P&L crypto-to-crypto target can't slip through even if the client is bypassed.

#### 2. `createSellAllGlobal()` service function

**File**: `src/lib/transaction-service.ts`

**Intent**: Validate every requested location against the authoritative server-side holding and resolve a USD price for each, all-or-nothing, then bulk-insert one SELL row per location. Reuses `getHoldingAtLocation()` and `resolvePriceUsd()` so per-row semantics match `createTransaction()`.

**Contract**: `export async function createSellAllGlobal(supabase, userId, data: unknown): Promise<ServiceResult<Transaction[]>>`.

Algorithm:
1. `createSellAllGlobalSchema.safeParse(data)`; on failure return `{ error, status: 400 }` (same message-join pattern as `createTransaction`).
2. For each location row, in a validation pass that inserts nothing:
   - `holding = await getHoldingAtLocation(supabase, userId, source_asset, row.location)`.
   - If `holding <= 0`, collect an error like `Insufficient ${source_asset} at ${row.location}: have ${holding}`.
   - `price_usd = await resolvePriceUsd("SELL", source_asset, row.target_asset, holding * price, holding, transaction_date, price)` — passing the shared `price` as the override so cost basis matches the form price.
   - If `price_usd === null`, collect a price-resolution error naming the location.
   - Build the row: `source_quantity = holding`, `target_quantity = holding * price`, `target_asset = row.target_asset`, `price = price` (shared), `price_usd`, `fee = row.fee`, `location = row.location`, `type = "SELL"`, `transaction_date`, `user_id`.
3. If any errors were collected, return `{ error: errors.join("; "), status: 409 }` — insert nothing (all-or-nothing).
4. Otherwise `supabase.from("transactions").insert(rows).select()`; on DB error return `{ error, status: 500 }`; else return `{ data: created as Transaction[] }`.

Mirror the existing `target_quantity = source_quantity * price` convention from the single-location SELL. Because targets are restricted to USD stablecoins (≈ $1), `target_quantity` is the USD proceeds and the engine's cost-basis math stays arithmetically correct — the non-stablecoin quirk is out of reach by construction.

#### 3. Batch endpoint

**File**: `src/pages/api/transactions/batch.ts` (new)

**Intent**: A POST endpoint that authenticates, parses JSON, delegates to `createSellAllGlobal()`, and returns the created rows or an error — following the exact shape of `src/pages/api/transactions.ts`.

**Contract**: `export const prerender = false;` and `export const POST: APIRoute`. Auth guard via `context.locals.user` (else `unauthorizedResponse()`); `createClient(...)` null-check (else `errorResponse("Supabase is not configured", 500)`); parse body with try/catch (`errorResponse("Invalid JSON body", 400)`); call `createSellAllGlobal`; on `result.error` return `errorResponse(result.error, result.status ?? 400)`; else `jsonResponse({ data: result.data }, 201)`. (Astro file-based routing maps this to `/api/transactions/batch`.)

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- With seeded holdings of one asset at two locations, a `POST /api/transactions/batch` (e.g. via curl/REST client with a valid session cookie) creates exactly two SELL rows and returns them.
- A batch where one location has zero holding returns a 409 naming that location and creates **nothing** (verify table row count unchanged).
- A batch with a duplicate location in the array is rejected with 400.
- Created rows have `price_usd` equal to the submitted shared price (cost-basis parity), and `source_quantity` equal to the server-computed holding (not any client value).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Frontend — SellAllDialog + portfolio row trigger

### Overview

Build the `SellAllDialog` component seeded from a `PortfolioAsset`, and add a "Sell all" trigger to each `PortfolioTable` row. On submit, POST to the batch endpoint and refresh the portfolio via the existing callback.

### Changes Required:

#### 1. SellAllDialog component

**File**: `src/components/portfolio/SellAllDialog.tsx` (new)

**Intent**: A dialog that takes a `PortfolioAsset` and lets the user configure and submit a global sell-all. Seeds one selectable row per non-zero location from `asset.locations[]`, with shared price/date controls, an inline proceeds summary, and a single submit that calls the batch endpoint.

**Contract**: Props `{ asset: PortfolioAsset; open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void }`. Internal state:
- Per-location rows derived from `asset.locations.filter(l => l.quantity > 0)`: each `{ location, quantity, selected: true, targetAsset: "usdt-tether", targetSymbol: "USDT", fee: "" }`.
- Shared `price` (string), initialized from `asset.current_price_usd` — falling back to `""` when it is `null` (the field is `number | null` and can be null when the price is stale), so the user enters it manually rather than seeing `NaN`.
- Shared `transactionDate` (string), initialized to now (`new Date().toISOString().slice(0,16)`), same as `TransactionForm`.
- `submitting`, `error`.

UI (reuse shadcn `Dialog`, `Input`, `Label`, `Button`, `AssetAutocomplete`):
- Title: `Sell all {asset.symbol}`.
- Shared "Price per unit (USD)" `Input` and "Date & Time" `datetime-local` `Input`.
- One row per location: a checkbox (toggles `selected`), location name + quantity (formatted like `PortfolioTable`'s `formatQty`), an `AssetAutocomplete` for target with `filterIds={USD_STABLECOINS}` (the same restriction the DEPOSIT tab uses) defaulting to USDT, and a fee `Input`.
- Inline summary line: count of selected rows + total proceeds `Σ(quantity × price)`.
- "Sell All" submit `Button`, disabled when `submitting`, no row selected, or price ≤ 0.

Submit handler: build `{ source_asset: asset.asset, price: Number(price), transaction_date: new Date(transactionDate).toISOString(), locations: selectedRows.map(r => ({ location: r.location, target_asset: r.targetAsset, fee: r.fee ? Number(r.fee) : 0 })) }`; `POST /api/transactions/batch`; on `!res.ok` read `{ error }` and show it; on success call `onSuccess()` and close. Mirror `TransactionForm.handleSubmit` error handling.

#### 2. Sell-all trigger on portfolio rows

**File**: `src/components/portfolio/PortfolioTable.tsx`

**Intent**: Add a "Sell all" control to each asset row that opens `SellAllDialog` for that asset, and surface a success callback so the parent can refresh.

**Contract**: Add prop `onSellAllSuccess: () => void` to `PortfolioTableProps`. Track which asset's dialog is open via local state (e.g. `sellAllAsset: PortfolioAsset | null`). Render a small "Sell all" button in each main asset row (a new cell or inline control near the existing action area), disabled when `a.is_closed` or `a.total_quantity <= 0`. Render one `SellAllDialog` controlled by `sellAllAsset`, passing `onSuccess={() => { setSellAllAsset(null); onSellAllSuccess(); }}`. The click must not toggle the row's expand state (stop propagation).

#### 3. Wire refresh from PortfolioView

**File**: `src/components/portfolio/PortfolioView.tsx`

**Intent**: Pass the existing portfolio-refresh handler into `PortfolioTable` so a successful sell-all re-fetches `/api/portfolio`.

**Contract**: Pass `onSellAllSuccess={handleTransactionCreated}` (the existing refresh callback at `PortfolioView.tsx:116`) to `<PortfolioTable>`. No new fetch logic needed.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Seed one asset at two locations; the portfolio row shows a "Sell all" control; clicking it opens the dialog listing both locations with correct quantities and target defaulted to USDT.
- Submitting creates two SELLs; dialog closes; portfolio refreshes and the asset position closes to zero across both locations.
- Deselecting one location and submitting sells only the remaining location(s); the deselected location's holding is unchanged.
- The target picker offers only USD stablecoins (e.g. USDC, USDT); editing one location's target to USDC and submitting records that location's SELL with the chosen stablecoin target (and the recorded ETH-style non-stablecoin path is not selectable — F1 restriction).
- Editing the shared price updates the proceeds summary; recorded cost basis matches the shown price (lessons.md parity check).
- The "Sell all" control is disabled/absent for closed (zero) positions and does not toggle row expansion when clicked.
- A stale dialog (holding reduced in another tab before submit) returns the server's all-or-nothing 409 and creates nothing.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- The project has no existing unit-test harness (verification is lint + build + manual, consistent with S-07). No new unit tests added. The batch service's correctness is covered by the manual API checks in Phase 1.

### Integration Tests:

- Not automated. The Phase 1 manual API checks (two-location success, zero-holding abort, duplicate-location rejection) serve as the integration verification.

### Manual Testing Steps:

1. Two-location happy path: DEPOSIT USDT + BUY the same asset at "Binance" and "MetaMask" → portfolio row → "Sell all" → both rows listed → submit → both positions close, realized P&L recorded for both.
2. Per-location target: in the dialog, change "MetaMask" target to USDC, leave "Binance" as USDT → submit → MetaMask SELL has USDC target, Binance SELL has USDT target. (Targets are restricted to USD stablecoins this slice — F1.)
3. Deselect: uncheck one location → submit → only the checked location sells.
4. Stale/oversell guard: open the dialog, then (in another tab) sell some of the asset, then submit the dialog → 409, nothing created.
5. Single-location asset: an asset held at only one location still opens the dialog with one row and sells correctly.
6. Price override: change the shared price → summary updates → submit → recorded `price_usd` matches.

## Performance Considerations

The dialog reuses data already on the client (`PortfolioAsset.locations[]`) — no fetch to open it. The batch service does one `getHoldingAtLocation` query per location (each scans that location's transactions) plus at most one price lookup per row; for a personal tracker's location count this is negligible. A single bulk insert replaces N round-trips.

## Migration Notes

None — no schema change. Created rows use the existing `transactions` table and are indistinguishable from single-location SELLs to the P&L engine.

## References

- PRD: FR-004 (global sell-all with per-location target + fee), US-03
- Roadmap: S-08 (`context/foundation/roadmap.md:168-178`); builds on S-07 (`sell-all-single-location`)
- Prior plan: `context/changes/sell-all-single-location/plan.md`
- Single SELL payload: `src/components/portfolio/TransactionForm.tsx:131-140`
- Transaction service: `src/lib/transaction-service.ts:12-146`
- Schema: `src/lib/schemas.ts:22-63`
- Endpoint pattern: `src/pages/api/transactions.ts`
- Portfolio data + refresh: `src/components/portfolio/PortfolioView.tsx:14-126`, `PortfolioTable.tsx`
- Lessons: `context/foundation/lessons.md` (cost basis matches form price)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — batch sell-all endpoint + service

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 6d5d344
- [x] 1.2 Build passes: `npm run build` — 6d5d344

#### Manual

- [x] 1.3 Two-location batch creates exactly two SELL rows and returns them — 6d5d344
- [x] 1.4 Zero-holding location returns 409 and creates nothing (all-or-nothing) — 6d5d344
- [x] 1.5 Duplicate location in the array is rejected with 400 — 6d5d344
- [x] 1.6 Created rows have price_usd = submitted shared price and source_quantity = server-computed holding — 6d5d344

### Phase 2: Frontend — SellAllDialog + portfolio row trigger

#### Automated

- [x] 2.1 Lint passes: `npm run lint`
- [x] 2.2 Build passes: `npm run build`

#### Manual

- [x] 2.3 Portfolio row shows "Sell all"; dialog lists all non-zero locations with correct quantities, target defaulted to USDT
- [x] 2.4 Submit creates one SELL per selected location; dialog closes; portfolio refreshes; positions close
- [x] 2.5 Deselecting a location excludes it; per-location stablecoin target override is recorded; non-stablecoin targets are not selectable
- [x] 2.6 Shared price edit updates summary and recorded cost basis matches (parity check)
- [x] 2.7 "Sell all" is disabled/absent for closed positions and does not toggle row expansion
- [x] 2.8 Stale dialog submit returns all-or-nothing 409 and creates nothing
