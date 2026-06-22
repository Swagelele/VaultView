# Persistence & Data-Isolation Integration Tests — Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`: stand up the project's first
DB-touching test layer (a reusable local-Supabase harness), then use it to defend two
High-impact risks at the integration layer:

- **Risk #3** — a transaction save reports success but persists wrong/partial state.
- **Risk #4** — a user reads or mutates another user's rows (cross-user leak / IDOR / RLS gap).

The harness exercises the real `transaction-service.ts` functions against a real local
Postgres and the real RLS boundary — no mocked Supabase client, no service-role shortcut for
the isolation assertions.

## Current State Analysis

From `context/changes/testing-persistence-data-isolation/research.md` (fresh, same commit):

- **No DB/API test exists.** 5 Vitest files, all unit, all in `src/lib/`. `vitest.config.ts`
  sets only the `@/*` alias — no setup file, no env loading, no integration project.
- **The save logic lives in the service, not the handlers.** API routes in `src/pages/api/`
  are ~30-line auth-gate-and-delegate shells; persistence + ownership logic is concentrated in
  `src/lib/transaction-service.ts`. Tests target the service layer + RLS directly.
- **Two write paths.** `createTransaction` (`transaction-service.ts:92`) does one
  `.insert(row).select().single()` (`:156`); `createSellAllGlobal` (`:165`) validates every
  location first (`:182-220`), then does one multi-row `.insert(rows)` (`:230`). The only
  atomicity is Postgres single-statement atomicity — **no multi-statement transaction, RPC, or
  app-level rollback exists** (`:226-229`).
- **Ownership enforced twice.** Every read filters `.eq("user_id", userId)`
  (`transaction-service.ts:22, 243, 313`); every insert hard-stamps `user_id` (`:142, :208`);
  RLS gates all four ops on `auth.uid() = user_id`
  (`supabase/migrations/20260614213523_create_transactions.sql:37-52`). `user_id` is
  `NOT NULL … ON DELETE CASCADE` (`:6`).
- **No IDOR-by-id surface.** Only `POST` + collection `GET` exist; no `:id`, UPDATE, or DELETE
  route. The realistic cross-user vector is an RLS gap — so test RLS directly.
- **Runtime constraint.** Tests run in Node under Vitest, not workerd, so they **must not
  import `@/lib/supabase.ts`** (it imports `astro:env/server`). Construct clients directly from
  `@supabase/supabase-js`. The app env schema declares only `SUPABASE_URL`/`SUPABASE_KEY` — no
  service-role key (`astro.config.mjs:16-21`).
- **Local stack is running.** API `http://127.0.0.1:54321`, DB `54322`
  (`supabase/config.toml`, confirmed via `npx supabase status`).

## Desired End State

`npm run test:integration` runs a separate Vitest project against the local Supabase stack and
passes, containing:

- a harness module that yields a **service-role client** (RLS-bypassing, for seed +
  ground-truth read-back) and a **per-test user-scoped client** (real JWT, RLS-active), plus
  per-test user create/teardown;
- **Risk #3** tests proving persisted columns match the operation and a failed save persists
  zero rows;
- **Risk #4** tests proving user B cannot read or write user A's rows, with a positive control.

When the local stack is unreachable, the suite **skips with a clear message** rather than
failing. `npm test` (unit) is unchanged — fast, Docker-free, CI-green. Test-plan cookbook
§6.2/§6.4 are filled and Phase 2 status flips to reflect the landed suite.

### Key Discoveries

- Column-derivation is the real "200-but-wrong-state" surface: one-sided ops force `target_*`
  NULL and set `price = price_usd` (`transaction-service.ts:135-149`); two-sided store a rate.
- `resolvePriceUsd` short-circuits to `1` for a stablecoin source (`:71`) and to
  `targetQty/sourceQty` for a stablecoin target (`:73-75`), and an `override` wins first
  (`:59`) — any of these keeps CoinPaprika out of the test.
