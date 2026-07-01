# Portfolio History Chart — Hover Crosshair & Tooltip Implementation Plan

## Overview

Add a mouse-driven hover affordance to `PortfolioHistoryChart`: as the user moves
across the chart, a thin vertical guide line and a dot pin the nearest daily data
point on the curve, and a small tooltip below that point shows the active metric's
value (Portfolio Value or Total P&L) and a friendly date. This makes the chart
readable — today the only labels are the y-axis min/max and the start/end dates,
so the value on any given day is invisible.

## Current State Analysis

- `PortfolioHistoryChart.tsx` renders a pure SVG line chart (`viewBox="0 0 800 220"`,
  `preserveAspectRatio="none"`) inside a `relative` wrapper div (`:110`). The SVG
  stretches non-uniformly to the container width, so screen-pixel → data-index
  mapping must go through the wrapper's `getBoundingClientRect()`, **not** raw SVG
  coordinates.
- Local state already holds the active `metric` (`"value" | "pnl"`) and `range`.
  The visible series is `sliced` and its plotted numbers are `values` (`:43-44`).
- `buildLinePath(values, VIEW_W, VIEW_H, VIEW_PAD)` (`src/lib/portfolio-history-chart.ts:90`)
  computes the exact per-point `{x, y}` coordinates in viewBox space internally
  (the `pts` array, `:107`) but only returns `{ path, areaPath, min, max }`. The dot
  needs those coordinates to land precisely on the smoothed curve's vertices.
- Data per point: `{ date: "YYYY-MM-DD", value_usd, total_pnl_usd, … }`
  (`src/types.ts:75`). `formatUsd` exists (`src/lib/format.ts:2`); there is **no**
  date formatter yet.
- The crosshair branch only needs to exist where the chart already renders — the
  `sliced.length < 2` guard (`:104`) already replaces the SVG with an empty-state
  message, so the hover code lives entirely inside the `else` branch.

## Desired End State

Hovering anywhere over the rendered chart shows a vertical guide line at the nearest
daily point, a filled dot on the curve at that point, and a tooltip just below the
point reading e.g. `Jun 30, 2026 · $12,345.67`. Moving the mouse snaps the indicator
between days; leaving the chart hides all hover elements. The tooltip never spills
past the chart's left/right edges. Verified by `npm run lint`, `npm run build`, the
new unit tests for the lib helpers, and manual hover testing in the browser.

### Key Discoveries:

- `buildLinePath` already has the `{x,y}` vertices (`portfolio-history-chart.ts:107`) — expose, don't recompute.
- `preserveAspectRatio="none"` ⇒ map cursor via wrapper bounding rect fraction `fx = (clientX - rect.left) / rect.width`, then `index = Math.round(fx * (n - 1))`.
- SVG crosshair elements (`<line>`, `<circle>`) placed in viewBox units scale with the SVG automatically and stay aligned to the curve; the tooltip is HTML positioned in percentage of the wrapper.
- `date` strings are `YYYY-MM-DD`; parse with explicit numeric parts to avoid UTC-vs-local off-by-one-day shifts.

## What We're NOT Doing

- No keyboard/focus navigation of the crosshair (mouse/pointer only). Desktop-only is
  the PRD stance; keyboard a11y for the chart is a possible later follow-up.
- No touch/mobile gesture handling.
- No change to data fetching, the API, the series math, or the `liveToday` override.
- No interpolation between days — the indicator snaps to real data points only.
- No tooltip for the empty-state (`<2` points) chart — nothing is drawn there.
- No second metric in the tooltip — only the active metric's value (plus date).

## Implementation Approach

Two phases. Phase 1 makes the lib testable-pure: `buildLinePath` additionally returns
its `points` array, and a new `formatChartDate` helper turns `YYYY-MM-DD` into
`Mon D, YYYY`. Both get unit tests alongside the existing `portfolio-history-chart.test.ts`.
Phase 2 wires the UI: a `hoveredIndex` state, `onMouseMove`/`onMouseLeave` on the
`relative` wrapper, the SVG guide line + dot, and an absolutely-positioned, edge-clamped
tooltip below the hovered point.

