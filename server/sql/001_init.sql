CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS auth_nonces (
  wallet TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON projects(owner_wallet, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_versions (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, version)
);

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet TEXT NOT NULL,
  project_id UUID,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  purpose TEXT NOT NULL DEFAULT 'project',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS assets_owner_sha_idx ON assets(owner_wallet, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(project_id);

CREATE TABLE IF NOT EXISTS collections (
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  owner_wallet TEXT NOT NULL,
  project_id UUID,
  mint_page JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id, contract_address)
);
CREATE INDEX IF NOT EXISTS collections_owner_idx ON collections(owner_wallet, updated_at DESC);

CREATE TABLE IF NOT EXISTS whitelists (
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  source_type INTEGER NOT NULL DEFAULT 0,
  source_chain_id BIGINT NOT NULL DEFAULT 0,
  source_contract TEXT,
  snapshot_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id, contract_address)
);

CREATE TABLE IF NOT EXISTS whitelist_entries (
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  wallet TEXT NOT NULL,
  allowance BIGINT NOT NULL,
  proof JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY(chain_id, contract_address, wallet)
);
CREATE INDEX IF NOT EXISTS whitelist_wallet_idx ON whitelist_entries(chain_id, contract_address, wallet);

CREATE TABLE IF NOT EXISTS render_cache (
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  token_id BIGINT NOT NULL,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id, contract_address, token_id)
);
