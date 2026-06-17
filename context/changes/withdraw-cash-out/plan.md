# WITHDRAW (cash-out with realized P&L) Implementation Plan

## Overview

Add **WITHDRAW** — the fifth and final transaction type (PRD FR-006, US-05, roadmap S-06). A WITHDRAW is a one-sided "cash out": the user removes a quantity of an asset from a location (exit from crypto, not a transfer), realized P&L is locked in at the current market price against the position's average cost, and the portfolio reflects the reduced position. It is the structural inverse of DEPOSIT (which just landed, `6dc57f2`..`e599545`): same one-sided form/schema scaffolding, but it **realizes P&L like a SELL** instead of deriving a historical cost basis.

## Current State Analysis

The data model and most engine logic already accommodate WITHDRAW — it was designed in from F-02:

- **DB**: `transaction_type` enum already includes `'WITHDRAW'`; `target_asset`/`target_quantity` are nullable for one-sided ops (`supabase/migrations/20260614213523_create_transactions.sql`). **No migration needed.**
- **Types**: `TransactionType` union already lists `"WITHDRAW"` (`src/types.ts:1`).
- **P&L engine**: `computePositions` (`src/lib/pnl-engine.ts:40`) already handles WITHDRAW correctly with **no change** — a WITHDRAW row is not DEPOSIT, so it runs the source-disposal path (realizes `source_quantity × (price_usd − avgCost)`, `:69-81`), and its `target_asset`/`target_quantity` are null, so the acquisition step (`:83`, guarded by `if (tx.target_asset && tx.target_quantity)`) is skipped. The over-sell clamp (`:70`) and deterministic `(transaction_date, created_at)` sort (`:50-54`) already apply.
- **Transaction list**: `TransactionList.tsx` already has `TYPE_STYLES`/`TYPE_ORDER` entries for WITHDRAW.
- **Balance guard**: `createTransaction` already runs the holding-sufficiency check for every non-DEPOSIT type (`src/lib/transaction-service.ts:98-106`), so WITHDRAW inherits the 409-on-overdraw guard for free.

What is missing is concentrated in four spots:

