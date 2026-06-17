---
change_id: transaction-list-filters
roadmap_id: S-04
title: Lista transakcji z filtrami
status: archived
created: 2026-06-17
updated: 2026-06-17
archived_at: 2026-06-17T12:47:09Z
prd_refs: [FR-011]
---

# Change: transaction-list-filters

## Identity

Roadmap slice **S-04** — a transaction list view with filters by type (BUY/SELL/SWAP/DEPOSIT/WITHDRAW), location, and asset (PRD FR-011).

## Outcome

The user can open a dedicated `/transactions` page and browse their full transaction history, narrowing it with AND-combined filters for type, location, and asset. Each row shows core trade fields plus a computed per-transaction realized P&L.

## Prerequisites

- S-01 (`core-trade-and-portfolio`) — done. Provides the `transactions` table, the `GET /api/transactions` endpoint, the P&L engine, and the UI conventions this change builds on.

## Links

- Plan: `context/changes/transaction-list-filters/plan.md`
- Brief: `context/changes/transaction-list-filters/plan-brief.md`
- Roadmap: `context/foundation/roadmap.md` (S-04)
