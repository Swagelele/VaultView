import { describe, it, expect } from "vitest";
import { sliceRange, buildLinePath, formatChartDate, CHART_RANGES } from "./portfolio-history-chart";
import type { PortfolioHistoryPoint } from "@/types";

function point(date: string, value: number): PortfolioHistoryPoint {
  return {
    date,
    value_usd: value,
    realized_pnl_usd: 0,
    unrealized_pnl_usd: 0,
    total_pnl_usd: value,
  };
}

// A series of N daily points 2026-01-01.., values 0,1,2,...
function seriesOf(n: number): PortfolioHistoryPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return point(`2026-01-${day}`, i);
  });
}

describe("sliceRange", () => {
  it("returns the trailing N+1 points for each range", () => {
    const full = seriesOf(400);
    expect(sliceRange(full, "15d")).toHaveLength(16);
    expect(sliceRange(full, "30d")).toHaveLength(31);
    expect(sliceRange(full, "180d")).toHaveLength(181);
    expect(sliceRange(full, "365d")).toHaveLength(366);
  });

  it("takes the most-recent points (the tail of the series)", () => {
    const full = seriesOf(20);
    const sliced = sliceRange(full, "15d");
    expect(sliced).toHaveLength(16);
    expect(sliced[0].date).toBe("2026-01-05");
    expect(sliced[sliced.length - 1].date).toBe("2026-01-20");
  });

  it("returns the whole series when it is shorter than the range", () => {
    const full = seriesOf(5);
    expect(sliceRange(full, "365d")).toHaveLength(5);
  });

  it("returns an empty array for an empty series", () => {
    expect(sliceRange([], "30d")).toEqual([]);
    // exhaustively: every range is safe on empty input
    for (const range of CHART_RANGES) {
      expect(sliceRange([], range)).toEqual([]);
    }
  });
});

describe("buildLinePath", () => {
  it("returns empty paths for <2 points (cannot draw a line)", () => {
    expect(buildLinePath([], 100, 100)).toEqual({ path: "", areaPath: "", min: 0, max: 0, points: [] });
    expect(buildLinePath([42], 100, 100)).toEqual({ path: "", areaPath: "", min: 42, max: 42, points: [] });
  });

  it("maps max to the top (y=0) and min to the bottom (y=height)", () => {
    const { path, min, max } = buildLinePath([0, 10], 100, 100);
    expect(min).toBe(0);
    expect(max).toBe(10);
    // first point (value 0 = min) at bottom, second (value 10 = max) at top
    expect(path).toBe("M 0 100 L 100 0");
  });

  it("closes the area down to the bottom edge for an all-positive series (baseline 0 clamped)", () => {
    // values 60000..96000 → 0 sits far below min, so the baseline clamps to the bottom (y=height).
    const { areaPath } = buildLinePath([60000, 96000], 100, 100);
    expect(areaPath).toBe("M 0 100 L 100 0 L 100 100 L 0 100 Z");
  });

  it("puts the area baseline at the zero line for a P&L series that crosses 0", () => {
    // values -10..10 → 0 maps to the vertical middle (y=50), the baseline of the fill.
    const { areaPath, min, max } = buildLinePath([-10, 10], 100, 100);
    expect(min).toBe(-10);
    expect(max).toBe(10);
    expect(areaPath).toBe("M 0 100 L 100 0 L 100 50 L 0 50 Z");
  });

  it("draws a flat mid-line for all-equal values (no divide-by-zero, no NaN)", () => {
    const { path, areaPath, min, max } = buildLinePath([5, 5, 5], 100, 100);
    expect(min).toBe(5);
    expect(max).toBe(5);
    // span 0 → every y sits on the mid-line (y=50); smoothed but flat, no NaN.
    expect(path.startsWith("M 0 50")).toBe(true);
    expect(path.endsWith("100 50")).toBe(true);
    expect(path).toContain("50 50"); // the middle data point
    expect(path).not.toContain("NaN");
    expect(areaPath).not.toContain("NaN");
  });

  it("smooths a ≥3-point line with cubic Béziers that pass through the data points", () => {
    const { path } = buildLinePath([0, 5, 10], 100, 100); // 3 points → x at 0, 50, 100
    expect(path.startsWith("M 0 100")).toBe(true); // first point (min) at bottom
    expect(path).toContain("C"); // smoothed, not a polyline
    expect(path).toContain("50 50"); // passes through the middle data point (x=50, mid value)
    expect(path.endsWith("100 0")).toBe(true); // last point (max) at top
    expect(path).not.toContain("NaN");
  });

  it("keeps a 2-point series a straight line (no curve to smooth)", () => {
    const { path } = buildLinePath([0, 10], 100, 100);
    expect(path).toBe("M 0 100 L 100 0");
  });

  it("returns one vertex per value, on the curve, for the hover crosshair", () => {
    expect(buildLinePath([0, 10], 100, 100).points).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ]);
    expect(buildLinePath([0, 5, 10], 100, 100).points).toEqual([
      { x: 0, y: 100 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ]);
  });

  it("does not overshoot the box on a sharp peak (monotone cubic, no clipping)", () => {
    // A spike (0 → 100 → 0) is where a naive Catmull-Rom spline bulges past the top edge. With a
    // box of 100×100 every coordinate the curve emits must stay within [0, 100].
    const { path, areaPath } = buildLinePath([0, 100, 0, 80, 0], 100, 100);
    const coords = [...path.matchAll(/-?\d+\.?\d*/g)].map((mn) => Number(mn[0]));
    expect(coords.length).toBeGreaterThan(0);
    for (const c of coords) {
      expect(c).toBeGreaterThanOrEqual(-0.01);
      expect(c).toBeLessThanOrEqual(100.01);
    }
    expect(areaPath).not.toContain("NaN");
  });
});

describe("formatChartDate", () => {
  it("renders YYYY-MM-DD as a friendly Mon D, YYYY", () => {
    expect(formatChartDate("2026-06-30")).toBe("Jun 30, 2026");
    expect(formatChartDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatChartDate("2025-12-09")).toBe("Dec 9, 2025");
  });

  it("does not shift the day (parses parts explicitly, not as UTC midnight)", () => {
    // A bare `new Date("2026-03-01")` is UTC midnight and renders Feb 28 in negative-offset zones.
    expect(formatChartDate("2026-03-01")).toBe("Mar 1, 2026");
  });
});
