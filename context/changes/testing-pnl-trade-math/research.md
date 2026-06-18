---
date: 2026-06-18T00:00:00Z
researcher: Claude (10x-research)
git_commit: 98aaccfa2d47edb55725200338d44652c9040115
branch: master
repository: m1 (VaultView)
topic: "P&L and trade-math correctness — oracle and coverage for test-plan §3 Phase 1 (Risks #1, #2, #5)"
tags: [research, codebase, pnl-engine, transaction-service, coinpaprika, testing, oracle]
status: complete
last_updated: 2026-06-18
last_updated_by: Claude (10x-research)
---

# Research: P&L and trade-math correctness — oracle for test-plan §3 Phase 1

**Date**: 2026-06-18
**Researcher**: Claude (10x-research)
**Git Commit**: 98aaccfa2d47edb55725200338d44652c9040115
**Branch**: master
**Repository**: m1 (VaultView)

## Research Question

This is rollout **Phase 1** of `context/foundation/test-plan.md` §3 — *P&L and trade-math
correctness* — defending Risks **#1** (wrong P&L / average-cost number), **#2** (crypto-to-crypto
quantity corruption), and **#5** (price-API failure → hang or fabricated price), at the **unit**
layer. Per Module 3 Lesson 2 and §1 principle #3, research must produce the **oracle** —
*what the code should do, derived from requirements* — and reveal **which risks are already
covered** vs bare. It must NOT assert that the implementation's current return value is the
correct value (the oracle problem).

## Summary

The P&L engine is a single deterministic Average-Cost reducer in `src/lib/pnl-engine.ts`, fed
by a USD-price resolver in `src/lib/transaction-service.ts`, with presentation math in
`portfolio-service.ts`, `portfolio-summary.ts`, and `asset-allocation.ts`. The classic test base
is **sparse-but-real**: 5 Vitest files in `src/lib/` (~40 `it` blocks) already cover the core
average-cost / realized / unrealized / SWAP / DEPOSIT / WITHDRAW happy paths and the dashboard
null-collapsing logic. Phase 1's job is therefore **edge-case and regression hardening**, not
greenfield coverage.

Three findings reshape the plan's scope:

