# Sell-All Global — Plan Brief

> Full plan: `context/changes/sell-all-global/plan.md`

## What & Why

Let the user sell an asset across **all** locations in one operation, with a per-location target asset and fee (e.g. BTC on Binance → USDT, BTC on MetaMask → ETH). This is PRD FR-004's secondary success criterion and roadmap S-08 — the last piece of the sell-all stream that began with S-07's single-location "Max" button. Today closing a position held in three places means three separate SELL transactions; this collapses that into one configured submit.

## Starting Point

The portfolio already computes and ships per-location holdings to the client: `PortfolioAsset.locations[]` carries `{ location, quantity, avg_cost_usd, unrealized_pnl }` and the row carries `current_price_usd` (rendered as the expandable breakdown in `PortfolioTable.tsx`). Transactions are created one-at-a-time via `POST /api/transactions` → `createTransaction()`, which validates the per-location holding and resolves a USD price. There is no way to create more than one transaction per request and no multi-location UI.

## Desired End State

Each portfolio asset row gets a "Sell all" control. Clicking it opens a dialog seeded from that row's data: one row per location (pre-checked, deselectable), each with an editable target asset (default USDT) and fee, plus a single shared editable price (prefilled from market) and datetime (default now), and an inline "Selling N positions → ~$X proceeds" summary. One submit creates one SELL per selected location, atomically; on success the dialog closes and the portfolio refreshes with the positions closed. If any location fails server validation, nothing is created and the error names the location(s).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Entry point | Button on each portfolio row | The row already holds asset + per-location quantities + price, so the dialog seeds with zero new fetches | Plan |
| Submission | New `POST /api/transactions/batch` + `createSellAllGlobal()` | Single round-trip, atomic bulk insert, server reuses existing holding/price helpers | Plan |
| Failure mode | All-or-nothing | Portfolio never lands in a half-sold state; matches "one operation" + PRD correctness guardrail | Plan |
| Target asset | Default USDT, editable to any USD stablecoin per row | "Cash out everything" is the dominant case; targets restricted to stablecoins so P&L stays correct (see Out of scope) | Plan |
| Price | One shared price, prefilled from market, editable | Same asset at the same moment = one price; override preserved per PRD + lessons.md parity | Plan |
| Locations | All non-zero pre-selected, deselectable | "Sell all" means all by default, with an escape hatch to skip a location | Plan |
| Date/time | One shared, default now, editable | Matches the "one operation, one moment" model | Plan |
| target_quantity | Mirror existing SELL (`qty × price`) | Global sell-all == N single SELLs; keeps the two paths consistent, no engine change | Plan |
| Confirm | Inline summary, single submit | Shows scope of the bulk action without a second modal | Plan |

## Scope

**In scope:**
- `createSellAllGlobalSchema` + `createSellAllGlobal()` service (all-or-nothing validation, atomic bulk insert)
- `POST /api/transactions/batch` endpoint
- `SellAllDialog` component (per-location rows, shared price/date, inline summary)
- "Sell all" trigger on each `PortfolioTable` row + portfolio refresh on success

**Out of scope:**
- P&L engine / `createTransaction()` changes
- Fixing the pre-existing crypto-to-crypto `target_quantity` model (separate S-01 concern). Because of it, **sell-all targets are restricted to USD stablecoins this slice**; FR-004's non-stablecoin BTC→ETH target is deferred until that model is fixed (then just drop the stablecoin filter).
- Per-location price or datetime; best-effort partial submit; two-step confirm modal
- Sell-all entry from `TransactionForm`; any new migration

## Architecture / Approach

Backend-first. Phase 1 adds the schema, a service function that recomputes each location's holding server-side (the client snapshot can be stale), resolves `price_usd` per row from the shared price, validates **all** rows before inserting **any**, then does one bulk `.insert([...])` for atomicity. Phase 2 adds a React `SellAllDialog` seeded from the `PortfolioAsset` object and a row trigger in `PortfolioTable`, reusing `PortfolioView`'s existing `/api/portfolio` refresh callback. Each created row is shape-identical to a single-location SELL, so the P&L engine needs no changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend batch endpoint + service | Atomic multi-location SELL creation behind `POST /api/transactions/batch` | All-or-nothing validation + correct server-side holding recomputation (no overselling) |
| 2. SellAllDialog + row trigger | The full UX: configure per-location targets/fees and submit once | Multi-row form state + not breaking row expand/selection in `PortfolioTable` |

**Prerequisites:** S-07 (`sell-all-single-location`) done; S-01 portfolio + P&L engine in place.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Client `locations[]` snapshot can be stale; mitigated by mandatory server-side holding recompute + all-or-nothing.
- Sidesteps (does not fix) the pre-existing non-stablecoin `target_quantity` quirk by restricting targets to USD stablecoins; revisit when re-enabling crypto-to-crypto sell-all targets.
- Assumes JS number precision is sufficient for crypto quantities (consistent with existing form).

## Success Criteria (Summary)

- User clicks "Sell all" on an asset, reviews/edits per-location targets and fees, and closes positions across all locations in one submit.
- A failed location aborts the entire batch with a clear message — never a partial sell.
- Recorded cost basis/price for each created SELL matches the price shown in the dialog.
