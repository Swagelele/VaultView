<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Swap Price Provider CoinPaprika → Binance

- **Plan**: context/changes/binance-price-provider/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-27
- **Verdict**: APPROVED (with one recommended hardening)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria: `npm run lint` clean, `npx vitest run` 115 passed, `npm run build` ok, deploy verified live (version ee7d856a). Both `lessons.md` boundary regressions (finite guard, request timeout) confirmed closed.

## Findings

### F1 — Stablecoin peg set duplicated (split-brain drift risk)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture / Safety & Quality
- **Location**: src/lib/prices.ts:18 vs src/lib/schemas.ts:6
- **Detail**: prices.ts defines its own `USD_PEGGED = ["USDT","USDC"]`, duplicating `schemas.USD_STABLECOINS`. Every other module detects stablecoins via `isUsdStablecoin` from schemas; only the adapter keeps a parallel set. If the sets drift, the engine values a coin at $1 while the adapter marks it to a live ticker — a P&L-consistency divergence. Latent (identical today).
- **Fix**: Import `isUsdStablecoin` from schemas in prices.ts; delete the local `USD_PEGGED` + `isPegged`, use `isUsdStablecoin`.
  - Strength: Single source of truth; removes the drift class; matches every other consumer.
  - Tradeoff: Adds a schemas import to the price layer (no cycle — schemas only imports zod).
  - Confidence: HIGH — isUsdStablecoin normalizes via toUpperCase, identical behavior.
  - Blind spot: None significant.
- **Decision**: FIXED — prices.ts now imports isUsdStablecoin from schemas; USD_PEGGED/isPegged removed.

### F2 — Stale "CoinPaprika" comments + obsolete 364-day floor

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Doc Accuracy
- **Location**: src/lib/portfolio-history-service.ts:10-14 (+ transaction-service.ts:60, asset-allocation.ts:4; tech-stack.md, roadmap.md)
- **Detail**: Plan's Critical Detail said to update the WINDOW_FLOOR_DAYS comment to drop the CoinPaprika rationale — not done. Binance klines have no rolling-365 cutoff, so the 364-day floor may be obsolete. tech-stack.md/roadmap.md still name CoinPaprika as the live provider. Cosmetic.
- **Fix**: Update comments to Binance; re-validate whether the 364-day floor still earns its place.
- **Decision**: FIXED — code comments (portfolio-history-service, transaction-service, asset-allocation) + tech-stack.md + roadmap.md updated to Binance; WINDOW_FLOOR_DAYS reframed as a product window bound (value unchanged).

### F3 — toSymbol defensive guard for empty/edge ids

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/prices.ts:24-26
- **Detail**: `toSymbol("")` → `"USDT"` (a real pair). Unreachable today (API routes filter empties; ids are engine-derived), but an early `if (!coinId) return null` would self-defend the boundary.
- **Fix**: Add an early empty-id guard in getCurrentPrice/getHistoricalPrice.
- **Decision**: FIXED — `if (!coinId) return null` added to getCurrentPrice + getHistoricalPrice; `if (!id) continue` in getMultiplePrices; empty-id guard in getHistoricalPriceSeries.
