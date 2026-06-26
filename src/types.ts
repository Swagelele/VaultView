export type TransactionType = "BUY" | "SELL" | "SWAP" | "DEPOSIT" | "WITHDRAW";

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  source_asset: string;
  source_quantity: number;
  target_asset: string | null;
  target_quantity: number | null;
  price: number;
  price_usd: number | null;
  fee: number;
  location: string;
  transaction_date: string;
  created_at: string;
  updated_at: string;
}

export type TransactionInsert = Omit<
  Transaction,
  "id" | "user_id" | "fee" | "price_usd" | "created_at" | "updated_at"
> & {
  fee?: Transaction["fee"];
};

/**
 * A transaction enriched with per-transaction P&L (USD).
 * - `realized_pnl_usd`: gain/loss locked in at disposal; null for DEPOSIT and unpriced rows.
 * - `unrealized_pnl_usd`: live mark-to-market of the lot acquired by this trade (BUY/SWAP target side)
 *   vs the current price — `target_quantity * current_price - source_quantity * price_usd`. Null for
 *   disposals (SELL), stablecoin/unpriced acquisitions, and assets with no current price.
 */
export type TransactionWithPnl = Transaction & {
  realized_pnl_usd: number | null;
  unrealized_pnl_usd: number | null;
};

export interface Position {
  asset: string;
  location: string;
  quantity: number;
  total_cost_usd: number;
  avg_cost_usd: number;
  realized_pnl: number;
}

export interface PortfolioAssetLocation {
  location: string;
  quantity: number;
  avg_cost_usd: number;
  unrealized_pnl: number;
}

export interface PortfolioAsset {
  asset: string;
  symbol: string;
  total_quantity: number;
  avg_cost_usd: number;
  current_price_usd: number | null;
  price_stale: boolean;
  unrealized_pnl_usd: number | null;
  total_realized_pnl_usd: number;
  is_closed: boolean;
  locations: PortfolioAssetLocation[];
}

/**
 * One day in the reconstructed portfolio time-series.
 * - `value_usd`: Σ over held assets of quantity × that day's price (missing price → 0).
 * - `realized_pnl_usd`: cumulative realized P&L from all disposals up to and including this day.
 * - `unrealized_pnl_usd`: Σ over held assets of quantity × (price − avg cost) (missing price → 0).
 * - `total_pnl_usd`: realized + unrealized — the "total earned P&L" curve.
 */
export interface PortfolioHistoryPoint {
  date: string;
  value_usd: number;
  realized_pnl_usd: number;
  unrealized_pnl_usd: number;
  total_pnl_usd: number;
}

/**
 * API response wrapper for the portfolio history series.
 * - `excluded_price_days`: count of held asset-days that fell back to 0 because no historical
 *   price was available — surfaced as an honest "N assets had no price on some days" note.
 */
export interface PortfolioHistoryResponse {
  data: PortfolioHistoryPoint[];
  start_date: string;
  end_date: string;
  excluded_price_days: number;
}

export interface CoinSearchResult {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  is_active: boolean;
}

export interface CoinPrice {
  id: string;
  price_usd: number;
}

export interface PriceLookupResult {
  prices: Record<string, number>;
  stale: boolean;
  updated_at: string | null;
}
