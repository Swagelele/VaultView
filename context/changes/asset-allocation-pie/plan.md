# Asset Allocation Pie/Donut Chart Implementation Plan

## Overview

Add a read-only **asset-allocation donut chart** to the portfolio dashboard (roadmap S-09, FR-014). It shows each asset's share of total current portfolio value (`quantity × current price`) as a current-state snapshot — no time dimension. The chart is fed by the `assets` state that `PortfolioView` already holds and refreshes every 20s, so it re-renders live alongside the existing summary cards and table. This is purely additive UI: no API, schema, migration, or P&L-engine changes.

## Current State Analysis

- `PortfolioView.tsx` (`src/components/portfolio/PortfolioView.tsx`) is a single React island. It fetches `/api/portfolio` on mount, stores `assets: PortfolioAsset[]`, and polls `/api/prices` every 20s, recomputing each asset's `current_price_usd` / `unrealized_pnl_usd` in place (lines 57–118). The render tree (lines 149–182) stacks `<SummaryCards>`, a toggle/timestamp row, and `<PortfolioTable>` inside a `space-y-4` container.
- `PortfolioAsset` (`src/types.ts:43–54`) carries everything the chart needs: `asset` (stable id), `symbol`, `total_quantity`, `current_price_usd: number | null`, `is_closed`. **There is no pre-computed current-value or total-portfolio-value field** — the table computes value inline as `total_quantity * current_price_usd` (`PortfolioTable.tsx:78`). The chart will do the same via a shared helper.
- `SummaryCards.tsx` derives its numbers from a pure helper `computeSummary` in `src/lib/portfolio-summary.ts` (unit-tested in `portfolio-summary.test.ts`). This is the established pattern to mirror: **pure compute helper in `src/lib/` + thin presentational component**.
- Reusable primitives: `Card`/`CardContent` (`src/components/ui/card.tsx`, dark-theme `rounded-lg border border-white/10 bg-white/5 p-4`), `formatUsd`/`pnlColor` (`src/lib/format.ts`), `cn` (`src/lib/utils.ts`).
- `global.css` defines only `--chart-1..5` (light + dark). Five tokens is a theme default, **not** a cap — the chart needs a unique color per asset for any asset count, so colors are generated programmatically rather than drawn from these tokens.
- No charting library is installed (no recharts/chart.js/d3). Runtime is Cloudflare workerd — keep the bundle lean; the chart is hand-rolled SVG.
- Tests run via `vitest` (`npm test`). Existing `src/lib/*.test.ts` files establish the unit-test pattern.

### Key Discoveries:

- Mount point: `PortfolioView.tsx:151`, immediately after `<SummaryCards assets={assets} totalFeesUsd={totalFees} />`, inside the `space-y-4` stack. The component receives the same live `assets` prop and re-renders on every price refresh for free.
- Value formula (single source of truth to reuse): `value = total_quantity * current_price_usd`, only meaningful when `current_price_usd !== null && total_quantity > 0`.
- The 20s price polling already drives liveness — the chart needs **no** fetching or polling of its own.
- `lessons.md` arithmetic-correctness rules target the P&L engine; this feature only **displays** existing values, so those rules don't apply. The relevant correctness bar here is: slices sum to exactly 100% of the priced total.

## Desired End State

On the dashboard, a full-width card sits between the summary cards and the holdings table containing a donut chart. The donut hole shows the total current value of priced holdings. Each priced, non-zero asset is a slice with a unique color; a legend lists each asset's color swatch, symbol, current value, and percentage share. Unpriced assets (`current_price_usd === null`) are excluded from the math; if any were excluded, a small note says so. A portfolio with no priced holdings shows a friendly empty message instead of a chart; a single priced asset renders as a full ring at 100%.

Verify by: loading the dashboard with a multi-asset portfolio (donut + legend render, percentages sum to 100%, total in center matches the summed values), with a single asset (full ring), with an unpriced asset (excluded + note shown), and with an empty/all-unpriced portfolio (empty message). `npm test`, `npm run lint`, and `npm run build` all pass.

## What We're NOT Doing

- No time-series / balance-over-time chart (explicitly v2 / parked in roadmap).
- No new API endpoint, DB column, migration, or change to `pnl-engine.ts` / `portfolio-service.ts`.
- No charting-library dependency (recharts/chart.js/d3).
- No per-location allocation breakdown (the donut is per-asset, consolidated across locations — per-location detail stays in the table).
- No interactivity beyond what the legend + static SVG provide (no drill-down, no click-to-filter). Hover tooltips are optional polish, not required.
- No change to the existing 20s polling cadence or the summary-cards/table layout other than inserting the new card.

## Implementation Approach

