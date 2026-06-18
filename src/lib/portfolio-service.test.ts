import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the boundaries getPortfolio depends on: the DB read and the price API. The fee total is
// pure arithmetic over the returned transactions, so neither boundary needs real data.
vi.mock("@/lib/transaction-service", () => ({ getTransactions: vi.fn() }));
vi.mock("@/lib/coinpaprika", () => ({ getMultiplePrices: vi.fn() }));

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "@/types";
import { getPortfolio } from "./portfolio-service";
import { getTransactions } from "@/lib/transaction-service";
import { getMultiplePrices } from "@/lib/coinpaprika";

const getTransactionsMock = vi.mocked(getTransactions);
const getMultiplePricesMock = vi.mocked(getMultiplePrices);

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

const supabase = null as unknown as SupabaseClient;

describe("getPortfolio — total fees (FR-010)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMultiplePricesMock.mockResolvedValue({ prices: {}, stale: false, updated_at: null });
  });

  it("sums fee across all transactions, independent of P&L", async () => {
    getTransactionsMock.mockResolvedValue([
      tx({ type: "DEPOSIT", source_asset: "btc-bitcoin", source_quantity: 1, price_usd: 60000, fee: 10 }),
      tx({
        type: "SELL",
        source_asset: "btc-bitcoin",
        source_quantity: 1,
        target_asset: "usdt-tether",
        target_quantity: 65000,
        price_usd: 65000,
        fee: 25.5,
      }),
    ]);

    const result = await getPortfolio(supabase, "user-1");
    expect(result.total_fees_usd).toBe(35.5);
  });

  it("reports zero fees for an empty portfolio", async () => {
    getTransactionsMock.mockResolvedValue([]);

    const result = await getPortfolio(supabase, "user-1");
    expect(result.total_fees_usd).toBe(0);
  });
});
