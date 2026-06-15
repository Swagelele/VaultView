# Sell-All Single Location Implementation Plan

## Overview

Add a "Max" button to the transaction form that auto-fills the source quantity with the user's full holding at the selected location. Reorder form fields so the user picks location before entering quantity, enabling sell-all to work without scrolling back. Applies to both SELL (direct fill) and BUY (compute max target from source balance and price). Delivers PRD US-03 and extends FR-004 to BUY.

## Current State Analysis

The transaction form (`src/components/portfolio/TransactionForm.tsx`) already:
- Fetches available balance from `/api/holdings` when `sourceAsset` + `location` are set (line 32-47)
- Displays the balance below the quantity field (lines 273-277)
- Validates insufficient balance before submission (line 85)
- Server-side validation in `transaction-service.ts:90-98` prevents overselling

What's missing:
- No "Max" / "Sell all" button to auto-fill quantity
- Location field is below Quantity, so balance isn't available when user reaches quantity
- BUY and SELL share a single JSX block — need to split for different field ordering

### Key Discoveries:

- `availableBalance` state already exists and is correctly fetched per `[sourceAsset, location, type]` — `TransactionForm.tsx:30-47`
- For BUY, source amount = `amount * price` (line 84), so max target quantity = `availableBalance / price`
- `insufficientBalance` validation (line 85) already covers post-fill edge cases
- Price suggestion effect (line 58-82) auto-fetches when assets + date change, independent of field render order
- The `resetForm()` function (line 87-98) clears all fields on tab change — no stale state risk

## Desired End State

On the SELL tab, the user picks the sell asset, picks location, then sees a "Max" link next to the Quantity label. Clicking it fills the quantity with their exact holding at that location. On the BUY tab, after picking buy asset, paying asset, location, and price, clicking "Max" fills in the maximum amount they can buy given their source balance. Both tabs show the available balance next to the quantity field for context. When holding is zero, Max is visible but disabled.

**Verification**: create a DEPOSIT of 1.5 BTC at "Binance". Open SELL tab, pick BTC, pick "Binance", click Max — quantity fills with 1.5. Submit a SELL of 1.5 BTC → position closes to zero.

## What We're NOT Doing