1. **`src/lib/schemas.ts:10`** — the Zod `type` enum omits `"WITHDRAW"`, and the `superRefine` (`:22-63`) only treats DEPOSIT as one-sided; WITHDRAW would fall into the `else` branch and be **wrongly rejected for lacking a target asset**.
2. **`src/lib/transaction-service.ts` `getHoldingAtLocation` (`:28-39`)** — handles DEPOSIT/BUY/SELL/SWAP explicitly; WITHDRAW is not subtracted, so holdings (and the balance guard, and the form's "Max") would ignore withdrawals.
3. **`src/lib/transaction-service.ts` `createTransaction` price column (`:126-130`)** — `type === "DEPOSIT" ? priceUsd : (input.price ?? target/source ?? 1)`. WITHDRAW has no `target_quantity` and the form sends no `price`, so this stores `1` instead of the realized price unless WITHDRAW joins the DEPOSIT branch.
4. **`src/components/portfolio/TransactionForm.tsx`** — only renders DEPOSIT/BUY/SELL tabs; needs a WITHDRAW tab.

### Key Discoveries:

- `resolvePriceUsd` (`src/lib/transaction-service.ts:44-83`) already resolves WITHDRAW correctly via fallthrough: stablecoin source → `1` (`:64`), no target → `getPriceForDate(source, date)` (`:81`), which returns the **current** price for today's date. Grouping it with the DEPOSIT branch is a clarity edit, not a behavior fix.
- The price-suggestion effect in the form prices the source asset for any non-BUY type (`assetForPrice = type === "BUY" ? targetAsset : sourceAsset`) and the balance-fetch + "Max" effect skips only DEPOSIT — both already cover WITHDRAW once the tab exists.
- DEPOSIT's two-phase split (backend `6dc57f2`, then form `e599545`) is the template this plan follows.

## Desired End State

A logged-in user can open the Add Transaction dialog, pick **Withdraw**, select an asset they hold, enter a quantity (or tap **Max** to auto-fill the full holding at that location), accept or override the suggested current price, set a fee, pick location and date, and submit. On submit: the row persists as a one-sided WITHDRAW, realized P&L is computed against the location's average cost, the position quantity/cost at that location drop, and the `/transactions` row shows `realized_pnl_usd` (with `unrealized_pnl_usd` null). Over-withdrawing is blocked in the form and rejected server-side with a 409. The summary dashboard's total realized P&L already absorbs the new realized amount.

**Verification**: withdraw part of a held BTC position → portfolio quantity decreases, transaction list shows a WITHDRAW row with a realized P&L figure matching `qty × (current_price − avg_cost)`; attempt to withdraw more than held → blocked.

## What We're NOT Doing

- No DB migration (enum + nullable columns already exist).
- No new "lifetime withdrawn total" aggregate or dedicated WITHDRAW reporting UI — out of US-05 scope; the summary dashboard already totals realized P&L.
- No date-based historical pricing for WITHDRAW — cash-out realizes at current market price (overridable); no future-date guard beyond what SELL has.
- No change to `computePositions` logic (it already handles WITHDRAW); we only add a regression test + clarifying comment.
- No global/multi-location "withdraw all" (that is the sell-all family, S-07/S-08, already done for SELL).

## Implementation Approach

Mirror DEPOSIT's landed pattern in two phases: **(1)** make the backend accept, price, and account for WITHDRAW correctly, fully unit-tested; **(2)** add the form tab that produces a valid WITHDRAW payload. WITHDRAW is modeled as a "one-sided disposal" — it shares DEPOSIT's *shape* (no target side) but SELL's *accounting* (realized P&L on the source). Wherever code currently branches on `type === "DEPOSIT"` to mean "one-sided," extend it to also cover WITHDRAW; wherever it branches on the non-DEPOSIT set to mean "disposal needing a balance check / realized P&L," WITHDRAW already belongs.

## Phase 1: Schema + P&L + service (backend)

### Overview

Teach the validation, holding, pricing, and persistence layers about WITHDRAW so the server accepts a one-sided withdrawal, prices it at current market, enforces the holding balance, and realizes P&L. Lock in the (already-correct) engine behavior with a test.

### Changes Required:

#### 1. Zod schema — accept WITHDRAW as one-sided

**File**: `src/lib/schemas.ts`

**Intent**: Add `"WITHDRAW"` to the transaction `type` enum and make the `superRefine` treat WITHDRAW as one-sided (no target asset/quantity), like DEPOSIT — while keeping the future-date guard DEPOSIT-only.

**Contract**: `baseSchema.type` enum gains `"WITHDRAW"` (`:10`). The `superRefine` one-sided branch condition broadens from `data.type === "DEPOSIT"` to "DEPOSIT or WITHDRAW" for the two `target_asset`/`target_quantity` "must not have" checks; the `transaction_date` future check stays gated on DEPOSIT only. The `else` (two-sided, requires target) branch then applies only to BUY/SELL/SWAP. Error messages should name the actual type (`${data.type} must not have a target asset`) rather than hardcoding "DEPOSIT".

#### 2. `getHoldingAtLocation` — subtract on WITHDRAW

**File**: `src/lib/transaction-service.ts`

**Intent**: Withdrawals must reduce the computed holding, so the balance guard and the form's "Max" reflect them.

**Contract**: In the reducer loop (`:28-39`), add `"WITHDRAW"` to the source-disposal case so a WITHDRAW row subtracts `source_quantity` (it has no target side, so no acquisition arm). Simplest: include `"WITHDRAW"` in the existing `(BUY|SELL|SWAP)` source-subtract condition (`:33`); leave the target-add condition (`:36`) as BUY/SELL/SWAP only.

#### 3. `resolvePriceUsd` — group WITHDRAW with the one-sided branch

**File**: `src/lib/transaction-service.ts`

**Intent**: Resolve WITHDRAW's USD price as current-market (overridable), making the one-sided source-priced intent explicit rather than relying on fallthrough.

**Contract**: Extend the `type === "DEPOSIT"` branch (`:57`) to `type === "DEPOSIT" || type === "WITHDRAW"`: override wins, stablecoin → `1`, else `getPriceForDate(sourceAsset, date)` (returns current price for today's date). Behavior is unchanged from the existing fallthrough; this is for readability. Add a one-line comment noting WITHDRAW realizes at current market price (PRD Open Question default).

#### 4. `createTransaction` — one-sided price column + explicit null-ing for WITHDRAW

**File**: `src/lib/transaction-service.ts`

**Intent**: Store the realized price (not `1`) in the `price` column for WITHDRAW, and persist it as a one-sided row. The balance check already covers WITHDRAW (non-DEPOSIT) and must stay.

**Contract**: The `price` ternary (`:126-130`) broadens its DEPOSIT condition to "DEPOSIT or WITHDRAW" → `price = priceUsd` for both (one-sided ops have no exchange rate). The row's `target_asset`/`target_quantity` null-ing (`:137-138`) likewise broadens to "DEPOSIT or WITHDRAW" (functionally already null via `?? null`, but make the one-sided intent explicit). Do **not** alter the `input.type !== "DEPOSIT"` balance check at `:98` — WITHDRAW must be balance-checked.

#### 5. P&L engine — regression test + clarifying comment

**File**: `src/lib/pnl-engine.ts`

**Intent**: `computePositions` already realizes WITHDRAW P&L and skips acquisition; add a short comment so a future reader knows WITHDRAW is intentionally covered by the generic disposal path.

**Contract**: One comment near the disposal block (`:69`) noting "SELL/SWAP/WITHDRAW all dispose of the source; WITHDRAW has no target so the acquisition arm is skipped." No logic change.

#### 6. Unit tests

**File**: `src/lib/transaction-service.test.ts` and `src/lib/pnl-engine.test.ts`

**Intent**: Cover the new WITHDRAW branches and lock in realized-P&L correctness.

**Contract**: In `transaction-service.test.ts`, add `resolvePriceUsd` WITHDRAW cases (override wins; stablecoin → `1`; non-stablecoin → `getPriceForDate` current price; historical `null` → `null`). In `pnl-engine.test.ts`, add a case: DEPOSIT/BUY establishes a position, a WITHDRAW of part of it produces `realized_pnl = qty × (price_usd − avg_cost)` and reduces `quantity`/`total_cost_usd`, with no target position created. Follow the existing test style/helpers.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or `npx astro sync && npm run build`)
- Linting passes: `npm run lint`
- Unit tests pass: `npm test` (Vitest) — including the new WITHDRAW cases in `transaction-service.test.ts` and `pnl-engine.test.ts`

#### Manual Verification:

- POST `/api/transactions` with a WITHDRAW body for a held asset returns 201 and a row with `price_usd` = current price, `target_asset`/`target_quantity` null
- POST a WITHDRAW exceeding the holding returns 409 with the "Insufficient …" message
- POST a WITHDRAW with a `target_asset` is rejected 400 by the schema

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: WITHDRAW form (frontend)

### Overview

Add a **Withdraw** tab to the transaction form that mirrors SELL minus the target asset, producing a valid one-sided WITHDRAW payload with a suggested/overridable current price and a "Max" sell-all fill.

### Changes Required:

#### 1. WITHDRAW tab + UI branch

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Render a fourth tab that collects exactly the one-sided disposal fields.

**Contract**: Extend the local `TxType` union (`"DEPOSIT" | "BUY" | "SELL"`) with `"WITHDRAW"` and add a `Tabs` trigger + content panel. The WITHDRAW panel renders: source asset autocomplete (unrestricted, like DEPOSIT/SELL), location autocomplete, quantity input with a **Max** button (fills from `availableBalance`, the SELL pattern), price-per-unit input labeled as suggested/overridable, date/time, and optional fee. No target asset/quantity fields. Reuse the existing price-suggestion effect (already prices `sourceAsset` for non-BUY types) and the balance-fetch effect (already runs for non-DEPOSIT types) — both work for WITHDRAW once the tab/state exist.

#### 2. WITHDRAW payload builder

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Submit a one-sided WITHDRAW the server accepts.

**Contract**: Add a `type === "WITHDRAW"` branch in the payload builder: `{ ...base, source_asset, source_quantity: Number(amount) }`, and — for non-stablecoin sources with a positive price — `source_price_usd_override: Number(price)` (the DEPOSIT pattern; lets the user's accepted/overridden current price win). No `target_asset`/`target_quantity`. The submit button stays gated on `insufficientBalance` (amount > availableBalance), which already exists for disposals.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Existing unit tests still pass: `npm test`

#### Manual Verification:

- `Withdraw` tab appears; selecting a held asset + location shows the available balance and a suggested price within ~2s
- **Max** fills the quantity with the exact holding at that location; submitting closes the position (quantity → 0 at that location in the portfolio view)
- A partial withdraw reduces the position and shows a WITHDRAW row on `/transactions` with a realized P&L figure ≈ `qty × (current_price − avg_cost)`, unrealized blank
- Entering a quantity above the available balance disables submit; bypassing the form yields a 409
- Withdrawing a stablecoin (USDT) records realized P&L ≈ 0

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This is the final phase — on success, flip `change.md` to `implemented` and sync the roadmap (S-06 → done).

---

## Testing Strategy

### Unit Tests:

- `resolvePriceUsd` WITHDRAW: override wins; stablecoin → `1`; non-stablecoin → current `getPriceForDate`; `null` historical → `null`.
- `computePositions` WITHDRAW: realized P&L = `qty × (price_usd − avg_cost)`; position quantity and `total_cost_usd` reduced proportionally; no target position created; over-withdraw beyond a held position is clamped (engine) — though the service blocks it first.
- Schema: WITHDRAW with a target asset/quantity is rejected; WITHDRAW without one is accepted.

### Integration Tests:

- End-to-end via API: create BUY → WITHDRAW part → assert holding decreased and realized P&L recorded; WITHDRAW over holding → 409.

### Manual Testing Steps:

1. Buy/deposit an asset at a location, then Withdraw part of it; confirm portfolio quantity drops and `/transactions` shows the WITHDRAW row with realized P&L.
2. Use **Max** to withdraw the full holding; confirm the position closes (quantity 0).
3. Try to withdraw more than held; confirm the form blocks submit.
4. Withdraw a stablecoin; confirm realized P&L ≈ 0 and no wasted price API call.
5. Override the suggested price; confirm the recorded `price_usd` matches the override.

## Performance Considerations

None new. `getHoldingAtLocation` already re-scans transactions per call (acceptable at MVP scale, unchanged). WITHDRAW pricing reuses the cached CoinPaprika current-price path; stablecoins skip the API entirely.

## Migration Notes

No data migration. The `transaction_type` enum and nullable target columns already exist from F-02.

## References

- Roadmap slice: `context/foundation/roadmap.md` S-06 (and Open Roadmap Question #1 — pricing mechanism, resolved to current market price)
- PRD: FR-006, US-05, Open Question #1
- Precedent (one-sided op): `context/archive/2026-06-17-deposit-historical-cost/plan.md`; commits `6dc57f2` (backend), `e599545` (form)
- P&L disposal path: `src/lib/pnl-engine.ts:69-88`
- Lessons: "Order P&L transactions deterministically" and "Always verify cost basis matches form price" (`context/foundation/lessons.md`) — both already satisfied by the reused engine/pricing paths

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema + P&L + service (backend)

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — b1155fb
- [x] 1.2 Linting passes: `npm run lint` — b1155fb
- [x] 1.3 Unit tests pass (incl. new WITHDRAW cases): `npm test` — b1155fb

#### Manual

- [x] 1.4 WITHDRAW for a held asset returns 201 with current `price_usd` and null target fields — b1155fb
- [x] 1.5 WITHDRAW exceeding holding returns 409 — b1155fb
- [x] 1.6 WITHDRAW with a target asset is rejected 400 — b1155fb

### Phase 2: WITHDRAW form (frontend)

#### Automated

- [x] 2.1 Type checking passes: `npm run build`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Existing unit tests still pass: `npm test`

#### Manual

- [x] 2.4 Withdraw tab shows available balance + suggested price; Max fills full holding and closes position
- [x] 2.5 Partial withdraw shows a WITHDRAW row with realized P&L ≈ qty × (current − avg cost), unrealized blank
- [x] 2.6 Over-balance quantity disables submit; bypass yields 409
- [x] 2.7 Stablecoin withdraw records realized P&L ≈ 0
