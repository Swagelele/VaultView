# Persistence & Data-Isolation Integration Tests — Plan Brief

> Full plan: `context/changes/testing-persistence-data-isolation/plan.md`
> Research: `context/changes/testing-persistence-data-isolation/research.md`

## What & Why

Rollout Phase 2 of the test plan: build the project's first DB-touching test layer and use it
to defend two High-impact risks — **#3** (a save reports success but persists wrong/partial
state) and **#4** (a user reads or mutates another user's rows). RLS and the batch-save path
are declared but have never been exercised by a test.

## Starting Point

5 unit test files, all in `src/lib/`, all DB-free. No integration harness, no service-role
client, no API/RLS test. The save + ownership logic lives in `src/lib/transaction-service.ts`
(thin API handlers just auth-gate and delegate). RLS policies and the `.eq("user_id")` filter
both enforce isolation, but neither is verified. Local Supabase is running (API `54321`).

## Desired End State

`npm run test:integration` runs a separate Vitest project against local Supabase: a smoke test,
persistence tests (persisted columns match the operation; a failed save persists zero rows),
and isolation tests (user B's RLS-scoped client reads 0 of user A's rows and cannot write as
A). When the stack is down, the suite skips with a hint. `npm test` (unit) stays fast and
CI-green. Test-plan cookbook §6.2/§6.4 get filled.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Test wiring | Separate config (`test:integration`), local-only | Keeps unit run fast/CI-green; test-plan §5 marks DB gate "local" | Plan |
| RLS client auth | `admin.createUser` + `signInWithPassword` → token | Exercises the real auth path; `auth.uid()` resolves as in prod | Plan |
| Key sourcing | env with known-default fallback | Zero setup for the standard local stack; local keys are public/non-secret | Plan |
| Risk #3 scope | Targeted by branch | Hits every column-derivation branch + failure + batch with minimal surface | Plan |
| DB unreachable | Skip with clear message | Contributor without Docker gets a clean skip, not confusing red | Plan |
| Where to test | Service layer + RLS, not HTTP handlers | Logic lives in the service; booting workerd is off-target | Research |
| Rollback | Not tested | No multi-statement transaction exists to roll back | Research |

## Scope

**In scope:** separate Vitest integration config + script; connection/key resolver; service-role
+ user-scoped client factories; per-test user create/teardown; DB-reachability skip guard; smoke
test; Risk #3 persistence tests; Risk #4 RLS isolation tests; cookbook §6.2/§6.4 fill-in.

**Out of scope:** CI integration job; HTTP/Astro-server tests; rollback/TOCTOU/concurrency
tests; exhaustive per-type matrix; any schema or production-code change; new dependencies.

## Architecture / Approach

A standalone Vitest project (`vitest.integration.config.ts`) with a setup file that resolves
connection config (env + local-default fallback) and probes the DB. Tests build two clients
directly from `@supabase/supabase-js` (never the app's `astro:env`-bound `createClient`): a
**service-role** client to seed and read ground truth, and a **user-scoped** client carrying a
real JWT so RLS is live. Persistence tests assert through an independent service-role re-SELECT;
isolation tests assert through user B's RLS-scoped client. CoinPaprika is kept out by using
stablecoin sides or a price override.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness & config | Integration config + script, clients, user lifecycle, skip guard, smoke test | Getting the user-JWT client wiring right (`supabase-js ^2.99.1` token option) |
| 2. Persistence (Risk #3) | Persisted-state + 409-persists-nothing + batch all-or-nothing | Accidentally asserting the API return value instead of re-read DB state |
| 3. Isolation (Risk #4) + docs | RLS read/write denial + positive control; cookbook fill-in | Accidentally using service-role for the denial assertions (bypasses RLS) |

**Prerequisites:** local Supabase running (`npx supabase start`), migrations applied
(`npx supabase db reset`).
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Exact `@supabase/supabase-js ^2.99.1` mechanism for attaching user B's token (global
  `Authorization` header vs `auth.setSession`) — resolve during Phase 1 impl.
- `email_confirm: true` at user creation skips the confirmation gate so `signInWithPassword`
  works without the Mailpit flow.
- Committed local-default keys only work for the standard `supabase start` stack; customized
  stacks override via env. (`.env.test`, if ever used, needs a `.gitignore` entry — not added
  now since the fallback path needs no file.)

## Success Criteria (Summary)

- A save's persisted rows provably match the operation; a rejected save (409) leaves zero rows.
- User B is denied reading or writing user A's rows at the RLS boundary, with a positive control
  proving the test isn't trivially passing.
- `npm run test:integration` is green locally and skips cleanly when the stack is down; `npm
  test` is unchanged.
