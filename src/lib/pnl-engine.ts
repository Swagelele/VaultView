import type { Transaction } from "@/types";

export interface PositionEntry {
  asset: string;
  location: string;
  quantity: number;
  total_cost_usd: number;
  realized_pnl: number;
}

export type PositionMap = Map<string, PositionEntry>;

function positionKey(asset: string, location: string): string {
  return `${asset}::${location}`;
}

function getOrCreate(map: PositionMap, asset: string, location: string): PositionEntry {
  const key = positionKey(asset, location);
  let entry = map.get(key);
  if (!entry) {
    entry = { asset, location, quantity: 0, total_cost_usd: 0, realized_pnl: 0 };
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
}

export function computePositions(transactions: Transaction[]): ComputeResult {
  const positions: PositionMap = new Map();
  const unpriced: UnpricedTransaction[] = [];

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime(),
  );

  for (const tx of sorted) {
    if (tx.price_usd === null) {
      unpriced.push({ id: tx.id, type: tx.type });
      continue;
    }

    if (tx.type === "DEPOSIT") {
      const pos = getOrCreate(positions, tx.source_asset, tx.location);
      pos.quantity += tx.source_quantity;
      pos.total_cost_usd += tx.source_quantity * tx.price_usd;
      continue;
    }

    const sourcePos = getOrCreate(positions, tx.source_asset, tx.location);
    if (sourcePos.quantity > 0) {
      const avgCost = sourcePos.total_cost_usd / sourcePos.quantity;
      const realizedPnl = tx.source_quantity * (tx.price_usd - avgCost);
      sourcePos.realized_pnl += realizedPnl;
      sourcePos.quantity -= tx.source_quantity;
      sourcePos.total_cost_usd -= tx.source_quantity * avgCost;
    }

    if (tx.target_asset && tx.target_quantity) {
      const targetPos = getOrCreate(positions, tx.target_asset, tx.location);
      const costBasis = tx.source_quantity * tx.price_usd;
      targetPos.quantity += tx.target_quantity;
      targetPos.total_cost_usd += costBasis;
    }
  }

  return { positions, unpriced };
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

    summary.locations.push({
      location: entry.location,
      quantity: entry.quantity,
      avg_cost_usd: entry.quantity > 0 ? entry.total_cost_usd / entry.quantity : 0,
      realized_pnl: entry.realized_pnl,
    });
  }

  for (const summary of assetMap.values()) {
    summary.avg_cost_usd = summary.total_quantity > 0 ? summary.total_cost_usd / summary.total_quantity : 0;
    summary.is_closed = summary.total_quantity === 0;
  }

  return [...assetMap.values()];
}
