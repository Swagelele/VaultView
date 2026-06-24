---
title: VaultView Domain Distillation
created: 2026-06-23
type: domain-distillation
---

# VaultView — Domain Distillation

> A **map** of the VaultView domain distilled from source docs + code, not a redesign.
> Evidence-tagged: `[evidence]` = quoted from a file I read; `[inference]` = reasoned
> from evidence; `[unknown]` = not verified. Citations are `file:line` I actually opened.
> Read-only on production code; this artifact is the only file written.

## Step 0 — Project context (where the domain lives)

- **Vision / requirements:** `context/foundation/prd.md` — VaultView is a crypto
  portfolio tracker whose reason to exist is **arithmetically-correct Average-Cost
  P&L** + **location-aware consolidation**. "P&L calculations must be arithmetically
  correct — wrong numbers are worse than no numbers" (`prd.md`, Guardrails). [evidence]
- **Stack:** `context/foundation/tech-stack.md` — Astro 6 SSR + React 19 islands +
  Supabase + Cloudflare; pricing via **CoinPaprika** (no key, coinId convention like
  `btc-bitcoin`, `usdt-tether`). [evidence]
- **Where business logic lives (layers):** [evidence]
  - **Domain engine (pure):** `src/lib/pnl-engine.ts` — `computePositions`,
    `aggregateByAsset`. The only place P&L math happens.
  - **Application/service:** `src/lib/transaction-service.ts` (write spine + read-side
    per-tx P&L), `src/lib/portfolio-service.ts` (read model assembly).
  - **Contracts:** `src/lib/schemas.ts` (Zod input), `src/types.ts` (TS types).
  - **Anti-corruption layer:** `src/lib/coinpaprika.ts` (vendor wire types are
    function-local/unexported — a working ACL per `trade-flow-analysis/research.md:190-202`).
  - **Persistence:** `supabase/migrations/20260614213523_create_transactions.sql`
    (+ `..._add_price_usd...`). A **single `transactions` table**; no positions/lots table.
  - **UI islands:** `src/components/portfolio/*` (`TransactionForm`, `PortfolioView`,
    `PortfolioTable`, `TransactionList`, `SellAllDialog`).
  - **API:** `src/pages/api/{transactions,transactions/batch,portfolio,prices,holdings,locations,assets/search}`.
- **Architectural shape:** a **history-replay** system. Writes persist one
  `transactions` row; **all P&L + cost basis are recomputed on read** by replaying the
  full transaction history through `pnl-engine.ts`. There is **no stored cost basis or
  position** (`trade-flow-analysis/research.md:29-34`; engine recomputes per call). [evidence]

---

## Step 1 — Ubiquitous Language

For each term: definition + source quote, and where it lives in code (or MISSING).

### Persisted / first-class concepts

| Term | Definition (source) | Code home |
|---|---|---|
| **Transaction** | The one persisted write. "User can add a BUY/SELL/SWAP … DEPOSIT … WITHDRAW" (`prd.md` FR-003..006). | `types.ts:3-18` `Transaction`; SQL `create_transactions.sql:4-32`; Zod `schemas.ts:9-20`. **Defined 3× by hand** — see Step 4. [evidence] |
| **TransactionType** | Five user-facing categories: `BUY, SELL, SWAP, DEPOSIT, WITHDRAW` (`prd.md` Business Logic). | `types.ts:1`; SQL enum `create_transactions.sql:2`; Zod enum `schemas.ts:10`. [evidence] |
| **source/target asset+quantity** | "two-sided trade (source asset → target asset)" (`prd.md` FR-003). | `types.ts:7-10`; SQL `:9-15`. [evidence] |
| **price vs price_usd** | `price` = source→target exchange rate (two-sided) or USD valuation (one-sided); `price_usd` = resolved USD cost basis input. | `types.ts:11-12`; resolution `transaction-service.ts:135-151`; SQL comment "Price per unit of source asset" `:17`. **Two meanings of "price"** — see Step 4. [evidence] |
| **fee** | "total fees paid" (`prd.md` FR-010). Summed as raw USD. | `types.ts:13`; `portfolio-service.ts:23-24`. [evidence] |
| **location** | "user-defined free-text tags created inline" (`prd.md` FR-012, Business Logic). | A **plain `varchar` column** `create_transactions.sql:24`; `types.ts:14`. **Not a first-class entity** — confirmed: no locations table, distinct values derived from transactions (`transaction-service.ts:314-326`). [evidence] |
| **transaction_date** | "User specifies the original purchase date" (`prd.md` FR-005). Minute precision (`.slice(0,16)`). | SQL `:27`; `TransactionForm.tsx:27`; tie-handling `pnl-engine.ts:55-64`. [evidence] |