1. **The Risk #2 regression that actually shipped (commit `98aaccf`, the "120,000 ETH" bug) lives
   in the React component `TransactionForm.tsx`, NOT in `src/lib/`.** The engine faithfully stored
   the wrong quantity the form computed. A unit test of `src/lib` will **not** catch a recurrence
   unless the quantity-derivation math is extracted into a pure, importable function — OR we test
   the server-side mirror (`resolvePriceUsd`'s crypto-to-crypto branch) as the closest in-lib
   guard. This is the single most important decision for `/10x-plan`.
2. **Fees are entirely excluded from every P&L computation** (engine never reads `tx.fee`; fees
   are only a flat dashboard sum). This appears intentional per the PRD (realized P&L is "against
   average cost"; total fees is a separate FR-010 line) — so the oracle is "P&L is gross of fees,
   fees reported separately," and a Phase 1 test should *lock that contract in* rather than
   "fix" it.
3. **`is_closed` uses strict `=== 0`** with no epsilon. Average-cost subtraction (`pnl-engine.ts:78`)
   can leave floating residue, so a fully-sold position could read as still-open. This is a
   genuine latent edge the plan should decide on (assert-current vs flag-as-bug).

For Risk #5, the boundary degrades correctly to `null` (no fabricated price; manual override
short-circuits the API), but `coinpaprika.ts` has **zero direct tests** (only mocked through
`resolvePriceUsd`), **no response validation** (unchecked `as T` cast → NaN risk on a malformed
200), and **no timeout/AbortController** (a real hang vector that a unit test can document but
not fully exercise).

## Detailed Findings

### Risk #1 — P&L / average-cost arithmetic (the oracle)

The Average-Cost contract, with formulas quoted from code (these ARE the oracle, and each is
independently reproducible per the PRD NFR "verifiable with a spreadsheet"):

- **Per-disposal average cost**: `avgCost = total_cost_usd / quantity` — `pnl-engine.ts:74`,
  guarded by the `quantity > 0` clamp at `:73`.
- **Realized P&L per disposal**: `source_quantity * (price_usd − avgCost)` — `pnl-engine.ts:75`.
- **Cost-basis decrement on disposal** (average-cost, not sale price): `total_cost_usd −=
  source_quantity * avgCost` — `pnl-engine.ts:78`.
- **Target/acquired cost basis**: `costBasis = source_quantity * price_usd` — `pnl-engine.ts:88`
  (the USD spent on the *source* side; NOT `target_quantity * target_price`).
- **Asset-level average cost** (consolidated across locations): `total_cost_usd / total_quantity`
  — `pnl-engine.ts:143`, div-by-zero guarded → 0.
- **Asset unrealized P&L** (FR-008, aggregate mode): `total_quantity * (currentPrice − avg_cost_usd)`
  when priced and held — `portfolio-service.ts:47-48`.
- **Per-buy unrealized P&L** (FR-009 mode 2, buy-and-hold view): `target_quantity * currentPrice −
  source_quantity * price_usd` — `transaction-service.ts:294-295`, only for a markable acquisition
  (`isMarkableAcquisition`, `:254-264`).
- **Dashboard totals** (FR-010): realized summed across all assets incl. closed
  (`portfolio-summary.ts:28`); unrealized summed only over held assets and **null-collapsing** — if
  *any* held asset is unpriced, the whole total is `null` (`:30-36`); `net = realized + unrealized`
  or null (`:39`).

**Already covered (do not re-author):** weighted average across multiple BUYs
(`pnl-engine.test.ts:80-114`), partial & full SELL realized P&L (`:116-222`), SWAP source/target
(`:152-188`), DEPOSIT cost basis incl. non-$1 (`:27-49`), WITHDRAW realized + position close
(`:224-279`), unrealized/net aggregation + null-collapsing + fee passthrough
(`portfolio-summary.test.ts`), allocation fractions/exclusion (`asset-allocation.test.ts`).

**Bare edges worth a requirement-derived test (Risk #1):**
- Multi-location *consolidation* of average cost (same asset, two locations, different avg costs →
  single consolidated avg) — aggregation tested for quantity but not avg-cost reconciliation.
- `is_closed` floating residue (`pnl-engine.ts:144`, strict `=== 0`).
- **Fee-exclusion as an explicit contract** — assert P&L is unchanged by `fee`, and that
  `total_fees_usd` sums independently (`portfolio-service.ts:24`).
- Zero-but-not-null `price_usd` (passes the null guard; DEPOSIT adds 0 cost; disposal realizes a
  full loss) — `pnl-engine.ts:57-60` vs `:64-65`.

### Risk #2 — crypto-to-crypto quantity (where it actually breaks)

- **The shipped bug (`98aaccf`)**: `TransactionForm.tsx` valued a non-stablecoin counter side at
  $1, storing `target_quantity = qty × price` (SELL) / `source_quantity = qty × price` (BUY)
  instead of dividing by the counter asset's USD price. "Sell 2 BTC for ETH" recorded **"120,000
  ETH."** Fix: `target_quantity = (qty × price) / counterPrice`, plus `source_price_usd_override`
  and a submit-gate (`tradeNeedsCounterPrice`) so the form blocks rather than fabricating when the
  counter price is unavailable. **This logic is in the React component — current `src/lib` tests
  cannot reach it.**
- **Server-side mirror (in-lib, testable today)**: `resolvePriceUsd` crypto-to-crypto branch
  derives source USD as `(targetQuantity * targetUsdPrice) / sourceQuantity` —
  `transaction-service.ts:81-85` (commit `f2705e3`). Stablecoin-on-source → `1` (`:71`); target
  stablecoin → `(targetQuantity ?? 0) / sourceQuantity`, non-positive → null (`:73-76`). The engine
  then recomputes cost as `source_quantity * price_usd` (`:88`); **these two must reconcile** — a
  high-value regression target.
- **The ordering / phantom-position regression (lessons.md b, Risk #2 sequencing)**: a BUY and a
  same-minute SELL share minute-precision `transaction_date`. If the SELL sorts before its funding
  BUY, the `quantity > 0` clamp (`pnl-engine.ts:73`) silently skips the disposal → phantom position
  + dropped realized P&L. Guard: sort by `(transaction_date, created_at)` (`pnl-engine.ts:50-54`).
  This specific tie-ordering scenario does **not** appear to have an explicit test today — strong
  Phase 1 candidate.
- **Over-sell**: two distinct behaviors — write-time `409` guard (`transaction-service.ts:107`) and
  engine silent clamp recording realized `0` (`pnl-engine.ts:80-84`). The unclamped
  `getHoldingAtLocation` (`:13-46`) is what sell-all and the guard read. Tests should assert the
  clamp records `0` (not negative quantity), per the documented contract.

### Risk #5 — price-API boundary (degradation, no fabrication, no NaN, no hang)

`src/lib/coinpaprika.ts` is the entire fetch layer; browser never calls CoinPaprika directly
(proxied via `src/pages/api/prices.ts`, `src/pages/api/assets/search.ts`).

- **All failure modes (429 / non-200 / network / thrown) collapse to `null`** via `safeFetch`
  (`coinpaprika.ts:19-27`). No 429 distinction, no retry/backoff.
- **`resolvePriceUsd` null → HTTP 400** with a message pointing at manual override
  (`transaction-service.ts:125-131`); **override short-circuits the API** (`:59`). So the write path
  never fabricates and never writes NaN — *given* the schema-validated inputs.
- **No response validation** — `(await res.json()) as T` (`:23`), all response interface fields
  optional, only optional-chaining + `?? null` guards (`:65`, `:145`, `:45`). A `200` with a
  non-number `price` would pass `!== null` and flow into arithmetic; nothing checks
  `Number.isFinite`. **NaN-into-P&L is the residual contract gap** worth a test (mock a malformed
  200, assert clean degradation, not NaN).
- **`getMultiplePrices` stale-degradation** (`:74-129`) is the only place that emits a `stale` flag
  and merges stale-cached prices on partial failure — **complex and untested**.
- **No timeout / AbortController anywhere** (`:19-27`; absent in `prices.ts`) → genuine hang vector;
  documentable by a test, not fully exercisable at the unit layer.
- **Manual override always usable** for DEPOSIT / WITHDRAW / stablecoin-side BUY/SELL
  (`TransactionForm.tsx` inputs render unconditionally); crypto↔crypto counter price is
  *deliberately* non-overridable and gates submit (anti-fabrication, `:120,748`).

## Code References

- `src/lib/pnl-engine.ts:40-95` — `computePositions` reducer (sort `:50-54`, unpriced guard
  `:57-60`, DEPOSIT `:62-67`, disposal+clamp `:72-84`, acquisition `:86-91`)
- `src/lib/pnl-engine.ts:112-148` — `aggregateByAsset` (consolidated avg cost `:143`, `is_closed`
  `:144`)
- `src/lib/transaction-service.ts:48-90` — `resolvePriceUsd` (override `:59`, one-sided `:64-69`,
  stablecoin `:71-76`, crypto-to-crypto `:81-85`, fallback `:88-89`)
- `src/lib/transaction-service.ts:13-46` — `getHoldingAtLocation` (unclamped per-location sum)
- `src/lib/transaction-service.ts:254-307` — `isMarkableAcquisition` + `getTransactionsWithPnl`
- `src/lib/portfolio-service.ts:15-67` — `getPortfolio` (fees `:24`, asset unrealized `:47-48`)
- `src/lib/portfolio-summary.ts:23-47` — `computeSummary` (null-collapsing `:30-36`)
- `src/lib/asset-allocation.ts:35-64` — `computeAllocation`
- `src/lib/coinpaprika.ts:19-27` — `safeFetch` (failure → null, no timeout); `:74-129`
  `getMultiplePrices` stale logic; `:153-162` `getPriceForDate` routing
- `src/components/portfolio/TransactionForm.tsx` — counterPrice / buildPayload (commit `98aaccf`,
  Risk #2 bug site, **not in lib**); submit gate `:120,748`
- `vitest.config.ts:8-11` — `@` alias only; default node env, no setup file, no coverage config
- Existing tests: `src/lib/{pnl-engine,transaction-service,portfolio-summary,asset-allocation,schemas}.test.ts`

## Architecture Insights

- **Oracle source is the PRD + lessons, not the function's return.** Average-cost formulas are
  spreadsheet-reproducible (PRD NFR); tests must derive expected values by hand, never copy
  `toBe(<current return>)`. The §2 anti-pattern for Risk #1/#2 is exactly this.
- **`price_usd` is the load-bearing field** for all engine math; `price` (exchange rate) is stored
  but never consumed by the engine.
- **Two over-sell guards exist by design** (write-time 409 + engine clamp-to-zero) and are NOT
  redundant — tests should treat each as a separate contract.
- **Determinism depends on the `created_at` tiebreaker.** Any test that builds same-minute trades
  must set `created_at` to express causal order, or it will reproduce the phantom-position bug by
  accident.
- **Test conventions**: co-located `*.test.ts`; inline `tx()` / `asset()` `Partial<T>` factories;
  `vi.mock("@/lib/coinpaprika", …)` at the network edge; run via `npm test` (`vitest run`).

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — (a) cost basis must match the form price the user saw (benign
  live-mark drift vs real bug); (b) sort P&L by `(transaction_date, created_at)` to avoid phantom
  positions. Both are explicit Phase 1 regression targets.
- Commit `98aaccf` (Risk #2's "already burned here") — crypto-to-crypto quantity bug, in
  `TransactionForm.tsx`.
- Commit `f2705e3` — `resolvePriceUsd` crypto-to-crypto derives source USD from the target side.
- `context/archive/2026-06-16-sell-all-global/plan.md` — sell-all targets restricted to USD
  stablecoins so `target_quantity ≈ USD proceeds`; the non-stablecoin quirk "out of reach by
  construction."
- `context/archive/2026-06-17-withdraw-cash-out/plan.md` — WITHDRAW one-sided disposal contract
  (realized at current price, no target, stablecoin → ≈0, over-withdraw blocked then clamped).
- `context/archive/2026-06-17-deposit-historical-cost/plan.md` — override → stablecoin $1 →
  historical → null ordering is load-bearing; never invent a cost basis; future-dated deposit
  blocked.
- `context/archive/2026-06-17-transaction-list-filters/plan.md` — cross-check a SELL's realized P&L
  against a manual average-cost computation.

## Related Research

None prior in this change folder. Risk map and rollout context: `context/foundation/test-plan.md`
(§2 Risk Response Guidance rows #1/#2/#5; §3 Phase 1; §6.1 / §6.5 cookbook stubs to fill).

## Open Questions

1. **Risk #2 scope (decide in `/10x-plan`)**: the regression that shipped is in
   `TransactionForm.tsx`, but Phase 1 is scoped to the `src/lib` unit suite. Options:
   (a) test the in-lib server mirror `resolvePriceUsd` crypto-to-crypto branch (closest reachable
   guard, no refactor); (b) extract the form's quantity-derivation into a pure `src/lib` function
   and unit-test it (catches the real bug, needs a small refactor); (c) defer component coverage to
   a later phase and document the gap. Recommendation: (a) now + flag (b) as a candidate; do not
   silently leave the actual burn site uncovered.
2. **Fee-exclusion**: confirmed intentional from PRD reading (gross P&L + separate fee total). Plan
   should add a *contract-locking* test, not change behavior. Confirm with the user if any doubt.
3. **`is_closed === 0` epsilon**: assert current strict-equality behavior, or treat floating residue
   as a bug to flag? Recommend a test that documents the contract and a note to §6 / lessons if it's
   a latent defect.
4. **Price-API NaN guard**: there is no `Number.isFinite` check on a malformed-200 price. Worth a
   Risk #5 test (mock a non-number price, assert no NaN propagates) — but the *fix* (adding a guard)
   may exceed a test-only phase; flag for the plan.
5. **Timeout/hang**: no AbortController exists. A unit test can assert the null-degradation contract
   but cannot exercise a real hang; note the gap for an observability/infra follow-up rather than
   forcing it into a unit phase.
