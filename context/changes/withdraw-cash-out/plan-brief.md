# WITHDRAW (cash-out with realized P&L) — Plan Brief

> Full plan: `context/changes/withdraw-cash-out/plan.md`

## What & Why

Add **WITHDRAW**, the last of the five transaction types (PRD FR-006, US-05, roadmap S-06). A WITHDRAW is a one-sided "cash out": the user removes an asset quantity from a location (a permanent exit from crypto, not a transfer), realized P&L is locked in at current market price against the position's average cost, and the portfolio reflects the reduced position.

## Starting Point

The data model was built for all five types from the start: the `transaction_type` enum already includes `WITHDRAW`, target columns are nullable, and `TransactionType` lists it. DEPOSIT (the other one-sided op) landed days ago (`6dc57f2`..`e599545`) and is the template. The P&L engine's generic disposal path already realizes WITHDRAW correctly with no change.

## Desired End State

A user opens Add Transaction, picks **Withdraw**, selects a held asset, enters a quantity (or taps **Max** to fill the full holding at that location), accepts or overrides the suggested current price, and submits. The row persists one-sided, realized P&L is computed against average cost, the position drops, and `/transactions` shows the realized figure. Over-withdraws are blocked in-form and rejected 409 server-side.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Pricing mechanism | Current market price, overridable | Matches roadmap default for PRD Open Question #1 and FR-007; reuses DEPOSIT's override path | Plan (roadmap-guided) |
| Quantity entry | Manual input + "Max" (sell-all) | Satisfies US-05 ("enter quantity or use sell-all"); reuses SELL wiring | Plan |
| Stablecoin withdraw | Treat as $1, realized P&L ≈ 0 | Skips a noisy/wasted API call; correct ~0 gain | Plan |
| Over-withdraw | Reject 409 + block in form | Reuses existing non-DEPOSIT balance guard; satisfies US-05 AC | Plan |
| Display | Reduce holding + show realized P&L only | Falls out of existing aggregation; dashboard already totals realized P&L | Plan |

## Scope

**In scope:** WITHDRAW Zod validation; holding subtraction; current-market pricing; one-sided persistence with correct `price` column; engine regression test; a Withdraw form tab.

**Out of scope:** DB migration; date-based historical pricing; a "lifetime withdrawn" aggregate or dedicated WITHDRAW report; global multi-location withdraw-all; any change to `computePositions` logic.

## Architecture / Approach

Mirror DEPOSIT in two phases. WITHDRAW = DEPOSIT's *shape* (one-sided, no target) + SELL's *accounting* (realized P&L on the source). Wherever code branches on `type === "DEPOSIT"` to mean "one-sided," extend it to include WITHDRAW (schema, price column, row null-ing, pricing); wherever it branches on the non-DEPOSIT set to mean "disposal + balance check," WITHDRAW already belongs. Form adds a tab; the existing price-suggestion and balance/"Max" effects already cover non-BUY / non-DEPOSIT types.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend (schema + P&L + service) | Server accepts, prices, balance-checks, and realizes P&L for WITHDRAW; unit-tested | Schema `else`-branch would wrongly require a target — WITHDRAW must join the one-sided branch |
| 2. Form | Withdraw tab producing a valid one-sided payload with Max + overridable price | Reusing SELL/DEPOSIT effects without regressing existing tabs |

**Prerequisites:** S-01 (done). No migration, no new deps.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes current-market pricing is the right default (per roadmap; revisable without rearchitecting since price is overridable).
- Assumes `computePositions` needs no logic change — verified by reading the disposal/acquisition guards; Phase 1 adds a test to lock it in.

## Success Criteria (Summary)

- User can withdraw part or all of a held asset; the position decreases and realized P&L appears on the transaction list.
- Over-withdrawing is prevented (form-disabled + 409).
- Stablecoin withdrawal records realized P&L ≈ 0 with no wasted price call.
