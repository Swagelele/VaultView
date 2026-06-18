<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: P&L and Trade-Math Correctness

- **Plan**: context/changes/testing-pnl-trade-math/plan.md
- **Scope**: All 4 phases (complete)
- **Date**: 2026-06-18
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Stale-flag test hardcodes 120_001 coupled to the TTL constant

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Test Quality
- **Location**: src/lib/coinpaprika.test.ts (advanceTimersByTime(120_001))
- **Detail**: The stale-flag test advances fake timers by a literal 120_001ms to cross coinpaprika.ts's CURRENT_PRICE_TTL_MS (120_000). The coupling is silent — if the TTL changes, the test could prime-and-read inside the same window and pass for the wrong reason (false-green) instead of failing loudly.
- **Fix**: Export CURRENT_PRICE_TTL_MS from coinpaprika.ts and advance by TTL + 1 so the test boundary tracks the source.
- **Decision**: FIXED — exported the constant; test advances by CURRENT_PRICE_TTL_MS + 1.

### F2 — Duplicate local tx() factory in transaction-service.test.ts

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/transaction-service.test.ts (inside the crypto-to-crypto describe block)
- **Detail**: A second tx() Partial<T> factory is redefined inside the crypto-to-crypto describe, duplicating the module-level factory other suites keep singular. Harmless/self-scoped, minor DRY drift.
- **Fix**: Hoist the factory to module scope (matching pnl-engine.test.ts).
- **Decision**: FIXED — factory hoisted to module scope.

### F3 — Relative epsilon can absorb a whole unit of an ultra-high-quantity asset

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — by-design tradeoff; noted for awareness
- **Dimension**: Safety & Quality (Correctness)
- **Location**: src/lib/pnl-engine.ts:163-164
- **Detail**: is_closed tolerance is grossAcquired × 1e-9. For a SHIB-scale position (~1e9 tokens) the close threshold is ~1 token, so a genuine 1-token sub-cent remainder could read as closed. This is the intended "absorb dust" behavior (an absolute epsilon would break across asset scales) and the dust test pins the relative boundary. Recorded for explicitness, not as a defect.
- **Fix**: None recommended — accept as designed.
- **Decision**: ACCEPTED — scale-safe relative tolerance is the correct design.
```
