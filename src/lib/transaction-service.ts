import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction, TransactionWithPnl } from "@/types";
import { createTransactionSchema, createSellAllGlobalSchema, isUsdStablecoin } from "@/lib/schemas";
import { getPriceForDate, getMultiplePrices } from "@/lib/coinpaprika";
import { computePositions } from "@/lib/pnl-engine";

interface ServiceResult<T> {
  data?: T;
  error?: string;
  status?: number;
}

export async function getHoldingAtLocation(
  supabase: SupabaseClient,
  userId: string,
  asset: string,
  location: string,
): Promise<number> {
  const { data: transactions } = await supabase
    .from("transactions")
    .select("type, source_asset, source_quantity, target_asset, target_quantity, location")
    .eq("user_id", userId)
    .eq("location", location)
    .order("transaction_date", { ascending: true });

  if (!transactions) return 0;

  let quantity = 0;
  for (const tx of transactions) {
    if (tx.type === "DEPOSIT" && tx.source_asset === asset) {
      quantity += Number(tx.source_quantity);
    }
    if ((tx.type === "BUY" || tx.type === "SELL" || tx.type === "SWAP") && tx.source_asset === asset) {
      quantity -= Number(tx.source_quantity);
    }
    if ((tx.type === "BUY" || tx.type === "SELL" || tx.type === "SWAP") && tx.target_asset === asset) {
      quantity += Number(tx.target_quantity);
    }
  }

  return quantity;
}

async function resolvePriceUsd(
  type: string,
  sourceAsset: string,
  targetAsset: string | null | undefined,
  targetQuantity: number | null | undefined,
  sourceQuantity: number,
  transactionDate: string,
  override?: number,
): Promise<number | null> {
  if (override) return override;

  if (type === "DEPOSIT") return 1;

  if (isUsdStablecoin(sourceAsset)) return 1;

  if (targetAsset && isUsdStablecoin(targetAsset)) {
    const price = (targetQuantity ?? 0) / sourceQuantity;
    return price > 0 ? price : null;
  }

  const dateStr = transactionDate.slice(0, 10);

  // Crypto-to-crypto: derive source USD from target side per plan convention
  if (targetAsset && targetQuantity && targetQuantity > 0) {
    const targetUsdPrice = await getPriceForDate(targetAsset, dateStr);
    if (targetUsdPrice !== null) {
      return (targetQuantity * targetUsdPrice) / sourceQuantity;
    }
  }

  const apiPrice = await getPriceForDate(sourceAsset, dateStr);
  return apiPrice;
}

export async function createTransaction(
  supabase: SupabaseClient,
  userId: string,
  data: unknown,
): Promise<ServiceResult<Transaction>> {
  const parsed = createTransactionSchema.safeParse(data);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return { error: messages.join("; "), status: 400 };
  }

  const input = parsed.data;

  if (input.type !== "DEPOSIT") {
    const holding = await getHoldingAtLocation(supabase, userId, input.source_asset, input.location);
    if (holding < input.source_quantity) {
      return {
        error: `Insufficient ${input.source_asset} at ${input.location}: have ${holding}, need ${input.source_quantity}`,
        status: 409,
      };
    }
  }

  const priceUsd = await resolvePriceUsd(
    input.type,
    input.source_asset,
    input.target_asset,
    input.target_quantity,
    input.source_quantity,
    input.transaction_date,
    input.source_price_usd_override,
  );

  if (priceUsd === null) {
    return {
      error:
        "Cannot resolve USD valuation for this transaction. Provide a manual price override or ensure a stablecoin is on one side of the trade.",
      status: 400,
    };
  }

  const price =
    input.type === "DEPOSIT"
      ? 1
      : (input.price ??
        (input.target_quantity && input.source_quantity ? input.target_quantity / input.source_quantity : 1));

  const row = {
    user_id: userId,
    type: input.type,
    source_asset: input.source_asset,
    source_quantity: input.source_quantity,
    target_asset: input.type === "DEPOSIT" ? null : (input.target_asset ?? null),
    target_quantity: input.type === "DEPOSIT" ? null : (input.target_quantity ?? null),
    price,
    price_usd: priceUsd,
    fee: input.fee,
    location: input.location,
    transaction_date: input.transaction_date,
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { data: created, error } = await supabase.from("transactions").insert(row).select().single();

  if (error) {
    return { error: error.message, status: 500 };
  }

  return { data: created as Transaction };
}