## Critical Implementation Details

- **Coordinate spaces.** The hovered index comes from the wrapper's pixel rect; the
  guide line and dot are drawn in SVG viewBox units (`points[i].x` in 0–800, `points[i].y`
  in 0–220); the tooltip is positioned in CSS percentages of the wrapper
  (`left: (i/(n-1))*100%`, `top` from `points[i].y / VIEW_H * 100%`). Keep the three
  conversions straight — mixing them is the one real footgun here.
- **Edge clamping.** The tooltip is centered under the point by default; near the left
  and right edges it must shift inward so it doesn't clip. Use a translate that the
  component clamps (e.g. transform `translateX(-50%)` but bounded), or position with
  `left` clamped to `[halfWidth, 100% - halfWidth]`.

## Phase 1: Lib support — expose point coordinates + friendly date helper

### Overview

Surface the data the UI needs from the chart math, kept pure and unit-tested.

### Changes Required:

#### 1. Return per-point coordinates from `buildLinePath`

**File**: `src/lib/portfolio-history-chart.ts`

**Intent**: The hover dot must sit exactly on a curve vertex. `buildLinePath` already
computes the `pts` array; expose it so the component doesn't duplicate the `xOf`/`yOf`
mapping.

**Contract**: Extend the `LinePath` interface with `points: { x: number; y: number }[]`
and include it in the returned object. For the `values.length <= 1` early-return,
return `points: []` (the chart never draws a crosshair there). Existing fields
(`path`, `areaPath`, `min`, `max`) and their values are unchanged. Round coordinates
with the existing `r()` helper for determinism, consistent with the path strings.

#### 2. Add a `formatChartDate` helper

**File**: `src/lib/portfolio-history-chart.ts`

**Intent**: Render `YYYY-MM-DD` as a human-friendly `Mon D, YYYY` (e.g. `Jun 30, 2026`)
in the tooltip.

**Contract**: `export function formatChartDate(iso: string): string`. Parse the three
numeric parts explicitly (do **not** pass the bare string to `new Date()` — that parses
as UTC midnight and renders as the previous day in negative-offset locales). Return the
short month name + day + full year. Pure and locale-stable for the test.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes (folded into build): `npm run build`
- Unit tests pass: `npx vitest run src/lib/portfolio-history-chart.test.ts`

#### Manual Verification:

- (none — pure functions, covered by unit tests)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 2: Hover crosshair + tooltip UI

### Overview

Wire mouse tracking, the SVG guide line + dot, and the edge-clamped tooltip into
`PortfolioHistoryChart`.

### Changes Required:

#### 1. Track the hovered data point

**File**: `src/components/portfolio/PortfolioHistoryChart.tsx`

**Intent**: Translate mouse position over the chart into the nearest daily index and
clear it when the cursor leaves.

**Contract**: Add `const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)`.
Attach `onMouseMove` and `onMouseLeave` to the existing `relative` wrapper div (`:110`).
`onMouseMove`: `fx = (e.clientX - rect.left) / rect.width`, then
`setHoveredIndex(clamp(Math.round(fx * (sliced.length - 1)), 0, sliced.length - 1))`
using the event's `currentTarget` rect. `onMouseLeave`: `setHoveredIndex(null)`. Consume
the `points` array now returned by `buildLinePath`.

#### 2. Draw the SVG guide line + dot

**File**: `src/components/portfolio/PortfolioHistoryChart.tsx`

**Intent**: Show where the cursor is on the curve.

