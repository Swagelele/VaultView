# Portfolio History Chart — Hover Crosshair & Tooltip — Plan Brief

> Full plan: `context/changes/portfolio-chart-hover-tooltip/plan.md`

## What & Why

Add a mouse hover affordance to the portfolio history chart so the user can read the
value and date at any point on the curve. Today the chart shows only y-axis min/max and
start/end date labels — the value on any specific day is invisible.

## Starting Point

`PortfolioHistoryChart.tsx` (slice S-10, already shipped) draws a pure-SVG line chart
inside a `relative` wrapper, with active-metric and time-range state already local. The
chart math in `src/lib/portfolio-history-chart.ts` already computes per-point vertices
but doesn't expose them.

## Desired End State

Hovering the chart shows a thin vertical guide line, a dot pinned to the nearest daily
point on the curve, and a tooltip just below it reading e.g. `Jun 30, 2026 · $12,345.67`
for the active metric. Leaving the chart hides everything; the tooltip never clips at the
edges.

## Key Decisions Made

| Decision            | Choice                                  | Why                                                                 | Source |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------- | ------ |
| Indicator visual    | Vertical guide line + dot on the curve  | Standard affordance; dot pins exact value, reads clean on minimal SVG | Plan   |
| Cursor tracking     | Snap to nearest data point              | Always shows real (non-interpolated) data; dot lands on the line    | Plan   |
| Tooltip content     | Active metric value + date              | Matches what the curve represents; no ambiguity                     | Plan   |
| Date format / place | `Mon D, YYYY`, tooltip below the point  | Readable; matches "below the cursor" request; edge-clamped          | Plan   |

## Scope

**In scope:** mouse hover crosshair (line + dot), edge-clamped tooltip with active-metric
value + friendly date, snap-to-nearest-day, exposing point coords + a date helper from the lib.

**Out of scope:** keyboard/touch navigation, interpolated values, second metric in tooltip,
any data/API/series-math change, tooltip on the empty-state chart.

## Architecture / Approach

Phase 1 (lib, pure + tested): `buildLinePath` also returns its `points: {x,y}[]`; new
`formatChartDate` turns `YYYY-MM-DD` into `Mon D, YYYY`. Phase 2 (UI): `hoveredIndex` state
driven by `onMouseMove`/`onMouseLeave` on the wrapper (cursor mapped via bounding-rect
fraction → nearest index); SVG `<line>` + `<circle>` in viewBox units; HTML tooltip
positioned in wrapper percentages, edge-clamped, `pointer-events-none`.

## Phases at a Glance

| Phase             | What it delivers                                   | Key risk                                    |
| ----------------- | -------------------------------------------------- | ------------------------------------------- |
| 1. Lib support    | `points` from `buildLinePath` + `formatChartDate`, unit-tested | Date parsing off-by-one across timezones    |
| 2. Hover UI       | Crosshair + dot + edge-clamped tooltip             | Coordinate-space mixups (pixel/viewBox/CSS%) |

**Prerequisites:** none — works against existing component and lib.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- `preserveAspectRatio="none"` stretches x non-uniformly — cursor mapping must use the
  wrapper's bounding rect, not SVG coords (handled in the plan).
- Tooltip edge-clamping is the only fiddly CSS; everything else follows existing patterns.

## Success Criteria (Summary)

- Hovering reveals the value + date for any day at a glance.
- The indicator snaps to real data points and matches the active metric/range.
- No clipping at chart edges; clean hide on mouse-leave.