Follow the `computeSummary` → `SummaryCards` pattern: put all logic in pure, unit-tested helpers in `src/lib/`, then render a thin presentational component. Phase 1 delivers and tests the two pure functions (allocation reduction + color generation). Phase 2 builds the SVG donut + legend component on top of them and mounts it. Splitting this way means the arithmetic (which must sum to 100%) is verified in isolation before any pixels are drawn.

Color generation uses golden-angle hue rotation: `hue = (index * 137.508) mod 360`, with fixed saturation/lightness tuned for the dark theme (e.g. `hsl(hue, 65%, 55%)`). Indexing by the asset's position in a stable, value-sorted allocation list gives each asset a distinct, non-repeating, deterministic color regardless of how many assets exist.

SVG donut geometry: a single circle of radius `r` with `stroke-width` forming the ring; each slice is drawn as an arc using `stroke-dasharray` / `stroke-dashoffset` (circumference `C = 2πr`; slice length `= fraction * C`; offset accumulates around the ring). This avoids per-slice `path` arc math and handles the single-asset (full ring) case naturally.

## Phase 1: Allocation + color helpers

### Overview

Add two pure functions in `src/lib/` plus unit tests: one computes the allocation breakdown from `PortfolioAsset[]`, the other generates a deterministic distinct color per index.

### Changes Required:

#### 1. Allocation compute helper

**File**: `src/lib/asset-allocation.ts` (new)

**Intent**: Reduce `PortfolioAsset[]` to the data the donut needs — total priced value, per-asset value + fraction, sorted largest-first — while excluding assets that can't be valued. Keeps the value formula and exclusion rule in one tested place (mirrors `computeSummary`).

**Contract**: Export a function `computeAllocation(assets: PortfolioAsset[]): AllocationResult` and the supporting types. Suggested shape:

```ts
export interface AllocationSlice {
  asset: string; // stable id (color/key)
  symbol: string;
  value: number; // total_quantity * current_price_usd
  fraction: number; // value / totalValue (0..1); 0 when totalValue === 0
}
export interface AllocationResult {
  slices: AllocationSlice[]; // priced, quantity>0, sorted by value desc
  totalValue: number; // sum of slice values
  excludedCount: number; // held assets dropped for missing price
}
```

Rules: include an asset only when `current_price_usd !== null && total_quantity > 0`; count held assets (`total_quantity > 0`) with `current_price_usd === null` toward `excludedCount`; sort slices by `value` descending; `fraction = totalValue > 0 ? value / totalValue : 0`. No rounding of fractions in the helper (formatting happens in the component).

#### 2. Color generator helper

**File**: `src/lib/chart-colors.ts` (new)

**Intent**: Map a slice index to a unique, deterministic, dark-theme-friendly color so any number of assets each get a distinct swatch/slice.

**Contract**: Export `allocationColor(index: number): string` returning an `hsl(...)` string via golden-angle hue rotation (`hue = (index * 137.508) % 360`, fixed S/L). Pure and stable: same index → same color across slice and legend.

#### 3. Unit tests

**File**: `src/lib/asset-allocation.test.ts` (new)

**Intent**: Lock the allocation arithmetic and edge cases.

**Contract**: Vitest cases covering — multi-asset (fractions sum to 1, sorted desc, totalValue correct); single priced asset (one slice, fraction 1); unpriced held asset excluded and counted in `excludedCount`; zero-quantity / closed assets ignored; empty input (`slices: []`, `totalValue: 0`, `excludedCount: 0`); all-unpriced portfolio (`slices: []`, `excludedCount > 0`). A light test that `allocationColor` is deterministic and varies by index may live here or in a sibling test.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run build` (astro check runs as part of build) or `npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- Spot-check a sample portfolio's computed fractions sum to ~1.0 and `totalValue` matches a manual `Σ quantity×price`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: AssetAllocationChart component + mount

### Overview

Build the hand-rolled SVG donut + legend component using the Phase 1 helpers, wrap it in `Card`, and mount it in `PortfolioView` below the summary cards. Handle empty/single-asset/unpriced states.

### Changes Required:

#### 1. Chart component

**File**: `src/components/portfolio/AssetAllocationChart.tsx` (new)

**Intent**: Render the allocation donut and legend from live `assets`. Presentational only — all math comes from `computeAllocation`; colors from `allocationColor`.

**Contract**: `export function AssetAllocationChart({ assets }: { assets: PortfolioAsset[] })`. Calls `computeAllocation(assets)`. Behavior:
- If `slices.length === 0`: render the `Card` with a muted empty message (e.g. "No priced holdings to chart yet.") — no SVG.
- Otherwise: render an SVG ring (single `<circle>` track + one stroked arc `<circle>` per slice using `stroke-dasharray`/`stroke-dashoffset` over circumference `C = 2πr`; offsets accumulate). Slice and legend colors both come from `allocationColor(i)` using the same index.
- Donut center: total value via `formatUsd(totalValue)` (absolutely/transform-centered over the SVG), with a small "Total value" caption.
- Legend: one row per slice — color swatch, `symbol`, `formatUsd(value)`, and percentage (`(fraction * 100).toFixed(1)%`).
- If `excludedCount > 0`: a small muted note, e.g. "{excludedCount} asset(s) excluded (no current price)."
- Layout inside `Card`: donut left, legend right on wider screens (e.g. `flex flex-col gap-4 sm:flex-row sm:items-center`), consistent with the dark theme (`text-white`, `text-muted-foreground`).