**Contract**: When `hoveredIndex !== null`, render inside the existing `<svg>` (after the
line path): a `<line>` from `(points[i].x, 0)` to `(points[i].x, VIEW_H)` (thin, muted
stroke, `vectorEffect="non-scaling-stroke"`) and a `<circle>` at `(points[i].x, points[i].y)`
filled with `lineColor`. No-op when `hoveredIndex` is null.

#### 3. Render the tooltip below the point

**File**: `src/components/portfolio/PortfolioHistoryChart.tsx`

**Intent**: Show the active metric's value and the friendly date just below the hovered
point, without clipping at the chart edges.

**Contract**: When `hoveredIndex !== null`, render an absolutely-positioned HTML element
inside the `relative` wrapper. Horizontal: `left: (i/(n-1))*100%` with a clamped
`translateX(-50%)` so it stays within the wrapper. Vertical: below the point, derived
from `points[i].y / VIEW_H` of the chart height. Content: `formatChartDate(sliced[i].date)`
and `formatUsd(values[i])`, styled to match the existing `bg-black/40` / `text-[10px]`
`tabular-nums` label treatment. `pointer-events-none` so it never eats the mouse moves.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build (type check) passes: `npm run build`
- Existing tests still pass: `npx vitest run`

#### Manual Verification:

- Hovering the chart shows a vertical guide + dot snapped to the nearest day, and a tooltip below it with the right value and `Mon D, YYYY` date.
- The tooltip reflects the active metric and updates when toggling Portfolio Value ↔ Total P&L and changing the time range.
- The tooltip does not clip at the far-left or far-right edges of the chart.
- Moving the mouse off the chart hides the guide, dot, and tooltip.
- No crosshair/tooltip appears on the "Not enough history" empty state.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `buildLinePath` returns a `points` array of length `values.length` with coordinates
  matching the existing line vertices; `points: []` for `<2` inputs.
- `formatChartDate("2026-06-30")` → `"Jun 30, 2026"`; no off-by-one-day shift.

### Manual Testing Steps:

1. Open the dashboard with enough history to render the chart.
2. Move the mouse slowly across the chart — confirm the guide/dot snap to days and the tooltip tracks below with correct value + date.
3. Toggle Portfolio Value ↔ Total P&L and switch ranges (15d/30d/180d/365d); confirm the tooltip value matches the line.
4. Hover at the extreme left and right edges; confirm the tooltip stays fully visible.
5. Move the mouse off the chart; confirm all hover elements disappear.

## Performance Considerations

`onMouseMove` only sets a small integer state; React re-renders the chart cheaply (paths
are recomputed from already-sliced data, no refetch). No throttling needed at daily
resolution (≤366 points).

## References

- Component: `src/components/portfolio/PortfolioHistoryChart.tsx`
- Chart math: `src/lib/portfolio-history-chart.ts`
- Existing tests: `src/lib/portfolio-history-chart.test.ts`
- Formatters: `src/lib/format.ts`
- Origin slice: S-10 portfolio-history-chart (`context/archive/2026-06-27-portfolio-history-chart/`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Lib support — expose point coordinates + friendly date helper

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — e904c1a
- [x] 1.2 Type checking passes (build): `npm run build` — e904c1a
- [x] 1.3 Unit tests pass: `npx vitest run src/lib/portfolio-history-chart.test.ts` — e904c1a

### Phase 2: Hover crosshair + tooltip UI

#### Automated

- [x] 2.1 Lint passes: `npm run lint`
- [x] 2.2 Build (type check) passes: `npm run build`
- [x] 2.3 Existing tests still pass: `npx vitest run`

#### Manual

- [ ] 2.4 Hover shows guide + dot snapped to nearest day with correct value/date tooltip below
- [ ] 2.5 Tooltip reflects active metric and updates on metric/range change
- [ ] 2.6 Tooltip does not clip at far-left/far-right edges
- [ ] 2.7 Moving mouse off the chart hides guide, dot, and tooltip
- [ ] 2.8 No crosshair/tooltip on the "Not enough history" empty state
