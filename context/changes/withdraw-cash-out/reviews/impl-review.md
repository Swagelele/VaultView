<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: WITHDRAW (cash-out with realized P&L)

- **Plan**: context/changes/withdraw-cash-out/plan.md
- **Scope**: Full plan (Phase 1 + 2 of 2)
- **Date**: 2026-06-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated success criteria re-run during review: `npm test` 42/42 pass; `npm run lint` clean; `npm run build` clean. Backend contract (201/409/400 + live pricing) verified against the running dev server during Phase 1.

## Findings

### F1 — WITHDRAW date picker allows future dates (no max)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/portfolio/TransactionForm.tsx:585-592
- **Detail**: DEPOSIT's date input caps at now (`max={maxDate}`); the WITHDRAW input did not. A future-dated WITHDRAW makes `resolvePriceUsd` call `getPriceForDate` for a future day with no CoinPaprika tick → null → opaque 400 "Cannot resolve USD valuation." Degrades safely but is confusing; the cap also restores DEPOSIT/WITHDRAW consistency while still allowing legitimate backdating.
- **Fix**: Add `max={maxDate}` to the WITHDRAW Date & Time `<Input>`, matching the DEPOSIT picker.
- **Decision**: FIXED (Fix now)

### F2 — No proceeds summary for WITHDRAW

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/portfolio/TransactionForm.tsx:~202-207
- **Detail**: `computedTotal` renders a "Total cost" (BUY) / "Proceeds" (SELL) hint line but covered neither DEPOSIT nor WITHDRAW. A WITHDRAW has a realized USD value (qty × price) that can be shown like SELL's proceeds. Purely cosmetic.
- **Fix**: Extend `computedTotal` to show "Withdrawn value: $…" for WITHDRAW and render it in the WITHDRAW branch.
- **Decision**: FIXED (Fix now)
