# Sell-All Single Location — Plan Brief

> Full plan: `context/changes/sell-all-single-location/plan.md`

## What & Why

Add a "Max" button to the transaction form that auto-fills the source quantity with the user's full holding at the selected location. This eliminates manual quantity lookup when selling an entire position — a core friction point identified in the PRD (US-03, FR-004). Applies to both SELL (direct fill) and BUY (compute max purchasable from source balance).

## Starting Point

The transaction form (`TransactionForm.tsx`) already fetches and displays available balance per asset+location via the `/api/holdings` endpoint. Insufficient balance validation exists both client-side and server-side. What's missing is a click target that auto-fills the quantity field, and the form field ordering puts Location *after* Quantity — so balance isn't available when the user reaches the quantity field.

## Desired End State

On the SELL tab, the user picks asset → location → sees "Max" next to Quantity → clicks it → quantity fills with exact holding. On the BUY tab, after picking buy asset → paying asset → location → price, clicking "Max" fills the max purchasable quantity. Zero-balance Max is visible but disabled. No new API endpoints or backend changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Form field reorder scope | SELL + BUY tabs (not DEPOSIT) | Sell-all needs location before quantity; reordering both trade tabs keeps the flow consistent. |
| Sell-all scope | Both SELL and BUY tabs | BUY users also benefit from "spend all source" — extends FR-004 naturally. |
| Zero balance behavior | Disabled button (not hidden) | User discovers the feature exists even without balance; "Available: 0" text already communicates state. |
| Button placement | Inline text-link in Quantity label row | Matches "MAX" button pattern from crypto exchanges; no extra vertical space. |
| Button label | "Max" | Universal crypto exchange convention; clearer than "Sell all" on BUY tab. |

## Scope

**In scope:**
- "Max" button on SELL tab — fills quantity with full holding at location
- "Max" button on BUY tab — fills quantity with `sourceBalance / price`
- Form field reorder for SELL: sell asset → location → quantity → price → receiving → date → fee
- Form field reorder for BUY: buy asset → paying with → location → price → quantity → date → fee
- Disabled state when balance is zero/unavailable (or price missing for BUY)

**Out of scope:**
- Global sell-all across all locations (S-08)
- Sell-all from portfolio table rows
- Auto-selecting receiving asset or price
- DEPOSIT tab changes
- Backend/API changes

## Architecture / Approach

Pure frontend change in a single file (`TransactionForm.tsx`). Split the shared BUY/SELL JSX block into separate per-type blocks with different field ordering. Add an inline `<button>` in the Quantity label row that reads existing `availableBalance` state and sets `amount`. No new state, hooks, API calls, or components.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. SELL tab reorder + Max | Core sell-all for SELL (US-03) | JSX restructuring could introduce regression in shared state |
| 2. BUY tab reorder + Max | Sell-all extended to BUY (FR-004) | BUY Max depends on price being set — edge case if price suggestion fails |

**Prerequisites:** S-01 (core trade + portfolio) completed.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Assumes `availableBalance` precision (JavaScript number) is sufficient for crypto quantities — no evidence of precision issues in existing code
- BUY Max computation (`balance / price`) may produce many decimal places — relies on existing `toLocaleString` formatting for display

## Success Criteria (Summary)

- User can click Max on SELL tab and quantity fills with exact holding at selected location
- User can click Max on BUY tab and quantity fills with max purchasable amount given source balance and price
- Max is disabled (not hidden) when balance is zero or prerequisites are missing
