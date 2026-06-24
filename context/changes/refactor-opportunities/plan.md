# Refactor Opportunities (D1 + D3) Implementation Plan

## Overview

Two outcomes, guard-first: (D3) characterize and test the untested per-lot
unrealized-P&L read path (`getTransactionsWithPnl`) and make CI actually run the
unit suite; then (D1) replace the hand-maintained, untyped transaction contract
with a single source of truth — generated Supabase DB types feeding a typed client,
deleting the `as Transaction` casts. The D3 guard lands first so the behavior the
D1 type-migration touches is pinned before any code moves.

## Current State Analysis

- The transaction row is defined **three times by hand** — Zod `schemas.ts:9-20`,
  TS `types.ts:3-18`, SQL migrations — over an **untyped** `createServerClient`
  (`supabase.ts:9`). Three casts bridge the gap: `as Transaction`
  (`transaction-service.ts:164`), `as Transaction[]` (`:238`, `:252`), plus
  `eslint-disable no-unsafe-assignment` (`:157`). `TransactionInsert` (`types.ts:20-25`)
  exists but is used nowhere (verified: 0 references).
- A column rename/add produces **no TS error** today — silent drift. Risk is real
  but latent (no drift bug in git history).
- `getTransactionsWithPnl` (`transaction-service.ts:279-312`) carries the per-lot
  unrealized formula (`:299-300`) and the `stale`/`updated_at` passthrough, with
  **zero test coverage** at any layer (grep-verified).
- **CI runs no tests** — `ci.yml:18-21` is `npm ci / astro sync / lint / build`.
  The only automatic net is `tsc`/ESLint. `.husky/pre-commit` gates lint+format only.
- `supabase gen types` is viable: `supabase/config.toml` + 2 migrations + `supabase`
  CLI devDep. In-repo precedent for a typed client: `tests/integration/clients.ts:59,66,77,85`
  (`createClient<IntegrationDatabase>`).
- Reusable test scaffolding: `fakeSupabase` (`transaction-service.test.ts:211-219`)
  and `vi.mock("@/lib/coinpaprika")` (already stubs `getMultiplePrices`).

## Desired End State

- `getTransactionsWithPnl` has unit tests covering the per-lot formula,
  `isMarkableAcquisition` filtering, the `realizedByTx` join, and `stale`/`updated_at`
  passthrough; `npm run test` runs in CI and the suite is green.
- `src/db/database.types.ts` is generated and committed; the production Supabase
  client is `createServerClient<Database>`; `Transaction`/`TransactionInsert` in
  `types.ts` are **derived from** the generated `Row`/`Insert` types; the 3 casts and
  the `eslint-disable` in `transaction-service.ts` are gone; `tsc` (CI `build`) now
  fails on a column drift. No behavioral change.

### Key Discoveries

- Untyped client + casts introduced together in `23deb7a` (accidental, no ADR).
- `TransactionInsert` authored in `5577087` "for creating new transactions", never used.
- Strangler-Fig is de-risked by `clients.ts` already typing its client.
- CI's `build` step is the only enforceable gate — D1 converts silent drift into a
  `tsc` failure that gate already catches.

## What We're NOT Doing

- **D2** (extract a shared `buildTransactionRow()`): deferred. The two insert literals
  (`:143-155`, `:209-221`) stay; D1 makes them both type-checked, which removes the
  *silent*-drift risk. A follow-up change extracts the builder.
- **D4** (coinpaprika `AbortController` timeout + `Number.isFinite` guard): deferred —
  deliberate per `lessons.md:19-23`; guard, don't rebuild.
- **D5** (SWAP UI path; WITHDRAW future-date): deferred — deliberate domain constraints,
  routed to the L5 DDD pass.
- No new business behavior, no migration changes, no API contract changes.
- Anything surprising surfaced mid-migration gets a follow-up change, not in-scope creep.

## Implementation Approach

Guard-first, then mechanism-green-then-enforce. Phase 1 pins the P&L read behavior
with tests and turns CI into a real gate — done before any production code moves.
Phase 2 lands the generated types as a pure-additive, unused artifact (green, trivially
revertible). Phase 3 flips the client to typed and re-points `types.ts` at the generated
types — the enforcement switch. Phase 4 deletes the casts one commit at a time, each an
independently revertible step verified by `tsc`.

## Critical Implementation Details

