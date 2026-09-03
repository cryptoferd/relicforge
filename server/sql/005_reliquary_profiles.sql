-- Relic Forge My Reliquary v1
-- Wallet profile identity + reconstructable onchain activity ledger.

CREATE TABLE IF NOT EXISTS reliquary_profiles (
  wallet TEXT PRIMARY KEY,
  username TEXT,
  bio TEXT NOT NULL DEFAULT '',
  pfp_chain_id BIGINT,
  pfp_contract_address TEXT,
  pfp_token_id TEXT,
  stats_cache JSONB NOT NULL DEFAULT '{}'::jsonb,
  stats_refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reliquary_username_shape CHECK (
    username IS NULL OR username ~ '^[A-Za-z][A-Za-z0-9_]{2,23}$'
  ),
  CONSTRAINT reliquary_bio_length CHECK (char_length(bio) <= 280),
  CONSTRAINT reliquary_pfp_complete CHECK (
    (pfp_chain_id IS NULL AND pfp_contract_address IS NULL AND pfp_token_id IS NULL)
    OR
    (pfp_chain_id IS NOT NULL AND pfp_contract_address IS NOT NULL AND pfp_token_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS reliquary_username_lower_uidx
  ON reliquary_profiles ((lower(username)))
  WHERE username IS NOT NULL;

CREATE OR REPLACE FUNCTION reliquary_lock_username()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.username IS NOT NULL AND NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'Reliquary username is permanent and cannot be changed.';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reliquary_lock_username_trigger ON reliquary_profiles;
CREATE TRIGGER reliquary_lock_username_trigger
BEFORE UPDATE ON reliquary_profiles
FOR EACH ROW EXECUTE FUNCTION reliquary_lock_username();

CREATE TABLE IF NOT EXISTS reliquary_mint_activity (
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  wallet TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_time TIMESTAMPTZ,
  phase_id INTEGER,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  native_value_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
  platform_fee_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
  fee_mode SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id, contract_address, wallet, tx_hash)
);

CREATE INDEX IF NOT EXISTS reliquary_mint_wallet_time_idx
  ON reliquary_mint_activity(wallet, block_time DESC);

CREATE TABLE IF NOT EXISTS reliquary_transfer_activity (
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  wallet TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_time TIMESTAMPTZ,
  token_id TEXT NOT NULL,
  from_wallet TEXT NOT NULL,
  to_wallet TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('mint','in','out')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id, contract_address, wallet, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS reliquary_transfer_wallet_token_idx
  ON reliquary_transfer_activity(wallet, chain_id, contract_address, token_id, block_number DESC, log_index DESC);

CREATE INDEX IF NOT EXISTS reliquary_transfer_wallet_time_idx
  ON reliquary_transfer_activity(wallet, block_time DESC);

CREATE TABLE IF NOT EXISTS reliquary_scan_state (
  wallet TEXT NOT NULL,
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  first_scan_block BIGINT NOT NULL,
  last_scanned_block BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(wallet, chain_id, contract_address)
);
