# Transaction Schema + RLS Implementation Plan

## Overview

Create the first Supabase migration for VaultView: a `transactions` table that stores all five transaction types (BUY, SELL, SWAP, DEPOSIT, WITHDRAW) in a single structure, with Row Level Security policies enforcing per-user data isolation. Add TypeScript types for the transaction domain model.

## Current State Analysis

- **Database**: PostgreSQL 17 via Supabase. Zero custom tables — only `auth.users` exists.
- **Migrations**: `supabase/migrations/` directory does not exist. `config.toml` has `schema_paths = []`.
- **Auth**: Email/password fully implemented. `context.locals.user` is `@supabase/supabase-js.User | null` with `user.id` as UUID. `auth.uid()` available in Postgres via JWT.
- **Types**: No `src/types.ts` exists. No domain types defined.
- **Supabase CLI**: `supabase` 2.23.4 in devDependencies — can run `npx supabase migration new`.

### Key Discoveries:

- `src/lib/supabase.ts:6-8` — `createClient()` returns `null` when env vars missing; all callers handle this
- `src/middleware.ts:9` — `supabase.auth.getUser()` extracts the user; `user.id` is the UUID that `auth.uid()` resolves to in RLS policies
- `supabase/config.toml:53-58` — migrations enabled but no paths configured; first migration will auto-configure
- `astro.config.mjs:16-21` — env vars via `astro:env/server`, not `process.env`

## Desired End State

A `transactions` table exists in Supabase with:
- Fields covering all 5 transaction types (nullable target columns for one-sided operations)
- RLS enabled with CRUD policies scoped to `auth.uid() = user_id`
- Indexes on `user_id`, `transaction_date`, and both asset sides for query performance
- TypeScript types (`Transaction`, `TransactionInsert`, `TransactionType`) exported from `src/types.ts`

Verification: `npx supabase db reset` applies cleanly; inserting a row with one user and querying as another returns zero rows.

## What We're NOT Doing

