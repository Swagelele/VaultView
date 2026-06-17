import { describe, it, expect } from "vitest";
import { computeSummary } from "./portfolio-summary";
import type { PortfolioAsset } from "@/types";

function asset(overrides: Partial<PortfolioAsset>): PortfolioAsset {
  return {
    asset: "btc-bitcoin",
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

describe("computeSummary", () => {
  it("returns zeros for an empty portfolio", () => {
    const summary = computeSummary([], 0);
    expect(summary.total_realized_pnl_usd).toBe(0);
    expect(summary.total_unrealized_pnl_usd).toBe(0);
    expect(summary.net_pnl_usd).toBe(0);
    expect(summary.total_fees_usd).toBe(0);
  });

  it("sums realized, unrealized, and net across priced assets", () => {
    const summary = computeSummary(
      [
        asset({ asset: "btc-bitcoin", total_realized_pnl_usd: 5000, unrealized_pnl_usd: 2000 }),
        asset({ asset: "eth-ethereum", total_realized_pnl_usd: -1000, unrealized_pnl_usd: 3000 }),
      ],
      0,
    );
    expect(summary.total_realized_pnl_usd).toBe(4000);
    expect(summary.total_unrealized_pnl_usd).toBe(5000);
    expect(summary.net_pnl_usd).toBe(9000);
  });

  it("collapses unrealized and net to null when a held asset is unpriced", () => {
    const summary = computeSummary(
      [
        asset({ asset: "btc-bitcoin", total_realized_pnl_usd: 5000, unrealized_pnl_usd: 2000 }),
        asset({
          asset: "eth-ethereum",
          total_realized_pnl_usd: 1000,
          current_price_usd: null,
          unrealized_pnl_usd: null,
        }),
      ],
      0,
    );
    expect(summary.total_unrealized_pnl_usd).toBeNull();
    expect(summary.net_pnl_usd).toBeNull();
    // Realized is price-independent and still summed.
    expect(summary.total_realized_pnl_usd).toBe(6000);
  });

  it("counts a closed position toward realized without collapsing unrealized", () => {
    const summary = computeSummary(
      [
        asset({ asset: "btc-bitcoin", total_quantity: 1, total_realized_pnl_usd: 0, unrealized_pnl_usd: 2000 }),
        asset({
          asset: "eth-ethereum",
          total_quantity: 0,
          is_closed: true,
          total_realized_pnl_usd: 7500,
          current_price_usd: null,
          unrealized_pnl_usd: null,
        }),
      ],
      0,
    );
    // Closed asset's null unrealized must NOT collapse the total (qty 0 is skipped for unrealized).
    expect(summary.total_unrealized_pnl_usd).toBe(2000);
    expect(summary.total_realized_pnl_usd).toBe(7500);
    expect(summary.net_pnl_usd).toBe(9500);
  });

  it("passes total fees through verbatim", () => {
    const summary = computeSummary([asset({})], 123.45);
    expect(summary.total_fees_usd).toBe(123.45);
  });
});