### Computed-on-read concepts (the domain model proper)

| Term | Definition (source) | Code home |
|---|---|---|
| **Position** | A holding of one asset at one location, with quantity + avg cost + realized P&L. "consolidated positions" (`prd.md` Success Criteria). | `pnl-engine.ts:10-21` `PositionEntry`; keyed `asset::location` (`:23-25`). Distinct `Position` interface also in `types.ts:39-46`. **Two declarations of the same concept** — see Step 4. [evidence] |
| **avg cost (Average Cost)** | The only costing method (`prd.md` Non-Goals: "No FIFO/LIFO … Average Cost is the only method"). `avgCost = total_cost_usd / quantity`. | `pnl-engine.ts:85`, `:159`. [evidence] |
| **Realized P&L** | Locked-in gain on disposal vs average cost (`prd.md` FR-003, US-01). `source_quantity * (price_usd - avgCost)`. | `pnl-engine.ts:86`; per-tx map `:90`, surfaced `transaction-service.ts:306`. [evidence] |
| **Unrealized P&L** | Live mark-to-market vs current price (`prd.md` FR-008). | Aggregate: `portfolio-service.ts:47-48`. Per-lot: `transaction-service.ts:299-300`. **Two formulas** — see Step 4. [evidence] |
| **is_closed** | A position whose remaining quantity is ~0 (float-tolerant). | `pnl-engine.ts:158-165`; UI "Show closed positions" `PortfolioView.tsx:165`. [evidence] |
| **consolidated holding** | "consolidated holdings per asset across all locations, with per-location breakdown" (`prd.md` FR-013). | `aggregateByAsset` `pnl-engine.ts:124-168`; read model `PortfolioAsset` `types.ts:55-66`. [evidence] |
| **holding (validation sum)** | Current quantity at a location, an **order-independent** sum used as the over-sell guard. | `getHoldingAtLocation` `transaction-service.ts:13-48`; API `/api/holdings`. [evidence] |
| **unpriced transaction** | A row whose `price_usd` is null — skipped by the engine. | `pnl-engine.ts:67-70`, `ComputeResult.unpriced` `:42-48`. [evidence] |

### ONE-CONCEPT-MANY-NAMES / ONE-NAME-MANY-CONCEPTS (the "3×Account" hunt)

1. **"position" / "holding" / "balance" — one concept, three names (and two code
   declarations).** The PRD uses "positions" and "holdings" interchangeably
   (`prd.md` Success Criteria vs FR-013). In code:
   - `PositionEntry` (`pnl-engine.ts:10`) — the canonical engine position (`asset::location`).
   - `Position` (`types.ts:39-46`) — a **second, near-identical interface** that the
     engine does NOT use (engine uses `PositionEntry`). [evidence]
   - `getHoldingAtLocation` (`transaction-service.ts:13`) — a **third** notion: an
     unclamped quantity sum, deliberately order-independent, used only as a write guard.
   - UI says "balance" (`pnl-engine.test.ts:190` "marks zero-balance position"),
     "position(s)" (`PortfolioView.tsx:165,179`; `PortfolioTable.tsx:34`;
     `SellAllDialog.tsx:194`), and "holdings" (`AssetAllocationChart.tsx:34`).
   **Verdict:** one domain concept (a holding/position) wearing three names; the
   `types.ts:39` `Position` is a latent duplicate of `PositionEntry`. [evidence/inference]

2. **"price" — one name, two concepts.** Column `price` is the **exchange rate**
   (two-sided) but the **USD valuation** (one-sided DEPOSIT/WITHDRAW), branched at
   `transaction-service.ts:135-141`; `price_usd` is the separate USD cost-basis input.
   The SQL comment "Price per unit of source asset" (`create_transactions.sql:17`)
   describes only one of the two meanings. [evidence]