- P&L calculation logic (that's S-01)
- API routes for CRUD operations (that's S-01)
- UI components (that's S-01)
- Seed data or test fixtures (only an empty/comment-only `supabase/seed.sql` placeholder if current config requires it)
- Separate `locations` table (locations are varchar in transactions per decision)
- CHECK constraints on nullable columns (keeping schema simple for MVP; app-level validation in S-01)

## Implementation Approach

Single migration file using Supabase CLI conventions. One table, four RLS policies (SELECT/INSERT/UPDATE/DELETE), four indexes covering user/date/source-asset/target-asset access. TypeScript types mirror the DB schema using the CoinPaprika ID format for assets.

## Phase 1: SQL Migration

### Overview

Create the first Supabase migration with the `transactions` table, RLS policies, and performance indexes.

### Changes Required:

#### 1. Create migration file

**File**: `supabase/migrations/<timestamp>_create_transactions.sql`

**Intent**: First migration for VaultView. Creates the `transactions` table with columns for all 5 transaction types in a single structure. Target-side columns (target_asset, target_quantity) are nullable — populated for BUY/SELL/SWAP, NULL for DEPOSIT/WITHDRAW.

**Contract**: The migration must be generated via `npx supabase migration new create_transactions` (creates the timestamped file in `supabase/migrations/`). The SQL creates:

```sql
-- Transaction type enum
CREATE TYPE transaction_type AS ENUM ('BUY', 'SELL', 'SWAP', 'DEPOSIT', 'WITHDRAW');

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type transaction_type NOT NULL,
  
  -- Source side (always present for all types)
  source_asset varchar NOT NULL,
  source_quantity numeric NOT NULL CHECK (source_quantity > 0),
  
  -- Target side (NULL for DEPOSIT/WITHDRAW)
  target_asset varchar,
  target_quantity numeric CHECK (target_quantity IS NULL OR target_quantity > 0),
  
  -- Price per unit of source asset (exchange rate for trades, cost basis for DEPOSIT, market price for WITHDRAW)
  price numeric NOT NULL CHECK (price > 0),
  
  -- Fee
  fee numeric NOT NULL DEFAULT 0 CHECK (fee >= 0),
  
  -- Location label (free-text, e.g., 'Binance', 'MetaMask', 'Cold Wallet')
  location varchar NOT NULL,
  
  -- User-specified transaction date/time
  transaction_date timestamptz NOT NULL,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON transactions FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, transaction_date DESC);
CREATE INDEX idx_transactions_user_source_asset ON transactions(user_id, source_asset);
CREATE INDEX idx_transactions_user_target_asset ON transactions(user_id, target_asset) WHERE target_asset IS NOT NULL;
```

The `numeric` type (not `decimal` or `float`) is critical for financial data — it stores exact values without floating-point rounding errors, which directly supports the PRD Guardrail requiring arithmetically verifiable P&L.

#### 2. Empty seed placeholder

**File**: `supabase/seed.sql` (new file)

**Intent**: Satisfy the current Supabase config (`[db.seed] enabled = true`, `sql_paths = ["./seed.sql"]`) during `npx supabase db reset` without adding seed data or fixtures.

**Contract**: Create an empty or comment-only SQL file. Do not insert test rows or seed records in this phase.

#### 3. README database setup note

**File**: `README.md`

**Intent**: Keep setup documentation accurate now that the project will have an application table and Supabase migration.

**Contract**: Replace the current note that no database tables or migrations are required with a short note that the transactions migration applies via `npx supabase db reset` during local setup.

### Success Criteria:

#### Automated Verification:

- Migration file exists in `supabase/migrations/`
- Empty/comment-only `supabase/seed.sql` exists for the configured seed path
- `npx supabase db reset` completes without errors (requires local Supabase running)
- Table `transactions` visible in Supabase Studio at `http://localhost:54323`

#### Manual Verification:

- RLS blocks access from a different authenticated user context; verify via two signed-in Supabase clients or Supabase Studio SQL that explicitly sets `role authenticated` and `request.jwt.claim.sub` for user A/user B before SELECT/INSERT/UPDATE/DELETE checks
- Confirm all columns have correct types and constraints
- README database setup note reflects the transactions migration and local `db reset` step

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: TypeScript Types

### Overview

Create domain types that mirror the database schema, providing type safety for all transaction operations in the application layer.

### Changes Required:

#### 1. Transaction types

**File**: `src/types.ts` (new file)

**Intent**: Define TypeScript types for the transaction domain model. These types will be used by API routes (S-01), P&L engine (S-01), and UI components (S-01+). Using CoinPaprika asset IDs as branded strings for type clarity.

**Contract**: Export these types:
- `TransactionType` — union type matching the DB enum: `'BUY' | 'SELL' | 'SWAP' | 'DEPOSIT' | 'WITHDRAW'`
- `Transaction` — full row type matching all DB columns (id, user_id, type, source_asset, source_quantity, target_asset (nullable), target_quantity (nullable), price, fee, location, transaction_date, created_at, updated_at)
- `TransactionInsert` — type for creating new transactions: `Omit<Transaction, 'id' | 'user_id' | 'fee' | 'created_at' | 'updated_at'> & { fee?: Transaction['fee'] }` (user_id set server-side from auth, fee defaults to 0, timestamps auto-generated)

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes with no errors on `src/types.ts`
- Types are importable: `import type { Transaction, TransactionInsert, TransactionType } from '@/types'`

#### Manual Verification:

- Types accurately reflect the DB schema column-by-column

---

## Testing Strategy

### Unit Tests:

- Not applicable for this foundation — no business logic. Type correctness verified by TypeScript compiler.

### Integration Tests:

- Migration applies cleanly on fresh database (`npx supabase db reset`)
- RLS policies enforce data isolation (manual SQL verification)

### Manual Testing Steps:

1. Start local Supabase: `npx supabase start`
2. Apply migration: `npx supabase db reset`
3. Open Supabase Studio (`http://localhost:54323`) → verify `transactions` table exists with correct columns
4. Create or identify two auth users and note their UUIDs
5. Verify RLS with two signed-in Supabase clients, or in SQL Editor by wrapping each user-context check in a transaction: `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '<user-uuid>', true); ...; ROLLBACK;`
6. Insert/select/update/delete as user A, then repeat SELECT/UPDATE/DELETE as user B and verify user A's row is invisible and blocked

## Performance Considerations

Four indexes cover the primary query patterns:
- `idx_transactions_user_id` — base filter for all user queries (RLS + application)
- `idx_transactions_user_date` — portfolio view sorts by date descending
- `idx_transactions_user_source_asset` — per-asset P&L queries filter by disposed/source asset
- `idx_transactions_user_target_asset` — per-asset P&L queries filter by acquired/target asset

Asset filters must query both sides of a two-sided trade: `source_asset = <asset>` OR `target_asset = <asset>`.

At MVP scale (small data volume per PRD), these are sufficient. No partitioning or materialized views needed.

## Migration Notes

- First migration in the project — `supabase/migrations/` directory created by `npx supabase migration new`
- Current Supabase config points `db.seed.sql_paths` at `./seed.sql`; create an empty/comment-only `supabase/seed.sql` so `db reset` has a configured seed file without adding seed data
- Migration is forward-only; rollback = drop table (acceptable for first migration, no existing data)
- Production deployment: `npx supabase db push` or via CI pipeline

## References

- Roadmap F-02: `context/foundation/roadmap.md` (lines 68-79)
- PRD Business Logic: `context/foundation/prd.md` §Business Logic
- PRD NFR data isolation: `context/foundation/prd.md` §Non-Functional Requirements
- Supabase client: `src/lib/supabase.ts`
- Auth middleware: `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: SQL Migration

#### Automated

- [x] 1.1 Migration file exists in `supabase/migrations/`
- [x] 1.2 Empty/comment-only `supabase/seed.sql` exists for the configured seed path
- [x] 1.3 `npx supabase db reset` completes without errors
- [x] 1.4 Table `transactions` visible in Supabase Studio

#### Manual

- [ ] 1.5 RLS blocks access from different user context (authenticated-context test)
- [ ] 1.6 All columns have correct types and constraints
- [ ] 1.7 README database setup note reflects the transactions migration and local `db reset` step

### Phase 2: TypeScript Types

#### Automated

- [ ] 2.1 `npm run lint` passes on `src/types.ts`
- [ ] 2.2 Types importable via `@/types`

#### Manual

- [ ] 2.3 Types accurately reflect DB schema
