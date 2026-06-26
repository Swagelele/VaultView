import { describe, it, expect } from "vitest";
import { computePortfolioHistory } from "./portfolio-history";
import type { Transaction } from "@/types";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    user_id: "user-1",
    type: "BUY",
    source_asset: "usdt-tether",
    source_quantity: 0,
    target_asset: null,
    target_quantity: null,
    price: 1,
    price_usd: 1,
    fee: 0,
    location: "Binance",
    transaction_date: "2026-06-01T10:00:00Z",
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-01T10:00:00Z",
    ...overrides,
  };
}

// Per-asset daily price series helper.
function series(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

describe("computePortfolioHistory — hand-computed fixture (DEPOSIT + SELL + WITHDRAW)", () => {
  // Ledger over 2026-06-01 .. 2026-06-04:
  //   06-01 DEPOSIT 2 BTC @ 50000  → BTC qty 2, avg 50000
  //   06-02 DEPOSIT 100000 USDT @ 1
  //   06-03 SELL 1 BTC → 60000 USDT @ price 60000 → realized 1×(60000−50000)=10000
  //   06-04 WITHDRAW 1 BTC @ 70000 → realized 1×(70000−50000)=20000 (BTC closes)
  // BTC price series: 50000 / 55000 / 60000 / 70000. USDT is a stablecoin → priced at 1.
  const transactions: Transaction[] = [
    tx({
      type: "DEPOSIT",
      source_asset: "btc-bitcoin",
      source_quantity: 2,
      price_usd: 50000,
      transaction_date: "2026-06-01T10:00:00Z",
      created_at: "2026-06-01T10:00:00Z",
    }),
    tx({
      type: "DEPOSIT",
      source_asset: "usdt-tether",
      source_quantity: 100000,
      price_usd: 1,
      transaction_date: "2026-06-02T10:00:00Z",
      created_at: "2026-06-02T10:00:00Z",
    }),
    tx({
      type: "SELL",
      source_asset: "btc-bitcoin",
      source_quantity: 1,
      target_asset: "usdt-tether",
      target_quantity: 60000,
      price_usd: 60000,
      transaction_date: "2026-06-03T10:00:00Z",
      created_at: "2026-06-03T10:00:00Z",
    }),
    tx({
      type: "WITHDRAW",
      source_asset: "btc-bitcoin",
      source_quantity: 1,
      target_asset: null,
      target_quantity: null,
      price_usd: 70000,
      transaction_date: "2026-06-04T10:00:00Z",
      created_at: "2026-06-04T10:00:00Z",
    }),
  ];

  const priceSeries = new Map([
    [
      "btc-bitcoin",
      series({
        "2026-06-01": 50000,
        "2026-06-02": 55000,
        "2026-06-03": 60000,
        "2026-06-04": 70000,
      }),
    ],
  ]);

  const { points, excludedPriceDays } = computePortfolioHistory(transactions, priceSeries, {
    startDate: "2026-06-01",
    endDate: "2026-06-04",
  });

  it("emits one point per day across the window", () => {
    expect(points.map((p) => p.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"]);
    expect(excludedPriceDays).toBe(0);
  });

  it("day 1: value = 2×50000, no P&L yet", () => {
    expect(points[0]).toEqual({
      date: "2026-06-01",
      value_usd: 100000,
      realized_pnl_usd: 0,
      unrealized_pnl_usd: 0,
      total_pnl_usd: 0,
    });
  });

  it("day 2: BTC marks up to 55000 + 100000 USDT → value 210000, unrealized 10000", () => {
    expect(points[1]).toEqual({
      date: "2026-06-02",
      value_usd: 210000,
      realized_pnl_usd: 0,
      unrealized_pnl_usd: 10000,
      total_pnl_usd: 10000,
    });
  });

  it("day 3: SELL realizes 10000; value 220000, total 20000", () => {
    expect(points[2]).toEqual({
      date: "2026-06-03",
      value_usd: 220000, // 1 BTC × 60000 + 160000 USDT × 1
      realized_pnl_usd: 10000,
      unrealized_pnl_usd: 10000, // remaining 1 BTC × (60000 − 50000)
      total_pnl_usd: 20000,
    });
  });

  it("day 4: WITHDRAW closes BTC; cumulative realized 30000, unrealized 0", () => {
    expect(points[3]).toEqual({
      date: "2026-06-04",
      value_usd: 160000, // only 160000 USDT remains
      realized_pnl_usd: 30000, // 10000 (SELL) + 20000 (WITHDRAW)
      unrealized_pnl_usd: 0,
      total_pnl_usd: 30000,
    });
  });
});

describe("computePortfolioHistory — edge cases", () => {
  it("a missing price contributes 0 (no NaN) and bumps excludedPriceDays", () => {
    const transactions = [
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        price_usd: 50000,
        transaction_date: "2026-06-01T10:00:00Z",
      }),
    ];
    // Series has day 1 but not day 2.
    const priceSeries = new Map([["btc-bitcoin", series({ "2026-06-01": 50000 })]]);

    const { points, excludedPriceDays } = computePortfolioHistory(transactions, priceSeries, {
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });

    expect(points[0].value_usd).toBe(50000);
    expect(points[1].value_usd).toBe(0); // missing price → 0, not NaN
    expect(Number.isNaN(points[1].unrealized_pnl_usd)).toBe(false);
    expect(points[1].unrealized_pnl_usd).toBe(0);
    expect(excludedPriceDays).toBe(1); // one held asset-day with no price
  });

  it("prices a same-day BUY→SELL correctly (snapshot after both, in causal order)", () => {
    // Same day: DEPOSIT funds USDT, BUY 1 BTC, then SELL it — all on 06-01. The snapshot must reflect
    // the post-SELL state: BTC closed, realized 5000.
    const transactions = [
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 100000,
        price_usd: 1,
        transaction_date: "2026-06-01T10:00:00Z",
        created_at: "2026-06-01T10:00:00.100Z",
      }),
      tx({
        type: "BUY",
        source_asset: "usdt-tether",
        source_quantity: 60000,
        target_asset: "btc-bitcoin",
        target_quantity: 1,
        price_usd: 1,
        transaction_date: "2026-06-01T10:00:00Z",
        created_at: "2026-06-01T10:00:00.200Z",
      }),
      tx({
        type: "SELL",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        target_asset: "usdt-tether",
        target_quantity: 65000,
        price_usd: 65000,
        transaction_date: "2026-06-01T10:00:00Z",
        created_at: "2026-06-01T10:00:00.300Z",
      }),
    ];
    const priceSeries = new Map([["btc-bitcoin", series({ "2026-06-01": 65000 })]]);

    const { points } = computePortfolioHistory(transactions, priceSeries, {
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });

    // BTC closed; only 105000 USDT (100000 − 60000 + 65000) remains, valued at 1.
    expect(points[0].value_usd).toBe(105000);
    expect(points[0].realized_pnl_usd).toBe(5000);
    expect(points[0].unrealized_pnl_usd).toBe(0); // BTC closed, USDT marks flat
    expect(points[0].total_pnl_usd).toBe(5000);
  });

  it("a fully-closed position stays flat: realized constant, unrealized 0 after close", () => {
    const transactions = [
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        price_usd: 50000,
        transaction_date: "2026-06-01T10:00:00Z",
      }),
      tx({
        type: "WITHDRAW",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        target_asset: null,
        target_quantity: null,
        price_usd: 60000,
        transaction_date: "2026-06-02T10:00:00Z",
      }),
    ];
    const priceSeries = new Map([
      ["btc-bitcoin", series({ "2026-06-01": 50000, "2026-06-02": 60000, "2026-06-03": 99999 })],
    ]);

    const { points } = computePortfolioHistory(transactions, priceSeries, {
      startDate: "2026-06-01",
      endDate: "2026-06-03",
    });

    expect(points[1].realized_pnl_usd).toBe(10000);
    // Day 3: position closed — the 99999 mark must not leak into value or unrealized.
    expect(points[2].value_usd).toBe(0);
    expect(points[2].unrealized_pnl_usd).toBe(0);
    expect(points[2].realized_pnl_usd).toBe(10000); // flat
    expect(points[2].total_pnl_usd).toBe(10000);
  });

  it("folds pre-window transactions into the first day (clamped window start)", () => {
    // BTC deposited 2026-05-01, well before the window start of 2026-06-01. The opening snapshot must
    // already hold it.
    const transactions = [
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        price_usd: 40000,
        transaction_date: "2026-05-01T10:00:00Z",
      }),
    ];
    const priceSeries = new Map([["btc-bitcoin", series({ "2026-06-01": 50000 })]]);

    const { points } = computePortfolioHistory(transactions, priceSeries, {
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });

    expect(points[0].value_usd).toBe(50000);
    expect(points[0].unrealized_pnl_usd).toBe(10000); // 1 × (50000 − 40000)
  });

  it("values stablecoins at 1 without a series entry, never counting them excluded", () => {
    const transactions = [
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 5000,
        price_usd: 1,
        transaction_date: "2026-06-01T10:00:00Z",
      }),
    ];
    const { points, excludedPriceDays } = computePortfolioHistory(transactions, new Map(), {
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });

    expect(points[0].value_usd).toBe(5000);
    expect(excludedPriceDays).toBe(0);
  });

  it("returns empty points when the window is inverted", () => {
    const { points, excludedPriceDays } = computePortfolioHistory([], new Map(), {
      startDate: "2026-06-04",
      endDate: "2026-06-01",
    });
    expect(points).toEqual([]);
    expect(excludedPriceDays).toBe(0);
  });
});
