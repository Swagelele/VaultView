<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Transaction List with Filters

- **Plan**: context/changes/transaction-list-filters/plan.md
- **Scope**: Phases 1–2 of 2 (+ per-purchase unrealized-P&L revision)
- **Date**: 2026-06-17
- **Verdict**: NEEDS ATTENTION (no blockers — all warnings; resolved during triage)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension          | Verdict |
| ------------------ | ------- |
| Plan Adherence     | PASS    |
| Scope Discipline   | PASS    |
| Safety & Quality   | WARNING |
| Architecture       | PASS    |
| Pattern Consistency| WARNING |
| Success Criteria   | PASS    |

Automated success criteria re-run at review time: `npm run lint` PASS, `npm run build` PASS.
Manual criteria (1.4–1.6, 2.3–2.8) marked complete in `## Progress` and confirmed by the user.

## Findings

### F1 — Fresh buys show instant non-zero unrealized P&L

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/transaction-service.ts:266-268
- **Detail**: Per-purchase `unrealized = target_qty × live_price − source_qty × price_usd`. Right after a buy, the recorded cost basis differs from the live ticker by spread/drift, so a brand-new purchase shows non-zero unrealized P&L immediately. Re-surfaces the documented `lessons.md` symptom; correct live mark-to-market but a known UX trap, more visible per-row than on the dashboard.
- **Decision**: ACCEPTED-AS-RULE — folded into the existing "Always verify cost basis matches form price" lesson (per-row live-mark drift is expected, not a cost-basis bug). Code left as-is (numbers are correct live mark-to-market); no tooltip added by user choice.

### F2 — Stale-price flag dropped; stale unrealized shown as fresh

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/lib/transaction-service.ts:257
- **Detail**: `getTransactionsWithPnl` destructured only `{ prices }`, discarding `stale`/`updated_at` that `getMultiplePrices` returns and `portfolio-service.ts` propagates — so stale unrealized values rendered identically to fresh ones.
- **Fix**: Returned `{ data, stale, updated_at }` (new `TransactionsWithPnlResult`), passed through `GET /api/transactions`, and surfaced a "Prices may be stale" hint in `TransactionList`.
- **Decision**: FIXED

### F3 — Non-401 fetch failure renders as "No transactions yet"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/portfolio/TransactionList.tsx:27-37,136-141
- **Detail**: A failed fetch was swallowed to `null` and shown as the empty-account message, hiding transient errors.
- **Fix**: Added an `error` state + distinct error panel with a Retry button (`reloadKey`), separate from the empty-list copy.
- **Decision**: FIXED

### F4 — Unrealized counts full acquired qty even after partial sell

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/lib/transaction-service.ts:264-268
- **Detail**: A partially-sold lot still shows unrealized on the original full quantity; can overlap the realized line for the same lot.
- **Decision**: ACCEPTED — deliberate buy-and-hold semantic, documented in plan + type doc. No action.

### F5 — symbolFromId duplicated in portfolio-service.ts

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/lib/format.ts:25 vs src/lib/portfolio-service.ts:37
- **Detail**: The shared `symbolFromId` helper was not adopted in `portfolio-service.ts`, leaving a second inline `id.split("-")[0]…` copy.
- **Fix**: `portfolio-service.ts` now imports and uses `symbolFromId`.
- **Decision**: FIXED

### F6 — GET /api/transactions now makes an external price call

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/lib/transaction-service.ts:256-257
- **Detail**: New latency on a previously DB-only endpoint, but mitigated: assets deduped, one batched `getMultiplePrices`, 120s cache — same posture as `portfolio-service.ts`.
- **Decision**: ACCEPTED — acceptable at single-user scale. No action.
