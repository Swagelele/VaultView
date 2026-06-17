# Asset Allocation Pie/Donut Chart — Plan Brief

> Full plan: `context/changes/asset-allocation-pie/plan.md`

## What & Why

Add a read-only asset-allocation donut chart to the portfolio dashboard (roadmap S-09, FR-014) showing each asset's share of total current portfolio value. It completes the portfolio-views experience with an at-a-glance picture of concentration — a current-state snapshot, no time dimension.

## Starting Point

`PortfolioView.tsx` already holds live `assets: PortfolioAsset[]` state (refreshed every 20s) and renders `<SummaryCards>` + `<PortfolioTable>` in a vertical stack. Each asset carries `total_quantity` and `current_price_usd`; current value is `quantity × price` (computed inline in the table today). No charting library is installed.

## Desired End State

A full-width card between the summary cards and the holdings table shows a donut: total priced value in the center, one uniquely-colored slice per priced asset, and a legend with swatch + symbol + value + % share. Unpriced assets are excluded (with a note); empty portfolios show a friendly message; a single asset renders a full ring. The chart updates live on the existing 20s price refresh.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Rendering | Hand-rolled SVG donut | Zero new dependencies; keeps the Cloudflare Workers bundle lean and gives full control over dark-theme styling. | Plan |
| Layout | Full-width card below summary cards | Fits the existing `space-y-4` vertical stack with no grid rework and room for a legend. | Plan |
| Colors | Unique generated color per asset (golden-angle HSL), no cap | User requirement: every asset gets its own distinct color regardless of count; the 5 theme tokens were only a default, not a limit. | Plan |
| Edge cases | Exclude unpriced; graceful fallbacks | Keeps the math honest (slices sum to 100% of priced total) and avoids crashes on empty/single/unpriced portfolios. | Plan |
| Center + labels | Total value in center, % in legend | One-glance headline number plus detail without cluttering slices. | Plan |
| Structure | Pure tested helpers in `src/lib/` + thin component | Mirrors the proven `computeSummary` → `SummaryCards` pattern; arithmetic verified before pixels. | Plan |

## Scope

**In scope:**
- `computeAllocation` helper (value, fraction, sort, exclusion) + unit tests
- `allocationColor` deterministic color generator
- `AssetAllocationChart` SVG donut + legend component
- Mount in `PortfolioView` below the summary cards

**Out of scope:**
- Time-series / balance-over-time chart (v2)
- Any API/schema/migration/P&L-engine change
- Charting-library dependency
- Per-location allocation breakdown; drill-down/click interactivity

## Architecture / Approach

Pure helpers in `src/lib/` (`asset-allocation.ts`, `chart-colors.ts`) compute the breakdown and colors from the `PortfolioAsset[]` the parent already has. A presentational `AssetAllocationChart` draws the ring with stacked stroked `<circle>` arcs (`stroke-dasharray`/`stroke-dashoffset` over circumference `2πr`) and a legend, wrapped in the existing `Card`. No data fetching of its own — it consumes the parent's live `assets` prop and re-renders on the 20s poll.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Allocation + color helpers | Tested `computeAllocation` + `allocationColor` in `src/lib/` | Fraction/exclusion math must sum to 100% — covered by unit tests |
| 2. Chart component + mount | SVG donut + legend, mounted below summary cards | SVG arc offset math; edge-case states (empty/single/unpriced) |

**Prerequisites:** S-01 (done) — live portfolio data and view layer exist.
**Estimated effort:** ~1 session across 2 phases (small, additive).

## Open Risks & Assumptions

- Assumes `value = total_quantity × current_price_usd` is the correct allocation basis (consistent with the table) — confirmed.
- Golden-angle HSL is assumed to yield visually distinct, theme-consistent colors for realistic asset counts; tune S/L if any clash on the dark background.
- Stale prices flow through unchanged (already surfaced elsewhere in the UI); the chart simply reflects current `assets` state.

## Success Criteria (Summary)

- User sees a donut + legend whose percentages sum to 100% and whose center total matches the summed holding values.
- Unpriced/empty/single-asset portfolios all render sensibly (note / message / full ring).
- Chart stays in sync with the live 20s price refresh; `npm test`, `npm run lint`, `npm run build` all pass.
