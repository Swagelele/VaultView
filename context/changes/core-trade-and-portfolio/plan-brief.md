# Core Trade & Portfolio — Plan Brief

> Full plan: `context/changes/core-trade-and-portfolio/plan.md`

## What & Why

Build the core opening-balance + trade entry flow and portfolio dashboard (S-01, the north-star slice). A logged-in user can add a USD-stablecoin DEPOSIT, then create BUY/SELL/SWAP transactions with CoinPaprika-powered price suggestions, and see a consolidated portfolio with per-asset and per-location P&L using the Average Cost method. This is the foundation every subsequent slice (S-02 through S-08) builds on — without it, the rest of the roadmap has no data to display.

## Starting Point

Auth is fully implemented (email/password), the `transactions` table with RLS exists (F-02), and the Astro + React + shadcn/ui framework is scaffolded. The dashboard is a placeholder. No business logic, no CoinPaprika integration, no transaction form, no portfolio view, no P&L computation.

## Desired End State

User opens `/dashboard`, sees a portfolio table with held assets (symbol, quantity, avg cost, current price, unrealized P&L), can expand any row for per-location detail, and prices auto-refresh every 20 seconds. An "Add Transaction" dialog supports DEPOSIT/BUY/SELL/SWAP with asset autocomplete, price suggestions where relevant, and location autocomplete. User records a USD-stablecoin DEPOSIT before the first trade; after submitting any transaction, the portfolio recalculates instantly.

## Key Decisions Made

| Decision                       | Choice                                                                                 | Why (1 sentence)                                                                                                                | Source      |
| ------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| P&L computation location       | Server-side on request                                                                 | Single source of truth, avoids stale materialized views; O(n) is fine for MVP scale                                             | Plan        |
| Test runner                    | Vitest with `npm run test`                                                             | Arithmetic correctness is a product guardrail, so P&L fixtures must be executable                                               | Plan review |
| API architecture               | Astro routes as thin controllers + services in src/lib/                                | Matches existing auth pattern; keeps P&L logic testable in isolation                                                            | Plan        |
| P&L display currency           | USD via CoinPaprika                                                                    | Users think in USD; "$500 profit" is immediately meaningful                                                                     | Plan        |
| Cost basis tracking            | Compute from transaction history (no stored positions)                                 | Always consistent; no sync bugs; trivially correct                                                                              | Plan        |
| Price field semantics          | Exchange rate (user-visible), separate execution-time `price_usd` for P&L              | Decouples display from computation; P&L uses the user's accepted/manual transaction valuation, not current price at submit time | Plan        |
| Source/target convention       | For trades, source leaves and target enters; DEPOSIT uses source as the entering asset | Consistent with the existing single-table schema while preserving the two-sided trade model                                     | Plan        |
| Opening balance model          | S-01 includes USD-stablecoin DEPOSIT before first trade                                | Prevents negative cash-like balances; full historical crypto deposit remains S-05                                               | User + Plan |
| Transaction form               | Single form with DEPOSIT/BUY/SELL/SWAP toggle in a dialog                              | One component; fields adapt per type; modal keeps user in portfolio context                                                     | Plan        |
| Price auto-refresh             | React island with 20s visible-tab polling                                              | Smooth UX, no full reload; hidden tabs pause so they do not burn API budget                                                     | Plan        |
| CoinPaprika calls              | Server-side proxy with 120s current-price cache and stale fallback                     | Keeps 20s UI polling from exceeding the 20K/month free tier; avoids CORS and enables dedupe                                     | Plan        |
| Asset autocomplete             | Debounced search (≥2 chars, 300ms) via proxy                                           | Fresh results from 10K+ coins without pre-loading                                                                               | Plan        |
| Insufficient-source protection | Server-side validation rejects BUY/SELL/SWAP that spend more source asset than held    | Prevents impossible states; P&L engine never sees negative balances                                                             | Plan        |
| Zero-balance assets            | Hidden by default, toggle to show                                                      | Clean default view; closed positions accessible on demand                                                                       | Plan        |
| Fee handling                   | Stored but not factored into Average Cost for S-01                                     | Simplifies P&L engine; fee-adjusted cost basis is a refinement                                                                  | Plan        |

## Scope

**In scope:**

