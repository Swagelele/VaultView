/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from "vitest";
import { computePositions, aggregateByAsset } from "./pnl-engine";
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
    transaction_date: "2026-06-15T10:00:00Z",
    created_at: "2026-06-15T10:00:00Z",
    updated_at: "2026-06-15T10:00:00Z",
    ...overrides,
  };
}

describe("computePositions", () => {
  it("DEPOSIT creates opening position at $1 cost basis", () => {
    const { positions } = computePositions([
      tx({ type: "DEPOSIT", source_asset: "usdt-tether", source_quantity: 100000, price_usd: 1 }),
    ]);

    const pos = positions.get("usdt-tether::Binance");
    expect(pos).toBeDefined();
    expect(pos!.quantity).toBe(100000);
    expect(pos!.total_cost_usd).toBe(100000);
    expect(pos!.realized_pnl).toBe(0);
  });

  it("DEPOSIT with non-$1 cost basis carries quantity × price_usd (S-05)", () => {
    const { positions } = computePositions([
      tx({ type: "DEPOSIT", source_asset: "btc-bitcoin", source_quantity: 2, price_usd: 42000 }),
    ]);

    const pos = positions.get("btc-bitcoin::Binance");
    expect(pos).toBeDefined();
    expect(pos!.quantity).toBe(2);
    expect(pos!.total_cost_usd).toBe(84000);
    expect(pos!.realized_pnl).toBe(0);
  });

  it("BUY after DEPOSIT reduces source and creates target cost basis", () => {
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 100000,
        price_usd: 1,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "BUY",
        source_asset: "usdt-tether",
        source_quantity: 60000,
        target_asset: "btc-bitcoin",
        target_quantity: 1,
        price: 60000,
        price_usd: 1,
        transaction_date: "2026-06-15T10:01:00Z",
      }),
    ]);

    const usdt = positions.get("usdt-tether::Binance");
    expect(usdt!.quantity).toBe(40000);

    const btc = positions.get("btc-bitcoin::Binance");
    expect(btc!.quantity).toBe(1);
    expect(btc!.total_cost_usd).toBe(60000);
  });

  it("multiple BUYs produce weighted average cost", () => {
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 200000,
        price_usd: 1,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "BUY",
        source_asset: "usdt-tether",
        source_quantity: 60000,
        target_asset: "btc-bitcoin",
        target_quantity: 1,
        price_usd: 1,
        transaction_date: "2026-06-15T10:01:00Z",
      }),
      tx({
        type: "BUY",
        source_asset: "usdt-tether",
        source_quantity: 63000,
        target_asset: "btc-bitcoin",
        target_quantity: 1,
        price_usd: 1,
        transaction_date: "2026-06-15T10:02:00Z",
      }),
    ]);

    const btc = positions.get("btc-bitcoin::Binance");
    expect(btc!.quantity).toBe(2);
    expect(btc!.total_cost_usd).toBe(123000);
    const avgCost = btc!.total_cost_usd / btc!.quantity;
    expect(avgCost).toBe(61500);
  });

  it("partial SELL records realized P&L", () => {
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 200000,
        price_usd: 1,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "BUY",
        source_asset: "usdt-tether",
        source_quantity: 120000,
        target_asset: "btc-bitcoin",
        target_quantity: 2,
        price_usd: 1,
        transaction_date: "2026-06-15T10:01:00Z",
      }),
      tx({
        type: "SELL",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        target_asset: "usdt-tether",
        target_quantity: 65000,
        price: 65000,
        price_usd: 65000,
        transaction_date: "2026-06-15T10:02:00Z",
      }),
    ]);

    const btc = positions.get("btc-bitcoin::Binance");
    expect(btc!.quantity).toBe(1);
    expect(btc!.realized_pnl).toBe(1 * (65000 - 60000));
    expect(btc!.realized_pnl).toBe(5000);
  });

  it("SWAP disposes source and acquires target", () => {
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 100000,
        price_usd: 1,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "BUY",
        source_asset: "usdt-tether",
        source_quantity: 30000,
        target_asset: "eth-ethereum",
        target_quantity: 10,
        price_usd: 1,
        transaction_date: "2026-06-15T10:01:00Z",
      }),
      tx({
        type: "SWAP",
        source_asset: "eth-ethereum",
        source_quantity: 5,
        target_asset: "btc-bitcoin",
        target_quantity: 0.25,
        price: 0.05,
        price_usd: 3200,
        transaction_date: "2026-06-15T10:02:00Z",
      }),
    ]);

    const eth = positions.get("eth-ethereum::Binance");
    expect(eth!.quantity).toBe(5);

    const btc = positions.get("btc-bitcoin::Binance");
    expect(btc!.quantity).toBe(0.25);
    expect(btc!.total_cost_usd).toBe(5 * 3200);
  });

  it("full SELL marks zero-balance position", () => {
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 60000,
        price_usd: 1,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "BUY",
        source_asset: "usdt-tether",
        source_quantity: 60000,
        target_asset: "btc-bitcoin",
        target_quantity: 1,
        price_usd: 1,
        transaction_date: "2026-06-15T10:01:00Z",
      }),
      tx({
        type: "SELL",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        target_asset: "usdt-tether",
        target_quantity: 65000,
        price_usd: 65000,
        transaction_date: "2026-06-15T10:02:00Z",
      }),
    ]);

    const btc = positions.get("btc-bitcoin::Binance");
    expect(btc!.quantity).toBe(0);
    expect(btc!.realized_pnl).toBe(5000);
  });

  it("transactions with price_usd === null are flagged as unpriced", () => {
    const { unpriced } = computePositions([tx({ type: "BUY", price_usd: null })]);

    expect(unpriced).toHaveLength(1);
    expect(unpriced[0].type).toBe("BUY");
  });
});

describe("aggregateByAsset", () => {
  it("consolidates per-location positions into per-asset totals", () => {
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 100000,
        price_usd: 1,
        location: "Binance",
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 50000,
        price_usd: 1,
        location: "MetaMask",
        transaction_date: "2026-06-15T10:00:00Z",
      }),
    ]);

    const summaries = aggregateByAsset(positions);
    const usdt = summaries.find((s) => s.asset === "usdt-tether");
    expect(usdt).toBeDefined();
    expect(usdt!.total_quantity).toBe(150000);
    expect(usdt!.locations).toHaveLength(2);
  });

  it("marks zero-balance assets as closed", () => {
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "usdt-tether",
        source_quantity: 60000,
        price_usd: 1,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "BUY",
        source_asset: "usdt-tether",
        source_quantity: 60000,
        target_asset: "btc-bitcoin",
        target_quantity: 1,
        price_usd: 1,
        transaction_date: "2026-06-15T10:01:00Z",
      }),
    ]);

    const summaries = aggregateByAsset(positions);
    const usdt = summaries.find((s) => s.asset === "usdt-tether");
    expect(usdt!.is_closed).toBe(true);

    const btc = summaries.find((s) => s.asset === "btc-bitcoin");
    expect(btc!.is_closed).toBe(false);
  });
});
