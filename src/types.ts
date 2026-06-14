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
  fee: number;
  location: string;
  transaction_date: string;
  created_at: string;
  updated_at: string;
}

export type TransactionInsert = Omit<Transaction, "id" | "user_id" | "fee" | "created_at" | "updated_at"> & {
  fee?: Transaction["fee"];
};
