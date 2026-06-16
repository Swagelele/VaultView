<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Sell-All Global

- **Plan**: context/changes/sell-all-global/plan.md
- **Mode**: Deep
- **Date**: 2026-06-16
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 1 critical, 0 warnings, 1 observation

## Verdicts

| Dimension             | Verdict                  |
| --------------------- | ------------------------ |
| End-State Alignment   | WARNING → PASS (F1 fixed) |
| Lean Execution        | PASS                     |
| Architectural Fitness | PASS                     |
| Blind Spots           | FAIL → PASS (F1 fixed)    |
| Plan Completeness     | PASS                     |

## Grounding

7/7 existing paths ✓ (schemas.ts, transaction-service.ts, transactions.ts, PortfolioTable.tsx, PortfolioView.tsx, AssetAutocomplete.tsx, AddTransactionDialog.tsx). Symbols ✓ — `resolvePriceUsd` (private, same file, override-first), `getHoldingAtLocation` (exported), `handleTransactionCreated` (PortfolioView.tsx:116), `PortfolioTable` single caller (PortfolioView.tsx:174). brief↔plan ✓. contract-surfaces.md absent → skipped.

## Findings

### F1 — Non-stablecoin target produces arithmetically wrong P&L

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 (target_quantity = holding × price), "What We're NOT Doing"
- **Detail**: The plan mirrored the existing SELL convention `target_quantity = holding × price`. Verified at `pnl-engine.ts:67-72`: for a non-stablecoin target the engine sets `targetPos.quantity += target_quantity` (a USD figure) and `total_cost_usd += source_quantity × price_usd` (the same USD figure), so selling 1 BTC @ $60k → ETH records ~60000 "ETH" at ~$1/ETH — wrong quantity and cost basis. FR-004's marquee example is BTC→ETH, and this slice makes per-location non-stablecoin targets a first-class control, conflicting with the PRD guardrail "wrong numbers are worse than no numbers." Phase 2 manual check 2.5 only asserted the target asset is recorded, not the quantity — so the test would pass while data is wrong.
- **Fix A ⭐ Recommended**: Restrict sell-all targets to USD stablecoins (filterIds pattern + server-side schema refine via isUsdStablecoin); correct cash-out path, defer BTC→ETH until S-01 model fixed.
  - Strength: Stays within the PRD guardrail; zero engine changes; reuses the existing DEPOSIT `filterIds` pattern; BTC→ETH returns for free once S-01 is fixed.
  - Tradeoff: Drops FR-004's BTC→ETH example from this slice (deferred).
  - Confidence: HIGH — engine behavior confirmed at pnl-engine.ts:67-72.
  - Blind spot: None significant.
- **Fix B**: Compute true target quantity from target market price in the batch service.
  - Strength: Keeps full FR-004 scope; correct ETH quantity + cost basis.
  - Tradeoff: Diverges from single-location SELL (two inconsistent paths), adds per-row price lookup, pulls an S-01 model fix into this slice.
  - Confidence: MED — sound but widens blast radius and leaves single SELL wrong.
  - Blind spot: Whether single SELL must be fixed in lockstep.
- **Decision**: FIXED via Fix A — restricted sell-all targets to USD stablecoins. Applied: scope note in "What We're NOT Doing"; client `filterIds={USD_STABLECOINS}` on the per-row target picker; server-side schema refine rejecting non-stablecoin `target_asset`; updated Phase 1 §2 correctness note; updated manual checks 2.5 + Testing Strategy step 2 to a stablecoin (USDC) example.

### F2 — Null current_price_usd not handled in dialog seed

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1 (shared `price` initialized from asset.current_price_usd)
- **Detail**: `PortfolioAsset.current_price_usd` is `number | null` (types.ts:48) and can be null when stale. The dialog contract didn't name the null case; a naive init yields `NaN`/"null" in the field. Submit is already gated on price ≤ 0, so it's polish, not a crash.
- **Fix**: Initialize the price state to `""` when current_price_usd is null; user enters it manually.
- **Decision**: FIXED — note added to Phase 2 §1 dialog contract.

## Triage Summary

- Fixed: F1 (Fix A), F2 (2)
- Verdict after fixes: REVISE → SOUND
