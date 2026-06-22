import type { Transaction } from "@/types";
import type { IntegrationClient, TransactionInsert } from "./clients";

/**
 * Small typed helpers over the Supabase client so test files read transaction rows as `Transaction`
 * without repeating query plumbing.
 */

export interface TxFilter {
  id?: string;
  userId?: string;
  sourceAsset?: string;
  location?: string;
}

/** Insert one row (typically with the service-role/seed client) and return the persisted record. */
export async function seedTransaction(client: IntegrationClient, row: TransactionInsert): Promise<Transaction> {
  const res = await client.from("transactions").insert(row).select().single();
  if (res.error) {
    throw new Error(`seedTransaction failed: ${res.error.message}`);
  }
  return res.data;
}

/** Read transaction rows visible to `client` (RLS applies for user-scoped clients), optionally filtered. */
export async function selectTransactions(client: IntegrationClient, filter: TxFilter = {}): Promise<Transaction[]> {
  let query = client.from("transactions").select("*");
  if (filter.id) query = query.eq("id", filter.id);
  if (filter.userId) query = query.eq("user_id", filter.userId);
  if (filter.sourceAsset) query = query.eq("source_asset", filter.sourceAsset);
  if (filter.location) query = query.eq("location", filter.location);

  const res = await query;
  if (res.error) {
    throw new Error(`selectTransactions failed: ${res.error.message}`);
  }
  return res.data;
}

/** Count transaction rows visible to `client`, optionally filtered. */
export async function countTransactions(client: IntegrationClient, filter: TxFilter = {}): Promise<number> {
  const rows = await selectTransactions(client, filter);
  return rows.length;
}
