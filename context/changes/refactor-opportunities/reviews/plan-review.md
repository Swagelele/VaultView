<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Refactor Opportunities (D1 + D3)

- **Plan**: context/changes/refactor-opportunities/plan.md
- **Mode**: Deep
- **Date**: 2026-06-23
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 1 critical · 1 warning · 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING → PASS (F1 fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS (F2 fixed) |
| Plan Completeness | PASS |

## Grounding
6/6 existing paths ✓ (`src/db/database.types.ts` expected-new), symbols ✓ (`test`=`vitest run`, `supabase` devDep 2.23.4, `getTransactionsWithPnl` def found), brief↔plan ✓. Confirmed-safe: double `.order()` chain runs against the existing `fakeSupabase` with no extension.

## Findings

### F1 — Typing only createServerClient<Database> is INERT

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — fix is clear but central to the goal
- **Dimension**: End-State Alignment
- **Location**: Phase 3 & 4
- **Detail**: Service fns take the bare `SupabaseClient` (`transaction-service.ts:14,52,95,168,241,279,314`; `portfolio-service.ts:15`). `SupabaseClient<Database>` is assignable, so `createServerClient<Database>` alone compiles but the generic erases at the call boundary — `.from(...)` inside the functions stays untyped and cast removal may pass only because casts masked `any`. The plan could complete all phases without reaching its end state ("a column drift fails tsc"). Fix requires threading `SupabaseClient<Database>` through the `.from()`-touching signatures and retyping the sell-all `rows: Record<string, unknown>[]` literal (`:181`) to the generated `Insert[]`.
- **Fix**: Added Phase 3 change #3 (thread the generic + retype `rows`), a Critical Implementation Details bullet, an automated grep check (3.1), and made the column-rename gate proof (3.6) the F1 acceptance test.
- **Decision**: FIXED

### F2 — Deriving Transaction has wider blast than "types.ts only"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 (derive types) + Critical Implementation Details
- **Detail**: Three `tx()` factories build full `Transaction` literals (`transaction-service.test.ts:18-36`, `pnl-engine.test.ts:6-24`, `portfolio-service.test.ts:17-35`) and `pnl-engine`/`portfolio-service` do numeric arithmetic. If generated `numeric` columns are `string`, all break. `npm run build` alone would not catch broken test-file types — only `npm run test` does. Mitigated by the decided narrow-to-`number`-at-boundary strategy, but the plan understated the surface.
- **Fix**: Made "verify generated numeric typing" Phase 3 step 1; named the 3 factories as the proof surface in Critical Implementation Details; `npm run test` already in Phase 3 automated criteria (3.4).
- **Decision**: FIXED

## Triage summary
- Fixed: F1, F2 (2)
- Verdict after fixes: **SOUND**