- Global sell-all across multiple locations (that's S-08, depends on this change)
- Sell-all button in the portfolio table rows (separate UX, out of scope)
- "Sell all" that auto-selects receiving asset or price — user still picks those manually
- Reworking the DEPOSIT tab field order (it has no sell-all concept)

## Implementation Approach

Split the shared BUY/SELL JSX block into separate per-type blocks with different field ordering. Add a "Max" text-button inline with the Quantity label. The button reads `availableBalance` (already fetched) and sets `amount` state — for SELL directly, for BUY divided by price. No new API endpoints or backend changes needed.

## Phase 1: SELL tab — form reorder + sell-all button

### Overview

Restructure the SELL tab field order so Location appears before Quantity, then add a "Max" inline button that auto-fills quantity from holding at that location. This phase delivers the core PRD requirement (US-03).

### Changes Required:

#### 1. Split SELL rendering from shared BUY/SELL block

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Extract the SELL tab JSX into its own conditional block with reordered fields. The new SELL field order is: sell asset → location → quantity (with Max) → price → receiving asset → balance display → date → fee. The shared `{(type === "BUY" || type === "SELL") && ...}` block becomes BUY-only for now (Phase 2 will restructure it).

**Contract**: The SELL block renders fields in this order:
1. `AssetAutocomplete` — "Sell asset" (sets `sourceAsset`, `sourceSymbol`)
2. Location `Input` with datalist (moved up from shared section)
3. Quantity `Input` with "Max" button in the label row
4. Price per unit `Input` (with suggested price)
5. `AssetAutocomplete` — "Receiving" (sets `targetAsset`, `targetSymbol`)
6. Available balance + computed total display
7. Date & Time `Input` (moved up from shared section)
8. Fee `Input`

The Location and Date fields must be excluded from the shared section when `type === "SELL"` to avoid double rendering.

#### 2. Add "Max" button to SELL quantity field

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Add a small text-button right-aligned in the Quantity `Label` row that fills `amount` with `availableBalance`. Follows the "MAX" button pattern common on crypto exchanges.

**Contract**: The button is rendered inside the Quantity label `div` as an inline `button` (not a form submit). Styled as a small text link (e.g., `text-xs text-primary cursor-pointer`). Uses `cn()` for class merging. Disabled (with `opacity-50 cursor-not-allowed`) when `availableBalance === null` or `availableBalance <= 0`. Click handler: `setAmount(String(availableBalance))`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- No TypeScript errors: `npx astro check` (if available) or build covers this

#### Manual Verification:

- SELL tab: field order is sell asset → location → quantity (Max) → price → receiving → balance → date → fee
- Deposit 2.0 BTC at "Binance", then open SELL tab → pick BTC → pick "Binance" → "Max" fills quantity with 2.0
- With zero holding: Max button is visible but disabled
- After clicking Max, manually editing quantity still works
- Available balance display still shows correctly next to quantity
- Insufficient balance warning still triggers if quantity exceeds balance
- BUY and DEPOSIT tabs still render and function correctly (no regression)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: BUY tab — form reorder + sell-all button

### Overview

Restructure the BUY tab field order so paying asset, location, and price all appear before quantity. Add Max button that computes maximum target quantity from source balance divided by price.

### Changes Required:

#### 1. Restructure BUY tab field order

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Give the BUY tab its own JSX block (replacing the now-BUY-only shared block from Phase 1) with reordered fields. The new BUY field order is: buy asset → paying with → location → price → quantity (with Max) → balance display → date → fee. This ensures all prerequisites for sell-all (source asset, location, price) are set before the user reaches the quantity field.

**Contract**: The BUY block renders fields in this order:
1. `AssetAutocomplete` — "Buy asset" (sets `targetAsset`, `targetSymbol`)
2. `AssetAutocomplete` — "Paying with" (sets `sourceAsset`, `sourceSymbol`) — moved up
3. Location `Input` with datalist — moved up
4. Price per unit `Input` (with suggested price)
5. Quantity `Input` with "Max" button in the label row
6. Available balance + computed total display
7. Date & Time `Input`
8. Fee `Input`

#### 2. Add "Max" button to BUY quantity field

**File**: `src/components/portfolio/TransactionForm.tsx`

**Intent**: Add the same "Max" inline button for BUY. The calculation differs: max target quantity = `availableBalance / price`. The button requires price to be set in addition to balance.

**Contract**: Same visual treatment as SELL Max button. Disabled when `availableBalance === null` or `availableBalance <= 0` or `!price` or `Number(price) <= 0`. Click handler: `setAmount(String(availableBalance / Number(price)))` — no artificial rounding (JavaScript's native precision is fine for display; the `toLocaleString` formatting in computed total handles display).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- BUY tab: field order is buy asset → paying with → location → price → quantity (Max) → balance → date → fee
- Deposit 10000 USDT at "Binance", then open BUY tab → pick BTC as buy asset → pick USDT as paying with → pick "Binance" → price auto-fills (e.g., $60000) → click Max → quantity fills with ~0.16666 BTC
- Max button disabled when price is empty or zero
- Max button disabled when paying asset balance is zero
- After clicking Max, changing price does NOT auto-update quantity (user must re-click Max)
- SELL tab still works correctly (no regression from Phase 1)
- DEPOSIT tab unaffected

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No new unit tests needed — the sell-all logic is purely UI state (`setAmount(value)`) with no new business logic. Server-side validation in `transaction-service.ts` and P&L calculations in `pnl-engine.ts` are unchanged.

### Integration Tests:

- Not applicable — no API changes.

### Manual Testing Steps:

1. SELL sell-all: Deposit asset → SELL tab → pick asset + location → click Max → verify quantity = exact holding → submit → verify portfolio shows closed position
2. BUY sell-all: Deposit stablecoin → BUY tab → pick target + source + location → set price → click Max → verify quantity = balance/price → submit → verify portfolio
3. Zero balance: Pick asset with no holding at location → verify Max is disabled
4. Edge: sell-all then change location → balance updates, amount stays (insufficient warning may show)
5. Edge: very small balance (e.g., 0.00000001) → Max fills with full precision

## Performance Considerations

None. No new API calls — sell-all reads from `availableBalance` state that's already fetched. No additional renders beyond the click handler updating `amount`.

## References

- PRD: US-03 (sell entire position), FR-004 (sell-all auto-fill)
- Roadmap: S-07 (`context/foundation/roadmap.md:157-166`)
- Transaction form: `src/components/portfolio/TransactionForm.tsx`
- Holdings API: `src/pages/api/holdings.ts` → `src/lib/transaction-service.ts:12-41`
- Balance validation: `src/lib/transaction-service.ts:90-98`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: SELL tab — form reorder + sell-all button

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Build passes: `npm run build`

#### Manual

- [ ] 1.3 SELL tab field order is correct (sell asset → location → quantity/Max → price → receiving → balance → date → fee)
- [ ] 1.4 Max fills quantity with exact holding at location
- [ ] 1.5 Max disabled when balance is zero or unavailable
- [ ] 1.6 BUY and DEPOSIT tabs still function correctly

### Phase 2: BUY tab — form reorder + sell-all button

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`

#### Manual

- [ ] 2.3 BUY tab field order is correct (buy asset → paying with → location → price → quantity/Max → balance → date → fee)
- [ ] 2.4 Max computes correct target quantity from source balance / price
- [ ] 2.5 Max disabled when price empty/zero or balance unavailable
- [ ] 2.6 SELL tab still functions correctly (no regression)