3. **"per-buy position" / "lot" — named in the PRD, ABSENT in code.** FR-009: "per-buy
   P&L breakdown where each individual purchase is treated as a separate position (like
   futures positions on exchanges)" (`prd.md` FR-009). **MISSING in code as a domain
   concept** — the engine collapses everything into one average-cost `asset::location`
   position (`pnl-engine.ts:84-89`); there is no lot/per-buy entity. The closest proxy
   is the **per-transaction-row** unrealized P&L in `getTransactionsWithPnl`
   (`transaction-service.ts:291-309`) and the `/transactions` list — but that is "P&L
   tagged onto a transaction," not "each buy as its own position." No two-mode toggle
   exists in `PortfolioView.tsx` (single aggregate table only, `:150-184`). [evidence]

### Operations & rules

| Operation | Source | Code |
|---|---|---|
| Add transaction (write spine) | US-01 | `createTransaction` `transaction-service.ts:94-165` |
| Per-location **sell-all** (auto-fill qty) | FR-004, US-03 | `TransactionForm` holdings fetch `:40`; `/api/holdings` |
| **Global sell-all** across locations | FR-004 (secondary) | `createSellAllGlobal` `transaction-service.ts:167-239`; `/api/transactions/batch` |
| Price suggestion + manual override | FR-007 | `resolvePriceUsd` override-first `:50-92`; `/api/prices` |
| Portfolio read model | FR-008, FR-013 | `getPortfolio` `portfolio-service.ts:15-67` |
| Transaction list (+ P&L, filters) | FR-011 | `getTransactionsWithPnl` `:279-312`; `TransactionList.tsx` |
| Asset allocation donut | FR-014 | `asset-allocation.ts` |

---

## Step 2 — Subdomain classification

Core = the product's reason to exist (Average-Cost P&L correctness + location-aware
consolidation), justified against `prd.md` Success Criteria / Guardrails / Non-Goals.

| Concept / area | Class | Justification (source) |
|---|---|---|
| **Average-Cost P&L engine** (`pnl-engine.ts`) | **CORE** | "wrong numbers are worse than no numbers … Average Cost must produce verifiably accurate results" (`prd.md` Guardrails). The whole value prop. [evidence] |
| **Location-aware consolidation** (`asset::location` keying, `aggregateByAsset`) | **CORE** | The market gap the PRD claims: "tagging WHERE each position physically sits … is the gap the market leaves open" (`prd.md` Vision). [evidence] |
| **Cost-basis resolution** (`resolvePriceUsd`, DEPOSIT historical / WITHDRAW market) | **CORE** | Drives realized P&L correctness; DEPOSIT cost basis "derived from historical API price" (FR-005). [evidence] |
| **Transaction write spine + balance guard** | **CORE-supporting** | Persists the only domain input; the over-sell 409 enforces a real invariant (US-05 AC). [inference] |
| **Per-buy P&L breakdown** (FR-009) | **CORE (unbuilt)** | Promoted to must-have in the PRD; currently MISSING in code. A core gap, not a supporting one. [evidence] |
| **Pricing integration** (`coinpaprika.ts`) | **GENERIC** | A swappable commodity vendor; PRD rejected/accepted vendors interchangeably (`tech-stack.md`). Clean ACL already. [evidence] |
| **Auth / data isolation** (Supabase + RLS) | **SUPPORTING (Generic mechanism)** | "no user ever sees another user's data" is a hard guardrail, but delivered by off-the-shelf RLS/auth (`prd.md` Access Control; RLS `create_transactions.sql:34-52`). [evidence] |
| **Location labels** (free-text) | **SUPPORTING** | "No separate location management screen" (FR-012) — deliberately thin. [evidence] |
| **Asset allocation donut, summary cards** | **SUPPORTING** | "additive UI with no new data model" (FR-014 note). [evidence] |
| **Transaction list + filters** | **SUPPORTING** | FR-011 convenience over the core data. [evidence] |

---

## Step 3 — Aggregate candidates + invariants

The transaction-history-replay shape means there is effectively **one write aggregate
(Transaction)** and **one derived read aggregate (the per-asset consolidated Position
set)**. Candidate invariants:

