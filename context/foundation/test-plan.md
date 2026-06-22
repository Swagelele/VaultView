# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-22

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the ground
   truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding build
output, `context/archive/`, and fixtures).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|--------------------------------|
| 1 | User sees a wrong P&L or average-cost number (realized, unrealized, or aggregate) and trusts it for a financial decision | High | High | PRD guardrail "P&L must be arithmetically correct — wrong numbers are worse than no numbers"; FR-008, FR-009, FR-010; interview Q1, Q2; hot-spot dir `src/lib/` (high churn) |
| 2 | A two-sided crypto-to-crypto trade (BUY/SELL/SWAP) computes the wrong source or target quantity, corrupting holdings and every downstream P&L number | High | High | We were already burned here (interview Q2 — a crypto-to-crypto quantity bug shipped and was fixed); interview Q3 (changed often, low confidence); hot-spot dir `src/lib/` (highest-churn business logic, ~10 commits/30d) |
| 3 | A transaction save reports success (HTTP 200) but persists wrong or partial state, leaving holdings inconsistent | High | Medium | Interview Q1; hot-spot dir `src/pages/api/` (~15 commits/30d); batch save path exists; no API-layer or DB-touching test exists today |
| 4 | A user reads or mutates another user's transactions or positions (cross-user leak / IDOR) because an endpoint checks authentication but not ownership, or RLS has a gap | High | Medium | PRD NFR "no user's data is visible to any other user, under any access path"; CLAUDE.md "always enable RLS on new tables"; interview Q3 (API + RLS, low confidence); RLS is declared but never exercised by a test |
| 5 | The CoinPaprika price API fails (outage or free-tier rate-limit) and the app hangs or fabricates a price instead of degrading to the manual-override path | Medium | Medium | tech-stack.md (free tier, ~20k calls/month, no key); FR-007 (manual override), FR-008 (auto-refresh every 15–30s multiplies calls across N assets); price boundary untested |

**Impact × Likelihood rubric.** Score both axes on a coarse High / Medium /
Low scale so two readers agree on the same row.

| Rating | Impact | Likelihood |
|--------|--------|------------|
| High   | user loses access, data, or money; failure is publicly visible | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs |
| Low    | cosmetic, easily reverted, no data effect | stable code, rarely touched |