- **Typing the client is INERT unless service signatures are threaded (Phase 3/4, load-bearing).**
  Every service function takes the *bare* `SupabaseClient` (untyped default):
  `transaction-service.ts:14,52,95,168,241,279,314` and `portfolio-service.ts:15`. A
  `SupabaseClient<Database>` is *assignable* to that param, so `createServerClient<Database>`
  alone compiles but the generic **erases at the call boundary** — `.from("transactions")`
  inside the functions stays untyped, and removing the casts may pass only because they
  were masking `any`. To make the typing actually catch drift (the whole point of D1),
  the parameter type of the `transaction-service.ts` functions that touch `.from(...)`
  must become `SupabaseClient<Database>`, and the sell-all insert literal
  `rows: Record<string, unknown>[]` (`:181`) must be retyped to the generated `Insert`
  (a bare `Record` will not satisfy it — that is the expected, wanted compile error).
- **PostgREST numeric typing (Phase 3, load-bearing).** Postgres `numeric` columns
  (`source_quantity`, `target_quantity`, `price`, `fee`, `price_usd`) may generate as
  `number`, `string`, or `number | string` depending on the CLI version. **Verify this
  first** (it is Phase 3 step 1). If they are not plain `number`, do **not** loosen the
  whole app — keep `Transaction` as a mapped type that narrows those fields to `number`
  at the boundary (values are validated/coerced upstream by Zod + the service), and
  document the one coercion point. The proof surface is the three `tx()` test factories
  that build full `Transaction` literals — `transaction-service.test.ts:18-36`,
  `pnl-engine.test.ts:6-24`, `portfolio-service.test.ts:17-35` — plus the arithmetic in
  `pnl-engine.ts`/`portfolio-service.ts`: if the derived type is wrong, `npm run test`
  (which type-checks test files) breaks across all of them. `npm run build` alone would
  NOT catch this, so Phase 3 acceptance must include `npm run test`.

---

## Phase 1: D3 guard + CI gate (do first)

### Overview

Characterize the untested per-lot unrealized-P&L path and make CI run the unit suite,
so the behavior D1 later touches is pinned and regressions are caught automatically.

### Changes Required:

#### 1. Unit tests for `getTransactionsWithPnl`

**File**: `src/lib/transaction-service.test.ts`

