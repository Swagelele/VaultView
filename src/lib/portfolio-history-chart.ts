import type { PortfolioHistoryPoint } from "@/types";

export type ChartRange = "15d" | "30d" | "180d" | "365d";

export const CHART_RANGES: ChartRange[] = ["15d", "30d", "180d", "365d"];

// How many trailing daily points each range shows. "Nd" spans N daily intervals = N+1 points. (A
// sub-15-day range is omitted: the series is daily-only, so a 1–2 point window has no real shape.)
const RANGE_TRAILING_POINTS: Record<ChartRange, number> = {
  "15d": 16,
  "30d": 31,
  "180d": 181,
  "365d": 366,
};

/** Slice the full series down to the trailing window a range selects (client-side zoom, no refetch). */
export function sliceRange(points: PortfolioHistoryPoint[], range: ChartRange): PortfolioHistoryPoint[] {
  return points.slice(-RANGE_TRAILING_POINTS[range]);
}

export interface LinePath {
  /** SVG path for the line itself (`M … L …`), empty when there are <2 points. */
  path: string;
  /** SVG path for the filled area between the line and the value-0 baseline. */
  areaPath: string;
  /** Min/max of the input values — the y-axis labels. */
  min: number;
  max: number;
}

// Round to 2 decimals so path strings stay compact and deterministic (stable across test runs).
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// Monotone-cubic tangents (Fritsch–Carlson), the d3 `curveMonotoneX` slopes. Each tangent is
// damped so a smooth segment can never bulge past its endpoints — no overshoot, so the curve stays
// strictly within the plotted value range (and therefore inside the box, never clipped).
function monotoneTangents(pts: { x: number; y: number }[]): number[] {
  const n = pts.length;
  const deltas: number[] = []; // secant slopes between consecutive points
  for (let i = 0; i < n - 1; i++) {
    deltas.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  }

  const m = new Array<number>(n);
  m[0] = deltas[0];
  m[n - 1] = deltas[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // A local extremum (sign change, or a flat secant) forces a zero tangent — the source of the
    // no-overshoot guarantee; otherwise average the neighbouring secants.
    m[i] = deltas[i - 1] * deltas[i] <= 0 ? 0 : (deltas[i - 1] + deltas[i]) / 2;
  }

  // Clamp each tangent into the Fritsch–Carlson monotonicity circle (alpha² + beta² ≤ 9).
  for (let i = 0; i < n - 1; i++) {
    if (deltas[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const alpha = m[i] / deltas[i];
    const beta = m[i + 1] / deltas[i];
    const s = alpha * alpha + beta * beta;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * alpha * deltas[i];
      m[i + 1] = tau * beta * deltas[i];
    }
  }
  return m;
}

/**
 * Map a series of y-values to SVG line + area paths within a width×height box.
 *
 * The value range fills the full height (max at top, min at bottom). The line is smoothed with a
 * monotone cubic spline (d3 `curveMonotoneX`) expressed as cubic Béziers: it passes through every
 * data point (no value is hidden) and never overshoots, so a sharp peak stays inside the box rather
 * than bulging past the top edge and clipping. The area fills down to the value-0 baseline, not the
 * chart bottom: for an all-positive series (portfolio value) 0 sits below the min, so the baseline
 * clamps to the bottom edge; for a P&L series that crosses 0, the baseline is the zero line.
 * Degenerate inputs are handled explicitly — <2 points yields empty paths, a 2-point series is a
 * straight line, and an all-equal series draws a flat mid-line with no divide-by-zero.
 */
export function buildLinePath(values: number[], width: number, height: number, padding = 0): LinePath {
  if (values.length <= 1) {
    const only = values[0] ?? 0;
    return { path: "", areaPath: "", min: only, max: only };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const n = values.length;

  // The line maps into an inset band [padding, height-padding] so its stroke never rides — and gets
  // clipped by — the exact top/bottom edge of the SVG viewport. The area baseline still uses the
  // full box below.
  const usableH = height - 2 * padding;
  const xOf = (i: number) => (i / (n - 1)) * width;
  const yOf = (v: number) => (span === 0 ? height / 2 : padding + ((max - v) / span) * usableH);
  const pts = values.map((v, i) => ({ x: xOf(i), y: yOf(v) }));

  let path: string;
  if (n === 2) {
    path = `M ${r(pts[0].x)} ${r(pts[0].y)} L ${r(pts[1].x)} ${r(pts[1].y)}`;
  } else {
    // Cubic Bézier per segment with control points placed a third of the way along each end's
    // monotone tangent — smooth, interpolating, and overshoot-free.
    const m = monotoneTangents(pts);
    const segments = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x;
      const c1x = pts[i].x + dx / 3;
      const c1y = pts[i].y + (m[i] * dx) / 3;
      const c2x = pts[i + 1].x - dx / 3;
      const c2y = pts[i + 1].y - (m[i + 1] * dx) / 3;
      segments.push(`C ${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(pts[i + 1].x)} ${r(pts[i + 1].y)}`);
    }
    path = `M ${r(pts[0].x)} ${r(pts[0].y)} ${segments.join(" ")}`;
  }

  // Baseline at value 0, clamped into the box (bottom edge for an all-positive series).
  const baselineY = span === 0 ? height : clamp(yOf(0), 0, height);
  const areaPath = `${path} L ${r(pts[n - 1].x)} ${r(baselineY)} L ${r(pts[0].x)} ${r(baselineY)} Z`;

  return { path, areaPath, min, max };
}
