# Transaction List with Filters — Plan Brief

> Full plan: `context/changes/transaction-list-filters/plan.md`

## What & Why

Add a dedicated `/transactions` page where the user browses their full transaction history, filtered by type, location, and asset (PRD **FR-011**, roadmap **S-04**). Today the app only shows the *aggregated* portfolio — there's no way to see or audit the raw trades that produced those positions.

## Starting Point

The data is already there: `GET /api/transactions` returns every transaction, and the P&L engine (`computePositions`) already computes realized P&L per disposal — it just folds it into position totals instead of surfacing it per row. There is no transaction list UI; the dashboard renders only `PortfolioView` (positions).

## Desired End State

`/transactions` (linked from the dashboard) lists all transactions newest-first, each row showing date, type, source/target assets + quantities, price, fee, location, and a computed realized P&L. Three "All"-defaulting filters (Type, Location, Asset) narrow the list with AND logic; Location/Asset options come from the user's own data, and the Asset filter matches either side of a trade.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Placement | New `/transactions` page | Clean separation; matches multi-page structure; room to grow | Plan |
| Columns | Core fields **+** realized P&L | User wants per-trade P&L in the audit view | Plan |
| Realized P&L source | Extend the existing engine | Keeps the math in one place; forward-compatible with WITHDRAW | Plan |
| Asset display | Derive symbol from ID (`btc-bitcoin`→`BTC`) | No API call; CoinPaprika IDs are `{symbol}-{name}` | Plan |
| Asset filter match | Source **or** target | "Show all my BTC trades" is the user's mental model | Plan |
| Sort / refresh | Newest-first, fetch once | History reads recent-first; rows don't change without user action | Plan |
| Filter logic | AND, options from data, "All" default | Predictable; no dead filter options | Plan |

## Scope

**In scope:** `/transactions` page + island; Type/Location/Asset filters; core columns + realized P&L; per-transaction realized P&L from the engine; dashboard nav link; route protection.

**Out of scope:** Editing/deleting transactions; pagination; new API/price calls; date-range filter, search, sort controls; CSV export; any change to portfolio aggregate numbers.

## Architecture / Approach

Phase 1 (backend): extend `computePositions` to also return a `Map<txId, realizedPnl>` (populated in the existing deterministically-sorted loop), add a `symbolFromId` helper, add `getTransactionsWithPnl`, and enrich the `GET /api/transactions` response with a nullable `realized_pnl_usd` (non-breaking). Phase 2 (frontend): a `TransactionList` React island fetches once, renders a shadcn `Table` with three `Select` filters, mounted on a new `transactions.astro` page following the dashboard's layout/island conventions.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Engine + API | Per-transaction realized P&L on `GET /api/transactions` | Must populate the map inside the existing sorted loop or risk the phantom-position bug (lessons.md) |
| 2. List page + filters | `/transactions` page, table, three AND filters, nav link | Asset symbol derivation + source-OR-target filter correctness |

**Prerequisites:** S-01 (`core-trade-and-portfolio`) — done.
**Estimated effort:** ~1–2 sessions across 2 phases (LOW complexity, lifted slightly by the per-row P&L).

## Open Risks & Assumptions

- Assumes CoinPaprika's `{symbol}-{name}` ID convention holds for all tracked assets (symbol-from-prefix). Fallback is the uppercased raw ID — cosmetic only.
- Per-transaction realized P&L must reuse the engine's deterministic ordering; computing it separately would reintroduce a known ordering bug.

## Success Criteria (Summary)

- User opens `/transactions`, sees all trades newest-first with correct values and per-row realized P&L.
- Type/Location/Asset filters narrow results with AND logic; Asset matches both sides; "All" resets.
- DEPOSIT and unpriced rows show `—` for realized P&L; dashboard aggregate P&L is unchanged.