Order: protect High × High first (#1, #2), then High × Medium (#3, #4),
then Medium × Medium (#5). No High-impact × Low-likelihood "provider
outage" rows are included — those belong to observability/alerting, not a
test.

**Abuse / security lens.** This product has authentication and accepts user
input, so the map carries an abuse scenario: Risk #4 (IDOR / ownership vs
authentication, RLS enforcement). It is scored on the same two axes as the
functional risks, not as a separate framework.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | P&L and average-cost outputs match an independently computed expectation (spreadsheet-reproducible per the NFR), for sell-all, deposit, and withdraw scenarios | "The function's current return value is the correct value" | The average-cost formula and the inputs each P&L path consumes; which paths already have tests vs none | unit | Oracle problem — asserting `toBe(<value the implementation currently returns>)` instead of a requirement-derived expectation |
| #2 | The exact crypto-to-crypto BUY/SELL/SWAP scenarios that broke produce correct source and target quantities on both sides | "BUY and SELL are symmetric, so one test covers both" | How source/target quantity and exchange rate combine per trade type; the specific scenario that regressed | unit | Happy-path-only; copying the expected quantity from the implementation under test |
| #3 | After a save, the persisted rows match the operation; a failed save does not return a success result | "HTTP 200 means the database is consistent" | The save sequence, what is persisted vs returned, whether the write is atomic, what happens on partial failure (do not test a rollback that does not exist) | integration (local Supabase) | Asserting on the API response shape instead of the persisted state; testing imagined rollback behavior |
| #4 | A request from user B for user A's resource is denied at the data boundary (ownership enforced, not just authentication) | "Logged-in equals authorized for this specific row" | The auth/session shape, where the account filter is applied, whether RLS or app code enforces ownership | integration | Over-mocking that bypasses the real RLS / ownership boundary, so the test never exercises isolation |
| #5 | An API failure surfaces cleanly and the manual-override path still works; a malformed response does not crash or silently fabricate a price | "The price response is always present and valid JSON" | The client's failure translation, what callers receive on error, the parsing/validation contract | unit (mock at the network edge) | Asserting exact live prices (brittle, network-dependent); over-mocking internals |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|------------|--------|----------------|
| 1 | P&L and trade-math correctness | Defend Risk #1, #2, #5 at the cheapest (unit) layer, extending the existing `src/lib` suite with requirement-derived edge cases | #1, #2, #5 | unit | complete | context/changes/testing-pnl-trade-math/ |
| 2 | Persistence and data isolation | Prove transaction saves persist consistent state and one user cannot reach another's data | #3, #4 | integration | complete | context/archive/2026-06-18-testing-persistence-data-isolation/ |
| 3 | Quality-gate wiring | Lock the floor: per-edit lint/typecheck and a scoped test trigger on risk areas, enforced at commit | cross-cutting | gates / hooks | complete | standalone — commit `c08f506` |
| 4 | Critical-path E2E | Cover one genuinely cross-boundary user path (trade entry → persists → visible in both portfolio views after reload) | cross-cutting | e2e | complete | standalone — commits `a9e1b37`..`b03cc70` |

**Status vocabulary** (fixed — parser literals):

| Value | Meaning |
|-------|---------|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | ^4.1.8 | Configured (`vitest.config.ts`, `npm test`). 5 test files, all in `src/lib/` — profile is **sparse**: business-logic helpers covered, API/middleware/components bare. |
| API mocking | none yet — see Phase 1 | — | Network-edge mocking (e.g. MSW or a fetch stub) introduced when Risk #5 is implemented. |
| integration (DB) | none yet — see Phase 2 | — | Local Supabase via `npx supabase`; needs a service-role client + fresh account/session per test. |
| e2e | none yet — see Phase 4 | — | Playwright planned for the single cross-boundary path. |
| accessibility | none | — | Out of scope for MVP (desktop-only, see PRD non-goals). |

**Stack grounding tools (current session):**
- Docs: none — Context7 / framework docs MCP not available in current session; stack facts taken from local `package.json`, `vitest.config.ts`, `CLAUDE.md`, `tech-stack.md`; checked: 2026-06-18
- Search: none — Exa.ai / web search MCP not available in current session; checked: 2026-06-18
- Runtime/browser: none — Playwright MCP not exposed in current session; arrives as a rollout tool in Phase 4; checked: 2026-06-18
- Provider/platform: Linear, GitHub (`gh` CLI), local Supabase (`npx supabase`) available — Supabase is directly relevant to the Phase 2 integration gate; checked: 2026-06-18

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local + CI | required (already wired: ESLint, `astro check`, husky/lint-staged, CI) | syntactic / type drift |
| unit | local + CI | required after §3 Phase 1 | P&L and trade-math logic regressions |
| integration (DB / isolation) | local | required after §3 Phase 2 | inconsistent saves, cross-user data access |
| per-edit hook (lint/typecheck + scoped test) | local (agent loop) | recommended after §3 Phase 3 | regressions at edit time |
| e2e on critical flow | local, then CI | required after §3 Phase 4 | broken critical user path across auth + API + DB + render |
| visual diff (deterministic) | CI on PR | optional | rendering regressions (deferred — see §7) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section reads "TBD."

### 6.1 Adding a unit test

- **Location & naming**: co-located with the source module — `src/lib/<module>.test.ts`
  next to `src/lib/<module>.ts`. Suffix is `.test.ts` (not `.spec.ts`).
- **Runner**: Vitest. Run the whole suite with `npm test`; a single file with
  `npx vitest run src/lib/<module>.test.ts`.
- **Fixtures**: build inputs with an inline factory that wraps `Partial<T>` over sane
  defaults — see `tx()` in `pnl-engine.test.ts` and `asset()` in `portfolio-summary.test.ts`.
  No shared fixture module; copy the small factory into the new test file.
- **Oracle rule (non-negotiable)**: derive every expected value from the requirement
  (the Average-Cost formula, the PRD), never by copying what the implementation currently
  returns. Add a one-line comment showing the arithmetic (e.g. `// (60000 + 64000) / 2 = 62000`)
  so a reviewer can confirm the oracle is requirement-derived, not implementation-pinned.
- **Determinism**: when a test builds same-minute transactions, set distinct `created_at`
  values to encode causal order — the P&L engine sorts by `(transaction_date, created_at)`,
  and omitting the tiebreaker reproduces the phantom-position bug by accident.
- **Reference test**: `src/lib/pnl-engine.test.ts`.

### 6.2 Adding an integration test

- **Location & naming**: `tests/integration/<name>.integration.test.ts`. The
  `.integration.test.ts` suffix is what the separate config globs; the default
  `npm test` excludes `tests/integration/**`, so DB tests never run in the unit pass.
- **Runner**: `npm run test:integration` (Vitest via `vitest.integration.config.ts`,
  `fileParallelism: false`). Requires a local Supabase stack (`npx supabase start`); if
  it's down the suite **skips** with a hint — `tests/integration/db.ts` probes once and
  suites guard with `describe.skipIf(!dbAvailable)`.
- **Two clients (the core distinction)**: `serviceClient()` bypasses RLS — use it ONLY to
  seed fixtures and read ground truth. `userClient(accessToken)` carries a real user JWT so
  `auth.uid()` resolves and RLS is enforced — assert ownership/isolation through it, never
  through the service-role client.
- **Per-test users**: `createTestUser(svc)` makes a confirmed user and signs in for a JWT;
  push the id and `deleteTestUser` in `afterEach` — `ON DELETE CASCADE` removes their rows,
  so re-runs leave nothing behind. Unique emails (`vault-it-<ts>-<n>@example.test`) keep
  parallel runs and re-runs collision-free.
- **Never import `@/lib/supabase.ts`** (or anything pulling `astro:env/server`) — it throws
  under Node/Vitest. Clients are built directly from `@supabase/supabase-js` in
  `tests/integration/clients.ts`.
- **Keep the price API out**: use a stablecoin on one side or `source_price_usd_override` so
  `resolvePriceUsd` short-circuits; assert raw rows via `selectTransactions`, never
  `getTransactionsWithPnl` (which calls CoinPaprika).
- **Keys**: `tests/integration/config.ts` resolves URL / anon / service-role from env,
  falling back to the public local-default JWTs — zero setup for the standard stack; override
  via `npx supabase status -o env`.
- **Reference tests**: `tests/integration/persistence.integration.test.ts`,
  `tests/integration/isolation.integration.test.ts`.

### 6.3 Adding an e2e test

- TBD — see §3 Phase 4.

### 6.4 Adding a test for a new API endpoint

- The persistence/ownership logic lives in the service layer
  (`src/lib/transaction-service.ts`), not the thin `src/pages/api/*` handlers — test the
  service function directly with the integration harness rather than booting the
  Astro/workerd server.
- **Assert the persisted side-effect, not the return value**: after calling the service
  function with the service-role client, re-`SELECT` the row(s) and assert the columns match
  the operation. For a failure (e.g. a 409 holding-check), assert `status` AND that a
  follow-up count is 0 — a failed save persists nothing.
- **Exercise the ownership boundary** for any endpoint that reads or mutates user-scoped data:
  seed user A's rows with the service-role client, then prove user B's `userClient` cannot read
  them (`select` returns 0) or write as A (RLS `WITH CHECK` rejects an insert with
  `user_id: A`), plus a positive control that A sees only A's rows.
- See §6.2 for harness mechanics. Reference:
  `tests/integration/isolation.integration.test.ts`.

### 6.5 Adding a test for the price-API boundary

- **Mock at the network edge, not the module**: stub `globalThis.fetch` (via
  `vi.stubGlobal("fetch", vi.fn(...))`) so the real `coinpaprika.ts` parsing and
  degradation logic actually runs. Mocking the `@/lib/coinpaprika` module instead (as
  `transaction-service.test.ts` does for its *callers*) bypasses the very logic under test.
- **Reset module caches between tests**: `currentPriceCache` / `historicalPriceCache` are
  module-global. Call `vi.resetModules()` in `beforeEach` and re-import the module inside
  each test (`const { getCurrentPrice } = await import("./coinpaprika")`), or use unique coin
  ids per test, to avoid cross-test cache bleed.
- **Assert degradation, never live prices**: every failure mode (non-200 incl. 429, network
  throw, malformed-200) must degrade to `null` / `[]` — assert that, and assert it is not NaN.
  Use `vi.useFakeTimers()` to cross the 120s current-price TTL when exercising the stale-flag path.
- **Reference test**: `src/lib/coinpaprika.test.ts`.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the phase taught.)

