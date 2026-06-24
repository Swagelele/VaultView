---
title: "Project Map — Artifact 1: Territory"
created: 2026-06-23
type: repo-map-artifact
source: git history (all 80 commits, 2026-06-08 .. 2026-06-23)
method: git log --name-only, noise-filtered, co-change pairs
---

# Territory — where VaultView actually lives

> Wide Scan, signal source 1 of 3. Built from git history only — no code read yet.
> History window = entire repo life (~2 weeks, 80 commits). "Active vs frozen"
> is therefore weak here; treat activity as "where build effort concentrated."

## Activity ranking (code only — docs/process churn excluded)

Noise filtered: `context/`, `.claude/`, lockfiles, `dist/`, `.astro/`, configs.

| File | Changes | Role (hypothesis) |
| --- | --- | --- |
| `src/lib/transaction-service.ts` | 11 | **Hub** — persistence + orchestration of trades |
| `src/components/portfolio/TransactionForm.tsx` | 11 | Main write UI (all 5 tx types) |
| `src/components/portfolio/PortfolioTable.tsx` | 6 | Per-asset consolidated view |
| `src/lib/pnl-engine.ts` (+ test, 5) | 5 | Average-cost P&L calculation |
| `src/pages/dashboard.astro` | 5 | Protected entry page |
| `src/lib/schemas.ts` | 5 | Zod validation contract |
| `src/components/portfolio/PortfolioView.tsx` | 5 | Portfolio island wrapper |
| `src/types.ts` | 4 | Shared types |
| `src/middleware.ts` | 4 | Auth gate / route protection |

**Hot zones (dir level):** `src/lib` (55), `src/components/portfolio` (32),
`src/pages` (28), `src/pages/api` (15).

> Caveat (lesson's "is it hot because core or because it keeps breaking?"):
> with only 2 weeks of history we can't separate steady-core from churn. The
> co-change + structure signals below disambiguate.

## Co-change — what moves together (hidden coupling)

| Pair | Co-changes | Reading |
| --- | --- | --- |
| `schemas.ts` ⟷ `transaction-service.ts` | 5 | **Contract coupling** — schema drives the service |
| `transaction-service.ts` ⟷ `pages/api/transactions.ts` | 3 | Service ↔ its HTTP entry point |
| `transaction-service.ts` ⟷ `pnl-engine.ts` | 3 | Service consumes the P&L engine |
| `pnl-engine.ts` ⟷ `pnl-engine.test.ts` | 3 | Healthy test-with-source coupling (cheap) |
| `PortfolioTable.tsx` ⟷ `PortfolioView.tsx` | 3 | UI pair, render together |
| auth pages (signin/signup/confirm/dashboard) | 2 each | Self-contained auth corridor |

**`transaction-service.ts` is the hub**: it co-changes with the schema, the API
route, the P&L engine, and its own test. Touch it and the blast radius reaches
validation, transport, and calculation at once.

## What this means for the map

- **Center of gravity:** the `TransactionForm → /api/transactions →
  transaction-service → pnl-engine` write spine. Most likely Deep Focus (L3) target.
- **Contract seam to watch:** `schemas.ts` ↔ `transaction-service.ts` ↔ `types.ts`
  (Zod schema, service, shared types must agree).
- **Separate corridor:** auth (middleware + auth pages/api) — clusters on its own,
  low coupling to the trade core.

## Unknowns (for later steps)
- Is `transaction-service.ts` hot because it's genuinely central, or because the
  data model kept shifting early? (structure graph + L3 trace will tell)
- Does anything change *that should* but doesn't co-change here? (history can't show this)
