/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the two boundaries getPortfolioHistory orchestrates: the DB read and the price-series fetch.
// The reconstruction engine runs for real so the service's wiring (window derivation, asset set,
// engine call) is exercised end-to-end.
vi.mock("@/lib/transaction-service", () => ({ getTransactions: vi.fn() }));
vi.mock("@/lib/prices", () => ({ getHistoricalPriceSeries: vi.fn() }));

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "@/types";
import { getPortfolioHistory } from "./portfolio-history-service";
import { computePortfolioHistory } from "./portfolio-history";
import { getTransactions } from "@/lib/transaction-service";
import { getHistoricalPriceSeries } from "@/lib/prices";

const getTransactionsMock = vi.mocked(getTransactions);
const getHistoricalPriceSeriesMock = vi.mocked(getHistoricalPriceSeries);

const DAY_MS = 86_400_000;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
}

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    user_id: "user-1",
    type: "BUY",
    source_asset: "USDT",
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

// A price-series stub that covers every day in the requested window at a flat price.
function flatSeries(price: number) {
  return (_asset: string, startDate: string, days: number): Promise<Map<string, number>> => {
    const start = Date.parse(`${startDate}T00:00:00Z`);
    const m = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      m.set(new Date(start + i * DAY_MS).toISOString().slice(0, 10), price);
    }
    return Promise.resolve(m);
  };
}

const supabase = null as unknown as SupabaseClient;

describe("getPortfolioHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty series anchored at today when there are no transactions", async () => {
    getTransactionsMock.mockResolvedValue([]);

    const result = await getPortfolioHistory(supabase, "user-1");

    expect(result.data).toEqual([]);
    expect(result.excluded_price_days).toBe(0);
    expect(result.start_date).toBe(result.end_date);
    expect(getHistoricalPriceSeriesMock).not.toHaveBeenCalled();
  });

  it("derives the window from the first transaction and emits one point per day to today", async () => {
    getTransactionsMock.mockResolvedValue([
      tx({
        type: "DEPOSIT",
        source_asset: "BTC",
        source_quantity: 1,
        price_usd: 50000,
        transaction_date: `${daysAgo(3)}T10:00:00Z`,
        created_at: `${daysAgo(3)}T10:00:00Z`,
      }),
    ]);
    getHistoricalPriceSeriesMock.mockImplementation(flatSeries(50000));

    const result = await getPortfolioHistory(supabase, "user-1");

    expect(result.start_date).toBe(daysAgo(3));
    expect(result.end_date).toBe(daysAgo(0));
    expect(result.data).toHaveLength(4); // days 3,2,1,0 ago inclusive
    expect(result.data[0].date).toBe(daysAgo(3));
    expect(result.data.at(-1)!.date).toBe(daysAgo(0));
    expect(result.excluded_price_days).toBe(0);
  });

  it("fetches one series per distinct non-stablecoin asset (stablecoins need none)", async () => {
    getTransactionsMock.mockResolvedValue([
      tx({
        type: "DEPOSIT",
        source_asset: "USDT",
        source_quantity: 100000,
        price_usd: 1,
        transaction_date: `${daysAgo(2)}T10:00:00Z`,
      }),
      tx({
        type: "BUY",
        source_asset: "USDT",
        source_quantity: 50000,
        target_asset: "BTC",
        target_quantity: 1,
        price_usd: 1,
        transaction_date: `${daysAgo(2)}T10:01:00Z`,
      }),
      tx({
        type: "SWAP",
        source_asset: "BTC",
        source_quantity: 0.5,
        target_asset: "ETH",
        target_quantity: 8,
        price_usd: 3000,
        transaction_date: `${daysAgo(1)}T10:00:00Z`,
      }),
    ]);
    getHistoricalPriceSeriesMock.mockImplementation(flatSeries(40000));

    await getPortfolioHistory(supabase, "user-1");

    // BTC + ETH → 2 fetches; USDT (stablecoin) is not fetched.
    expect(getHistoricalPriceSeriesMock).toHaveBeenCalledTimes(2);
    const fetchedAssets = getHistoricalPriceSeriesMock.mock.calls.map((c) => c[0]).sort();
    expect(fetchedAssets).toEqual(["BTC", "ETH"]);
  });

  it("last point matches a direct engine call over the same window + series", async () => {
    const transactions = [
      tx({
        type: "DEPOSIT",
        source_asset: "BTC",
        source_quantity: 2,
        price_usd: 50000,
        transaction_date: `${daysAgo(2)}T10:00:00Z`,
      }),
    ];
    getTransactionsMock.mockResolvedValue(transactions);
    getHistoricalPriceSeriesMock.mockImplementation(flatSeries(60000));

    const result = await getPortfolioHistory(supabase, "user-1");

    // Rebuild the same per-asset series the service fed the engine, then compare the last point.
    const series = await flatSeries(60000)("BTC", result.start_date, result.data.length);
    const direct = computePortfolioHistory(transactions, new Map([["BTC", series]]), {
      startDate: result.start_date,
      endDate: result.end_date,
    });

    expect(result.data.at(-1)).toEqual(direct.points.at(-1));
    // Sanity: 2 BTC marked at 60000 against 50000 cost → value 120000, unrealized 20000.
    expect(result.data.at(-1)!.value_usd).toBe(120000);
    expect(result.data.at(-1)!.unrealized_pnl_usd).toBe(20000);
  });

  it("propagates a DB read failure instead of swallowing it (M3L5)", async () => {
    getTransactionsMock.mockRejectedValue(new Error("Failed to read transactions: boom"));

    await expect(getPortfolioHistory(supabase, "user-1")).rejects.toThrow("Failed to read transactions");
  });
});
