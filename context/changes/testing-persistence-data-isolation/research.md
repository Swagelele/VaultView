---
date: 2026-06-22T00:00:00Z
researcher: EMEA\jozk
git_commit: b03cc70858fb8a20fd0dcde240826573aafc993c
branch: master
repository: vault-view
topic: "Ground rollout Phase 2 — persistence (Risk #3) and data isolation / IDOR (Risk #4)"
tags: [research, codebase, persistence, rls, ownership, supabase, integration-tests]
status: complete
last_updated: 2026-06-22
last_updated_by: EMEA\jozk
---

# Research: Persistence (Risk #3) and Data Isolation (Risk #4)

**Date**: 2026-06-22
**Researcher**: EMEA\jozk
**Git Commit**: b03cc70858fb8a20fd0dcde240826573aafc993c
**Branch**: master
**Repository**: vault-view

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` (change `testing-persistence-data-isolation`).
For Risk #3 (save reports 200 but persists wrong/partial state) and Risk #4 (cross-user
read/mutate, IDOR, RLS gap): find the real failure path in code, verify or correct the
test-plan response guidance, locate existing tests, identify the cheapest useful test layer,
and flag speculative risk or misleading hot-spot evidence. Specifically establish the save
sequence (single vs batch), what is persisted vs returned, atomicity / partial-failure
behavior, and where the per-user ownership filter lives (RLS vs app code) on read and mutate.

## Summary

**Both risks are real and testable at the integration layer, but the response guidance needs
two corrections and the hot-spot evidence is partly misleading.**

- **The substantive logic does NOT live in `src/pages/api/` (the cited hot-spot).** The API
  route handlers are ~30-line auth-gate-and-delegate shells. All persistence and ownership
  logic lives in `src/lib/transaction-service.ts`. The cheapest useful test targets the
  **service functions + the RLS boundary directly**, not the HTTP handlers. Testing through
  HTTP would require booting Astro/workerd and faking a middleware session — expensive, and
  not where the risk lives. (See [Misleading hot-spot evidence](#misleading-hot-spot-evidence).)

- **Risk #3 — save sequence.** Two write paths exist:
  - **Single** (`createTransaction`, `transaction-service.ts:92`): one
    `.insert(row).select().single()` (`:156`). Inherently atomic (single-row).
  - **Batch** (`createSellAllGlobal`, `:165`): a validation pass loops per location
    (`:182-220`), then **one multi-row** `.insert(rows).select()` (`:230`). Atomic at the
    Postgres **statement** level — a constraint violation rolls back all rows.
  - There is **no multi-statement transaction, no RPC, no application-level rollback
    anywhere.** The guidance "do NOT test a rollback that does not exist" is **VALIDATED** —
    confirm it in the doc and avoid it in tests.

- **Risk #3 — persisted vs returned.** Both paths return the row(s) via `.select()`, so the
  response **is** read-back DB state for the happy path (including DB defaults `id`,
  `created_at`). The meaningful "200 but wrong state" surface is **app-side column
  derivation**, not an echo of input: one-sided ops force `target_*` to NULL and set
  `price = price_usd` (`:135-149`); two-sided ops store a derived rate. A test must assert
  these **persisted** columns against the operation — independently re-`SELECT`, do not trust
  the returned object alone.

- **Risk #4 — ownership is enforced twice (belt-and-suspenders).** Every read filters
  `.eq("user_id", userId)` (`transaction-service.ts:22, 243, 313`) **and** RLS policies gate
  every operation on `auth.uid() = user_id`
  (`20260614213523_create_transactions.sql:37-52`). Every insert hard-stamps `user_id` from
  the session (`:142, :208`) — a user cannot forge another's `user_id`, blocked by both app
  code and RLS `WITH CHECK`. The guidance "logged-in ≠ authorized for this row" is **correct
  and meaningful**: ownership *is* enforced, and the test must prove the **RLS backstop**
  works standalone (a future endpoint could forget the app-code filter).

- **No IDOR-by-id surface exists today.** There is **no** `GET /transactions/:id`, and **no**
  UPDATE or DELETE endpoint at all — only `POST` + `GET` (collection) on `/api/transactions`,
  plus collection `GET`s on portfolio/holdings/locations. Classic path-param IDOR is not
  reachable. The realistic cross-user vector is an **RLS gap** if future code omits the
  user filter — so test RLS directly, with a user-scoped (not service-role) client.

**Cheapest useful layer (both risks):** Vitest (already configured) in Node against the
already-running local Supabase, calling the **service functions** with a **service-role
client** (seed + ground-truth read-back) and a **per-test user-scoped anon client** (to
exercise the real RLS boundary). Choose inputs (stablecoin side or `source_price_usd_override`)
so the price path never hits CoinPaprika — keep DB real, keep network out.

## Detailed Findings

### Risk #3 — the save sequence, atomicity, and partial failure

**Single-write path** — `createTransaction` (`src/lib/transaction-service.ts:92-163`):

1. Zod parse (`:97`). On failure → `{ error, status: 400 }`, nothing touches the DB.
2. **Holding pre-check** for non-DEPOSIT (`:105-113`): `getHoldingAtLocation` reads the
   user's rows and rejects an oversell with `status: 409`. This read is **not** in the same
   DB transaction as the later insert (documented TOCTOU, see below).
3. Price resolution `resolvePriceUsd` (`:115-131`) — may call CoinPaprika unless a stablecoin
   side or override short-circuits it.
4. **Column derivation** (`:135-153`) — the real "persists wrong state" surface:
   ```ts
   const isOneSided = input.type === "DEPOSIT" || input.type === "WITHDRAW";
   const price = isOneSided ? priceUsd : (input.price ?? (… target/source rate …));
   const row = { user_id: userId, …, target_asset: isOneSided ? null : …,
                 target_quantity: isOneSided ? null : …, price, price_usd: priceUsd, … };
   ```
5. **Insert** (`:156`):
   ```ts
   const { data: created, error } = await supabase.from("transactions").insert(row).select().single();
   if (error) { return { error: error.message, status: 500 }; }
   return { data: created as Transaction };
   ```
   A DB error returns `status: 500`; a **failed save never returns success.** The returned
   object is the read-back row (`.select()`), so for the single happy path response == persisted.

**Batch-write path** — `createSellAllGlobal` (`:165-237`), the "batch save path" the risk cites:

- Validation pass (`:182-220`): for each location, read the holding, reject if `<= 0`,
  resolve `price_usd`, accumulate `rows`. **Nothing is inserted during this pass.**
- All-or-nothing gate (`:222-224`): `if (errors.length > 0) return { error, status: 409 }` —
  if any location is bad, the **entire batch is rejected before any insert**.
- Single multi-row insert (`:230`), with an explicit code comment on atomicity (`:226-229`):
  > "The insert itself is atomic — one multi-row statement, so a constraint violation rolls
  > back all rows (no half-sold portfolio). Note the per-location holdings read above is NOT in
  > the same transaction, so concurrent writers could TOCTOU-oversell; acceptable at the PRD's
  > single-user scale, same posture as createTransaction."

**Atomicity verdict.** The only atomicity is Postgres single-statement atomicity (a single-row
insert, and a single multi-row insert). There is **no `BEGIN/COMMIT`, no RPC, no compensating
logic**. The residual hazard is **TOCTOU**: the holding read is a separate statement from the
insert, so two concurrent writers could both pass the pre-check and oversell. This is a
**documented, accepted single-user posture** — not a rollback to test.

**What "200 but wrong state" actually means here** (verified, not assumed):
- It is **not** a half-written batch (statement atomicity prevents that).
- It **is** a row whose **derived columns** disagree with the operation: a one-sided op that
  leaked a `target_*`, a two-sided rate computed wrong, a `price_usd` that doesn't match the
  override/stablecoin rule, or a `user_id` mismatch.
- Schema CHECK constraints are a second persistence guard worth asserting:
  `source_quantity > 0`, `price > 0`, `target_quantity IS NULL OR > 0`
  (`20260614213523_create_transactions.sql:11,15,18`).

### Risk #4 — where the per-user ownership filter is applied

**App-code filter (read paths).** Every `.from("transactions")` read is scoped by the
caller's `userId`, which originates from `context.locals.user.id` (set by middleware from the
session cookie):

- `getHoldingAtLocation` — `.eq("user_id", userId)` (`transaction-service.ts:22`)
- `getTransactions` — `.eq("user_id", userId)` (`:243`); used by `getTransactionsWithPnl`
  (`:278`) and by `getPortfolio` (`portfolio-service.ts:16`)
- `getDistinctLocations` — `.eq("user_id", userId)` (`:313`)

`grep` across `src/` confirms **no `.from("transactions")` read omits the filter**, and there
is **no `service_role` usage anywhere in `src/`** — the app only ever uses the anon
SSR/cookie client (`src/lib/supabase.ts:9`).

**App-code stamp (mutate paths).** Both inserts hard-set `user_id: userId`
(`:142`, `:208`) — the client cannot specify it. A user cannot insert "as" another user.

**RLS (the data boundary / backstop).** `20260614213523_create_transactions.sql:34-52`:
```sql
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own transactions"   ON transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own transactions" ON transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own transactions" ON transactions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own transactions" ON transactions FOR DELETE USING (auth.uid() = user_id);
```
`user_id` is `NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` (`:6`) — deleting a test
user cascades their transactions (clean teardown).

**Auth/session shape.** `src/middleware.ts:15-36`: every request resolves
`supabase.auth.getUser()` into `context.locals.user`; protected API routes 401 when absent
(`:29-35`). So at the handler level the user is always authenticated; the **only thing
standing between an authenticated user and another user's row is the `user_id` filter +
RLS** — exactly what Risk #4 must exercise.

**The API surface is narrow** (`src/pages/api/`):
- `POST /api/transactions` (insert, `transactions.ts:8-32`) + `GET /api/transactions`
  (own collection, `:34-46`)
- `POST /api/transactions/batch` (sell-all-global insert, `batch.ts`)
- `GET /api/portfolio`, `GET /api/holdings`, `GET /api/locations` — all own-collection reads
- **No** `:id` route, **no** UPDATE/DELETE handler. → No path-param IDOR today.

### Existing tests and the harness gap

- 5 Vitest files, all unit, all in `src/lib/` (`*.test.ts`). **No API-layer or DB-touching
  test exists.** `vitest.config.ts` only sets the `@/*` alias — no setup file, no env loading,
  no separate integration project.
- `transaction-service.test.ts` tests only the **pure** `resolvePriceUsd` and mocks
  CoinPaprika (`:10-13`). It never constructs a Supabase client — confirming the persistence
  and ownership paths are **entirely uncovered**.
- **Over-mocking anti-pattern, concretely:** `transaction-service.test.ts` is fine for a pure
  function, but the Phase-2 isolation test must **not** mock the Supabase client or use a
  service-role client for the isolation assertion — either bypasses RLS and tests nothing.

### Cheapest useful test layer (per risk)

**Shared harness (new — does not exist):**
- Runner: existing Vitest, in Node (not workerd). Add a **separate integration project/config**
  (e.g. `vitest.integration.config.ts` + a new script) so `npm test` (unit) stays fast,
  network-free, and green in CI without Docker. (Design decision for `/10x-plan`.)
- **Do NOT import `@/lib/supabase.ts`** in tests — it imports `astro:env/server`, unavailable
  under Vitest. Construct clients directly with `@supabase/supabase-js` `createClient(url, key)`.
- Two clients:
  - **service-role** (bypasses RLS) — seed user A's rows, and read back ground truth for
    Risk #3 assertions.
  - **per-test user-scoped anon** — `auth.admin.createUser({ email_confirm: true })` with a
    unique email (timestamp/uuid suffix), `signInWithPassword`, build an anon client carrying
    that user's access token. This client **enforces RLS** — it is the Risk #4 boundary.
- Env: local Supabase URL + anon key + **service-role key** (the latter is **not** in the
  Astro env schema — only `SUPABASE_URL`/`SUPABASE_KEY` are; `astro.config.mjs:16-21`). Source
  the keys from `npx supabase status -o env` into a test-only env (e.g. `.env.test`), not the
  app schema. Local stack ports: API `54321`, DB `54322` (`supabase/config.toml`).
- Teardown: `auth.admin.deleteUser` per test → cascade deletes rows. Unique emails make
  parallel/re-runs collision-free.
- **Keep the price network out:** use a stablecoin source/target or `source_price_usd_override`
  so `resolvePriceUsd` short-circuits (`:59`, `:66`, `:71-75`) and never calls CoinPaprika.
  For read assertions use `getTransactions` (no prices) rather than `getTransactionsWithPnl`
  (which calls `getMultiplePrices`, `:284`).

**Risk #3 tests (integration):**
1. **Happy single save persists exact state:** call `createTransaction(serviceClient, A, input)`
   for each shape (one-sided DEPOSIT/WITHDRAW, two-sided BUY/SELL/SWAP); independently
   `SELECT` the row and assert `user_id`, `type`, `target_*` NULL-ity (one-sided), `price`
   vs `price_usd` derivation, `source_quantity`, `location`, `transaction_date`.
2. **Failed save persists nothing:** an oversell (holding < `source_quantity`) returns
   `status: 409` (`:107-112`) **and** a follow-up `SELECT count = 0`. Assert on **persisted
   state**, not the response shape (the named anti-pattern).
3. **Batch all-or-nothing:** a `createSellAllGlobal` batch with one good + one zero-holding
   location returns `409` (`:222-224`) and `SELECT count = 0`; an all-valid batch persists
   **exactly N** rows with correct `target_quantity = holding × price` (`:189`).
4. **Do NOT** author a test that forces a partial insert and asserts rollback — that behavior
   does not exist (validated above).

**Risk #4 tests (integration, RLS-exercising):**
1. **Cross-user read denied:** seed A's rows (service-role); with B's user-scoped client,
   `from("transactions").select()` → **0 rows**. Optionally also assert
   `getTransactions(bScopedClient, A.id)` returns `[]` (filter) — but the load-bearing
   assertion is the **RLS** one where the client carries B's JWT.
2. **Cross-user write denied:** with B's client, attempt `insert({ user_id: A.id, … })` →
   RLS `WITH CHECK` rejects (`:41-43`). Confirms a forged `user_id` cannot land.
3. **Positive control:** A's own client reads exactly A's rows and inserts succeed — proves
   the test isn't trivially passing because everything is denied.

## Code References

- `src/pages/api/transactions.ts:8-32` — `POST` insert (auth-gate + delegate); `:34-46` — `GET` own collection
- `src/pages/api/transactions/batch.ts:8-32` — `POST` sell-all-global (the "batch" path)
- `src/lib/transaction-service.ts:92-163` — `createTransaction` (single save, derivation, insert `:156`)
- `src/lib/transaction-service.ts:165-237` — `createSellAllGlobal` (validation pass + atomic multi-row insert `:230`, atomicity/TOCTOU comment `:226-229`)
- `src/lib/transaction-service.ts:13-46` — `getHoldingAtLocation` (filtered read, `:22`)
- `src/lib/transaction-service.ts:239-248, 309-320` — `getTransactions` / `getDistinctLocations` (filtered reads, `:243`, `:313`)
- `src/lib/portfolio-service.ts:16` — `getPortfolio` delegates to filtered `getTransactions`
- `src/lib/supabase.ts:5-24` — anon SSR/cookie client; `createClient` returns `null` if unconfigured
- `src/middleware.ts:15-36` — session resolution → `context.locals.user`; protected-route 401
- `supabase/migrations/20260614213523_create_transactions.sql:34-52` — RLS enable + 4 policies; `:11,15,18` CHECK constraints; `:6` `ON DELETE CASCADE`
- `src/lib/schemas.ts:22-66` — `createTransactionSchema` (one-sided vs two-sided refinement); `:76-105` `createSellAllGlobalSchema` (stablecoin-target restriction)
- `astro.config.mjs:16-21` — env schema declares only `SUPABASE_URL`/`SUPABASE_KEY` (no service-role)
- `vitest.config.ts` — alias only; no integration setup yet
- `src/lib/transaction-service.test.ts:10-13` — CoinPaprika mock; pure-function-only coverage

## Architecture Insights

- **Thin handlers, fat service.** API routes are uniform auth-gate-and-delegate shells; the
  business + persistence + ownership logic is concentrated in `transaction-service.ts`. Test
  the service layer, not the HTTP shell.
- **Defense in depth on ownership.** App-code `user_id` filter **and** RLS both enforce
  isolation. The app-code filter is the kind of thing a new endpoint can forget; RLS is the
  durable boundary — so the test's primary target is RLS, exercised by a user-scoped client.
- **Atomicity by single statement, not by transaction.** No `BEGIN/COMMIT`/RPC. Correctness
  rests on (a) validate-before-insert, (b) single (multi-row) insert statements. The known gap
  is TOCTOU between the holding read and the insert — accepted at single-user scale.
- **Determinism caveat for any P&L-touching read assertion:** same-minute fixtures must set
  distinct `created_at` or risk the phantom-position clamp (see lessons "Order P&L
  transactions deterministically"). Persistence/isolation tests can sidestep this by asserting
  raw rows (`getTransactions`) rather than computed P&L.

## Verification of the test-plan response guidance

| Risk | Guidance | Verdict |
|------|----------|---------|
| #3 | "After a save the persisted rows match the operation; a failed save does not return success." | **Confirmed reachable.** Persisted-state assertion is the right target; `:107-112`/`:158-159` show failures return 409/500, never success. |
| #3 | "do not test a rollback that does not exist." | **Validated.** No multi-statement transaction / RPC / compensating logic exists. Only single-statement atomicity. |
| #3 | anti-pattern "assert response shape instead of persisted state." | **Sharpened:** `.select()` makes the response == persisted on happy path, so the *distinguishing* assertion is independent read-back + the **count=0 on failure** case. |
| #4 | "denied at the data boundary — ownership enforced, not just authentication." | **Confirmed.** Ownership = app filter + RLS; middleware proves auth always present, so the test isolates the ownership layer. |
| #4 | anti-pattern "over-mocking that bypasses the real RLS boundary." | **Confirmed + concretized:** isolation assertion must use a **user-scoped anon client** (RLS active), never the service-role client or a mocked Supabase. |

## Misleading hot-spot evidence

- **`src/pages/api/` (~15 commits/30d) is a likelihood signal, not where the failure lives.**
  Those files are 20–32-line shells; the churn likely reflects wiring, not the
  persistence/ownership logic (which sits in `src/lib/transaction-service.ts`). Do not aim the
  test at the HTTP handler — boot cost is high and the logic isn't there.
- **"batch save path" worry is narrower than it sounds.** The only batch is a single multi-row
  `INSERT` → statement-atomic. The genuine residual is TOCTOU (read-then-insert), not partial
  persistence — and TOCTOU is an accepted single-user posture, not a Phase-2 test target.
- **No IDOR-by-id today.** Absent `:id`/UPDATE/DELETE routes, the cross-user vector reduces to
  an RLS gap. Keep the test on the RLS boundary; don't invent a path-param IDOR scenario the
  API can't express.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — "Order P&L transactions deterministically": `created_at`
  is load-bearing for any P&L-sequence read; persistence/isolation tests should assert raw
  rows to stay clear of it.
- `context/changes/testing-pnl-trade-math/` (Phase 1, complete) — established the unit
  cookbook (§6.1/§6.5), the override-first `resolvePriceUsd` behavior reused here to keep the
  price network out of integration tests, and the CoinPaprika-cache caveat (irrelevant once
  inputs short-circuit the API).

## Related Research

- `context/foundation/test-plan.md` §2 (Risk Response Guidance, rows #3/#4), §3 (Phase 2), §4
  (Stack — integration row), §6.2/§6.4 (cookbook TBDs this phase fills).

## Open Questions

- **Integration test location/config:** separate `vitest.integration.config.ts` + script vs a
  co-located `*.integration.test.ts` glob — and whether CI runs it (needs Docker/local
  Supabase) or it stays local-only (test-plan §5 marks the DB gate "local"). Decide in `/10x-plan`.
- **Service-role key sourcing:** confirm `.env.test` (from `npx supabase status -o env`) and
  ensure it is git-ignored; the app schema deliberately omits it.
- **User-scoped client construction:** confirm the exact `@supabase/supabase-js` pattern for
  attaching B's access token (e.g. `createClient(url, anonKey, { global: { headers: { Authorization: \`Bearer <token>\` } } })` vs `auth.setSession`) against the installed `^2.99.1`.
