---
date: 2026-06-23T00:00:00Z
researcher: Claude (10x-research, M4L4 Refactor opportunities)
git_commit: 392ed2544730fa69bbdb869572fc6199c7314177
branch: master
repository: m1 (VaultView)
topic: "Refactor opportunities — rank trade-spine debt by value vs risk"
tags: [research, codebase, refactor-opportunities, ranking, deep-focus, verified]
status: complete
last_updated: 2026-06-23
last_updated_by: Claude
prior: context/changes/trade-flow-analysis/research.md
---

# Research: Refactor opportunities (trade-spine)

**Prior (evidence base):** `context/changes/trade-flow-analysis/research.md` — its
findings are treated as gathered evidence, not re-derived.
**This report ENDS with a ranked proposal. It makes NO decision** — the decision
happens at `/10x-plan`.

## Candidate enumeration + classification (audit this first)

Each debt item from the prior analysis, classified: **CANDIDATE** = fix changes code
*structure*; **NOT-A-CANDIDATE** = test gap / runtime guard / domain decision (kept
as input to feasibility & cost, per the lesson's contract).

| Item | Classification | Intentionality verdict | Realistic approach |
|---|---|---|---|
| **D1** contract triplication over untyped Supabase client | **CANDIDATE** (structural) | **Accidental** | REBUILD (incremental) |
| **D2** duplicated insert literal | **CANDIDATE** (structural) | **Accidental** | REBUILD (mechanical, rides D1) |
| **D3** `getTransactionsWithPnl` untested | NOT-A-CANDIDATE (test gap) | **Accidental gap** — violates PRD guardrail | GUARD (additive test) |
| **D4** coinpaprika missing timeout + type-guard | NOT-A-CANDIDATE (runtime guard) | **Deliberate deferral** (`lessons.md`) | GUARD (don't rebuild) |
| **D5** SWAP no UI / WITHDRAW future-date | NOT-A-CANDIDATE (domain) | **Deliberate constraints** | DEFER → L5 DDD |

Net: **2 structural candidates (D1, D2)**; D3/D4 are guards (input to cost), D5 is domain.

## Per-candidate detail

### D1 — Contract seam over an untyped client  → **single source of truth (generated DB types)**
- **Current shape:** transaction row defined 3× by hand — Zod `schemas.ts:9-20`, TS
  `types.ts:3-18`, SQL migrations — over an **untyped** `createServerClient`
  (`supabase.ts:9`, no `<Database>` param). 3 casts bridge it: `as Transaction`
  (`transaction-service.ts:164`), `as Transaction[]` (`:238`, `:252`), plus
  `eslint-disable no-unsafe-assignment` (`:157`). `TransactionInsert` (`types.ts:20-25`)
  exists but is **imported nowhere**. [evidence]
- **Intentionality: ACCIDENTAL.** Casts + disable introduced in one feature commit
  `23deb7a`; no doc anywhere in `context/` ever considered a typed/generated client;
  `TransactionInsert` was authored ("for creating new transactions", `transaction-schema-rls/plan.md:178`)
  then left unused — the signature of drift, not a constraint. [evidence]
- **Risk: real but latent.** `git log --all` shows no column/type-drift bug ever
  (the one "column misalignment" fix `93dea30` was cosmetic UI). The risk is that the
  *next* column rename drifts silently. [evidence]
- **Feasibility: REBUILD, Strangler-Fig-able.** `supabase gen types typescript --local`
  is viable (`supabase/config.toml`, 2 migrations, `supabase` CLI is a devDep). An
  in-repo precedent exists: `tests/integration/clients.ts:38-59` already hand-types
  the client via `IntegrationDatabase`. First step is **pure-additive**: generate
  `src/db/database.types.ts`, commit with no consumers. [evidence]

### D2 — Duplicated insert literal → **shared typed row-builder**
- **Current shape:** row literal duplicated at `transaction-service.ts:143-155` and
  `:209-221`; 2 insert sites (`:158`, `:232`). Neither derives from `TransactionInsert`. [evidence]
- **Intentionality: ACCIDENTAL** — second literal copied in sell-all `6d5d344`. [evidence]
- **Feasibility: REBUILD, mechanical.** Extract one `buildTransactionRow()`; covered
  by existing persistence integration tests. Best done **after** D1 so the builder is
  typed by the generated `Insert`. [evidence]

### D3 — `getTransactionsWithPnl` untested → **characterization/guard tests** (not structural)
- Zero test refs (grep-confirmed); per-lot unrealized formula at `:299-300`. Violates
  PRD "wrong numbers are worse than no numbers." [evidence]
- **Feasibility: GUARD, pure additive, highest value-per-effort.** Reuses existing
  mocks: `fakeSupabase` (`transaction-service.test.ts:211-219`) + `vi.mock("@/lib/coinpaprika")`
  (already stubs `getMultiplePrices`, which this function calls). No new infra. [evidence]

### D4 — coinpaprika guards → **guard, don't rebuild** (deliberate deferral)
- ACL structure is clean; the 2 missing guards are **documented deliberate deferrals**
  (`lessons.md:19-23`). Two small edits inside `safeFetch`, fully covered by the
  existing `coinpaprika.test.ts` harness (already uses fake timers). [evidence]

### D5 — SWAP / WITHDRAW asymmetries → **defer to L5 (domain)**
- SWAP UI was **intentionally removed** (`7b81f3a` — redundant with BUY/SELL, backend
  keeps SWAP for existing data). WITHDRAW future-date is **deliberately** DEPOSIT-only
  (`schemas.ts:28-29`, `withdraw-cash-out/plan.md:60-62` — WITHDRAW prices at market).
  Neither is debt; the WITHDRAW nonsensical-future-date is a minor domain question. [evidence]

## ⚠ Cross-cutting finding: CI runs NO tests
`.github/workflows/ci.yml` = `astro sync → lint → build` only. The **only automatic
regression net is `tsc`/ESLint** (via `build`); unit/integration/e2e run **locally
only**, and `.husky/pre-commit` gates only lint+format. [evidence]
Implication for ranking: **D1's payoff (silent runtime drift → compile error) is the
single most CI-enforceable guard there is.** D3/D4 tests raise *local* confidence but
aren't a true gate until a `npm test` step is added to CI.

---

## Refactor opportunities (ranked)

> A PROPOSAL for the planning session, not a decision. Ordered by (debt cost × how
> CI-enforceable the fix is) vs change cost.

### #1 — D1: single source of truth via generated DB types  ⭐
- **Current → target:** 3 hand-defs + untyped client + 3 casts → generated
  `database.types.ts` feeding `createServerClient<Database>`; `Transaction`/`Insert`
  derived from it; casts and `eslint-disable` deleted.
- **Why #1:** only structural candidate worth a refactor *and* the highest-leverage
  guard given CI runs no tests — it converts the entire silent blast radius (types +
  2 insert literals + schemas + form) into compile errors the existing CI `build`
  already catches. Accidental complexity, so no load-bearing decision is at risk.
- **Blast radius:** `supabase.ts`, every `transaction-service.ts` function signature,
  `types.ts`, eventually `clients.ts`. All caught by `tsc` at each step.
- **Incremental path:** (1) generate + commit types, no consumers [pure additive];
  (2) `db:types` npm script; (3) type the production client; (4) migrate
  `transaction-service.ts` function-by-function, one cast deleted per commit;
  (5) re-point `types.ts`/`clients.ts` to the generated type. Each step compiles alone.
- **First prerequisite step:** run `supabase gen types typescript --local > src/db/database.types.ts` and commit it unused.

### #2 — D2: extract a typed row-builder
- **Current → target:** 2 duplicated literals → one `buildTransactionRow()` returning
  the generated `Insert` type.
- **Why #2:** mechanical, low-risk, removes the duplication that D1's type would
  otherwise still let drift between the two sites. Rides on D1.
- **Blast radius:** `transaction-service.ts` + persistence integration tests only.
- **First step:** extract the literal to one local function, call from both sites.

### Cheap fast win (regardless of ranking) — D3: test `getTransactionsWithPnl`
- Pure additive unit tests against the PRD's P&L guardrail; reuses existing mocks;
  zero blast radius. Recommend pairing with **adding `npm test` to CI** so it (and the
  rest of the unit suite) becomes a real gate. Do-first candidate.

## Considered and rejected (as refactors)
- **D4 (coinpaprika guards):** rejected as a refactor — structure is a clean ACL;
  deliberate deferral. Adequate response is a guard (timeout + `isFinite`), not a rebuild.
- **D5 (SWAP/WITHDRAW):** rejected — deliberate domain constraints with documented
  rationale; the only open question (WITHDRAW future-date) is a domain ruling → L5 DDD.

## Open questions (for the planning session)
- Scope: D1 alone, or D1 + the D3 guard (+ a `npm test` CI step) as one change? [decision]
- D1 rollout: how many `transaction-service.ts` functions per commit? [decision]
- The `numeric` Postgres columns generate as `number | string` under PostgREST typing
  — confirm against the current `number`-typed interface during D1. [unknown]

## Claim verification (ast-grep + grep)

Load-bearing claims for the ranking, pinned deterministically. Nothing overturned.

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `TransactionInsert` used nowhere | **confirmed** | defined `types.ts:20`; 0 references outside `types.ts` |
| 2 | Supabase client untyped | **confirmed** | `createServerClient(...)` no `<Database>` (`supabase.ts:9`); `src/db/database.types.ts` absent |
| 3 | typed-client precedent exists | **confirmed** | `createClient<IntegrationDatabase>` (`tests/integration/clients.ts:59,66,77,85`) |
| 4 | CI runs no tests | **confirmed** | `ci.yml:18-21` = `npm ci / astro sync / lint / build` only |
| 5 | 3 casts, 2 insert sites, `getTransactionsWithPnl` untested | **confirmed** (L3 ast-grep pass) | see `trade-flow-analysis/research.md` verification table |

Verdict: the ranking stands. D1's "accidental" verdict is reinforced (the one helper
type meant to enforce the insert shape is entirely unused), and the Strangler-Fig
path is de-risked by an existing in-repo precedent.
