# DEPOSIT with Historical Cost Basis (S-05) — Plan Brief

> Full plan: `context/changes/deposit-historical-cost/plan.md`

## What & Why

Let a user DEPOSIT **any** asset they already hold (not just stablecoins), with cost basis derived from CoinPaprika's historical price at the original purchase date and a manual override always available. This is the core of PRD **US-04 / FR-005** — recording pre-existing holdings (e.g. "1 BTC bought 3 months ago elsewhere") so they appear in the portfolio with calculable unrealized P&L.

## Starting Point

DEPOSIT is deliberately stubbed for this change: the schema rejects non-stablecoin deposits (_"Use S-05 for other assets"_, `schemas.ts:26-27`) and `resolvePriceUsd` hard-returns `1` for every deposit (`transaction-service.ts:55`). The form's Deposit tab is locked to stablecoins with no price field. The historical-price lookup (`getPriceForDate`, `/api/prices?date=`) and the P&L engine (which already multiplies by `price_usd`) are fully built and reused as-is.

## Desired End State

On the Add Transaction → Deposit tab, a user picks any asset, a quantity, and the original purchase date, sees a suggested cost-basis price for that date (overridable), picks a location, and submits. The deposit stores `price_usd` = the resolved/overridden cost basis, and the portfolio per-asset and summary views show the holding with correct unrealized P&L. Stablecoin deposits behave exactly as before ($1, no price field); future-dated deposits are rejected.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| No historical price (null / >1yr) | Manual cost basis required; block submit until entered | Never invent a basis (PRD arithmetic guardrail); FR-007 mandates override anyway | Plan |
| Stablecoin deposits | Keep $1 shortcut, no price field | Preserves working behavior; avoids ticker noise & a pointless API call | Plan |
| Per-row deposit P&L on `/transactions` | Out of scope — aggregate portfolio only | FR-005 satisfied by the aggregate view; deposits have no target side to mark | Plan |
| Date guard | Block future dates only; any past date allowed | Catches the one nonsensical case without blocking old deposits | Plan |
| Deposit fee | No fee field | A deposit brings in existing holdings, not a trade | Plan |
| Cost-basis bridge | Form sends `source_price_usd_override`; server honors override-first | Reuses existing override plumbing; one path for suggestion + manual | Plan |
| Testing | Unit-test `resolvePriceUsd` + engine deposit path; manual UI | Locks down the PRD-guardrailed arithmetic; no component harness exists | Plan |

## Scope

**In scope:** lift the stablecoin DEPOSIT gate; historical cost-basis resolution with override; future-date guard; deposit form asset picker + suggested/overridable cost-basis field; unit tests for resolution + engine.

**Out of scope:** per-row deposit unrealized P&L on `/transactions`; deposit fees; current-price fallback; engine/migration changes; React component tests; any BUY/SELL/SWAP change.

## Architecture / Approach

Backend-first vertical slice (same shape as `transaction-list-filters`). Phase 1: `schemas.ts` (remove gate + future-date guard) and `transaction-service.ts` (`resolvePriceUsd` DEPOSIT branch: override → stablecoin $1 → `getPriceForDate` → null) with unit tests. Phase 2: `TransactionForm.tsx` deposit branch (unrestricted asset, suggestion effect, cost-basis field, date cap, payload + submit gate). The override is the single bridge between form and server; the engine and portfolio service are untouched.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + cost-basis (backend) | Server accepts & correctly prices any-asset deposits; unit-tested | Override-first ordering in `resolvePriceUsd`; mocking CoinPaprika in tests |
| 2. Deposit form (frontend) | Asset picker, suggested/overridable cost basis, date cap, submit gate | Conditional stablecoin-vs-other branch in one shared form |

**Prerequisites:** S-01 (done). No new deps; `vitest` and the price endpoint already exist.
**Estimated effort:** ~1–2 sessions across 2 phases (LOW–MEDIUM).

## Open Risks & Assumptions

- Assumes CoinPaprika historical coverage is "good enough"; gaps are handled by manual override (by design).
- Live-mark drift (lessons.md): a fresh deposit dated today marks against the current ticker, so unrealized P&L may read slightly non-zero — expected, same as BUY/SELL.
- Assumes the existing `source_price_usd_override` path needs no schema change (verified: already in `baseSchema`).

## Success Criteria (Summary)

- User deposits a non-stablecoin asset with a past date, sees a suggested cost basis, can override it, and the portfolio shows the holding with arithmetically correct unrealized P&L.
- Stablecoin deposits are unchanged ($1, no price field); future-dated deposits are rejected.
- `resolvePriceUsd` and the deposit engine path are covered by passing unit tests.
