import { createClient } from "@supabase/supabase-js";
import type { Transaction, TransactionType } from "@/types";
import { url, anonKey, serviceRoleKey } from "./config";

/**
 * Map an interface to an equivalent object-literal type so it carries an implicit string index
 * signature. `@supabase/supabase-js`'s `GenericTable` constraint requires `Row extends
 * Record<string, unknown>`, and TS interfaces are NOT assignable to index signatures (only type
 * aliases / mapped types are). Without this, the schema fails `extends GenericSchema`, `Schema`
 * collapses to `never`, and `.insert()` ends up typed as `never[]`.
 */
type Indexed<T> = { [K in keyof T]: T[K] };

/**
 * The columns a caller may set when inserting a transaction. `id`, `created_at`, and `updated_at`
 * are DB-defaulted; `fee` and `price_usd` are optional. Mirrors the row shape built by
 * `src/lib/transaction-service.ts`. It is wrapped with `Indexed<>` inside `IntegrationDatabase`
 * because this interface, on its own, does not satisfy the `GenericTable` index-signature constraint.
 */
export interface TransactionInsert {
  user_id: string;
  type: TransactionType;
  source_asset: string;
  source_quantity: number;
  target_asset?: string | null;
  target_quantity?: number | null;
  price: number;
  price_usd?: number | null;
  fee?: number;
  location: string;
  transaction_date: string;
}

/**
 * Minimal typed schema for the `transactions` table so `@supabase/supabase-js` returns typed rows
 * and checks inserts — without a generated Database type.
 */
export interface IntegrationDatabase {
  public: {
    Tables: {
      transactions: {
        Row: Indexed<Transaction>;
        Insert: Indexed<TransactionInsert>;
        Update: Indexed<Partial<TransactionInsert>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: { transaction_type: TransactionType };
    CompositeTypes: Record<string, never>;
  };
}

// Resolve the client type from `createClient`'s instantiation, NOT from `SupabaseClient<IntegrationDatabase>`
// directly: the latter lets SupabaseClient's own generic defaults collapse `Schema` to `never` (so
// `.insert()` types as `never[]`). Deriving it from a factory return also works but reintroduces that
// collapse once other factories are annotated with this alias — the createClient instantiation form is stable.
export type IntegrationClient = ReturnType<typeof createClient<IntegrationDatabase>>;

/**
 * Service-role client — bypasses RLS. Use ONLY for seeding fixtures and reading ground-truth
 * state. Never use it for the Risk #4 isolation assertions (it would defeat the boundary).
 */
export function serviceClient(): IntegrationClient {
  return createClient<IntegrationDatabase>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * User-scoped client — sends the user's JWT as a bearer token so PostgREST resolves `auth.uid()`
 * and RLS is enforced exactly as in production. This is the client the isolation tests assert
 * through.
 */
export function userClient(accessToken: string): IntegrationClient {
  return createClient<IntegrationDatabase>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Plain anon client with no session — used to exchange credentials for a user JWT during signin. */
export function anonClient(): IntegrationClient {
  return createClient<IntegrationDatabase>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
