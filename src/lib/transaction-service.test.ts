/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolvePriceUsd } from "./transaction-service";
import { computePositions } from "@/lib/pnl-engine";
import type { Transaction } from "@/types";
import { getPriceForDate } from "@/lib/coinpaprika";

// CoinPaprika is mocked — no network in unit tests. getMultiplePrices is unused here but must be
// present so the module's other exports import cleanly.
vi.mock("@/lib/coinpaprika", () => ({
  getPriceForDate: vi.fn(),
  getMultiplePrices: vi.fn(),
}));

const mockedGetPriceForDate = vi.mocked(getPriceForDate);

describe("resolvePriceUsd — DEPOSIT cost basis (S-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("override wins over everything, even for a non-stablecoin deposit", async () => {
    const price = await resolvePriceUsd("DEPOSIT", "btc-bitcoin", null, null, 1, "2024-01-01T00:00:00Z", 50000);

    expect(price).toBe(50000);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });

  it("stablecoin deposit returns $1 without an API call", async () => {
    const price = await resolvePriceUsd("DEPOSIT", "usdt-tether", null, null, 100, "2026-03-01T00:00:00Z");

    expect(price).toBe(1);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });

  it("non-stablecoin deposit derives cost basis from the historical price at the purchase date", async () => {
    mockedGetPriceForDate.mockResolvedValue(42000);

    const price = await resolvePriceUsd("DEPOSIT", "btc-bitcoin", null, null, 1, "2026-03-01T12:30:00Z");

    expect(price).toBe(42000);
    expect(mockedGetPriceForDate).toHaveBeenCalledWith("btc-bitcoin", "2026-03-01");
  });

  it("returns null when no historical price is available (caller surfaces a 400)", async () => {
    mockedGetPriceForDate.mockResolvedValue(null);

    const price = await resolvePriceUsd("DEPOSIT", "btc-bitcoin", null, null, 1, "2020-01-01T00:00:00Z");

    expect(price).toBeNull();
  });
});

describe("resolvePriceUsd — WITHDRAW realized price (S-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("override wins over everything, even for a non-stablecoin withdraw", async () => {
    const price = await resolvePriceUsd("WITHDRAW", "btc-bitcoin", null, null, 1, "2026-06-17T00:00:00Z", 70000);

    expect(price).toBe(70000);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });

  it("stablecoin withdraw returns $1 without an API call (realized P&L ≈ 0)", async () => {
    const price = await resolvePriceUsd("WITHDRAW", "usdt-tether", null, null, 100, "2026-06-17T00:00:00Z");

    expect(price).toBe(1);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });

  it("non-stablecoin withdraw resolves the current market price via getPriceForDate", async () => {
    mockedGetPriceForDate.mockResolvedValue(70000);

    const price = await resolvePriceUsd("WITHDRAW", "btc-bitcoin", null, null, 1, "2026-06-17T12:30:00Z");

    expect(price).toBe(70000);
    expect(mockedGetPriceForDate).toHaveBeenCalledWith("btc-bitcoin", "2026-06-17");
  });

  it("returns null when no price is available (caller surfaces a 400)", async () => {
    mockedGetPriceForDate.mockResolvedValue(null);

    const price = await resolvePriceUsd("WITHDRAW", "btc-bitcoin", null, null, 1, "2026-06-17T00:00:00Z");

    expect(price).toBeNull();
  });
});

describe("resolvePriceUsd — crypto-to-crypto derivation (Risk #2)", () => {
  // Regression guard for the "120,000 ETH" class of bug (commits 98aaccf, f2705e3): a
  // crypto-to-crypto trade must derive the source's USD price from the TARGET side, so the
  // recorded cost basis reconciles with the engine — never store the raw USD value as a quantity.
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("derives source USD from the target side: (targetQty × targetUsdPrice) / sourceQty", async () => {
    // Sell 2 BTC, receive 40 ETH, with ETH @ $3,000 → trade value 40 × 3000 = $120,000.
    // Source BTC USD price = 120000 / 2 = $60,000 per BTC.
    mockedGetPriceForDate.mockResolvedValue(3000); // ETH price

    const priceUsd = await resolvePriceUsd("SELL", "btc-bitcoin", "eth-ethereum", 40, 2, "2026-06-15T10:00:00Z");

    expect(priceUsd).toBe(60000);
    expect(mockedGetPriceForDate).toHaveBeenCalledWith("eth-ethereum", "2026-06-15");
  });

  it("reconciles the derived price_usd with the engine's target cost basis", async () => {
    // The resolved price_usd (60000) is what gets stored. Feeding it through the engine, the
    // acquired ETH cost basis must equal source_quantity × price_usd AND targetQty × targetUsdPrice.
    mockedGetPriceForDate.mockResolvedValue(3000);
    const priceUsd = await resolvePriceUsd("SELL", "btc-bitcoin", "eth-ethereum", 40, 2, "2026-06-15T10:00:00Z");

    const { positions } = computePositions([
      tx({
        type: "DEPOSIT",
        source_asset: "btc-bitcoin",
        source_quantity: 2,
        price_usd: 50000,
        transaction_date: "2026-06-15T09:00:00Z",
      }),
      tx({
        type: "SELL",
        source_asset: "btc-bitcoin",
        source_quantity: 2,
        target_asset: "eth-ethereum",
        target_quantity: 40,
        price_usd: priceUsd!,
        transaction_date: "2026-06-15T10:00:00Z",
      }),
    ]);

    const eth = positions.get("eth-ethereum::Binance")!;
    expect(eth.quantity).toBe(40);
    // engine cost basis (source_quantity × price_usd) reconciles with target-side valuation
    expect(eth.total_cost_usd).toBe(2 * priceUsd!);
    expect(eth.total_cost_usd).toBe(40 * 3000); // 120000
  });

  it("returns $1 when the source is a stablecoin, with no API call", async () => {
    const priceUsd = await resolvePriceUsd("BUY", "usdt-tether", "btc-bitcoin", 1, 60000, "2026-06-15T10:00:00Z");

    expect(priceUsd).toBe(1);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });

  it("derives implied price from the target stablecoin amount; non-positive → null", async () => {
    // SELL 1 BTC into 65,000 USDT → implied $65,000 per BTC.
    const sell = await resolvePriceUsd("SELL", "btc-bitcoin", "usdt-tether", 65000, 1, "2026-06-15T10:00:00Z");
    expect(sell).toBe(65000);

    // A zero target amount cannot yield a price.
    const zero = await resolvePriceUsd("SELL", "btc-bitcoin", "usdt-tether", 0, 1, "2026-06-15T10:00:00Z");
    expect(zero).toBeNull();
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });
});

describe("resolvePriceUsd — price-API failure degradation (Risk #5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the price API yields nothing (caller maps null → HTTP 400)", async () => {
    // A crypto-to-crypto trade with the API down: target price null, source fallback null → null.
    // createTransaction turns this null into a 400 pointing at the manual-override path.
    mockedGetPriceForDate.mockResolvedValue(null);

    const price = await resolvePriceUsd("SELL", "btc-bitcoin", "eth-ethereum", 40, 2, "2026-06-15T10:00:00Z");

    expect(price).toBeNull();
  });

  it("a manual override short-circuits the API entirely, even with the API down", async () => {
    mockedGetPriceForDate.mockResolvedValue(null);

    const price = await resolvePriceUsd("SELL", "btc-bitcoin", "eth-ethereum", 40, 2, "2026-06-15T10:00:00Z", 60000);

    expect(price).toBe(60000);
    expect(mockedGetPriceForDate).not.toHaveBeenCalled();
  });
});
