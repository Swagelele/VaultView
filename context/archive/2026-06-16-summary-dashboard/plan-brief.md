# Summary Dashboard — Plan Brief

> Full plan: `context/changes/summary-dashboard/plan.md`

## What & Why

PRD FR-010 / roadmap S-03: give the user a flat-totals summary on `/dashboard` — Total Realized P&L, Total Unrealized P&L, Total Fees (USD), plus a derived Net P&L. The S-01 P&L engine already computes the per-asset numbers; this slice aggregates them into a single at-a-glance view.

## Starting Point

`getPortfolio()` returns `PortfolioAsset[]` with per-asset `total_realized_pnl_usd` and (null-aware) `unrealized_pnl_usd`. `PortfolioView` renders these in a table and refreshes prices every 20s, recomputing unrealized P&L client-side. `fee` is stored on every transaction but is never aggregated or denominated.

## Desired End State

Four cards sit above the holdings table on `/dashboard`. Realized and Fees are static; Unrealized and Net update in lockstep with the 20s price refresh and the table rows. A fresh account shows `$0.00`; an unpriced asset makes Unrealized and Net show `—` rather than a wrong number.

## Key Decisions Made

| Decision               | Choice                                              | Why                                                                          | Source |
| ---------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Fee denomination       | Treat as USD; label "Total Fees (USD)"              | Consistent with the all-USD valuation model; form never captured a currency  | Plan   |
| Card set               | 3 PRD cards + derived Net P&L                       | Net is the bottom-line number users want and is free to compute              | Plan   |
| Placement              | Top of existing `/dashboard`, no new route          | One cohesive dashboard, no nav changes                                       | Plan   |
| Where totals computed  | Pure `computeSummary()` called client-side on live assets | Unit-testable AND keeps Unrealized/Net in sync with the 20s refresh    | Plan   |
| Edge states            | Zeros for empty; `—` when any held asset is unpriced | Never displays a fabricated total; mirrors the table's `—` convention        | Plan   |

## Scope

**In scope:** sum fees server-side onto the existing portfolio response; pure `computeSummary` + unit tests; `SummaryCards` UI; wire into `PortfolioView` above the table; scaffold shadcn `Card`; extract shared `formatUsd`/`pnlColor`.

**Out of scope:** charts/time-series, new route or nav, fee-denomination model or migration, any P&L engine change, a new API endpoint.

## Architecture / Approach

`getPortfolio` adds `total_fees_usd` (sum of already-fetched transactions' `fee`) to its response. A pure `computeSummary(assets, totalFeesUsd)` in `src/lib/portfolio-summary.ts` produces the four totals with null-collapsing (unrealized → `null` if any held asset is unpriced) and closed-position handling (realized counts closed assets). `SummaryCards` calls it on every render with the live `assets` array from `PortfolioView`, so Unrealized/Net stay current; Realized/Fees are price-independent.

## Phases at a Glance

| Phase                              | What it delivers                                              | Key risk                                                       |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 1. Backend — fees & summary fn     | `total_fees_usd` on response + unit-tested `computeSummary`  | Getting null/closed-position rules right (covered by tests)    |
| 2. UI — summary cards              | `SummaryCards` rendered live above the table                 | Keeping Unrealized/Net in sync with the 20s refresh (no drift) |

**Prerequisites:** S-01 (`core-trade-and-portfolio`) — done.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Fees of mixed real-world denominations are summed as USD; acceptable because the form never captured a fee currency (MVP).
- A single unpriced held asset collapses the whole Unrealized/Net total to `—` (chosen over a possibly-misleading partial sum).

## Success Criteria (Summary)

- Card totals equal the manual sum of the corresponding table columns.
- Unrealized and Net track the table across a 20s refresh; "Show closed" toggle never changes a total.
- Fresh account shows `$0.00`; unpriced assets show `—` for Unrealized/Net while Realized/Fees stay numeric.
