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

  it("WITHDRAW realizes P&L on the source and creates no target position (S-06)", () => {
    const { positions, realizedByTx } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 2,
        price_usd: 60000,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        id: "wd-1",
        type: "WITHDRAW",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        target_asset: null,
        target_quantity: null,
        price_usd: 70000,
        transaction_date: "2026-06-16T10:00:00Z",
      }),
    ]);

    const btc = positions.get("btc-bitcoin::Binance");
    expect(btc!.quantity).toBe(1);
    // avg cost was 60000; withdrawing 1 at 70000 realizes 1 × (70000 − 60000)
    expect(btc!.realized_pnl).toBe(10000);
    expect(realizedByTx.get("wd-1")).toBe(10000);
    // cost basis drops by 1 × avgCost (60000), leaving the remaining unit at cost
    expect(btc!.total_cost_usd).toBe(60000);
    // one-sided: no target position is created
    expect(positions.size).toBe(1);
  });

  it("full WITHDRAW closes the position", () => {
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "eth-ethereum",
        source_quantity: 10,
        price_usd: 3000,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "WITHDRAW",
        source_asset: "eth-ethereum",
        source_quantity: 10,
        target_asset: null,
        target_quantity: null,
        price_usd: 3500,
        transaction_date: "2026-06-16T10:00:00Z",
      }),
    ]);

    const eth = positions.get("eth-ethereum::Binance");
    expect(eth!.quantity).toBe(0);
    expect(eth!.realized_pnl).toBe(10 * (3500 - 3000));
  });

  it("transactions with price_usd === null are flagged as unpriced", () => {
    const { unpriced } = computePositions([tx({ type: "BUY", price_usd: null })]);

    expect(unpriced).toHaveLength(1);
    expect(unpriced[0].type).toBe("BUY");
  });

  it("excludes fee from P&L math — quantity, cost basis, and realized P&L ignore the fee", () => {
    // PRD FR-003 + FR-010: P&L is gross of fees; fees are reported only as a separate total.
    // Two identical histories differing ONLY in `fee` must produce identical engine output.
    const build = (fee: number) =>
      computePositions([
        tx({
          type: "DEPOSIT",
          source_asset: "usdt-tether",
          source_quantity: 100000,
          price_usd: 1,
          fee,
          transaction_date: "2026-06-15T10:00:00Z",
        }),
        tx({
          type: "BUY",
          source_asset: "usdt-tether",
          source_quantity: 60000,
          target_asset: "btc-bitcoin",
          target_quantity: 1,
          price_usd: 1,
          fee,
          transaction_date: "2026-06-15T10:01:00Z",
        }),
        tx({
          type: "SELL",
          source_asset: "btc-bitcoin",
          source_quantity: 1,
          target_asset: "usdt-tether",
          target_quantity: 65000,
          price_usd: 65000,
          fee,
          transaction_date: "2026-06-15T10:02:00Z",
        }),
      ]);

    const noFee = build(0).positions.get("btc-bitcoin::Binance")!;
    const bigFee = build(999).positions.get("btc-bitcoin::Binance")!;
    expect(bigFee.quantity).toBe(noFee.quantity);
    expect(bigFee.total_cost_usd).toBe(noFee.total_cost_usd);
    expect(bigFee.realized_pnl).toBe(noFee.realized_pnl);
    // sanity: there *was* realized P&L to compare (1 × (65000 − 60000))
    expect(noFee.realized_pnl).toBe(5000);
  });

  it("treats price_usd === 0 as a real price, not as unpriced", () => {
    // 0 passes the `=== null` unpriced guard, so a DEPOSIT at price 0 adds quantity at zero cost.
    const { positions, unpriced } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "doge-dogecoin",
        source_quantity: 1000,
        price_usd: 0,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
    ]);

    expect(unpriced).toHaveLength(0);
    const doge = positions.get("doge-dogecoin::Binance")!;
    expect(doge.quantity).toBe(1000);
    expect(doge.total_cost_usd).toBe(0);
  });

  it("realizes a full loss when disposing at price_usd === 0", () => {
    // Hold 2 BTC at avg cost 60000; selling 1 at a real price of 0 realizes 1 × (0 − 60000).
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 2,
        price_usd: 60000,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "SELL",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        target_asset: "usdt-tether",
        target_quantity: 0,
        price_usd: 0,
        transaction_date: "2026-06-15T10:01:00Z",
      }),
    ]);

    const btc = positions.get("btc-bitcoin::Binance")!;
    expect(btc.realized_pnl).toBe(-60000);
  });

  it("realizes a same-minute SELL regardless of array order (no phantom position) — Risk #2", () => {
    // A funding BUY and its SELL share the same minute-precision transaction_date. created_at
    // encodes causal order (BUY created before SELL). Even passed in reverse array order, the
    // (transaction_date, created_at) sort must run the BUY first so the SELL disposes a funded
    // position — realizing P&L instead of being clamped, and leaving no phantom quantity.
    const buy = tx({
      id: "buy-1",
      type: "BUY",
      source_asset: "usdt-tether",
      source_quantity: 60000,
      target_asset: "btc-bitcoin",
      target_quantity: 1,
      price_usd: 1,
      transaction_date: "2026-06-15T10:00:00Z",
      created_at: "2026-06-15T10:00:00.100Z",
    });
    const sell = tx({
      id: "sell-1",
      type: "SELL",
      source_asset: "btc-bitcoin",
      source_quantity: 1,
      target_asset: "usdt-tether",
      target_quantity: 65000,
      price_usd: 65000,
      transaction_date: "2026-06-15T10:00:00Z",
      created_at: "2026-06-15T10:00:00.200Z",
    });

    const { positions, realizedByTx } = computePositions([sell, buy]); // reverse array order

    expect(realizedByTx.get("sell-1")).toBe(5000); // 1 × (65000 − 60000), not dropped to 0
    expect(positions.get("btc-bitcoin::Binance")!.quantity).toBe(0); // no phantom unit left
  });

  it("documents the failure the created_at tiebreaker prevents (inverted causal order)", () => {
    // If created_at itself were inverted (SELL created before its funding BUY — which cannot happen
    // causally), the SELL sorts first, hits the over-sell clamp, drops its realized P&L to 0, and
    // leaves a phantom BTC unit. This shows created_at is the load-bearing tiebreaker.
    const buy = tx({
      id: "buy-1",
      type: "BUY",
      source_asset: "usdt-tether",
      source_quantity: 60000,
      target_asset: "btc-bitcoin",
      target_quantity: 1,
      price_usd: 1,
      transaction_date: "2026-06-15T10:00:00Z",
      created_at: "2026-06-15T10:00:00.200Z",
    });
    const sell = tx({
      id: "sell-1",
      type: "SELL",
      source_asset: "btc-bitcoin",
      source_quantity: 1,
      target_asset: "usdt-tether",
      target_quantity: 65000,
      price_usd: 65000,
      transaction_date: "2026-06-15T10:00:00Z",
      created_at: "2026-06-15T10:00:00.100Z",
    });

    const { positions, realizedByTx } = computePositions([buy, sell]);

    expect(realizedByTx.get("sell-1")).toBe(0); // clamped — disposal skipped
    expect(positions.get("btc-bitcoin::Binance")!.quantity).toBe(1); // phantom unit
  });

  it("clamps an over-sell to realized 0 without driving quantity negative — Risk #2", () => {
    // SELL against a position that was never funded: the clamp skips the disposal, records 0 (not
    // null, not negative quantity), but the acquisition arm still credits the target asset.
    const { positions, realizedByTx } = computePositions([
      tx({
        id: "oversell-1",
        type: "SELL",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        target_asset: "usdt-tether",
        target_quantity: 65000,
        price_usd: 65000,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
    ]);

    expect(realizedByTx.get("oversell-1")).toBe(0);
    expect(positions.get("btc-bitcoin::Binance")!.quantity).toBe(0); // not negative
    expect(positions.get("usdt-tether::Binance")!.quantity).toBe(65000); // acquisition still ran
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

  it("blends average cost across locations and preserves per-location avg cost", () => {
    // Binance: 1 BTC @ $60,000 (cost 60000); MetaMask: 1 BTC @ $64,000 (cost 64000).
    // Consolidated avg cost = (60000 + 64000) / (1 + 1) = 62000; each location keeps its own avg.
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        price_usd: 60000,
        location: "Binance",
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        price_usd: 64000,
        location: "MetaMask",
        transaction_date: "2026-06-15T10:00:00Z",
      }),
    ]);

    const summaries = aggregateByAsset(positions);
    const btc = summaries.find((s) => s.asset === "btc-bitcoin")!;
    expect(btc.total_quantity).toBe(2);
    expect(btc.avg_cost_usd).toBe(62000);
    expect(btc.locations.find((l) => l.location === "Binance")!.avg_cost_usd).toBe(60000);
    expect(btc.locations.find((l) => l.location === "MetaMask")!.avg_cost_usd).toBe(64000);
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

  it("treats a fully-disposed position with float residue as closed", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754. Withdrawing 0.3 leaves a residue
    // of ~5.5e-17 quantity, which strict `=== 0` would wrongly report as still open.
    // Relative to gross acquired (0.30000000000000004), the threshold is ~3e-10, so the
    // residue is below it and the position is closed.
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 0.1,
        price_usd: 50000,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 0.2,
        price_usd: 50000,
        transaction_date: "2026-06-15T10:01:00Z",
      }),
      tx({
        type: "WITHDRAW",
        source_asset: "btc-bitcoin",
        source_quantity: 0.3,
        target_asset: null,
        target_quantity: null,
        price_usd: 60000,
        transaction_date: "2026-06-16T10:00:00Z",
      }),
    ]);

    const summaries = aggregateByAsset(positions);
    const btc = summaries.find((s) => s.asset === "btc-bitcoin");
    expect(btc!.is_closed).toBe(true);
  });

  it("keeps a genuine dust holding open (residue above the relative threshold)", () => {
    // Acquire 1 BTC, withdraw 0.999999 → 0.000001 BTC genuinely remains. That is far above
    // the relative threshold (1 × 1e-9 = 1e-9), so it must NOT be reported as closed.
    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        price_usd: 60000,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
      tx({
        type: "WITHDRAW",
        source_asset: "btc-bitcoin",
        source_quantity: 0.999999,
        target_asset: null,
        target_quantity: null,
        price_usd: 65000,
        transaction_date: "2026-06-16T10:00:00Z",
      }),
    ]);

    const summaries = aggregateByAsset(positions);
    const btc = summaries.find((s) => s.asset === "btc-bitcoin");
    expect(btc!.is_closed).toBe(false);
  });
});
