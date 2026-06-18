import type { Transaction } from "@/types";

// A position is "closed" when its remaining quantity is within this fraction of the total
// quantity ever acquired for the asset. Average-cost subtraction (and binary float arithmetic on
// quantities like 0.1 + 0.2) can leave sub-atomic residue after a full disposal; a strict `=== 0`
// check would wrongly report such a position as still open. The tolerance is *relative* to the
// processed magnitude so it stays correct across asset scales (1 BTC vs. millions of SHIB).
const CLOSED_EPSILON = 1e-9;

export interface PositionEntry {
  asset: string;
  location: string;
  quantity: number;
  total_cost_usd: number;
  realized_pnl: number;
  // Gross quantity ever acquired into this position (DEPOSIT + target acquisitions), never
  // decremented on disposal. Used only as the magnitude reference for the relative is_closed check.
  acquired_quantity: number;
}

export type PositionMap = Map<string, PositionEntry>;

function positionKey(asset: string, location: string): string {
  return `${asset}::${location}`;
}

function getOrCreate(map: PositionMap, asset: string, location: string): PositionEntry {
  const key = positionKey(asset, location);
  let entry = map.get(key);
  if (!entry) {
    entry = { asset, location, quantity: 0, total_cost_usd: 0, realized_pnl: 0, acquired_quantity: 0 };
    map.set(key, entry);
  }
  return entry;
}

export interface UnpricedTransaction {
  id: string;
  type: string;
}

export interface ComputeResult {
  positions: PositionMap;
  unpriced: UnpricedTransaction[];
  // Realized P&L (USD) keyed by Transaction.id, captured at the disposal step. DEPOSIT and unpriced
  // transactions are absent (callers surface them as `null`); a clamped over-sell records 0.
  realizedByTx: Map<string, number>;
}

export function computePositions(transactions: Transaction[]): ComputeResult {
  const positions: PositionMap = new Map();
  const unpriced: UnpricedTransaction[] = [];
  const realizedByTx = new Map<string, number>();

  // Sort by transaction_date, then by created_at as a deterministic tiebreaker. Without the
  // tiebreaker, same-minute ties (datetime inputs are minute-precision) order nondeterministically;
  // if a SELL sorts before the BUY that funds it, the `quantity > 0` clamp below silently skips the
  // SELL while the BUY still adds — producing a phantom position and dropping the SELL's realized
  // P&L. created_at reflects causal insertion order (a funding BUY is always created before its SELL).
  const sorted = [...transactions].sort((a, b) => {
    const byDate = new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime();
    if (byDate !== 0) return byDate;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  for (const tx of sorted) {
    if (tx.price_usd === null) {
      unpriced.push({ id: tx.id, type: tx.type });
      continue;
    }

    if (tx.type === "DEPOSIT") {
      const pos = getOrCreate(positions, tx.source_asset, tx.location);
      pos.quantity += tx.source_quantity;
      pos.total_cost_usd += tx.source_quantity * tx.price_usd;
      pos.acquired_quantity += tx.source_quantity;
      continue;
    }

    // SELL / SWAP / WITHDRAW all dispose of the source asset and realize P&L against average cost.
    // WITHDRAW (S-06) has a null target, so the acquisition arm below is naturally skipped — a
    // one-sided cash-out that only reduces the position. No type-specific branch is needed here.
    const sourcePos = getOrCreate(positions, tx.source_asset, tx.location);
    if (sourcePos.quantity > 0) {
      const avgCost = sourcePos.total_cost_usd / sourcePos.quantity;
      const realizedPnl = tx.source_quantity * (tx.price_usd - avgCost);
      sourcePos.realized_pnl += realizedPnl;
      sourcePos.quantity -= tx.source_quantity;
      sourcePos.total_cost_usd -= tx.source_quantity * avgCost;
      realizedByTx.set(tx.id, realizedPnl);
    } else {
      // Over-sell against an empty/closed position: the clamp skips the disposal, so no P&L is
      // realized for this transaction. Record 0 (not null) — the trade is priced, just not funded.
      realizedByTx.set(tx.id, 0);
    }

    if (tx.target_asset && tx.target_quantity) {
      const targetPos = getOrCreate(positions, tx.target_asset, tx.location);
      const costBasis = tx.source_quantity * tx.price_usd;
      targetPos.quantity += tx.target_quantity;
      targetPos.total_cost_usd += costBasis;
      targetPos.acquired_quantity += tx.target_quantity;
    }
  }

  return { positions, unpriced, realizedByTx };
}

export interface AssetSummary {
  asset: string;
  total_quantity: number;
  total_cost_usd: number;
  avg_cost_usd: number;
  total_realized_pnl: number;
  is_closed: boolean;
  locations: {
    location: string;
    quantity: number;
    avg_cost_usd: number;
    realized_pnl: number;
  }[];
}

export function aggregateByAsset(positionMap: PositionMap): AssetSummary[] {
  const assetMap = new Map<string, AssetSummary>();
  // Gross acquired quantity per asset across all its locations — the magnitude reference for the
  // relative is_closed tolerance. Kept off AssetSummary since it is an internal computation input.
  const acquiredByAsset = new Map<string, number>();

  for (const entry of positionMap.values()) {
    let summary = assetMap.get(entry.asset);
    if (!summary) {
      summary = {
        asset: entry.asset,
        total_quantity: 0,
        total_cost_usd: 0,
        avg_cost_usd: 0,
        total_realized_pnl: 0,
        is_closed: false,
        locations: [],
      };
      assetMap.set(entry.asset, summary);
    }

    summary.total_quantity += entry.quantity;
    summary.total_cost_usd += entry.total_cost_usd;
    summary.total_realized_pnl += entry.realized_pnl;
    acquiredByAsset.set(entry.asset, (acquiredByAsset.get(entry.asset) ?? 0) + entry.acquired_quantity);

    summary.locations.push({
      location: entry.location,
      quantity: entry.quantity,
      avg_cost_usd: entry.quantity > 0 ? entry.total_cost_usd / entry.quantity : 0,
      realized_pnl: entry.realized_pnl,
    });
  }

  for (const summary of assetMap.values()) {
    summary.avg_cost_usd = summary.total_quantity > 0 ? summary.total_cost_usd / summary.total_quantity : 0;
    // Closed when the remaining quantity is exactly zero, or within a tolerance relative to the
    // gross quantity ever acquired — absorbing float residue without masking genuine dust holdings.
    const grossAcquired = acquiredByAsset.get(summary.asset) ?? 0;
    summary.is_closed =
      summary.total_quantity === 0 || Math.abs(summary.total_quantity) < grossAcquired * CLOSED_EPSILON;
  }

  return [...assetMap.values()];
}
