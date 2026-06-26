# Portfolio History Chart — Plan Brief

> Full plan: `context/changes/portfolio-history-chart/plan.md`
> Frame brief: `context/changes/portfolio-history-chart/frame.md`

## What & Why

Add a line chart above the portfolio showing how it behaved over time — total **value** and total **earned P&L** (incl. already-withdrawn profit). The actual problem, per the frame: this is **a historical-valuation data source that doesn't exist today**, not a chart widget — the chart is the easy last mile.

## Starting Point

The whole P&L system is present-tense: `getPortfolio` replays transactions and marks to **current** prices only. No snapshot table, no "value at past date" engine, no time-series type or endpoint. But the inputs exist — date-sorted ledger, `realizedByTx`, a one-line-away CoinPaprika range fetch, and a hand-rolled SVG charting precedent (S-09).

## Desired End State

Above the portfolio, a chart defaulting to **Value / 365d** with a **Value ↔ Total P&L** toggle and **1d/15d/30d/180d/365d** range buttons that zoom one daily series client-side. The final point ticks live with the existing 20s price refresh. Built by reconstructing the series on each request from the transaction ledger — no new table.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| What the P&L curve plots | Total earned = cumulative realized + unrealized per day | Most honest "how did I do"; unrealized half nearly free given the value curve already needs historical prices | Plan |
| Data strategy | Reconstruct-on-read, no table | No migration/cron; range fetch makes it ~N calls; always consistent with edits | Frame → Plan |
| Charting | Hand-rolled SVG | Zero new deps, smallest workerd bundle, matches S-09 | Plan |
| Live final point | Fetch series once; recompute today client-side from existing price poll | Avoids the 365×N re-fetch trap; reuses live `assets` totals | Plan |
| Range selector | 1d/15d/30d/180d/365d zooming one daily series | One fetch powers every range; "1d" = yesterday close + live point | Plan |
| Missing historical price | Counts as 0 that day | User's explicit choice; simplest (note: produces visible dips — see risks) | Plan |

## Scope

**In scope:** range-fetch + cache reshape in `coinpaprika.ts`; pure reconstruction engine (`portfolio-history.ts`); history service + `GET /api/portfolio/history`; SVG chart with metric toggle + range zoom wired into `PortfolioView`.

**Out of scope:** snapshot table/cron/migration; intraday/hourly data; charting library; carry-forward price fill; per-asset/per-location historical breakdown; changes to existing `/api/portfolio` or the P&L engine outputs.

## Architecture / Approach

Bottom-up, four layers: **(1)** `getHistoricalPriceSeries` turns one CoinPaprika call into a date→price map per asset; **(2)** a pure engine walks each day, maintaining a running average-cost `PositionMap` (reusing `pnl-engine` math) and emitting `{date, value, realized, unrealized, total_pnl}`; **(3)** a service assembles per-asset series + runs the engine behind an authed endpoint; **(4)** a hand-rolled SVG chart whose last point is overridden by `PortfolioView`'s live totals so it ticks without re-fetching.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Price series fetch | One-call/asset year range + cache back-fill | Must not regress the `limit=1` single-day path |
| 2. Reconstruction engine | Daily value + P&L series, pure + tested | Arithmetic correctness (PRD guardrail); day-ordering |
| 3. Service + endpoint | `GET /api/portfolio/history` | Call volume; propagate DB errors (don't swallow) |
| 4. Chart UI | SVG chart, toggle, range zoom, live point | Live-point/server-point seam; SVG edge cases (negative, flat, <2 pts) |

**Prerequisites:** none — builds entirely on existing `transactions` + CoinPaprika.
**Estimated effort:** ~3-4 implement sessions across 4 phases.

## Open Risks & Assumptions

- **Missing price = 0** (chosen): assets older than CoinPaprika's 1-year window or with gaps produce visible dips/cliffs in both curves. Mitigation is honesty, not smoothing — an "N assets had no price on some days" note. Carry-forward fill is a clean future refinement if the dips annoy.
- **Live "today" point is recomputed client-side**, so today's valuation math is lightly duplicated between server (daily close) and client (live tick); both share the same per-asset cost basis, so the seam is continuous.
- CoinPaprika historical depth is exactly 1 year — the 365d range is the hard ceiling, not a choice.

## Success Criteria (Summary)

- User sees value and total-P&L curves above the portfolio, can toggle metric and zoom range, and watches the final point move with live prices.
- Engine unit tests reproduce hand-computed value + P&L for a DEPOSIT/SELL/WITHDRAW fixture (arithmetic guardrail).
- A full chart load costs ~N CoinPaprika calls; the 20s refresh costs zero.
