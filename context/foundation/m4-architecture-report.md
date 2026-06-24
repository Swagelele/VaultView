---
title: "VaultView — Module 4 Architecture Report (10xArchitect)"
created: 2026-06-23
type: architecture-report
repo: VaultView (m1) — Astro 6 SSR crypto portfolio tracker
git_commit: 392ed25
author: jozk (analysis paired with Claude, 10xDevs Module 4)
---

# VaultView — Architecture Report (Module 4 / 10xArchitect)

A two-pager built entirely from the four Module-4 artifacts, produced on **one repo
end-to-end** so each lesson fed the next. Nothing here is invented — every claim
traces to a cited artifact. The arc: **map the territory → trace one feature →
decide a refactor → read the domain.**

## Artifacts

| # | Element | Artifact | Lesson |
| --- | --- | --- | --- |
| ① | Repository map | `context/map/repo-map.md` (+ 3 working artifacts) | L2 |
| ② | Feature overview + ③ Technical debt | `context/changes/trade-flow-analysis/research.md` | L3 |
| ④ | Refactor opportunities + plan | `context/changes/refactor-opportunities/{research,plan}.md` (+ review) | L4 |
| ⑤ | DDD opportunities | `context/domain/{01-domain-distillation,02-invariant-aggregate-refactor,03-anti-corruption-layer}.md` | L5 |

---

## ① Repository map (Wide Scan)

Built from cheap deterministic signals: git history (activity + co-change), a
`dependency-cruiser` import graph, and authorship. Findings:

- **Center of gravity:** the trade write-spine `TransactionForm → /api/transactions →
  transaction-service → pnl-engine`. `transaction-service.ts` is the hub — both the
  most-edited code file (git) *and* depended-on by 5 modules (graph). Two independent
  signals agreeing.
- **`pnl-engine.ts` is a pure core** (instability 0%): safe to test/refactor in isolation.
- **No import cycles** across 54 modules — a clean graph.
- The `schemas ↔ service ↔ types` contract seam is the most drift-prone area.
- Solo repo → contributor map is degenerate; `context/archive/` serves as the ADR record.

## ② Feature overview (Deep Focus on the trade spine)

VaultView is a **history-replay** system: a write persists one `transactions` row;
**all P&L and cost basis are recomputed on read** by replaying full history through
`pnl-engine.ts`. There is no stored position / lot / cost-basis table. The UI discards
the write response and re-reads `GET /api/portfolio`. The five transaction types
diverge at three points (balance guard, price resolution, one-sided vs two-sided row);
realized P&L is computed at `pnl-engine.ts:86`, cost basis derived at `:99-101`.

## ③ Technical debt (verified with ast-grep)

- **D1 (top):** the transaction shape is hand-defined **three times** (Zod, TS, SQL)
  over an **untyped Supabase client** with 3 `as Transaction` casts → a column rename
  drifts **silently, no compile error**. (ast-grep corrected the cast count 2→3.)
- **D3:** `getTransactionsWithPnl` — the per-lot unrealized-P&L math — has **zero tests**,
  against the PRD guardrail "wrong numbers are worse than no numbers."
- **Map reversal:** `coinpaprika.ts` was flagged as an ACL risk but is the *cleanest*
  part — a working anti-corruption layer (verified: imported only in service/API).
- **Cross-cutting:** CI runs **no tests** (only `tsc`/lint/build) — so the only
  automatic regression net is the type checker.

## ④ Refactor opportunities → decision → plan

The history (intentionality) lens sorted **real debt from deliberate design**:
- **Accidental → candidates:** D1 (triplication/untyped client), D2 (duplicated insert).
- **Deliberate → rejected as refactors:** D4 (coinpaprika guards — documented deferral,
  "guard don't rebuild"), D5 (SWAP UI removed on purpose; WITHDRAW future-date by design).

**Decision (mine, at the `/10x-plan` gate):** implement **D1** (single source of truth
via generated Supabase types) + the **D3** cheap win (test `getTransactionsWithPnl` +
make CI run the unit suite), guard-first, 4 reversible phases; explicitly NOT D2/D4/D5.

**Plan review caught a would-be no-op (F1):** typing `createServerClient<Database>`
alone is *inert* — service fns take the bare `SupabaseClient`, so the generic erases at
the call boundary; the plan now threads `SupabaseClient<Database>` through the
signatures so drift actually fails `tsc`. Verdict after fixes: **SOUND**. The plan is
the deliverable; implementation follows the normal `/10x-implement` cycle.

## ⑤ DDD opportunities (Legacy with DDD)

- **Ubiquitous-language seams:** "position" wears three names with two declarations;
  "price" is one column with two meanings; and the PRD's must-have **FR-009 "per-buy /
  lot" position is MISSING in code** — the engine only does average-cost. A domain gap
  invisible from code alone.
- **Top invariant (02):** *"you cannot dispose more of an asset than you hold at a
  location"* is split across 5 layers and guarded by **two reducers that can disagree**
  (`getHoldingAtLocation` unclamped sum vs `computePositions` fail-soft clamp). Proposed:
  a `LocationHolding` **guardian aggregate** over one canonical reducer, throwing a named
  `InsufficientHoldingError` (fail-fast).
- **Anti-Corruption Layer (03):** verified the CoinPaprika *client* is already clean and
  declined to pick it; the real leak is the **coin-id convention** (`usdt-tether` shape +
  stablecoin set) bleeding into 5 layers and frozen into indexed DB columns. Proposed:
  an `AssetId` value object + `AssetCatalogPort`, with a grep-checkable isolation criterion.

---

## Synthesis — what these add up to

Three independent passes (debt, refactor, domain) converge on **one finding from three
angles**: the persisted `Transaction` — the single input every P&L number replays from —
has no authoritative shape. L3 saw it as silent type drift; L4 ranked it #1 and planned
the fix; L5 named it the core distillation gap. That convergence is the strongest signal
in the report: **the highest-leverage next change is to give `Transaction` one source of
truth, then build the `LocationHolding` aggregate on top of the now-trustworthy type.**

The DDD artifacts are the **fuel for the next cycle**: `02` and `03` are near-ready
`/10x-plan` inputs (phased, with before/after and test cases), and the FR-009 "per-buy
position" gap is a `/10x-shape` candidate. The same toolkit that delivered the MVP now
runs on domain-grounded inputs instead of guesses.

## Method note

AI acted as **analyst, not decider**: CLIs (`git`, `dependency-cruiser`, `ast-grep`)
gathered deterministic evidence, agents interpreted, and the refactor decision + plan-
review triage were mine. Structural counts were verified with `ast-grep` (and every zero
cross-checked with `grep`) — which caught a real undercount. All four artifacts are on
the same repo, so they chain rather than stand alone.
