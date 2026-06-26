import type { Transaction, PortfolioHistoryPoint } from "@/types";
import { applyTransaction, sortByDateThenCreated, type PositionMap } from "@/lib/pnl-engine";
import { isUsdStablecoin } from "@/lib/schemas";

const DAY_MS = 86_400_000;

export interface PortfolioHistoryResult {
  points: PortfolioHistoryPoint[];
  // Count of held asset-days that fell back to 0 because no historical price was available. Only the
  // reconstruction knows per-day holdings, so the excluded count must originate here (the service
  // wraps it into PortfolioHistoryResponse.excluded_price_days). A held asset-day with a missing
  // price is counted once; days where the asset is not held (quantity ≤ 0) are never counted.
  excludedPriceDays: number;
}

// Enumerate every calendar day (UTC, YYYY-MM-DD) from startDate to endDate inclusive. UTC anchoring
// keeps the step exactly 24h regardless of DST.
function enumerateDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  for (let t = start; t <= end; t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

// Resolve an asset's price on a given day: stablecoins are a constant 1; everything else comes from
// the per-asset series. A missing series entry returns null — the caller treats it as a 0
// contribution and bumps the excluded counter.
function priceFor(asset: string, day: string, priceSeriesByAsset: Map<string, Map<string, number>>): number | null {
  if (isUsdStablecoin(asset)) return 1;
  return priceSeriesByAsset.get(asset)?.get(day) ?? null;
}

/**
 * Reconstruct a daily portfolio value + P&L series by replaying the transaction ledger against
 * per-asset historical price series. Walks each day from `startDate` to `endDate`, applying that
 * day's transactions to a running average-cost PositionMap (the same arithmetic as `pnl-engine`,
 * via the shared `applyTransaction`), then valuing the open holdings at that day's prices.
 *
 * Correctness rules (PRD arithmetic guardrail):
 * - Transactions are applied in (transaction_date, created_at) order; a day's holdings are
 *   snapshotted AFTER all of that day's transactions (so a same-day BUY→SELL prices correctly).
 * - Any transaction dated on/before the first window day is folded into that first day, so the
 *   opening snapshot reflects pre-window holdings (window start may be clamped to ~365d ago while
 *   the ledger reaches further back).
 * - `value_usd = Σ qty × price` and `unrealized = Σ qty × (price − avgCost)`, with a missing price
 *   counted as 0 (never NaN) and tallied into `excludedPriceDays`.
 * - `realized_pnl_usd` accumulates disposal P&L across days (cumulative, never resets).
 */
export function computePortfolioHistory(
  transactions: Transaction[],
  priceSeriesByAsset: Map<string, Map<string, number>>,
  opts: { startDate: string; endDate: string },
): PortfolioHistoryResult {
  const days = enumerateDays(opts.startDate, opts.endDate);
  if (days.length === 0) {
    return { points: [], excludedPriceDays: 0 };
  }

  const sorted = sortByDateThenCreated(transactions);

  // Group transactions by their calendar day for O(1) lookup during the walk. The first window day
  // also absorbs everything strictly before it (pre-window holdings).
  const txByDay = new Map<string, Transaction[]>();
  const firstDay = days[0];
  for (const tx of sorted) {
    const txDay = tx.transaction_date.slice(0, 10);
    const bucket = txDay < firstDay ? firstDay : txDay;
    const arr = txByDay.get(bucket);
    if (arr) arr.push(tx);
    else txByDay.set(bucket, [tx]);
  }

  const positions: PositionMap = new Map();
  let cumulativeRealized = 0;
  let excludedPriceDays = 0;
  const points: PortfolioHistoryPoint[] = [];

  for (const day of days) {
    // Apply all of this day's transactions before snapshotting (already in causal order).
    for (const tx of txByDay.get(day) ?? []) {
      const { realized } = applyTransaction(positions, tx);
      if (realized !== null) cumulativeRealized += realized;
    }

    let value = 0;
    let unrealized = 0;
    for (const pos of positions.values()) {
      if (pos.quantity <= 0) continue; // closed/empty positions contribute nothing
      const price = priceFor(pos.asset, day, priceSeriesByAsset);
      if (price === null) {
        excludedPriceDays += 1; // held asset with no price this day → 0 contribution
        continue;
      }
      const avgCost = pos.total_cost_usd / pos.quantity;
      value += pos.quantity * price;
      unrealized += pos.quantity * (price - avgCost);
    }

    points.push({
      date: day,
      value_usd: value,
      realized_pnl_usd: cumulativeRealized,
      unrealized_pnl_usd: unrealized,
      total_pnl_usd: cumulativeRealized + unrealized,
    });
  }

  return { points, excludedPriceDays };
}
