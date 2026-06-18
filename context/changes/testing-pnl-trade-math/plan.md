# P&L and Trade-Math Correctness — Unit Test Hardening Plan

## Overview

This is rollout **Phase 1** of `context/foundation/test-plan.md` §3 — *P&L and trade-math
correctness*. It extends the existing `src/lib` Vitest suite with **requirement-derived edge cases
and regression guards** for the three highest-priority risks (#1 wrong P&L/avg-cost, #2
crypto-to-crypto quantity corruption, #5 price-API failure), and lands one small production fix
(`is_closed` floating-residue) decided during planning. The oracle for every assertion is the PRD
/ Average-Cost requirement, never the implementation's current return value (test-plan §1
principle #3; the §2 anti-pattern). The phase closes by filling the §6.1 / §6.5 cookbook stubs.

## Current State Analysis

The P&L engine is a single deterministic Average-Cost reducer in `src/lib/pnl-engine.ts`, fed by a
USD-price resolver in `src/lib/transaction-service.ts`, with presentation math in
`portfolio-service.ts`, `portfolio-summary.ts`, `asset-allocation.ts`. Vitest is configured
(`vitest.config.ts` — `@` alias only, default node env, no setup file, no coverage). The classic
base is **sparse-but-real**: 5 test files, ~40 `it` blocks, all in `src/lib/`.

**Already covered (do NOT re-author):** weighted average across multiple BUYs
(`pnl-engine.test.ts:80-114`), partial & full SELL realized P&L (`:116-222`), SWAP source/target
(`:152-188`), DEPOSIT cost basis incl. non-$1 (`:27-49`), WITHDRAW realized + close (`:224-279`),
dashboard null-collapsing + fee passthrough (`portfolio-summary.test.ts`), allocation fractions /
exclusion (`asset-allocation.test.ts`), `resolvePriceUsd` DEPOSIT/WITHDRAW resolution
(`transaction-service.test.ts`).

**Bare surfaces this phase targets** (from `research.md`):

- Multi-location average-cost *consolidation* (aggregation tested for quantity, not avg cost).
- `is_closed` strict `=== 0` with no tolerance (`pnl-engine.ts:144`) — float residue from
  average-cost subtraction (`:78`) can leave a sold-out position reading as open.
- Fee-exclusion is implicit — the engine never reads `tx.fee`; nothing pins this as intentional.
- Zero-but-not-null `price_usd` (passes the null guard, treated as a real price of 0).
- The crypto-to-crypto USD-derivation mirror (`resolvePriceUsd` `:81-85`) vs the engine's cost
  basis (`pnl-engine.ts:88`) — must reconcile (Risk #2's in-lib reachable guard).
- Same-minute tie / phantom-position ordering regression (lessons.md b; `pnl-engine.ts:50-54,73`).
- Over-sell clamp recording realized `0` (`pnl-engine.ts:80-84`).
- `coinpaprika.ts` has **zero direct tests** — degradation to `null`, the `getMultiplePrices`
  stale-flag merge, and the `resolvePriceUsd` → HTTP 400 path are all unexercised (Risk #5).

### Key Discoveries

- The Risk #2 regression that actually shipped (commit `98aaccf`, "120,000 ETH") lives in
  `src/components/portfolio/TransactionForm.tsx`, **outside the unit layer**. Decision: guard the
  in-lib mirror (`resolvePriceUsd`) now; document the form site as a known gap for a later
  component/e2e phase. (`research.md` Open Q1.)
- `price_usd` is the load-bearing engine field; `price` (exchange rate) is stored but never
  consumed by the engine.
- Two over-sell behaviors exist by design — write-time `409` (`transaction-service.ts:107`) and
  engine clamp-to-zero (`pnl-engine.ts:80-84`); both are real contracts.
- Determinism relies on the `created_at` tiebreaker — any same-minute test must set `created_at`
  to express causal order or it reproduces the phantom-position bug by accident.

## Desired End State

`npm test` passes with new requirement-derived tests covering the bare surfaces above; `is_closed`
correctly reports a sold-out position as closed despite float residue; the crypto-to-crypto USD
derivation is proven to reconcile with the engine cost basis; the price-API boundary is proven to
degrade to `null`/400 without fabricating a price, crashing, or emitting NaN into P&L; and
`test-plan.md` §6.1/§6.5 document how to add unit and price-boundary tests in this project.
Verify: `npm test` green, `npm run lint` and `astro check` green, `test-plan.md` §3 Phase 1 row =
`complete`.

## What We're NOT Doing

- **Not** writing tests in this skill — the plan decomposes the work; `/10x-implement` or
  `/10x-tdd` writes the code (Module 3 Lesson 2 boundary).
- **Not** testing or refactoring `TransactionForm.tsx` or any React component (form Risk #2 site is
  a documented gap, not in scope).
- **Not** wiring CI YAML or commit hooks — the unit gate's *enforcement* is `test-plan.md` §3
  Phase 3 (Quality-gate wiring). This phase makes the suite trustworthy; it does not edit
  `.github/workflows/ci.yml`.
- **Not** adding a `Number.isFinite` price guard or a fetch timeout/AbortController — both are
  documented as flagged gaps (research Open Q4, Q5), not implemented here.
- **Not** adding integration/DB tests or e2e — those are §3 Phases 2 and 4.
- **Not** changing P&L formulas, fee handling, or the over-sell contract — those are locked as-is.

## Implementation Approach

Order: cheapest-signal pure-math tests first (Phase 1, where the one production fix also lives),
then the regression guards that depend on the same engine understanding (Phase 2), then the
network-edge boundary which needs a new stub style (Phase 3), then documentation/closeout (Phase
4). Tests are co-located `*.test.ts`, use the existing inline `tx()` / `asset()` `Partial<T>`
factory pattern, derive expected values by hand (spreadsheet-reproducible per the PRD NFR), and
mock only at boundaries. Each math assertion carries a one-line comment showing the manual
derivation so a reviewer can confirm the oracle is requirement-derived, not implementation-copied.

## Critical Implementation Details

- **Determinism in fixtures**: any test constructing same-minute transactions MUST set `created_at`
  to encode causal order (funding BUY before the SELL of its proceeds). The engine sorts by
  `(transaction_date, created_at)` (`pnl-engine.ts:50-54`); a fixture that omits a distinct
  `created_at` will non-deterministically reproduce the phantom-position bug.
- **Epsilon fix needs a magnitude reference**: `PositionEntry` currently has no "gross acquired"
  value, so a *relative* tolerance has nothing to scale against. The fix adds an accumulator (see
  Phase 1, change #4) incremented on every acquisition (DEPOSIT add and target acquisition), and
  `is_closed` becomes `Math.abs(total_quantity) < grossAcquired * EPSILON`. This is the only
  production behavior change in the phase.
- **Network-edge mock (Phase 3)**: existing tests `vi.mock("@/lib/coinpaprika", …)` to mock the
  module. To test `coinpaprika.ts` *itself*, stub `globalThis.fetch` instead (the module's only
  external dependency, `coinpaprika.ts:21`), so the parsing/degradation logic actually runs.

## Phase 1: P&L & average-cost edge cases (Risk #1)

### Overview

Cover the bare average-cost edges with requirement-derived oracles, lock fee-exclusion as a
contract, and fix `is_closed` to tolerate float residue using a relative-magnitude epsilon.

### Changes Required:

#### 1. Multi-location average-cost consolidation test

**File**: `src/lib/pnl-engine.test.ts`

**Intent**: Prove `aggregateByAsset` consolidates the same asset held at two locations with
different per-location average costs into one correct blended `avg_cost_usd`, and that each
location's own `avg_cost_usd` is preserved in the breakdown (FR-013, FR-008).

**Contract**: New `describe("aggregateByAsset")` case. Oracle: consolidated
`avg_cost_usd = (Σ total_cost_usd) / (Σ total_quantity)` (`pnl-engine.ts:143`), with a hand-derived
expected value (e.g. 1 BTC @ 60000 at Binance + 1 BTC @ 64000 at MetaMask → consolidated avg
62000, location avgs 60000 / 64000). Comment must show the arithmetic.

#### 2. Fee-exclusion contract test

**File**: `src/lib/pnl-engine.test.ts` (engine) and `src/lib/portfolio-service.test.ts` (new file, fees total)

**Intent**: Pin the deliberate design that P&L is *gross* of fees and fees are reported only as a
separate total — so a future change cannot silently fold fees into P&L (PRD FR-003 + FR-010).

**Contract**: Two assertions. (a) Engine: two otherwise-identical transaction sets differing only
in `fee` produce identical `realized_pnl` / `total_cost_usd` / `quantity` (engine never reads
`tx.fee`). (b) `portfolio-service.ts:24`: `total_fees_usd` equals the raw sum of `tx.fee` across
all transactions, independent of P&L. `portfolio-service.test.ts` is a new co-located file; it must
mock `@/lib/coinpaprika` `getMultiplePrices` (the only external call in `getPortfolio`) so the
fee/aggregation assertions run without network.

#### 3. Zero-but-not-null `price_usd` edge test

**File**: `src/lib/pnl-engine.test.ts`

**Intent**: Document that a real `price_usd` of `0` is NOT treated as unpriced — a DEPOSIT at price
0 adds 0 cost, and a disposal at price 0 realizes a full loss against average cost — distinguishing
it from the `null` "unpriced" path.

**Contract**: Two cases. DEPOSIT with `price_usd: 0` → quantity added, `total_cost_usd` 0, not in
`unpriced`. SELL with `price_usd: 0` against an existing avg cost → `realized_pnl = source_quantity
× (0 − avgCost)` (full loss). Contrast with the existing `price_usd: null` → `unpriced` case
(`pnl-engine.test.ts:281`).

#### 4. `is_closed` relative-epsilon fix + test

**File**: `src/lib/pnl-engine.ts` (production fix) and `src/lib/pnl-engine.test.ts` (test)

**Intent**: A fully-sold position currently can read as still-open because average-cost subtraction
(`:78`) leaves float residue and `is_closed` uses strict `=== 0` (`:144`). Fix with a tolerance
relative to the position's processed magnitude (scale-safe across BTC vs SHIB), and test the
residue scenario.

**Contract**: Add a per-position gross-acquired-quantity accumulator to `PositionEntry`
(`pnl-engine.ts:3-9`), incremented wherever quantity is added (DEPOSIT, `:64`; target acquisition,
`:89`). In `aggregateByAsset`, sum it per asset and set
`is_closed = Math.abs(total_quantity) < grossAcquired * EPSILON` with `EPSILON = 1e-9` (module
const). The accumulator is internal engine state and need not appear on the public `AssetSummary`
unless a test needs it. Test: a BUY then a full SELL of the same quantity, constructed so the
running quantity leaves a sub-`1e-9`-relative residue, asserts `is_closed === true` and
`total_quantity` ≈ 0; and a genuine dust holding (above the relative threshold) asserts
`is_closed === false`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- New tests fail if reverted against the pre-fix `is_closed` (sanity: the residue test is red on
  the old strict `=== 0`).

#### Manual Verification:

- Each new math assertion carries a comment deriving the expected value from the Average-Cost
  requirement (not copied from a prior run).
- A sold-out position with float residue shows as closed in the portfolio UI.

**Implementation Note**: After automated verification passes, pause for human confirmation of the
manual checks before Phase 2.

---

## Phase 2: Crypto-to-crypto quantity & ordering regressions (Risk #2)

### Overview

Guard the regressions that already bit us — the crypto-to-crypto USD derivation (in-lib mirror of
the form bug) and the same-minute-tie phantom position — plus the over-sell clamp contract.

### Changes Required:

#### 1. `resolvePriceUsd` crypto-to-crypto ↔ engine reconciliation test

**File**: `src/lib/transaction-service.test.ts`

**Intent**: Prove the crypto-to-crypto branch derives the source USD price correctly and that the
value reconciles with the cost basis the engine then computes — the in-lib guard for the
"120,000 ETH" class of bug (commits `98aaccf`, `f2705e3`).

**Contract**: Extend the existing `vi.mock("@/lib/coinpaprika")` suite. For a SWAP/SELL where the
target is a non-stablecoin, mock `getPriceForDate(target)` and assert `resolvePriceUsd` returns
`(targetQuantity × targetUsdPrice) / sourceQuantity` (`transaction-service.ts:84`). Then feed a
transaction carrying that resolved `price_usd` into `computePositions` and assert the acquired
target cost basis equals `source_quantity × price_usd` (`pnl-engine.ts:88`) and equals
`targetQuantity × targetUsdPrice` — i.e. the two formulas agree. Cover the target-stablecoin branch
(`:74-75`, non-positive → null) and source-stablecoin branch (`:71`, → 1).

#### 2. Same-minute tie / phantom-position regression test

**File**: `src/lib/pnl-engine.test.ts`

**Intent**: Lock the lessons.md (b) fix — a BUY and a same-minute SELL must not produce a phantom
position or drop the SELL's realized P&L regardless of DB row order, because the engine sorts by
`(transaction_date, created_at)`.

**Contract**: Construct a funding BUY and a same-`transaction_date` SELL with `created_at` ordered
BUY-before-SELL, but pass them to `computePositions` in reverse array order. Assert the SELL's
realized P&L is recorded (not 0) and the resulting position is correctly reduced (no phantom
quantity). A second case with `created_at` also reversed documents the failure mode the tiebreaker
prevents. (`pnl-engine.ts:50-54,73`.)

#### 3. Over-sell clamp contract test

**File**: `src/lib/pnl-engine.test.ts`

**Intent**: Document that the engine clamps an unfunded disposal — it records realized `0` and does
not drive quantity negative — distinct from the write-time `409` guard.

**Contract**: A SELL/WITHDRAW against a zero or insufficient position asserts `realizedByTx` for
that tx id is `0` (`pnl-engine.ts:83`), quantity is not negative, and (for a SWAP) the acquisition
arm still credits the target if present (`:86`). Reference only — do not assert the `409` here
(that is the service path, Phase 2 of the rollout / integration).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- The phantom-position test is red if the engine sort drops the `created_at` tiebreaker (sanity).

#### Manual Verification:

- The reconciliation test's expected values are hand-derived from a worked crypto-to-crypto example
  (e.g. sell 2 BTC for ETH at known USD prices), matching the "120,000 ETH" scenario shape.

**Implementation Note**: Pause for human confirmation before Phase 3.

---

## Phase 3: Price-API boundary degradation (Risk #5)

### Overview

Give `coinpaprika.ts` its first direct tests by stubbing `fetch` at the network edge, proving the
boundary degrades to `null`/HTTP 400 without fabricating a price, crashing, or emitting NaN — and
documenting the two residual gaps (NaN-on-malformed-200, missing timeout).

### Changes Required:

#### 1. Network-edge `fetch` stub + `coinpaprika.ts` degradation tests

**File**: `src/lib/coinpaprika.test.ts` (new file)

**Intent**: Prove every failure mode (non-200 incl. 429, network throw, malformed body) collapses
to `null`/`[]` and never throws or returns a fabricated/NaN price.

**Contract**: New co-located file stubbing `globalThis.fetch` via `vi.stubGlobal`/`vi.fn`. Cases:
(a) `res.ok = false` (e.g. 429) → `getCurrentPrice` / `getHistoricalPrice` return `null`
(`coinpaprika.ts:22`); (b) `fetch` rejects → `null` (`:25`); (c) 200 with a body missing
`quotes.USD.price` → `null` via optional-chaining (`:65`), no throw, no NaN; (d) `searchCoins` with
a body missing `currencies` → `[]` (`:45`). Reset the module price caches between tests (the
`currentPriceCache` / `historicalPriceCache` Maps are process-global, `:12-13`) — use
`vi.resetModules()` + dynamic import, or unique coin ids per test, to avoid cross-test cache bleed.

#### 2. `getMultiplePrices` stale-degradation test

**File**: `src/lib/coinpaprika.test.ts`

**Intent**: Prove the only place that emits a `stale` flag behaves correctly on partial failure —
expired-but-cached prices are kept and flagged stale; an asset with no cache entry that fails is
silently omitted (not null, not NaN).

**Contract**: Seed a cache entry, force its TTL expiry, make the refetch fail for that id, and
assert `getMultiplePrices` returns the stale price merged in with `stale: true`, `updated_at: null`
(`coinpaprika.ts:107-122`). A second id with no cache entry that fails is absent from `prices`.
Requires controlling the 120s TTL (`:5,15-17`) — inject/advance time via `vi.useFakeTimers` or by
seeding `fetchedAt`.

#### 3. `resolvePriceUsd` → HTTP 400 / override degradation test

**File**: `src/lib/transaction-service.test.ts`

**Intent**: Prove that when the price API yields `null`, the write path degrades to a clean
resolution failure (caller returns HTTP 400 with the manual-override message), and that a manual
override short-circuits the API entirely.

**Contract**: With `getPriceForDate` mocked to `null`, `resolvePriceUsd` returns `null`
(`transaction-service.ts:88-89`) — the 400 mapping itself lives in `createTransaction:125-131` and
is asserted at the resolver level here (resolver returns null; document that the caller maps it to
400). With a truthy `override`, assert the API is never called and the override is returned
(`:59`). These extend the existing DEPOSIT/WITHDRAW override cases.

#### 4. Document the residual boundary gaps

**File**: `context/foundation/lessons.md`

**Intent**: Record the two boundary gaps this phase deliberately does not fix, so they have an
owner: (a) `coinpaprika.ts` casts responses `as T` with no `Number.isFinite` guard — a non-number
price in a 200 body could propagate NaN into P&L; (b) no `fetch` timeout/AbortController, so a hung
socket can hang the request indefinitely (observability/infra follow-up).

**Contract**: One appended lessons.md entry (Context / Problem / Rule / Applies-to) covering both
gaps, citing `coinpaprika.ts:19-27,23,65`. No production change.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- No test makes a real network call (CI has no CoinPaprika access) — verified by the `fetch` stub
  being asserted-called.

#### Manual Verification:

- A simulated outage in the running app still lets the user submit a transaction via manual price
  override (stablecoin-side or one-sided), and shows no NaN in P&L.

**Implementation Note**: Pause for human confirmation before Phase 4.

---

## Phase 4: Cookbook & closeout

### Overview

Fill the `test-plan.md` cookbook stubs this phase can now answer, record the phase note, and mark
the rollout row complete.

### Changes Required:

#### 1. Fill cookbook §6.1 (unit) and §6.5 (price-API boundary)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD` stubs with the canonical "how to add a test for X here" answer this
phase established (test-plan §6 contract).

**Contract**: §6.1 — location (co-located `src/lib/*.test.ts`), naming (`*.test.ts`), the inline
`tx()`/`asset()` `Partial<T>` factory pattern, oracle-from-requirements rule (hand-derived comment,
never copy the implementation's return), reference test (`pnl-engine.test.ts`), run command
(`npm test`). §6.5 — mock at the network edge by stubbing `globalThis.fetch` (not the module),
assert degradation/`null` and the parsing contract, reset the module caches between tests, never
assert live prices; reference test (`coinpaprika.test.ts`).

#### 2. Per-phase note (§6.6)

**File**: `context/foundation/test-plan.md`

**Intent**: 2–3 line note capturing what the phase taught (the `created_at` determinism trap; the
process-global price-cache bleed; the form-site Risk #2 gap).

**Contract**: Append to §6.6.

#### 3. Mark §3 Phase 1 complete

**File**: `context/foundation/test-plan.md`

**Intent**: Advance the rollout state so re-running `/10x-test-plan` picks up Phase 2.

**Contract**: §3 row 1 Status → `complete`; bump the `Last updated:` header date.

### Success Criteria:

#### Automated Verification:

- Full suite still green: `npm test`
- Linting passes (markdown/format): `npm run lint`
- `test-plan.md` §6.1 and §6.5 no longer contain `TBD`; §3 Phase 1 Status reads `complete`.

#### Manual Verification:

- §6.1/§6.5 read as actionable instructions a new contributor could follow without re-deriving the
  pattern.

**Implementation Note**: Final phase — on completion, the change is ready for `/10x-impl-review`
then `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- Average-cost consolidation across locations; fee-exclusion contract; zero-vs-null `price_usd`;
  `is_closed` relative-epsilon residue + genuine-dust cases.
- Crypto-to-crypto `resolvePriceUsd` ↔ engine cost-basis reconciliation; same-minute-tie phantom
  position; over-sell clamp records 0.
- `coinpaprika.ts` degradation (429/network/malformed → null/[]); `getMultiplePrices` stale flag;
  `resolvePriceUsd` → null/400 and override short-circuit.

### Integration Tests:

- None in this phase — persistence + isolation are §3 Phase 2 (local Supabase).

### Manual Testing Steps:

1. Sell a full position and confirm the asset shows as closed in the portfolio (is_closed fix).
2. With the network blocked, submit a one-sided / stablecoin-side transaction via manual override;
   confirm success and no NaN P&L.
3. Spot-check one new reconciliation test's expected value against a hand spreadsheet.

## Performance Considerations

None — unit tests on pure functions. Watch only for process-global price-cache bleed between
`coinpaprika.ts` tests (reset modules or use unique ids).

## Migration Notes

The single production change (`is_closed` epsilon + gross-acquired accumulator) is additive to
engine internals; no data migration. Existing `is_closed` tests asserting strict closure on exact
zero remain valid (`Math.abs(0) < x` holds).

## References

- Related research: `context/changes/testing-pnl-trade-math/research.md`
- Quality contract: `context/foundation/test-plan.md` (§2 rows #1/#2/#5; §3 Phase 1; §6.1/§6.5)
- Lessons: `context/foundation/lessons.md` (cost-basis-vs-form-price; deterministic ordering)
- Engine: `src/lib/pnl-engine.ts:40-95,112-148`; resolver `src/lib/transaction-service.ts:48-90`;
  boundary `src/lib/coinpaprika.ts:19-129`
- Regression commits: `98aaccf` (form quantity), `f2705e3` (resolvePriceUsd crypto-to-crypto)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: P&L & average-cost edge cases (Risk #1)

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — ee505a5
- [x] 1.2 Type checking passes: `npx astro check` — ee505a5
- [x] 1.3 Linting passes: `npm run lint` — ee505a5
- [x] 1.4 is_closed residue test is red against the pre-fix strict `=== 0` — ee505a5

#### Manual

- [x] 1.5 Each new math assertion derives its expected value from the Average-Cost requirement — ee505a5
- [x] 1.6 A sold-out position with float residue shows as closed in the portfolio UI — ee505a5

### Phase 2: Crypto-to-crypto quantity & ordering regressions (Risk #2)

#### Automated

- [x] 2.1 Unit tests pass: `npm test`
- [x] 2.2 Type checking passes: `npx astro check`
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Phantom-position test is red if the `created_at` tiebreaker is dropped

#### Manual

- [x] 2.5 Reconciliation expected values are hand-derived from a worked crypto-to-crypto example

### Phase 3: Price-API boundary degradation (Risk #5)

#### Automated

- [ ] 3.1 Unit tests pass: `npm test`
- [ ] 3.2 Type checking passes: `npx astro check`
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 No test makes a real network call (fetch stub asserted-called)

#### Manual

- [ ] 3.5 Simulated outage still allows manual-override submission with no NaN P&L

### Phase 4: Cookbook & closeout

#### Automated

- [ ] 4.1 Full suite still green: `npm test`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 §6.1/§6.5 contain no `TBD`; §3 Phase 1 Status reads `complete`

#### Manual

- [ ] 4.4 §6.1/§6.5 read as actionable instructions a new contributor could follow
