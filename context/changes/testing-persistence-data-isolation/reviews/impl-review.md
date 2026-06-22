<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Persistence & Data-Isolation Integration Tests

- **Plan**: context/changes/testing-persistence-data-isolation/plan.md
- **Scope**: Phases 1-3 of 3 (full plan)
- **Date**: 2026-06-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Both correctness-critical guarantees the plan singled out are honored: persistence asserted via
independent re-SELECT (not the function return value), and isolation denials asserted through user
B's RLS-scoped client (never service-role). Committed keys in `config.ts` are the genuine public
`supabase-demo` JWTs (safe to commit). No network dependence; no assertion relies on global DB state.

## Findings

### F1 — Teardown swallows delete failures and drops the id before deleting

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: tests/integration/users.ts:40-42; afterEach in persistence.integration.test.ts:22-29 & isolation.integration.test.ts:37-44
- **Detail**: `deleteTestUser` ignored the error from `admin.deleteUser`, so a failed teardown silently leaked an auth user + its rows in the local stack.
- **Fix**: Surface the error (console.warn on non-null error) so a failed delete is visible.
- **Decision**: FIXED — `deleteTestUser` now warns on a non-null delete error.

### F2 — Unique-email scheme is collision-safe only because fileParallelism is off

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability / Pattern Consistency
- **Location**: tests/integration/users.ts:18
- **Detail**: Emails keyed on `${Date.now()}-${index}`; cross-file collision-safety depended on `fileParallelism:false`.
- **Fix**: Add a random suffix so collision-safety is independent of the serialization setting.
- **Decision**: FIXED — stamp now appends `crypto.randomUUID().slice(0, 8)`.

### F3 — Two extra changes vs the plan body (both justified + documented)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — no action needed
- **Dimension**: Scope Discipline
- **Location**: tests/integration/transactions.ts; vitest.config.ts:16
- **Detail**: `transactions.ts` (typed seed/select/count helpers) wasn't in Phase 1's enumerated change list, and the `vitest.config.ts` exclude wasn't in the plan body. Both serve the plan's stated intent (the re-SELECT helper pattern; keeping `npm test` DB-free), and the exclude is recorded as an adaptation in test-plan §6.6.
- **Decision**: ACCEPTED — documented, no action.