| # | Aggregate candidate | Invariant (must always hold) | Source quote | Enforcement status |
|---|---|---|---|---|
| A1 | **Transaction (write)** | A non-DEPOSIT disposal cannot exceed the holding at its location | "Withdraw quantity cannot exceed current holdings" (US-05 AC); "sell-all qty matches exact current holding at that location" (US-03 AC) | **Enforced** at write via `getHoldingAtLocation` 409 (`transaction-service.ts:107-115`) — but the **clamp in the engine is a second, weaker line** (`pnl-engine.ts:84`). [evidence] |
| A2 | **Transaction shape** | source side always present; target side present iff two-sided (BUY/SELL/SWAP), absent for DEPOSIT/WITHDRAW | FR-003/005/006 | **Declared** (Zod `superRefine` `schemas.ts:22-66`; SQL CHECKs `:11,15,18`) but the row insert bypasses `TransactionInsert` and is `as Transaction`-cast (`:158-164`) — shape can **drift silently** (Step 4 D1). [evidence] |
| A3 | **Position (derived)** | `avg_cost = total_cost_usd / quantity`; Average Cost only | "Average Cost is the only method" (Non-Goals); arithmetically reproducible (NFR) | **Enforced & well-tested** in the engine (`pnl-engine.ts:85,159`; `pnl-engine.test.ts` covers all 5 branches). [evidence] |
| A4 | **Position (derived)** | realized P&L recorded for every priced disposal; over-sell records 0, not phantom qty | US-01; lessons "phantom positions" | **Enforced** via deterministic `(transaction_date, created_at)` sort + clamp (`pnl-engine.ts:55-95`); covered (`pnl-engine.test.ts:375`). [evidence] |
| A5 | **Cost basis** | the stored `price_usd` must equal the price the user saw at submit | `lessons.md` "Always verify cost basis matches form price" | **Partially** — override-first preserves it (`resolvePriceUsd:61`; sell-all passes form price `:193-203`), but live-mark drift on read is by-design and **untested** on `getTransactionsWithPnl`. [evidence] |
| A6 | **Data isolation** | a user reads/writes only their own transactions | "no user ever sees another user's data" (Guardrail) | **Enforced** by RLS `auth.uid() = user_id` (`create_transactions.sql:37-52`). [evidence] |

---

## Step 4 — MODEL vs CODE divergence (the payload)

