import type { PortfolioAsset } from "@/types";

export interface PortfolioSummary {
  total_realized_pnl_usd: number;
  total_unrealized_pnl_usd: number | null;
  net_pnl_usd: number | null;
  total_fees_usd: number;
}

/**
 * Aggregate per-asset portfolio data into the flat dashboard totals (PRD FR-010).
 *
 * - Realized P&L sums across ALL assets (including fully-closed positions), and is
 *   price-independent.
 * - Unrealized P&L sums only over held assets (quantity > 0). It is null-collapsing: if any
 *   held asset has a null `unrealized_pnl_usd` (no current price), the whole total is `null`
 *   rather than a misleading partial sum. Closed assets (qty 0) are skipped here.
 * - Net P&L is realized + unrealized, or `null` when unrealized is `null`.
 *
 * Pure and React-free so it can be unit-tested and called client-side on each render with the
 * live (price-refreshed) assets array.
 */
export function computeSummary(assets: PortfolioAsset[], totalFeesUsd: number): PortfolioSummary {
  let totalRealized = 0;
  let totalUnrealized: number | null = 0;

  for (const asset of assets) {
    totalRealized += asset.total_realized_pnl_usd;

    if (asset.total_quantity > 0) {
      if (asset.unrealized_pnl_usd === null) {
        totalUnrealized = null;
      } else if (totalUnrealized !== null) {
        totalUnrealized += asset.unrealized_pnl_usd;
      }
    }
  }

  const netPnl = totalUnrealized === null ? null : totalRealized + totalUnrealized;

  return {
    total_realized_pnl_usd: totalRealized,
    total_unrealized_pnl_usd: totalUnrealized,
    net_pnl_usd: netPnl,
    total_fees_usd: totalFeesUsd,
  };
}
