import type { PortfolioAsset } from "@/types";

export interface AllocationSlice {
  /** Stable asset id (uppercase ticker) — used as the color/legend key. */
  asset: string;
  symbol: string;
  /** Current value: total_quantity * current_price_usd. */
  value: number;
  /** Share of totalValue in [0, 1]; 0 when totalValue is 0. */
  fraction: number;
}

export interface AllocationResult {
  /** Priced, held (quantity > 0) assets, sorted by value descending. */
  slices: AllocationSlice[];
  /** Sum of slice values. */
  totalValue: number;
  /** Held assets dropped because they have no current price. */
  excludedCount: number;
}

/**
 * Reduce per-asset portfolio data into the asset-allocation donut breakdown (PRD FR-014).
 *
 * An asset contributes a slice only when it is both held (`total_quantity > 0`) and priced
 * (`current_price_usd !== null`); its value is `total_quantity * current_price_usd`. Held assets
 * without a current price are excluded from the math (so slices always sum to exactly the priced
 * total) and counted in `excludedCount` so the UI can note the omission. Closed / zero-quantity
 * positions are ignored entirely. Slices are sorted largest-first so color indices are stable and
 * the legend reads top-down by weight.
 *
 * Pure and React-free so it can be unit-tested and called on each render with the live
 * (price-refreshed) assets array.
 */
export function computeAllocation(assets: PortfolioAsset[]): AllocationResult {
  const valued: { asset: string; symbol: string; value: number }[] = [];
  let excludedCount = 0;

  for (const asset of assets) {
    if (asset.total_quantity <= 0) continue;
    if (asset.current_price_usd === null) {
      excludedCount += 1;
      continue;
    }
    valued.push({
      asset: asset.asset,
      symbol: asset.symbol,
      value: asset.total_quantity * asset.current_price_usd,
    });
  }

  valued.sort((a, b) => b.value - a.value);

  const totalValue = valued.reduce((sum, v) => sum + v.value, 0);

  const slices: AllocationSlice[] = valued.map((v) => ({
    asset: v.asset,
    symbol: v.symbol,
    value: v.value,
    fraction: totalValue > 0 ? v.value / totalValue : 0,
  }));

  return { slices, totalValue, excludedCount };
}
