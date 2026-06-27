# Frame Brief: Portfolio history chart (value + cumulative P&L over time)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

User wants a chart ("winget"/widget) above the portfolio view showing how the
portfolio behaved over time — a historic P&L / portfolio-value curve, so they
can see performance across time rather than only the present-tense snapshot the
app shows today.

## Initial Framing (preserved)

- **User's stated cause or approach**: This is a chart widget — add a graph
  component above the portfolio. (Implicitly: the data exists, like the S-09 pie
  chart; the work is rendering.)
- **User's proposed direction**: Build the widget and plot the historic P&L.
- **Pre-dispatch narrowing** (Step 1.5):
  - **Curve**: BOTH portfolio-value and cumulative-P&L, with a toggle to switch.
    User's reasoning is load-bearing: profit can be *withdrawn*, so current value
    misrepresents earnings — holding $100 now after withdrawing $5,000 (of which
    $2,000 was profit) should read **+$2,000 earned over time**. The P&L curve must
    accumulate *realized* gains from past sells/withdrawals, not just unrealized.
  - **Window**: last year, daily granularity.
  - **Freshness**: most-recent point is live (tracks current price, 15–30s refresh).

## Dimension Map

The observation could originate at any of these dimensions:

1. **Chart/widget UI** — render a line/area chart above the portfolio.  ← initial framing
2. **Portfolio API response** — currently present-tense only; carries no time axis.
3. **Historical-value engine** — value(T) = Σ holding(T) × price(T); does not exist anywhere.
4. **Historical price source** — CoinPaprika historical (1yr back, daily); per-day-per-asset call cost.
5. **Persistence strategy** — reconstruct-on-read vs. daily snapshot table (the parked decision).

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. The job is mainly the chart widget | One chart precedent exists (`AssetAllocationChart.tsx:19`, hand-rolled SVG, consumes current-state array). No charting lib in package.json. Rendering a line chart is easy — but it has no data to consume. | WEAK (not the locus) |
| 2. API is present-tense only, must gain a time axis | `getPortfolio(supabase, userId)` takes no date (`portfolio-service.ts:15`); response is a current snapshot. No `/api/portfolio-history` endpoint. No `{date, value}[]` type in `types.ts`. | STRONG |
| 3. Historical-value engine is missing | `computePositions()` / `aggregateByAsset()` have no "as-of date" path (`pnl-engine.ts:50,124`); no `getPortfolioAtDate`. Independent (un-primed) agent landed on the same conclusion: "the blocker is steps 1–2: no historical state exists." | STRONG (the real work) |
| 4. Historical price data is the dominant constraint | CoinPaprika `/historical` endpoint natively supports range fetch (`start`,`interval`,`limit`); current code hardcodes `limit=1` (`coinpaprika.ts:142`). One range call per asset (`limit=365`) = **N calls** for a full-year curve (~10 for a typical portfolio) vs **365×N** if the per-day fn is naively looped. 20k/month cap; 1-yr daily depth matches the ask exactly. | WEAK as blocker / it's a known trap |
| 5. Persistence requires a snapshot table | Because the range fetch makes on-read reconstruction cheap (N calls), a snapshot table is **not** required for feasibility. Reconstruct-on-read is viable; snapshot is an optimization, not a prerequisite. | WEAK (decision tilts to reconstruct) |

## Narrowing Signals

Decisive findings that focused the hypothesis space:

- **The two curves have very different costs.** Cumulative **realized** P&L over
  time is reconstructable from the **transaction history alone** — replay the
  date-sorted ledger (`pnl-engine.ts:60-64`) and accumulate `realizedByTx`
  (`:90`) bucketed by `transaction_date` (`types.ts:15`). Zero API calls, no
  schema change. SELL **and** WITHDRAW both flow through the disposal arm, so
  withdrawn profit is already captured — this *directly* satisfies the user's
  "+$2,000 already withdrawn" requirement.
- **The expensive half is the *value* curve** (and the unrealized portion of any
  total-P&L line): it needs each held asset's market price on each past day —
  O(days × distinct held assets) historical lookups. Done right (range fetch)
  this is still cheap; done naively (loop the `limit=1` fn) it is a 365× tier
  trap.
- Realized P&L is **never persisted** — it is recomputed on every read
  (`transaction-service.ts:283-284`). So bucketing it by date is the *same*
  recompute with an accumulator, not new storage.

## Cross-System Convention

The roadmap already anticipated this exact feature and parked it with the
explicit open decision: *"rekonstrukcji wartości portfela per dzień (replay
transakcji × historyczne ceny CoinPaprika) albo tabeli snapshotów bilansu …
decyzja rekonstrukcja vs snapshot trafia do /10x-plan"* (`roadmap.md` Parked).
The investigation's evidence (cheap N-call range fetch) tilts that decision
toward **reconstruct-on-read** — but the choice itself belongs to /10x-plan, not
this brief.

## Reframed Problem Statement

> **The actual problem to plan around is**: building a *historical
> portfolio-valuation data source* that does not exist today — not a chart
> widget. The chart is the easy last mile; the substance is reconstructing
> per-day holdings and valuing them over the last year.

Unlike the S-09 pie chart (pure UI over data already in the response), this
feature has no underlying data. The reframe also splits the work along a sharp
cost line the initial "just a widget" framing hides: the **cumulative
realized-P&L curve** — which is exactly what the user's withdrawn-profit example
demands — is buildable from the transaction ledger alone with no new API cost or
schema, while the **portfolio-value curve** is the part that pulls in historical
price reconstruction (cheap only if a single range call per asset is used, not a
per-day loop).

## Confidence

**HIGH** — strong, file-anchored evidence that the data source is absent
(dimensions 2 & 3); an independent un-primed agent reached the same conclusion;
the cost analysis (dimension 4) is concrete and matches the documented free-tier
limits; and the convention (roadmap Parked note) named this exact decision in
advance.

## What Changes for /10x-plan

Plan a **portfolio-history data source + endpoint + chart**, not a chart alone.
Two decisions are pre-loaded for the plan: (a) **reconstruct-on-read vs. snapshot
table** — evidence tilts to reconstruct, since a per-asset year-range CoinPaprika
call (`limit=365`, not the current `limit=1`) makes on-read cheap (~N calls); and
(b) **scope the cheap half first** — the realized-P&L curve ships from the ledger
with no API/schema cost and already answers the user's stated "how much have I
earned" question, while the value curve adds the historical-price machinery. The
plan must avoid the 365× call-volume trap (never loop the `limit=1` function).

## References

- Source files: `src/lib/portfolio-service.ts:15`, `src/lib/pnl-engine.ts:50,60-64,90,124`,
  `src/lib/coinpaprika.ts:131-151` (esp. `:142` `limit=1`), `src/lib/transaction-service.ts:283-289`,
  `src/types.ts:15-16`, `src/components/portfolio/AssetAllocationChart.tsx:19`,
  `supabase/migrations/` (2 migrations, no snapshot table)
- Roadmap parked item: `context/foundation/roadmap.md` (Parked → "Wykres bilansu w czasie")
- Lessons applied: deterministic `(transaction_date, created_at)` ordering; CoinPaprika
  boundary unguarded failure modes (`context/foundation/lessons.md`)
