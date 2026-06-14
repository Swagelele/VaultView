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

  -- Price per unit of source asset
  price numeric NOT NULL CHECK (price > 0),

  -- Fee
  fee numeric NOT NULL DEFAULT 0 CHECK (fee >= 0),

  -- Location label
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