- USD-stablecoin DEPOSIT creation as the opening-balance path before first trade
- BUY/SELL/SWAP transaction creation with current or historical CoinPaprika price suggestions
- Asset autocomplete from CoinPaprika, location autocomplete from prior transactions
- Average Cost P&L engine (realized + unrealized, per asset + per location)
- Portfolio table with expandable per-location breakdown
- Auto-refreshing current prices (20s visible-tab polling with server-side cache)
- Server-side insufficient-source validation for BUY/SELL/SWAP
- Schema migration adding `price_usd` column

**Out of scope:**

- Full DEPOSIT import for existing non-stablecoin assets with historical cost basis (S-05)
- WITHDRAW type (S-06)
- Per-buy P&L breakdown (S-02)
- Summary dashboard totals (S-03)
- Transaction list with filters (S-04)
- Sell-all auto-fill (S-07, S-08)
- Fee impact on cost basis
- Transaction editing/deletion
- Mobile responsive layout

## Architecture / Approach

```
Browser (React islands)           Server (Astro SSR on Cloudflare Workers)
┌────────────────────┐            ┌──────────────────────────────────────┐
│ PortfolioView      │───fetch───▸│ /api/portfolio → portfolio-service   │
│  ├─ PortfolioTable │            │   └─ pnl-engine (avg cost calc)      │
│  ├─ AddTxDialog    │            │   └─ coinpaprika (current prices)    │
│  │  └─ TxForm      │───POST───▸│ /api/transactions → tx-service       │
│  │     └─ AssetAC  │───fetch───▸│ /api/assets/search → coinpaprika    │
│  └─ price poll 20s │───fetch───▸│ /api/prices → coinpaprika           │
└────────────────────┘            └──────────────┬─────────────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────┐
                                  │ Supabase (transactions    │
                                  │ table + RLS)              │
                                  └──────────────────────────┘
```

## Phases at a Glance

| Phase                         | What it delivers                                                                | Key risk                                                               |
| ----------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Schema & Dependencies      | `price_usd` column, shadcn/ui components, Zod, Vitest, API helpers              | Migration must be backward-compatible                                  |
| 2. CoinPaprika Integration    | API client + proxy endpoints for search & prices                                | Free tier rate limits (20K/month); network errors                      |
| 3. Transaction Backend        | Service layer, CRUD API, validation, locations endpoint                         | Insufficient-source validation requires computing holdings per request |
| 4. Transaction Form UI        | Adaptive DEPOSIT/BUY/SELL/SWAP form with autocomplete, price suggestion, dialog | Source/target mapping per type must be correct                         |
| 5. P&L Engine & Portfolio API | Average Cost engine + executable P&L tests + portfolio endpoint                 | Arithmetic correctness is non-negotiable (PRD guardrail)               |
| 6. Portfolio Dashboard UI     | Table with auto-refresh, per-location detail, dialog integration                | State management for polling + re-fetch after trade                    |

**Prerequisites:** F-02 (transaction schema + RLS) — done.
**Estimated effort:** ~4-5 sessions across 6 phases.

## Open Risks & Assumptions

- CoinPaprika free tier (20K calls/month) is sufficient only with server-side current-price caching and hidden-tab polling pause. Without caching, one always-open dashboard at 20s polling would be ~129,600 external calls/month. With 120s cache TTL, the active-use budget is ~666 visible dashboard hours/month before search/historical calls.
- `price_usd` is resolved at transaction creation time from stablecoin rules, submitted quantities/manual price, and selected-date CoinPaprika prices. If valuation cannot be resolved, creation is rejected instead of storing a transaction that silently disappears from P&L.
- First trade requires a prior recorded source holding. In S-01 that means a USD-stablecoin DEPOSIT for the cash-like side; non-stablecoin historical deposits remain S-05.
- Fees are stored but do not affect P&L in S-01. This means reported P&L will be slightly off from true P&L for users with significant fees. Acceptable for MVP; fee-adjusted cost basis can be added as a refinement.
- The Average Cost method computes a single average across all purchases of an asset at a location, regardless of when they were made. This matches the PRD but differs from FIFO/LIFO (explicitly deferred to v2).

## Success Criteria (Summary)

- User can create a USD-stablecoin DEPOSIT, then BUY, SELL, and SWAP transactions with current or historical CoinPaprika price suggestions, override the suggested price, and see the execution valuation reflected in portfolio P&L
- Portfolio shows per-asset positions with correct Average Cost P&L (manually verifiable against a spreadsheet)
- Prices auto-refresh every ~20 seconds without page reload
- No user can see another user's transactions or positions (RLS enforcement)
