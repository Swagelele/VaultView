# Refactor Opportunities (D1 + D3) — Plan Brief

> Full plan: `context/changes/refactor-opportunities/plan.md`
> Research: `context/changes/refactor-opportunities/research.md`

## What & Why

Give the transaction contract a single source of truth (D1) and pin the untested
P&L read path (D3). Today the transaction shape is hand-defined three times (Zod, TS,
SQL) over an untyped Supabase client with `as Transaction` casts, so a column rename
drifts silently with no compile error — and `getTransactionsWithPnl` (per-lot
unrealized P&L) has zero tests, against a PRD guardrail that says "wrong numbers are
worse than no numbers." Since CI runs only `tsc`/lint, typing the client is also the
single most CI-enforceable guard available.

## Starting Point

Untyped `createServerClient` (`supabase.ts:9`); 3 casts in `transaction-service.ts`
(`:164,:238,:252`); unused `TransactionInsert`; `getTransactionsWithPnl` untested; CI =
`astro sync / lint / build`, no test step. `supabase gen types` is viable and a typed-
client precedent already exists in `tests/integration/clients.ts`.

## Desired End State

Generated `src/db/database.types.ts` feeds a `createServerClient<Database>`;
`Transaction`/`TransactionInsert` are derived from it; the casts and eslint-disable are
gone; `tsc` (CI build) now fails on column drift. `getTransactionsWithPnl` is unit-tested
and CI runs the unit suite. No behavioral change.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| What to fix | D1 + D3 cheap win | Top-ranked structural candidate + zero-risk guard | Research |
| Out of scope | D2, D4, D5 | D2 follow-up; D4 deliberate deferral; D5 → L5 domain | Research |
| Ordering | Guard-first | Pin behavior before touching code | Plan |
| types.ts strategy | Derive from generated | True single source of truth — the point of D1 | Plan |
| CI scope | Unit suite only | Real gate, no Docker in CI; integration stays local | Plan |
| numeric typing | Narrow to `number` at boundary if generated as string | Keep engine's `number` contract | Plan |

## Scope

**In scope:** D3 tests + CI test step; generated DB types; typed client; derived domain
types; cast removal.
**Out of scope:** D2 row-builder, D4 coinpaprika guards, D5 domain changes, any behavior
or migration change.

## Architecture / Approach

Guard-first, then mechanism-green-then-enforce. Tests + CI gate land first (Phase 1).
Generated types land unused and revertible (Phase 2). The client is typed and domain
types re-pointed — the enforcement switch (Phase 3). Casts are deleted one revertible
commit each (Phase 4). Each step is gated by `tsc`/tests.

## Phases at a Glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1. D3 guard + CI | `getTransactionsWithPnl` tests + `npm test` in CI | Mock chain mismatch with `fakeSupabase` |
| 2. Generate types | `database.types.ts` committed, unused | Local stack must be running for `gen types` |
| 3. Type + derive | Typed client; derived `Transaction` | PostgREST numeric typing (number vs string) |
| 4. Delete casts | Casts + eslint-disable removed | A cast hid a real mismatch surfaced by `tsc` |

**Prerequisites:** local Supabase stack up (`npx supabase start`) for Phase 2/3; `supabase` CLI (devDep).
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- Generated `numeric` typing may be `string`/`number|string` — handled by narrowing at
  the boundary (Critical Implementation Details).
- A removed cast could expose a latent type mismatch — that's the gate working; resolve
  at the real type, don't re-cast.
- CI test step covers unit only; integration/e2e remain local (need Supabase).

## Success Criteria (Summary)

- `getTransactionsWithPnl` is tested and the unit suite runs green in CI.
- The transaction shape has one source of truth; a column drift fails `tsc`.
- No behavioral regression — DEPOSIT/BUY/SELL and both portfolio views work; integration
  tests still pass.
