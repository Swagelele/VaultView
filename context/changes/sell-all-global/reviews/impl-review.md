<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Sell-All Global

- **Plan**: context/changes/sell-all-global/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-06-16
- **Verdict**: APPROVED (with 2 warnings)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — "all-or-nothing" comment overstates the atomicity guarantee

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/transaction-service.ts:209-210
- **Detail**: The bulk `insert([...])` is atomic at the DB level (constraint violation rolls back all rows), so the plan's goal (never a half-sold portfolio) holds. But the holdings read (getHoldingAtLocation per location) and the insert are two un-fenced round trips — concurrent writers could both pass `holding > 0` and oversell. Same TOCTOU race as createTransaction; accepted at the PRD's single-user scale. Issue is the comment implying a stronger guarantee than exists.
- **Fix A ⭐ Recommended**: Soften the comment to state the real boundary (insert atomic; read not transactionally fenced; acceptable at single-user scale).
  - Strength: Honest; zero behavior change; matches the existing single-tx posture.
  - Tradeoff: Leaves the unlikely race in place.
  - Confidence: HIGH — race out of scope for this tracker.
  - Blind spot: None significant.
- **Fix B**: Fence read+insert in a Postgres RPC/transaction.
  - Strength: Eliminates the race.
  - Tradeoff: New SQL + migration disproportionate to the risk; would want createTransaction migrated too.
  - Confidence: MED.
  - Blind spot: createTransaction consistency.
- **Decision**: FIXED via Fix A — comment softened to state insert-atomic / read-not-fenced.

### F2 — P&L-engine change contradicts the plan's "What We're NOT Doing"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/pnl-engine.ts:46-50, src/lib/transaction-service.ts:224-225
- **Detail**: Plan lists "No changes to the P&L engine" under What We're NOT Doing, yet the implementation added the (transaction_date, created_at) tiebreaker there and in getTransactions. Conscious, user-approved mid-implement fix for a real phantom-position bug, captured in lessons.md — but plan.md was never updated, so the plan-as-source-of-truth contradicts the diff. Documentation gap, not a code defect.
- **Fix**: Add a "Deviation" addendum to plan.md noting the engine tiebreaker was added by agreement (with commit SHA 7e7edab).
- **Decision**: FIXED — "Deviations from plan" section added to plan.md.

### F3 — resolvePriceUsd call is effectively ceremony in the batch path

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/transaction-service.ts:176-188
- **Detail**: `price` is schema-validated positive and passed as resolvePriceUsd's `override`, which returns it immediately — so priceUsd always equals price and the `priceUsd === null` branch is unreachable for this path. Harmless defensive/consistency code (mirrors createTransaction).
- **Fix (optional)**: Leave as-is for consistency, or set price_usd = price directly with a one-line comment. No behavior change.
- **Decision**: SKIPPED — kept for consistency with createTransaction.