| # | Doc / model says X | Code does Y | Evidence |
|---|---|---|---|
| **DV1** | FR-009: per-buy P&L breakdown — "each individual purchase treated as a separate position," a **must-have**, two display modes (aggregate + per-buy) | Engine has **only** average-cost `asset::location` positions; **no lot/per-buy entity**, **no mode toggle** in the UI. Per-tx P&L on the `/transactions` list is the only proxy. | `prd.md` FR-009; `pnl-engine.ts:84-89` (single avg position); `PortfolioView.tsx:150-184` (one table); `transaction-service.ts:291-309` (per-row proxy) [evidence] |
| **DV2** | Domain has one clear "position/holding" concept | **Three code notions**: `PositionEntry` (engine), unused `Position` (`types.ts:39`), `getHoldingAtLocation` (unclamped guard sum). The `types.ts` `Position` is a latent duplicate the engine never uses. | `pnl-engine.ts:10-21`; `types.ts:39-46`; `transaction-service.ts:13-48` [evidence] |
| **DV3** | Transaction shape is one thing | Defined **3× by hand** (Zod / TS / SQL) over an **untyped** Supabase client; bridged by **3 `as` casts** + `eslint-disable`; `TransactionInsert` exists but is **imported nowhere** → a column rename **drifts with no compile error**. | `schemas.ts:9-20`; `types.ts:3-25`; `create_transactions.sql:4-32`; casts `transaction-service.ts:158-164,232,238`; `refactor-opportunities/research.md:40-58` [evidence] |
| **DV4** | "price" is "price per unit of source asset" (SQL comment) | `price` carries **two different meanings**: exchange rate (two-sided) vs USD valuation (one-sided), branched at write time; the comment documents only one. | `create_transactions.sql:17`; `transaction-service.ts:135-141` [evidence] |
| **DV5** | FR-003: SWAP is a first-class transaction type users can add | **SWAP has no UI form path** — `TxType` is `DEPOSIT|BUY|SELL|WITHDRAW`; SWAP survives only in schema/engine for existing data (intentional, `7b81f3a`). | `TransactionForm.tsx:10`; `schemas.ts:10`; `refactor-opportunities/research.md:81-84` [evidence] |
| **DV6** | DEPOSIT date "can't have happened in the future" | Future-date guard is **DEPOSIT-only**; WITHDRAW future-date is **unguarded** (deliberate, since WITHDRAW prices at market) — but a nonsensical future WITHDRAW is still acceptable input. | `schemas.ts:29`; `refactor-opportunities/research.md:81-84` [evidence] |
| **DV7** | "location" is a domain concept ("location label") | Location is a **bare `varchar`** with no entity, table, FK, or normalization; distinct values are derived ad hoc. Renaming/merging a location is impossible without rewriting rows. | `create_transactions.sql:24`; `transaction-service.ts:314-326` [evidence] |
| **DV8** | A1 disposal invariant (can't oversell) | Enforced **twice, inconsistently**: the write guard `getHoldingAtLocation` is an **order-independent** sum, while the engine clamp is **order-dependent** — they can disagree on same-minute ties (the documented phantom-position class), reconciled only by the `created_at` tiebreaker. | `transaction-service.ts:13-48` vs `pnl-engine.ts:84`; `lessons.md:12-17` [evidence] |
| **DV9** | NFR: cost basis is what the user paid | `getTransactionsWithPnl` marks each lot live-to-market, so a fresh buy shows non-zero unrealized P&L — by design but **untested** and easily mistaken for a bug. | `transaction-service.ts:299-300`; `lessons.md:5-10` [evidence] |

---

## Step 5 — Refactor ranking (value × risk)

Ranked by **how core the invariant** × **how weakly enforced today**. (Structural
candidates only; test gaps and runtime guards are noted but not the model fix.)

| Rank | Item | Core-ness | Enforcement weakness | Net |
|---|---|---|---|---|
| **#1** | **DV3 — single source of truth for the Transaction shape** (generated DB types → typed client; delete the 3 casts; derive `Transaction`/`Insert`) | High — the Transaction is the **only persisted domain input**; if its shape drifts, every P&L number is wrong behind a 200 OK (PRD's top guardrail) | **Weakest** — untyped client, triplicated defs, silent drift; CI runs **no tests**, so `tsc` is the only net and it currently can't see the drift | **Highest** |
| #2 | **DV2 — collapse the three position notions** to one named model (make `types.ts` `Position` derive from / alias the engine's `PositionEntry`; name the guard sum distinctly, e.g. `availableQuantity`) | High (core concept) | Medium — duplication is latent, not yet a live bug | High |
| #3 | **DV1 — model the per-buy "lot"** to satisfy FR-009's second must-have mode | High (an unbuilt core requirement) | n/a (absent) — but this is **new feature work**, not a refactor; flag for `/10x-plan`, not a structural cleanup | Medium-as-refactor |
| #4 | DV4 — disambiguate `price` vs `price_usd` (rename / document the dual meaning) | Medium | Medium (comment misleads) | Medium |
| — | DV8/DV9 (test the engine-clamp/guard agreement + `getTransactionsWithPnl`); DV5/DV6/DV7 domain rulings | guard / domain | — | input to planning, not a model refactor |

**#1 and why: DV3 — give the Transaction one authoritative shape via generated DB
types feeding a typed Supabase client.** It guards the single most core invariant
(every P&L figure depends on the Transaction shape being correct — the PRD's "wrong
numbers are worse than no numbers" guardrail), it is the most weakly enforced today
(untyped client + triplicated hand-definitions + three `as` casts, with **no tests in
CI**), and it is accidental complexity (the one helper meant to enforce the insert
shape, `TransactionInsert`, is imported nowhere), so no load-bearing decision is at
risk. It converts the entire silent blast radius into compile errors the existing CI
`build` already catches. This matches the independently-reached ranking in
`refactor-opportunities/research.md:101-115`. [evidence]
