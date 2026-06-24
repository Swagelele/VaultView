---
title: "Project Map — Artifact 2: Structure"
created: 2026-06-23
type: repo-map-artifact
tool: dependency-cruiser 17.4.3
scope: src/ (TS/TSX). NOTE: .astro pages are not parsed by depcruise, so
       page-level imports are absent from this graph — tracked as unknown.
method: depcruise --no-config --ts-config tsconfig.json, cycles + metrics
---

# Structure — how VaultView is wired

> Wide Scan, signal source 2 of 3. Static import graph: 54 modules, 95 deps.

## Cycles
**None.** `no-circular` validation passed cleanly across all 54 modules.
No tangled import loops to worry about — unusual and good for a 2-week-old repo.

## Load-bearing foundations (high afferent coupling Ca)

These are depended-upon by many; a change here radiates widely.

| Module | Ca | I% | Role | Blast radius |
| --- | --- | --- | --- | --- |
| `src/lib/utils.ts` | 16 | 0% | `cn()` Tailwind helper | Widest — all UI |
| `src/lib/supabase.ts` | 9 | 10% | Server Supabase client | DB-touching code |
| `src/lib/api-helpers.ts` | 7 | 0% | API route plumbing | All API routes |
| `src/lib/format.ts` | 5 | 0% | Number/currency formatting | UI + tables |

## The architectural center

| Module | Ca | Ce | I% | Reading |
| --- | --- | --- | --- | --- |
| `src/lib/transaction-service.ts` | 5 | 3 | 38% | **Hub** — consumed by 5, consumes 3 |
| `src/lib/pnl-engine.ts` | 2 | 0 | 0% | **Pure core** — depended on, depends on nothing |
| `src/lib/schemas.ts` | 3 | 0 | 0% | Validation contract (Zod) |
| `src/lib/coinpaprika.ts` | 4 | 0 | 0% | Pricing API client (external dep boundary) |

**Hub downstream:** `transaction-service → coinpaprika + pnl-engine + schemas`.
Orchestration depends on pricing + calculation + validation. Clean separation.

**Confirms territory:** `transaction-service.ts` is hot in git (11 changes) because
it is the real center (Ca=5), not because it keeps breaking. Unknown resolved.

## Test-risk signal (from instability)

- `pnl-engine.ts` (I=0%, no outgoing deps) → **trivially unit-testable in isolation**.
  Pure average-cost math. (Tests exist: `pnl-engine.test.ts`.)
- `transaction-service.ts` (I=38%) → drags in `coinpaprika` (network) and Supabase →
  needs **mocking or integration tests**. Harder to cover; higher refactor risk.
- UI leaves (I=100%: `TransactionForm`, `PortfolioView`, pages) → end-of-chain
  consumers; changes here don't radiate, but they're hard to unit-test (pull 4–7 deps).

## Unknowns
- `.astro` pages (`dashboard.astro`, auth pages) are invisible to depcruise — their
  imports into `src/lib` / `src/components` are real but unmeasured here.
- Runtime-only wiring (Astro islands hydration, middleware injection) not captured
  by static import graph.
