import { describe, it, expect } from "vitest";
import { createTransactionSchema } from "./schemas";

describe("createTransactionSchema", () => {
  it("accepts valid USD-stablecoin DEPOSIT", () => {
    const result = createTransactionSchema.safeParse({
      type: "DEPOSIT",
      source_asset: "usdt-tether",
      source_quantity: 1000,
      location: "Binance",
      transaction_date: "2026-06-15T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts non-stablecoin DEPOSIT (S-05)", () => {
    const result = createTransactionSchema.safeParse({
      type: "DEPOSIT",
      source_asset: "btc-bitcoin",
      source_quantity: 1,
      location: "Binance",
      transaction_date: "2026-06-15T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a future-dated DEPOSIT (S-05)", () => {
    const result = createTransactionSchema.safeParse({
      type: "DEPOSIT",
      source_asset: "btc-bitcoin",
      source_quantity: 1,
      location: "Binance",
      transaction_date: "2099-01-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects DEPOSIT with target fields", () => {
    const result = createTransactionSchema.safeParse({
      type: "DEPOSIT",
      source_asset: "usdt-tether",
      source_quantity: 1000,
      target_asset: "btc-bitcoin",
      target_quantity: 1,
      location: "Binance",
      transaction_date: "2026-06-15T10:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid BUY payload", () => {
    const result = createTransactionSchema.safeParse({
      type: "BUY",
      source_asset: "usdt-tether",
      source_quantity: 60000,
      target_asset: "btc-bitcoin",
      target_quantity: 1,
      price: 60000,
      location: "Binance",
      transaction_date: "2026-06-15T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects BUY missing target fields", () => {
    const result = createTransactionSchema.safeParse({
      type: "BUY",
      source_asset: "usdt-tether",
      source_quantity: 60000,
      location: "Binance",
      transaction_date: "2026-06-15T10:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative quantities", () => {
    const result = createTransactionSchema.safeParse({
      type: "DEPOSIT",
      source_asset: "usdt-tether",
      source_quantity: -100,
      location: "Binance",
      transaction_date: "2026-06-15T10:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid SWAP payload", () => {
    const result = createTransactionSchema.safeParse({
      type: "SWAP",
      source_asset: "eth-ethereum",
      source_quantity: 10,
      target_asset: "btc-bitcoin",
      target_quantity: 0.5,
      location: "Binance",
      transaction_date: "2026-06-15T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});
