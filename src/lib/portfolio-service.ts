import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortfolioAsset } from "@/types";
import { getTransactions } from "@/lib/transaction-service";
import { computePositions, aggregateByAsset } from "@/lib/pnl-engine";
import { getMultiplePrices } from "@/lib/coinpaprika";

export interface PortfolioResponse {
  data: PortfolioAsset[];
  stale: boolean;
  updated_at: string | null;
  total_fees_usd: number;
}

export async function getPortfolio(supabase: SupabaseClient, userId: string): Promise<PortfolioResponse> {
  const transactions = await getTransactions(supabase, userId);

  if (transactions.length === 0) {
    return { data: [], stale: false, updated_at: null, total_fees_usd: 0 };
  }

  // Fees are summed as USD (PRD FR-010). The form never captured a fee currency, so a raw sum
  // is the honest MVP total. `fee` is non-null (defaults to 0 in the schema).
  const totalFeesUsd = transactions.reduce((sum, tx) => sum + tx.fee, 0);

  const { positions } = computePositions(transactions);
  const summaries = aggregateByAsset(positions);

  const activeCoinIds = summaries.filter((s) => s.total_quantity > 0).map((s) => s.asset);

  let priceData = { prices: {} as Record<string, number>, stale: false, updated_at: null as string | null };
  if (activeCoinIds.length > 0) {
    priceData = await getMultiplePrices(activeCoinIds);
  }

  const data: PortfolioAsset[] = summaries.map((s) => {
    const currentPrice: number | null = s.asset in priceData.prices ? priceData.prices[s.asset] : null;
    const symbol = s.asset.split("-")[0]?.toUpperCase() ?? s.asset;

    return {
      asset: s.asset,
      symbol,
      total_quantity: s.total_quantity,
      avg_cost_usd: s.avg_cost_usd,
      current_price_usd: currentPrice,
      price_stale: priceData.stale,
      unrealized_pnl_usd:
        currentPrice !== null && s.total_quantity > 0 ? s.total_quantity * (currentPrice - s.avg_cost_usd) : null,
      total_realized_pnl_usd: s.total_realized_pnl,
      is_closed: s.is_closed,
      locations: s.locations.map((loc) => ({
        location: loc.location,
        quantity: loc.quantity,
        avg_cost_usd: loc.avg_cost_usd,
        unrealized_pnl:
          currentPrice !== null && loc.quantity > 0 ? loc.quantity * (currentPrice - loc.avg_cost_usd) : 0,
      })),
    };
  });

  return {
    data,
    stale: priceData.stale,
    updated_at: priceData.updated_at,
    total_fees_usd: totalFeesUsd,
  };
}