- Local default anon + service-role keys are deterministic, public, non-secret JWTs printed by
  `supabase start` — safe as a committed fallback for the standard local stack.
- `getTransactions` (raw rows, no prices, `:239`) is the clean read for assertions;
  `getTransactionsWithPnl` (`:274`) calls the price API and must be avoided in these tests.

## What We're NOT Doing

- **No CI integration job.** Suite is local-only (test-plan §5 marks the DB gate "local"); CI
  has no Docker/Supabase. PR-time enforcement is the Phase-3 hook's job, not this phase.
- **No HTTP-layer / Astro-server tests.** The logic is in the service layer; booting
  workerd + faking middleware sessions is expensive and off-target.
- **No rollback test.** No multi-statement transaction exists to roll back (research-validated).
- **No TOCTOU/concurrency test.** Documented, accepted single-user posture (`:226-229`).
- **No exhaustive per-type matrix.** BUY/SELL/SWAP share one derivation path; we cover branches.
- **No schema/migration/production-code change.** Tests only. Any bug found is logged, not
  fixed here (a fix would be its own change).
- **No new runtime dependency.** `@supabase/supabase-js` and `vitest` are already installed.

## Implementation Approach

Build the harness first and prove it with a smoke test, so the two test suites stand on a
trusted foundation. Keep the integration project fully separate from the unit run: its own
Vitest config, its own npm script, its own setup file that resolves connection config and
probes the DB. The two suites then differ only in *which* client they assert through —
service-role for persistence ground-truth, user-scoped for the RLS boundary.

## Critical Implementation Details

- **Do not import `@/lib/supabase.ts` or anything that transitively imports `astro:env`** from
  the harness or tests — it throws under Node/Vitest. Build clients from `@supabase/supabase-js`
  directly. (Pure modules like `@/lib/schemas` are safe to import.)
- **Keep CoinPaprika out of every test** by construction: use a stablecoin on at least one side
  (so `resolvePriceUsd` returns `1` or a divided rate) or pass `source_price_usd_override`.
  Assert reads via `getTransactions` / a raw `.select()`, never `getTransactionsWithPnl`.
- **Per-test isolation:** each test creates its own user(s) with a unique email
  (timestamp/index suffix — note `Date.now()` is fine in tests, it's only forbidden in
  workflow scripts) and deletes them in teardown; `ON DELETE CASCADE` removes their rows.
- **`createTransaction`'s non-DEPOSIT holding pre-check** (`:105-113`) means a BUY/SELL/SWAP
  test must first seed a funding holding (e.g. a DEPOSIT of the source asset) or the save 409s
  before reaching the insert. Order fixtures accordingly.

## Phase 1: Harness & config foundation

### Overview

Create the separate integration Vitest project, the connection-config resolver, the
test-clients module, the per-test user lifecycle helpers, and a DB-reachability skip guard.
Prove it all with one smoke test.

### Changes Required:

#### 1. Integration Vitest project

**File**: `vitest.integration.config.ts` (new)

**Intent**: A separate Vitest config so DB tests never run in the default unit pass. Mirrors the
`@/*` alias from `vitest.config.ts`, registers the setup file, and includes only integration
specs.

**Contract**: `test.include` matches `**/*.integration.test.ts`; `test.setupFiles` points at
the new setup module; `resolve.alias` maps `@` → `./src` (copy from `vitest.config.ts:8-12`).
Single-threaded / no parallel file execution if needed to keep DB load predictable (decide
during impl; default Vitest is acceptable since each test self-isolates by unique user).

#### 2. npm script

**File**: `package.json`

**Intent**: Add `test:integration` running the new config; leave `test` untouched.

**Contract**: `"test:integration": "vitest run --config vitest.integration.config.ts"`.

#### 3. Connection config resolver

**File**: `tests/integration/config.ts` (new)

**Intent**: Resolve the Supabase URL, anon key, and service-role key from `process.env`, with a
well-known local-default fallback so the standard `supabase start` stack needs zero setup.