Single-asset case needs no special branch — one slice with `fraction = 1` draws a full ring naturally. Use `formatUsd` and `cn`; do not re-implement currency formatting.

#### 2. Mount in PortfolioView

**File**: `src/components/portfolio/PortfolioView.tsx`

**Intent**: Show the chart between the summary cards and the controls/table, fed by the same live `assets`.

**Contract**: Import `AssetAllocationChart` and render `<AssetAllocationChart assets={assets} />` immediately after `<SummaryCards ... />` (line 151), inside the existing `space-y-4` container. The component handles its own empty state, so no extra conditional is required; it sits above the existing `assets.length === 0` table fallback.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` / `npx astro check`
- Linting passes: `npm run lint`
- Existing unit tests still pass: `npm test`

#### Manual Verification:

- Multi-asset portfolio: donut renders with distinct colors, legend percentages sum to 100% (±rounding), center total equals the summed slice values shown in the table.
- Single-asset portfolio: full ring at 100%.
- Portfolio with an unpriced asset: that asset is absent from the donut/legend and the "excluded" note appears.
- Empty / all-unpriced portfolio: friendly empty message, no broken SVG.
- Chart updates on the 20s price refresh (values/percentages shift when prices move) without a manual reload.
- Layout matches the dark theme and aligns visually with the summary cards above and table below; no console errors.

**Implementation Note**: After automated verification passes, pause for manual confirmation that the visual/edge-case checks above hold.

---

## Testing Strategy

### Unit Tests:

- `computeAllocation`: fractions sum to 1; descending sort; `totalValue` accuracy; exclusion + `excludedCount` for unpriced and zero-quantity assets; empty and all-unpriced inputs.
- `allocationColor`: deterministic per index; distinct across consecutive indices.

### Integration Tests:

- None automated (no API/data-layer change). Covered by manual dashboard verification.

### Manual Testing Steps:

1. Sign in, open `/dashboard` with several priced assets — confirm donut + legend, percentages sum to 100%, center total matches.
2. Reduce to one asset — confirm full ring.
3. Add/hold an asset CoinPaprika can't price (or simulate `current_price_usd === null`) — confirm exclusion + note.
4. View an empty account — confirm empty message, no SVG errors.
5. Watch across a 20s refresh tick — confirm values update live.

## Performance Considerations

Negligible: one `computeAllocation` pass (O(n) over a handful of assets) per render and a small static SVG. No new network calls; reuses the existing polling. No memoization needed at this scale, though `computeAllocation` may be wrapped in `useMemo` keyed on `assets` if profiling ever shows a need (not required for MVP).

## Migration Notes

None — no data or schema changes.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-09, FR-014)
- Pattern to mirror (pure helper + presentational component): `src/lib/portfolio-summary.ts` + `src/components/portfolio/SummaryCards.tsx`
- Value formula precedent: `src/components/portfolio/PortfolioTable.tsx:78`
- Mount point: `src/components/portfolio/PortfolioView.tsx:151`
- Types: `src/types.ts:43-54` (`PortfolioAsset`)
- Shared helpers: `src/lib/format.ts`, `src/components/ui/card.tsx`, `src/lib/utils.ts`
- Theme tokens: `src/styles/global.css` (`--chart-1..5`, dark theme surfaces)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Allocation + color helpers

#### Automated

- [x] 1.1 Unit tests pass: `npm test`
- [x] 1.2 Type checking passes: `npm run build` / `npx astro check`
- [x] 1.3 Linting passes: `npm run lint`

#### Manual

- [x] 1.4 Sample portfolio fractions sum to ~1.0 and `totalValue` matches manual `Σ quantity×price`

### Phase 2: AssetAllocationChart component + mount

#### Automated

- [ ] 2.1 Type checking passes: `npm run build` / `npx astro check`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Existing unit tests still pass: `npm test`

#### Manual

- [ ] 2.4 Multi-asset: donut + legend render, percentages sum to 100%, center total matches table
- [ ] 2.5 Single-asset: full ring at 100%
- [ ] 2.6 Unpriced asset excluded from donut/legend with note shown
- [ ] 2.7 Empty / all-unpriced: friendly empty message, no SVG errors
- [ ] 2.8 Chart updates live on the 20s price refresh
- [ ] 2.9 Layout matches dark theme, aligns with cards/table, no console errors