**Intent**: Add a `describe("getTransactionsWithPnl")` block characterizing current
behavior (not asserting it's correct — pinning it). Cover: the per-lot formula
`target_quantity * currentPrice - source_quantity * price_usd` (`transaction-service.ts:299-300`);
`isMarkableAcquisition` filtering (`:259-269`) — stablecoin / unpriced / SELL → not
marked; the `realizedByTx` join from `computePositions`; and `stale`/`updated_at`
passthrough from `getMultiplePrices`.

**Contract**: Reuse the existing `fakeSupabase({data,error})` (`:211-219`) for the
`select/eq/order/order` chain and the existing `vi.mock("@/lib/coinpaprika")` to stub
`getMultiplePrices` with `{prices, stale, updated_at}`. `computePositions` runs real
(pure, already trusted) on crafted transaction arrays. No new mock infra.

#### 2. Run unit tests in CI

**File**: `.github/workflows/ci.yml`

**Intent**: Add a `npm run test` step so the DB-free unit suite becomes a real gate.

**Contract**: New `- run: npm run test` step after `npm run build` (or before `build`).
Unit suite only (`vitest.config.ts` already excludes `tests/integration/**` and `e2e/**`),
so no Docker/Supabase needed in CI.

### Success Criteria:

#### Automated Verification:

- New tests pass: `npm run test`
- Full unit suite still green: `npm run test`
- Lint passes: `npm run lint`
- CI workflow includes a test step (grep `npm run test` in `.github/workflows/ci.yml`)

#### Manual Verification:

- The new tests fail if the per-lot formula sign is flipped (spot-check by temporarily inverting it locally)
- A pushed branch shows the test step running green in GitHub Actions

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 2.

---

## Phase 2: D1 — generate types (additive, green)

### Overview

Land the generated DB types as an unused, committed artifact. Zero behavioral change,
trivially revertible.

### Changes Required:

#### 1. Generate the types file

**File**: `src/db/database.types.ts` (new)

**Intent**: Generate the canonical DB type definitions from the live local schema.

**Contract**: Output of `supabase gen types typescript --local` (local stack running).
Committed with **no consumers** — nothing imports it yet.

#### 2. Add a generation script

**File**: `package.json`

**Intent**: Make regeneration repeatable and discoverable.

**Contract**: New script `"db:types": "supabase gen types typescript --local > src/db/database.types.ts"`.

### Success Criteria:

#### Automated Verification:

- File exists: `src/db/database.types.ts`
- It exports a `Database` type containing `public.Tables.transactions` with `Row`/`Insert`/`Update`
- Build passes (file is valid TS, unused): `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- `npm run db:types` regenerates the file with no diff against the committed version
- Generated `transactions` columns match the two migrations (enum, numeric, nullable `price_usd`)

**Implementation Note**: Pause for human confirmation before Phase 3.

---

## Phase 3: D1 — type the client + derive types (enforcement)

### Overview

Flip the production client to typed and re-point `types.ts` at the generated types.
This is the enforcement switch: drift now becomes a `tsc` error.

### Changes Required:

#### 1. Verify generated numeric typing (do first — gates the rest)

**File**: `src/db/database.types.ts` (inspect only)

**Intent**: Determine whether `numeric` columns generated as `number`, `string`, or
`number | string` — this decides whether `Transaction` can be a plain alias or needs a
boundary-narrowing mapped type (per Critical Implementation Details).

**Contract**: Read the generated `transactions` `Row` field types for
`source_quantity, target_quantity, price, fee, price_usd`; record the finding before
editing `types.ts`.

#### 2. Type the production Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Parameterize the client with the generated schema so queries are checkable.

**Contract**: `createServerClient<Database>(...)` importing `Database` from `@/db/database.types`.

#### 3. Thread the typed client through the service (so typing is not inert)

**File**: `src/lib/transaction-service.ts` (and `src/lib/portfolio-service.ts` if it queries)

**Intent**: Change the `SupabaseClient` parameter to `SupabaseClient<Database>` on the
functions that call `.from("transactions")`, so the generic survives the call boundary
and `.from(...)`/`.insert(...)` are genuinely type-checked. Retype the sell-all
`rows: Record<string, unknown>[]` literal (`:181`) to the generated `Insert[]`.

**Contract**: Param type `SupabaseClient<Database>` on `:14,52,95,168,241,279,314`;
`rows` typed as the generated `transactions` `Insert[]`. Expect (and resolve at the
real type) any compile error this surfaces — that error *is* the gate working.

#### 4. Derive the domain types

**File**: `src/types.ts`

**Intent**: Make `Transaction`/`TransactionInsert` aliases of the generated Row/Insert —
the single source of truth — applying the numeric narrowing from step 1 if needed.

**Contract**: `Transaction` derived from
`Database["public"]["Tables"]["transactions"]["Row"]` (numeric fields narrowed to
`number` at the boundary if generated otherwise); `TransactionInsert` from `["Insert"]`.
`TransactionWithPnl` (built on `Transaction`) and the three `tx()` test factories must
still compile under `npm run test`.

### Success Criteria:

#### Automated Verification:

- Service fns are threaded: `grep -c "SupabaseClient<Database>" src/lib/transaction-service.ts` ≥ the count of `.from()`-touching functions
- Type checking passes: `npm run build` (astro check)
- Lint passes: `npm run lint`
- Unit suite green (type-checks the 3 `tx()` factories): `npm run test`
- Integration suite green locally: `npm run test:integration` (Supabase up)

#### Manual Verification:

- **Gate proof (F1):** a deliberate column rename in a scratch migration produces a `tsc` error — then reverted. If it does NOT error, the typing is still inert (signatures not threaded).
- Numeric-typing finding from step 1 recorded; if columns generated as `string`, the boundary-narrowing is in place
- App runs: create a DEPOSIT and a BUY via UI, both views update correctly

**Implementation Note**: Pause for human confirmation before Phase 4.

---

## Phase 4: D1 — delete the casts (cleanup)

### Overview

Remove the now-redundant casts, one independently revertible commit each, and retire
the integration-test stand-in type.

### Changes Required:

#### 1. Remove casts + eslint-disable

**File**: `src/lib/transaction-service.ts`

**Intent**: Delete each cast now that the typed client makes them unnecessary, one
commit per cast for clean reversibility.

**Contract**: Remove `as Transaction` (`:164`), `as Transaction[]` (`:238`, `:252`),
and the `eslint-disable @typescript-eslint/no-unsafe-assignment` (`:157`). Each removal
must keep `npm run build` green.

#### 2. Re-point the integration test type

**File**: `tests/integration/clients.ts`

**Intent**: Retire the hand-written `IntegrationDatabase` in favor of the generated
`Database` (or alias it) so there is one schema type repo-wide.

**Contract**: `createClient<Database>` sourced from `@/db/database.types`; remove or
alias `IntegrationDatabase`.

### Success Criteria:

#### Automated Verification:

- No casts remain: `grep -n "as Transaction" src/lib/transaction-service.ts` returns nothing
- No eslint-disable remains in the touched lines: `grep -n "no-unsafe-assignment" src/lib/transaction-service.ts`
- Type checking passes: `npm run build`
- Unit + integration suites green: `npm run test` and `npm run test:integration`

#### Manual Verification:

- App still creates/sells transactions correctly via UI (both portfolio views)
- Integration tests still assert persisted columns for DEPOSIT/SELL/sell-all

**Implementation Note**: Final phase — on completion the change flips to implemented.

---

## Testing Strategy

### Unit Tests:
- `getTransactionsWithPnl`: per-lot formula, `isMarkableAcquisition`, `realizedByTx` join, stale passthrough (Phase 1).
- Existing engine/service/coinpaprika suites must stay green throughout.

### Integration Tests:
- Persistence + isolation suites (local Supabase) must stay green after Phases 3–4 (typed client must not change runtime behavior).

### Manual Testing Steps:
1. Create a DEPOSIT (USDT) and a BUY via the UI; confirm both portfolio views update.
2. Temporarily rename a column in a scratch migration; confirm `npm run build` now errors (gate proof); revert.
3. Push a branch; confirm the new CI `npm run test` step runs.

## Migration Notes

No data migration. `database.types.ts` is generated from existing migrations; the typed
client is a compile-time change only — runtime queries are unchanged.

## References

- Decision + ranking: `context/changes/refactor-opportunities/research.md`
- Upstream analysis: `context/changes/trade-flow-analysis/research.md`
- Typed-client precedent: `tests/integration/clients.ts:59`
- Accepted priors: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: D3 guard + CI gate

#### Automated
- [ ] 1.1 New tests pass: `npm run test`
- [ ] 1.2 Full unit suite green: `npm run test`
- [ ] 1.3 Lint passes: `npm run lint`
- [ ] 1.4 CI workflow includes a test step

#### Manual
- [ ] 1.5 Tests fail if per-lot formula sign is flipped (spot-check)
- [ ] 1.6 Pushed branch shows test step green in GitHub Actions

### Phase 2: D1 — generate types (additive)

#### Automated
- [ ] 2.1 `src/db/database.types.ts` exists
- [ ] 2.2 Exports `Database` with `transactions` Row/Insert/Update
- [ ] 2.3 Build passes (unused file valid): `npm run build`
- [ ] 2.4 Lint passes: `npm run lint`

#### Manual
- [ ] 2.5 `npm run db:types` regenerates with no diff
- [ ] 2.6 Generated columns match the two migrations

### Phase 3: D1 — type client + derive types

#### Automated
- [ ] 3.1 Service fns threaded with `SupabaseClient<Database>` (grep count ≥ `.from()`-touching fns)
- [ ] 3.2 Type checking passes: `npm run build`
- [ ] 3.3 Lint passes: `npm run lint`
- [ ] 3.4 Unit suite green (type-checks the 3 `tx()` factories): `npm run test`
- [ ] 3.5 Integration suite green locally: `npm run test:integration`

#### Manual
- [ ] 3.6 Gate proof: scratch column rename produces a `tsc` error, then reverted (if not → typing inert)
- [ ] 3.7 Numeric-typing finding recorded; boundary-narrowing in place if columns are `string`
- [ ] 3.8 App: DEPOSIT + BUY via UI update both views

### Phase 4: D1 — delete casts (cleanup)

#### Automated
- [ ] 4.1 No `as Transaction` casts remain in transaction-service.ts
- [ ] 4.2 No `no-unsafe-assignment` disable remains in the touched lines
- [ ] 4.3 Type checking passes: `npm run build`
- [ ] 4.4 Unit + integration suites green

#### Manual
- [ ] 4.5 App still creates/sells transactions correctly (both views)
- [ ] 4.6 Integration tests still assert persisted columns