export async function createSellAllGlobal(
  supabase: SupabaseClient,
  userId: string,
  data: unknown,
): Promise<ServiceResult<Transaction[]>> {
  const parsed = createSellAllGlobalSchema.safeParse(data);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return { error: messages.join("; "), status: 400 };
  }

  const { source_asset, price, transaction_date, locations } = parsed.data;

  // Validation pass — insert nothing until every location is known-good (all-or-nothing).
  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (const row of locations) {
    const holding = await getHoldingAtLocation(supabase, userId, source_asset, row.location);
    if (holding <= 0) {
      errors.push(`No ${source_asset} to sell at ${row.location} (have ${holding})`);
      continue;
    }

    const targetQuantity = holding * price;

    // Pass the shared form price as the override so recorded cost basis matches what the
    // user saw at submit time (see context/foundation/lessons.md).
    const priceUsd = await resolvePriceUsd(
      "SELL",
      source_asset,
      row.target_asset,
      targetQuantity,
      holding,
      transaction_date,
      price,
    );
    if (priceUsd === null) {
      errors.push(`Cannot resolve USD valuation for ${source_asset} at ${row.location}`);
      continue;
    }

    rows.push({
      user_id: userId,
      type: "SELL",
      source_asset,
      source_quantity: holding,
      target_asset: row.target_asset,
      target_quantity: targetQuantity,
      price,
      price_usd: priceUsd,
      fee: row.fee,
      location: row.location,
      transaction_date,
    });
  }

  if (errors.length > 0) {
    return { error: errors.join("; "), status: 409 };
  }

  // The insert itself is atomic — one multi-row statement, so a constraint violation rolls back
  // all rows (no half-sold portfolio). Note the per-location holdings read above is NOT in the same
  // transaction, so concurrent writers could TOCTOU-oversell; acceptable at the PRD's single-user
  // scale, same posture as createTransaction.
  const { data: created, error } = await supabase.from("transactions").insert(rows).select();

  if (error) {
    return { error: error.message, status: 500 };
  }

  return { data: created as Transaction[] };
}

export async function getTransactions(supabase: SupabaseClient, userId: string): Promise<Transaction[]> {
  const { data } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .order("transaction_date", { ascending: true })
    .order("created_at", { ascending: true });

  return (data ?? []) as Transaction[];
}

/**
 * A trade marks-to-market when it acquired a non-stablecoin asset with a known USD cost — i.e. the
 * target side of a priced BUY/SWAP. SELL proceeds (stablecoin target) and unpriced rows are excluded.
 */
function isMarkableAcquisition(
  tx: Transaction,
): tx is Transaction & { target_asset: string; target_quantity: number; price_usd: number } {
  return (
    tx.target_asset !== null &&
    tx.target_quantity !== null &&
    tx.target_quantity > 0 &&
    tx.price_usd !== null &&
    !isUsdStablecoin(tx.target_asset)
  );
}

export interface TransactionsWithPnlResult {
  data: TransactionWithPnl[];
  // True when any unrealized P&L was computed from stale/last-known prices (mirrors PortfolioResponse,
  // so the transactions UI can flag staleness the same way the dashboard does).
  stale: boolean;
  updated_at: string | null;
}

export async function getTransactionsWithPnl(
  supabase: SupabaseClient,
  userId: string,
): Promise<TransactionsWithPnlResult> {
  const transactions = await getTransactions(supabase, userId);
  const { realizedByTx } = computePositions(transactions);

  // Live prices for every non-stablecoin asset acquired by a BUY/SWAP, so each purchase can show its
  // current unrealized (paper) P&L. getMultiplePrices handles the empty case and its own caching.
  const acquiredAssets = [...new Set(transactions.filter(isMarkableAcquisition).map((tx) => tx.target_asset))];
  const { prices, stale, updated_at } = await getMultiplePrices(acquiredAssets);

  const data = transactions.map((tx) => {
    let unrealizedPnl: number | null = null;
    if (isMarkableAcquisition(tx)) {
      const currentPrice = tx.target_asset in prices ? prices[tx.target_asset] : null;
      if (currentPrice !== null) {
        // Cost basis of the acquired lot = USD spent on the source side (matches the engine's
        // costBasis), valued now at the live price. Buy-and-hold view: counts the full acquired
        // quantity even if some was later sold.
        const costUsd = tx.source_quantity * tx.price_usd;
        unrealizedPnl = tx.target_quantity * currentPrice - costUsd;
      }
    }

    return {
      ...tx,
      realized_pnl_usd: realizedByTx.get(tx.id) ?? null,
      unrealized_pnl_usd: unrealizedPnl,
    };
  });

  return { data, stale, updated_at };
}

export async function getDistinctLocations(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("transactions")
    .select("location")
    .eq("user_id", userId)
    .order("location", { ascending: true });

  if (!data) return [];

  const unique = [...new Set(data.map((r: { location: string }) => r.location))];
  return unique;
}