- **Phase 1 (P&L / trade-math correctness, change `testing-pnl-trade-math`)**: three
  things bit or nearly bit. (1) `created_at` is load-bearing — same-minute fixtures must set
  it or they non-deterministically trigger the phantom-position clamp. (2) The CoinPaprika
  price caches are process-global, so boundary tests must `vi.resetModules()` + re-import or
  use unique ids. (3) The Risk #2 regression that actually shipped ("120,000 ETH") lives in
  `TransactionForm.tsx`, *outside* the unit layer — guarded here only at the `resolvePriceUsd`
  mirror; the form site remains an uncovered gap for a later component/e2e phase. One small
  production fix landed: `is_closed` now uses a relative epsilon (float-residue close).
- **Phase 2 (persistence & isolation, change `testing-persistence-data-isolation`)**: two
  things bit. (1) `@supabase/supabase-js` types `.insert()` as `never[]` unless the `Database`
  generic *exactly* satisfies `GenericSchema` — TS interfaces are not assignable to the
  `Record<string, unknown>` row/insert constraint, so `Row`/`Insert` need an `Indexed<>`
  mapped-type wrapper, and the client type must be `ReturnType<typeof createClient<DB>>` (not
  `SupabaseClient<DB>`, whose own generic defaults collapse `Schema` to `never`). Runtime was
  always fine; this was purely compile-time. (2) The default `vitest run` was collecting the
  Playwright `e2e/*.spec.ts` and would have swept in the DB tests — `vitest.config.ts` now
  excludes both `tests/integration/**` and `e2e/**` to keep the unit pass DB-free and green.
  No production code changed — tests only.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Pure presentational UI** — styling, layout, chart colors, and shadcn/ui
  primitives in `src/components/ui`. They break often and catch little; the
  component library is its own test. Re-evaluate if a presentational change
  ever causes a data-correctness or accessibility regression. (Source:
  Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-18
- Stack versions last verified: 2026-06-18
- AI-native tool references last verified: 2026-06-18
- Rollout status (§3) last reconciled: 2026-06-22 — all 4 phases complete (Phases 3 & 4 were built standalone in earlier sessions; statuses synced to their commits)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
