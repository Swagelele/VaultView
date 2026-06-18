# P&L and Trade-Math Correctness — Plan Brief

> Full plan: `context/changes/testing-pnl-trade-math/plan.md`
> Research: `context/changes/testing-pnl-trade-math/research.md`

## What & Why

Rollout Phase 1 of `test-plan.md` §3 — harden the `src/lib` Vitest suite against the three
highest-priority risks: wrong P&L/average-cost numbers (#1), crypto-to-crypto quantity corruption
(#2, "we were already burned here"), and price-API failure fabricating or NaN-ing a price (#5).
The PRD guardrail is blunt: "wrong numbers are worse than no numbers." Every assertion's oracle is
the Average-Cost requirement, never the code's current return value.

## Starting Point

The P&L engine (`pnl-engine.ts`) + price resolver (`transaction-service.ts`) already have ~40
passing `it` blocks covering the happy paths (weighted average, SELL/WITHDRAW realized P&L, SWAP,
DEPOSIT cost basis, dashboard totals). This phase fills the *edge* gaps those tests leave open, not
greenfield coverage.

## Desired End State

`npm test` green with new requirement-derived edge/regression tests; a sold-out position correctly
reads as closed despite float residue; the crypto-to-crypto USD derivation is proven to reconcile
with the engine's cost basis; the price boundary is proven to degrade to `null`/HTTP 400 without
fabricating a price, crashing, or emitting NaN; and `test-plan.md` §6.1/§6.5 document how to add
unit and price-boundary tests here.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Risk #2 guard site | Test in-lib `resolvePriceUsd` mirror only | The shipped bug lives in `TransactionForm.tsx`, outside the unit layer; guard the closest reachable path and document the form gap | Research → Plan |
| `is_closed` float residue | Fix now with a relative epsilon + test | A sold-out position reading as open is a real correctness edge worth closing in this phase | Plan |
| Epsilon kind | Relative to gross-acquired magnitude (×1e-9) | Scale-safe across 1 BTC vs millions of SHIB; a fixed absolute masks dust or misses large-qty residue | Plan |
| Price-API NaN gap | Test degradation; document NaN gap (no guard added) | Prove the no-fabricate/no-crash contract now; the malformed-200→NaN path is unobserved, flagged for follow-up | Research → Plan |
| Fee handling | Lock gross-of-fee as a contract test | Pins a deliberate PRD design so a future change can't silently fold fees into P&L | Research → Plan |
| Timeout/hang | Document as infra follow-up | Not exercisable at the unit layer; surfaced for the right owner rather than forced in | Research → Plan |

## Scope

**In scope:** edge/regression unit tests for Risks #1/#2/#5; one production fix (`is_closed`
relative-epsilon + a gross-acquired accumulator); a new `fetch`-edge stub for `coinpaprika.ts`;
filling cookbook §6.1/§6.5; documenting NaN + timeout gaps in `lessons.md`.

**Out of scope:** writing the test code (that's `/10x-implement` or `/10x-tdd`); any
`TransactionForm.tsx` / React component test or refactor; CI YAML / commit-hook wiring (§3 Phase
3); integration/DB and e2e (§3 Phases 2, 4); adding a `Number.isFinite` guard or fetch timeout;
changing P&L formulas, fee handling, or the over-sell contract.

## Architecture / Approach

Cheapest-signal pure-math tests first (Phase 1, where the lone production fix also lives), then the
regression guards sharing that engine understanding (Phase 2), then the network-edge boundary that
needs a new `fetch`-stub style (Phase 3), then cookbook/closeout (Phase 4). Co-located `*.test.ts`,
existing inline `Partial<T>` factory pattern, hand-derived expected values with a derivation
comment, mock only at boundaries.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. P&L edge + is_closed fix | Consolidation, fee-exclusion, zero-price, epsilon fix + tests | Epsilon needs a magnitude reference (engine state change) |
| 2. Quantity & ordering regressions | Crypto↔crypto reconciliation, phantom-position, over-sell clamp | Same-minute fixtures must set `created_at` or they self-sabotage |
| 3. Price-API boundary | First direct `coinpaprika.ts` tests; degradation + stale flag | Process-global price-cache bleed between tests |
| 4. Cookbook & closeout | Fill §6.1/§6.5, mark §3 Phase 1 complete | None material (docs) |

**Prerequisites:** Vitest already configured; no new tooling. **Estimated effort:** ~2 sessions
across 4 phases (3 test phases + 1 docs).

## Open Risks & Assumptions

- Assumes fee-exclusion is intentional per the PRD (gross P&L + separate fee total) — locked as a
  contract; flag if product intent differs.
- The Risk #2 form burn site (`TransactionForm.tsx`) remains uncovered by design — a documented
  gap for a later component/e2e phase, not closed here.
- NaN-on-malformed-200 and missing-fetch-timeout are documented, not fixed — owned as follow-ups.

## Success Criteria (Summary)

- A user can trust every P&L/average-cost number, a sold-out position reads as closed, and a
  crypto-to-crypto trade can never re-introduce the "120,000 ETH" quantity bug at the resolver
  level.
- A price-API outage degrades cleanly (manual override still works, no fabricated/NaN price).
- A new contributor can add a unit or price-boundary test by following §6.1/§6.5.
