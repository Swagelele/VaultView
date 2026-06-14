# Transaction Schema + RLS — Plan Brief

> Full plan: `context/changes/transaction-schema-rls/plan.md`

## What & Why

Create the first database migration for VaultView: a `transactions` table that stores all five crypto transaction types (BUY, SELL, SWAP, DEPOSIT, WITHDRAW) with Row Level Security enforcing per-user data isolation. This is roadmap foundation F-02 — it unlocks every vertical slice (S-01 through S-08).

## Starting Point

The project has a working Supabase auth layer (email/password) but zero custom tables. `auth.users` is the only table. No migrations directory exists yet. The Supabase CLI is installed and configured for local development with PostgreSQL 17.

## Desired End State

A `transactions` table exists in Supabase with RLS policies that guarantee no user can see another user's data. TypeScript types (`Transaction`, `TransactionInsert`, `TransactionType`) are exported from `src/types.ts` for use by all downstream slices. Running `npx supabase db reset` applies the schema cleanly.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|----------|--------|-------------------|
| Table structure | Single table, nullable target columns | Simplest model; DEPOSIT/WITHDRAW leave target_* NULL, BUY/SELL/SWAP fill them |
| Location storage | varchar column in transactions | PRD says free-text with autocomplete, no separate management screen (FR-012) |
| Asset identifiers | CoinPaprika ID format (`btc-bitcoin`) | Maps directly to pricing API with zero conversion |
| Numeric type | PostgreSQL `numeric` (not float) | Exact arithmetic required by PRD Guardrails for P&L correctness |
| Seed data | None | Clean schema-only migration; test data added manually or via UI |

## Scope

**In scope:**
- SQL migration: CREATE TABLE + RLS policies + indexes
- TypeScript types: Transaction, TransactionInsert, TransactionType
- README database setup note update
- Local verification via Supabase Studio

**Out of scope:**
- P&L calculation logic (S-01)
- API routes for CRUD (S-01)
- UI components (S-01)
- CHECK constraints for type-dependent nullability (app-level validation in S-01)
- Separate locations table
- Seed data or test fixtures; Phase 1 may add an empty/comment-only `supabase/seed.sql` placeholder for the current Supabase config

## Architecture / Approach

Single migration file via `npx supabase migration new`. One table with a `transaction_type` enum, source-side columns (always populated), target-side columns (nullable for one-sided operations), price, fee, location varchar, and timestamps. Four RLS policies (SELECT/INSERT/UPDATE/DELETE) all using `auth.uid() = user_id`. Four indexes for the primary query patterns (by user, by date, by source asset, by target asset).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. SQL Migration | `transactions` table + RLS + indexes in Supabase | Schema design error costs a migration in every later slice |
| 2. TypeScript Types | `Transaction`, `TransactionInsert`, `TransactionType` in `src/types.ts` | Types must match DB schema exactly |

**Prerequisites:** Local Supabase running (`npx supabase start`, requires Docker)
**Estimated effort:** ~1 session, 2 phases

## Open Risks & Assumptions

- Schema is designed for MVP scale (small data volume); no partitioning needed
- `numeric` type handles crypto precision (up to 18 decimal places for some tokens) — verified sufficient
- No CHECK constraint enforcing "target columns must be NULL for DEPOSIT/WITHDRAW" — validated at app level in S-01

## Success Criteria (Summary)

- `npx supabase db reset` applies migration without errors
- RLS verified: user A's transactions invisible to user B
- TypeScript types compile and are importable via `@/types`
