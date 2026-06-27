import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortfolioHistoryResponse } from "@/types";
import { getTransactions } from "@/lib/transaction-service";
import { getHistoricalPriceSeries } from "@/lib/prices";
import { isUsdStablecoin } from "@/lib/schemas";
import { computePortfolioHistory } from "@/lib/portfolio-history";

const DAY_MS = 86_400_000;

// The window spans at most ~1 year of daily points — a deliberate product bound on the history
// chart, not a provider constraint (Binance klines return multi-year history). Floor the window at
// 364 days ago; the client slices shorter ranges from the returned series.
const WINDOW_FLOOR_DAYS = 364;

function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Orchestrate the reconstruct-on-read portfolio history:
 * 1. Load the user's transactions (DB read errors propagate — see getTransactions / M3L5).
 * 2. Derive the window: start = max(first transaction date, 364 days ago), end = today (UTC).
 * 3. Fetch a daily price series per non-stablecoin asset ever held (stablecoins price at 1 in the
 *    engine, so they need no fetch), concurrently.
 * 4. Reconstruct the daily value + P&L series.
 *
 * Always returns the full window (≤365 daily points); the client slices ranges. Returns an empty
 * series (anchored at today) when the user has no transactions.
 */
export async function getPortfolioHistory(supabase: SupabaseClient, userId: string): Promise<PortfolioHistoryResponse> {
  const transactions = await getTransactions(supabase, userId);

  const todayMs = Date.parse(`${dayString(Date.now())}T00:00:00Z`);
  const endDate = dayString(todayMs);

  if (transactions.length === 0) {
    return { data: [], start_date: endDate, end_date: endDate, excluded_price_days: 0 };
  }

  // getTransactions returns rows ascending by (transaction_date, created_at), so [0] is the earliest.
  const firstTxMs = Date.parse(`${transactions[0].transaction_date.slice(0, 10)}T00:00:00Z`);
  const floorMs = todayMs - WINDOW_FLOOR_DAYS * DAY_MS;
  const startMs = Math.max(firstTxMs, floorMs);
  const startDate = dayString(startMs);

  // Inclusive day count from start to today — the Binance klines `limit` and the engine's window length.
  const days = Math.round((todayMs - startMs) / DAY_MS) + 1;

  // Distinct non-stablecoin assets ever touched (source or target). Stablecoins are priced at a
  // constant 1 inside the engine, so they need no series fetch.
  const assets = new Set<string>();
  for (const tx of transactions) {
    if (!isUsdStablecoin(tx.source_asset)) assets.add(tx.source_asset);
    if (tx.target_asset && !isUsdStablecoin(tx.target_asset)) assets.add(tx.target_asset);
  }

  // One Binance klines call per asset, concurrently — never loop the per-day fetch (the 365×N trap).
  const assetList = [...assets];
  const seriesList = await Promise.all(assetList.map((asset) => getHistoricalPriceSeries(asset, startDate, days)));
  const priceSeriesByAsset = new Map(assetList.map((asset, i) => [asset, seriesList[i]]));

  const { points, excludedPriceDays } = computePortfolioHistory(transactions, priceSeriesByAsset, {
    startDate,
    endDate,
  });

  return {
    data: points,
    start_date: startDate,
    end_date: endDate,
    excluded_price_days: excludedPriceDays,
  };
}
