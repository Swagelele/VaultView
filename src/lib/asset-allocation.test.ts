import { describe, it, expect } from "vitest";
import { computeAllocation } from "./asset-allocation";
import { allocationColor } from "./chart-colors";
import type { PortfolioAsset } from "@/types";

function asset(overrides: Partial<PortfolioAsset>): PortfolioAsset {
  return {
    asset: "BTC",
    symbol: "BTC",
    total_quantity: 1,
    avg_cost_usd: 60000,
    current_price_usd: 65000,
    price_stale: false,
    unrealized_pnl_usd: 5000,
    total_realized_pnl_usd: 0,
    is_closed: false,
    locations: [],
    ...overrides,
  };
}

describe("computeAllocation", () => {
  it("returns an empty result for an empty portfolio", () => {
    const result = computeAllocation([]);
    expect(result.slices).toEqual([]);
    expect(result.totalValue).toBe(0);
    expect(result.excludedCount).toBe(0);
  });

  it("computes value, fractions, and total across priced assets, sorted descending", () => {
    const result = computeAllocation([
      asset({ asset: "ETH", symbol: "ETH", total_quantity: 10, current_price_usd: 2000 }), // 20000
      asset({ asset: "BTC", symbol: "BTC", total_quantity: 1, current_price_usd: 60000 }), // 60000
    ]);

    expect(result.totalValue).toBe(80000);
    // Sorted by value desc: BTC (60000) before ETH (20000).
    expect(result.slices.map((s) => s.symbol)).toEqual(["BTC", "ETH"]);
    expect(result.slices[0].value).toBe(60000);
    expect(result.slices[1].value).toBe(20000);
    // Fractions sum to 1.
    const fractionSum = result.slices.reduce((sum, s) => sum + s.fraction, 0);
    expect(fractionSum).toBeCloseTo(1, 10);
    expect(result.slices[0].fraction).toBeCloseTo(0.75, 10);
    expect(result.slices[1].fraction).toBeCloseTo(0.25, 10);
    expect(result.excludedCount).toBe(0);
  });

  it("renders a single priced asset as one full-ring slice", () => {
    const result = computeAllocation([asset({ total_quantity: 2, current_price_usd: 50000 })]);
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].value).toBe(100000);
    expect(result.slices[0].fraction).toBe(1);
    expect(result.totalValue).toBe(100000);
  });

  it("excludes held assets with no current price and counts them", () => {
    const result = computeAllocation([
      asset({ asset: "BTC", symbol: "BTC", total_quantity: 1, current_price_usd: 60000 }),
      asset({ asset: "DOGE", symbol: "DOGE", total_quantity: 100, current_price_usd: null }),
    ]);
    expect(result.slices.map((s) => s.symbol)).toEqual(["BTC"]);
    expect(result.totalValue).toBe(60000);
    expect(result.excludedCount).toBe(1);
  });

  it("ignores zero-quantity / closed positions entirely", () => {
    const result = computeAllocation([
      asset({ asset: "BTC", symbol: "BTC", total_quantity: 1, current_price_usd: 60000 }),
      asset({ asset: "ETH", symbol: "ETH", total_quantity: 0, is_closed: true, current_price_usd: 2000 }),
      // Closed AND unpriced — still ignored, not counted as excluded (excludedCount is for held assets).
      asset({ asset: "LTC", symbol: "LTC", total_quantity: 0, is_closed: true, current_price_usd: null }),
    ]);
    expect(result.slices.map((s) => s.symbol)).toEqual(["BTC"]);
    expect(result.totalValue).toBe(60000);
    expect(result.excludedCount).toBe(0);
  });

  it("returns no slices for an all-unpriced portfolio but counts the exclusions", () => {
    const result = computeAllocation([
      asset({ asset: "BTC", symbol: "BTC", total_quantity: 1, current_price_usd: null }),
      asset({ asset: "ETH", symbol: "ETH", total_quantity: 5, current_price_usd: null }),
    ]);
    expect(result.slices).toEqual([]);
    expect(result.totalValue).toBe(0);
    expect(result.excludedCount).toBe(2);
  });
});

describe("allocationColor", () => {
  it("is deterministic for a given index", () => {
    expect(allocationColor(3)).toBe(allocationColor(3));
  });

  it("produces distinct colors for consecutive indices", () => {
    const colors = [0, 1, 2, 3, 4, 5, 6, 7].map(allocationColor);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("returns an hsl() string", () => {
    expect(allocationColor(0)).toMatch(/^hsl\(/);
  });
});