**Contract**: Exports `{ url, anonKey, serviceRoleKey }`. Reads `SUPABASE_URL`,
`SUPABASE_ANON_KEY` / `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from env; falls back to
`http://127.0.0.1:54321` and the public local default anon + service-role JWTs. These keys are
the non-secret demo JWTs from the local stack — a code comment must say so and point at
`npx supabase status -o env` for overrides.

#### 4. Test-clients module

**File**: `tests/integration/clients.ts` (new)

**Intent**: Factory functions for the two client kinds the suites need, built directly on
`@supabase/supabase-js` (never the app's `createClient`).

**Contract**:
- `serviceClient(): SupabaseClient` — `createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })`. Bypasses RLS; used for seeding + ground-truth reads.
- `userClient(accessToken: string): SupabaseClient` — an anon-key client that sends the user's
  JWT so `auth.uid()` resolves and RLS is enforced. Construct with the access token applied as
  the `Authorization: Bearer <token>` global header (verify the exact `@supabase/supabase-js
  ^2.99.1` option during impl — global headers vs `auth.setSession`); this is the only
  non-obvious wiring in the harness.

#### 5. Per-test user lifecycle

**File**: `tests/integration/users.ts` (new)

**Intent**: Create and tear down real auth users so tests run as genuine, isolated principals.

**Contract**:
- `createTestUser(svc): Promise<{ id, email, password, accessToken }>` — `svc.auth.admin.createUser({ email, password, email_confirm: true })` with a unique email, then `signInWithPassword` (via a throwaway anon client) to obtain `accessToken`.
- `deleteTestUser(svc, id): Promise<void>` — `svc.auth.admin.deleteUser(id)`; cascade removes rows.
- Unique email helper: `vault-it-${Date.now()}-${n}@example.test`.

#### 6. Setup file + DB-reachability skip guard

**File**: `tests/integration/setup.ts` (new)

**Intent**: Before the suite runs, probe the local stack; if unreachable, skip the whole
integration suite with an actionable message instead of failing.

**Contract**: A `beforeAll`/global setup that does a cheap service-role query (e.g.
`from("transactions").select("id").limit(1)` or an auth admin ping). On connection error, mark
the suite skipped (Vitest `ctx.skip()` pattern or a guarded `describe.skipIf`) and log
`"local Supabase not reachable — run \`npx supabase start\`; skipping integration tests"`.
Decide the cleanest Vitest mechanism during impl (a shared `dbAvailable` boolean consumed by
`describe.skipIf(!dbAvailable)` is the simplest).

#### 7. Smoke test

**File**: `tests/integration/smoke.integration.test.ts` (new)

**Intent**: Prove the harness end-to-end before building real suites.

**Contract**: create a user → service-role insert a minimal valid row for that `user_id` →
read it back → assert it exists → delete the user → assert the row is gone (cascade).

### Success Criteria:

#### Automated Verification:

- Unit suite still green and DB-free: `npm test`
- Integration smoke passes against the running stack: `npm run test:integration`
- Type checking passes: `npx astro sync && npm run lint` (ESLint is type-checked)
- New files compile under the integration config alias (no `astro:env` import error)

#### Manual Verification:

- With the stack stopped (`npx supabase stop`), `npm run test:integration` **skips** with the
  hint message rather than erroring.
- Re-running the smoke test twice in a row leaves no leftover users/rows (teardown works).

**Implementation Note**: After automated verification passes, pause for human confirmation of
the manual skip-guard + teardown checks before proceeding to Phase 2.

---

## Phase 2: Persistence tests (Risk #3)

### Overview

Targeted-by-branch tests that assert persisted state matches the operation and that failed
saves persist nothing — through the real `createTransaction` / `createSellAllGlobal`.

### Changes Required:

#### 1. Persistence suite

**File**: `tests/integration/persistence.integration.test.ts` (new)

**Intent**: Drive the service write functions against real Postgres and assert the persisted
rows via an independent service-role read — not the returned object alone.

**Contract**: Each test creates its own user, seeds any funding holding it needs, calls the
service function with the service-role client, then re-`SELECT`s to assert. Cases:

- **One-sided persisted-state** — a DEPOSIT (non-stablecoin source with `source_price_usd_override`, or stablecoin source): assert persisted `target_asset`/`target_quantity` are NULL, `price === price_usd`, `user_id`, `type`, `source_quantity`, `location`, `transaction_date` match input. (Covers the `isOneSided` branch, `transaction-service.ts:135-149`.)
- **Two-sided persisted-state** — a SELL of a seeded holding to a stablecoin target: assert `target_*` populated, `price` is the derived rate, `price_usd` matches the stablecoin rule. Seed the source holding first (DEPOSIT) so the `:105-113` pre-check passes.
- **Failed save persists nothing** — attempt a non-DEPOSIT save with holding < `source_quantity`; assert the result is `status: 409` (`:107-112`) **and** a follow-up count for that user/asset/location is 0.
- **Batch all-or-nothing** — `createSellAllGlobal` with one valid + one zero-holding location: assert `status: 409` (`:222-224`) and total rows for the user is 0; then an all-valid two-location batch: assert exactly 2 rows persisted with `target_quantity === holding × price` (`:189`).

### Success Criteria:

#### Automated Verification:

- Persistence suite passes: `npm run test:integration`
- Unit suite still green: `npm test`
- Lint/type-check pass: `npm run lint`
- No CoinPaprika network call occurs (assert by construction — stablecoin/override inputs; optionally fail the test if `fetch` is hit).

#### Manual Verification:

- Each oracle is requirement-derived (a comment shows the arithmetic for the two-sided rate and
  the batch `target_quantity`), not copied from the implementation's output.
- After the suite runs, the DB has no leftover test users/rows.

**Implementation Note**: Pause for human confirmation that the assertions read persisted state
(re-SELECT), not the API return value, before Phase 3.

---

## Phase 3: Isolation tests (Risk #4) + doc closeout

### Overview

Prove the RLS ownership boundary with a user-scoped client, add a positive control, then fill
the test-plan cookbook and flip the Phase-2 status.

### Changes Required:

#### 1. Isolation suite

**File**: `tests/integration/isolation.integration.test.ts` (new)

**Intent**: Exercise the real RLS boundary — assert through user B's JWT-bearing client, never
the service-role client.

**Contract**: create users A and B; seed A's rows with the service-role client. Then:

- **Cross-user read denied** — B's `userClient` does `from("transactions").select()`; assert it
  returns 0 of A's rows (RLS SELECT policy, migration `:37-39`).
- **Cross-user write denied** — B's `userClient` attempts `insert({ user_id: A.id, … })`;
  assert it is rejected by RLS `WITH CHECK` (`:41-43`) — error returned, and a service-role
  count confirms no such row landed.
- **Positive control** — A's own `userClient` reads exactly A's seeded rows and a self-insert
  succeeds; proves the suite isn't trivially passing because everything is denied.

#### 2. Cookbook fill-in

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.2 and §6.4 "TBD" stubs with the patterns this phase established
(separate config, service-role vs user-scoped clients, per-test user + cascade teardown,
assert persisted side-effect + RLS boundary, keep the price API out). Add a §6.6 Phase-2 note
if anything surprised. Flip the Phase-2 row in §3 to its landed status and bump the §8 ledger
date if touched.

**Contract**: Prose edits only, mirroring the §6.1/§6.5 style already present.

### Success Criteria:

#### Automated Verification:

- Isolation suite passes: `npm run test:integration`
- Full integration suite (smoke + persistence + isolation) green together: `npm run test:integration`
- Unit suite still green: `npm test`
- Lint/type-check pass: `npm run lint`

#### Manual Verification:

- The cross-user assertions are made through user B's RLS-scoped client (confirm no
  service-role client is used for the denial assertions).
- §6.2/§6.4 read as actionable patterns a future contributor can follow without re-deriving the
  harness.
- Test-plan Phase-2 status reflects the landed suite.

**Implementation Note**: After this phase, run roadmap/test-plan closeout per project
conventions before offering `/10x-archive`.

---

## Testing Strategy

### Unit Tests

- Unchanged. `npm test` stays DB-free and fast.

### Integration Tests

- **Persistence (Risk #3):** one-sided + two-sided persisted-state, 409-persists-nothing,
  batch all-or-nothing — asserted via independent service-role re-SELECT.
- **Isolation (Risk #4):** cross-user read denied, cross-user write denied, positive control —
  asserted via user B's RLS-scoped client.
- **Harness smoke:** create user → insert → read → cascade-delete.

### Manual Testing Steps

1. With the stack up: `npm run test:integration` → all green.
2. `npx supabase stop` → `npm run test:integration` → suite **skips** with hint, exit non-error.
3. `npx supabase start` → re-run twice → green both times, no leftover users (`auth.users`) or
   `transactions` rows (inspect via Studio `http://127.0.0.1:54323`).

## Performance Considerations

Per-test user creation + sign-in adds round-trips, but the suite is small and local-only; total
runtime is seconds. No parallel-execution tuning needed since each test self-isolates by unique
user (RLS scopes reads, so cross-test bleed is impossible even under parallel runs).

## Migration Notes

None — no schema or production-code change. Tests consume the existing migrations via the
already-reset local DB.

## References

- Research: `context/changes/testing-persistence-data-isolation/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risk Response #3/#4), §3 (Phase 2), §6.2/§6.4
- Save paths: `src/lib/transaction-service.ts:92-163` (single), `:165-237` (batch)
- RLS policies: `supabase/migrations/20260614213523_create_transactions.sql:34-52`
- Unit alias to mirror: `vitest.config.ts:8-12`
- Lessons: `context/foundation/lessons.md` (deterministic ordering — sidestepped by asserting raw rows)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Harness & config foundation

#### Automated

- [x] 1.1 Unit suite still green and DB-free: `npm test` — 5ab4b88
- [x] 1.2 Integration smoke passes against the running stack: `npm run test:integration` — 5ab4b88
- [x] 1.3 Type checking / lint passes: `npx astro sync && npm run lint` — 5ab4b88
- [x] 1.4 New harness files compile under the integration config (no `astro:env` import error) — 5ab4b88

#### Manual

- [x] 1.5 With the stack stopped, `npm run test:integration` skips with the hint message rather than erroring — 5ab4b88
- [x] 1.6 Re-running the smoke test twice leaves no leftover users/rows (teardown works) — 5ab4b88

### Phase 2: Persistence tests (Risk #3)

#### Automated

- [x] 2.1 Persistence suite passes: `npm run test:integration` — ddb99e2
- [x] 2.2 Unit suite still green: `npm test` — ddb99e2
- [x] 2.3 Lint/type-check pass: `npm run lint` — ddb99e2
- [x] 2.4 No CoinPaprika network call occurs (stablecoin/override inputs by construction) — ddb99e2

#### Manual

- [x] 2.5 Each oracle is requirement-derived (arithmetic comment), not copied from implementation output — ddb99e2
- [x] 2.6 No leftover test users/rows after the suite runs — ddb99e2

### Phase 3: Isolation tests (Risk #4) + doc closeout

#### Automated

- [x] 3.1 Isolation suite passes: `npm run test:integration`
- [x] 3.2 Full integration suite (smoke + persistence + isolation) green together
- [x] 3.3 Unit suite still green: `npm test`
- [x] 3.4 Lint/type-check pass: `npm run lint`

#### Manual

- [x] 3.5 Cross-user assertions made through user B's RLS-scoped client (no service-role for denials)
- [x] 3.6 §6.2/§6.4 read as actionable patterns a future contributor can follow
- [x] 3.7 Test-plan Phase-2 status reflects the landed suite
