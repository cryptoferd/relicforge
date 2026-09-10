-- Relic Forge Phase 2B R1: additive, private-by-default deployment model.
-- No existing project snapshots, collection addresses, or asset rows are deleted.
-- Apply only after a database backup and on a reviewed backend release.

CREATE TABLE IF NOT EXISTS rf26_networks (
  chain_id BIGINT PRIMARY KEY CHECK (chain_id > 0),
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('testnet','production')),
  launch_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  public_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  factory_address TEXT,
  release_id TEXT,
  release_manifest_hash TEXT,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT public_enabled OR (kind='production' AND launch_enabled AND factory_address IS NOT NULL AND release_id IS NOT NULL AND release_manifest_hash IS NOT NULL)),
  CHECK (kind <> 'testnet' OR public_enabled=FALSE)
);

-- These seeds do not enable new production deployments or discovery.
INSERT INTO rf26_networks(chain_id,label,kind,launch_enabled,public_enabled,factory_address,release_id)
VALUES
(1,'Ethereum Mainnet','production',FALSE,FALSE,NULL,NULL),
(11155111,'Ethereum Sepolia','testnet',TRUE,FALSE,'0x2d63a398c037fe9ea09c7176eab378c5a51fa88d','r12-v2-sepolia')
ON CONFLICT (chain_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS rf26_project_launch_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Launch configuration',
  target_chain_id BIGINT REFERENCES rf26_networks(chain_id),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rf26_launch_drafts_project_idx ON rf26_project_launch_drafts(project_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS rf26_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  owner_wallet TEXT NOT NULL,
  factory_address TEXT,
  provenance TEXT,
  architecture TEXT NOT NULL DEFAULT 'legacy' CHECK (architecture IN ('legacy','v2')),
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','preparing','deployed','sealed','failed')),
  deployment_journal JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chain_id,contract_address),
  FOREIGN KEY(chain_id,contract_address) REFERENCES collections(chain_id,contract_address) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rf26_deployments_project_idx ON rf26_deployments(project_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS rf26_deployments_owner_idx ON rf26_deployments(owner_wallet,updated_at DESC);

CREATE TABLE IF NOT EXISTS rf26_publications (
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  owner_wallet TEXT NOT NULL,
  listed BOOLEAN NOT NULL DEFAULT FALSE,
  feature_requested BOOLEAN NOT NULL DEFAULT FALSE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  slug TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,contract_address),
  FOREIGN KEY(chain_id,contract_address) REFERENCES collections(chain_id,contract_address) ON DELETE CASCADE,
  FOREIGN KEY(chain_id) REFERENCES rf26_networks(chain_id),
  CHECK (slug IS NULL OR (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' AND position('--' in slug)=0)),
  CHECK (NOT featured OR (listed AND feature_requested))
);
CREATE UNIQUE INDEX IF NOT EXISTS rf26_publications_slug_unique ON rf26_publications(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS rf26_publications_listed_idx ON rf26_publications(chain_id,updated_at DESC) WHERE listed;

CREATE OR REPLACE FUNCTION rf26_enforce_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n rf26_networks%ROWTYPE; c_owner TEXT; architecture TEXT;
BEGIN
  SELECT * INTO n FROM rf26_networks WHERE chain_id=NEW.chain_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unregistered network cannot publish collections'; END IF;
  SELECT owner_wallet INTO c_owner FROM collections
    WHERE chain_id=NEW.chain_id AND contract_address=NEW.contract_address;
  IF c_owner IS NULL OR lower(c_owner)<>lower(NEW.owner_wallet) THEN
    RAISE EXCEPTION 'Publication owner does not match collection owner';
  END IF;
  IF (NEW.listed OR NEW.feature_requested OR NEW.featured OR NEW.slug IS NOT NULL)
     AND (n.kind <> 'production' OR NOT n.public_enabled) THEN
    RAISE EXCEPTION 'Only enabled production networks may publish, feature, or claim slugs';
  END IF;
  IF NEW.listed OR NEW.feature_requested OR NEW.featured OR NEW.slug IS NOT NULL THEN
    SELECT d.architecture INTO architecture FROM rf26_deployments d
      WHERE d.chain_id=NEW.chain_id AND d.contract_address=NEW.contract_address;
    IF architecture IS DISTINCT FROM 'v2' THEN
      RAISE EXCEPTION 'Only verified V2 deployments may be publicly published';
    END IF;
  END IF;
  IF NEW.slug IS NOT NULL AND NEW.slug = ANY(ARRAY[
    'admin','api','assets','auth','dashboard','docs','help','home','index',
    'mint','new','reliquary','settings','studio','support','testnet','upcoming',
    'www','relicforge','ethereum','sepolia'
  ]) THEN RAISE EXCEPTION 'This slug is reserved'; END IF;
  IF TG_OP='UPDATE' AND OLD.slug IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'Mint-page slug is permanent; a dedicated redirect-preserving rename is required';
  END IF;
  NEW.updated_at=now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rf26_publication_guard ON rf26_publications;
CREATE TRIGGER rf26_publication_guard BEFORE INSERT OR UPDATE ON rf26_publications
FOR EACH ROW EXECUTE FUNCTION rf26_enforce_publication();

-- The old mint-page JSON flag is not a publication authorization. Older clients
-- may save settings, but cannot make testnets discoverable or claim production URLs.
CREATE OR REPLACE FUNCTION rf26_guard_collection_page() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n rf26_networks%ROWTYPE;
BEGIN
  SELECT * INTO n FROM rf26_networks WHERE chain_id=NEW.chain_id;
  IF NOT FOUND OR n.kind <> 'production' OR NOT n.public_enabled THEN
    IF COALESCE(NEW.mint_page->>'showcaseEnabled','false')='true'
       OR COALESCE(NEW.mint_page->>'featured','false')='true'
       OR COALESCE(NEW.mint_page->>'featureRequested','false')='true'
       OR COALESCE(NEW.mint_page->>'listed','false')='true'
       OR NEW.mint_page ? 'slug' THEN
      RAISE EXCEPTION 'Public discovery, featuring, and custom slugs are unavailable on this network';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rf26_collection_page_guard ON collections;
CREATE TRIGGER rf26_collection_page_guard BEFORE INSERT OR UPDATE OF mint_page,chain_id ON collections
FOR EACH ROW EXECUTE FUNCTION rf26_guard_collection_page();

-- Preserve all historical rows. Never copy old showcase flags into public opt-in.
INSERT INTO rf26_deployments(project_id,chain_id,contract_address,owner_wallet,status)
SELECT c.project_id,c.chain_id,c.contract_address,c.owner_wallet,'registered'
FROM collections c
ON CONFLICT(chain_id,contract_address) DO NOTHING;

-- A public-facing projection. Direct mint URLs still query the original table.
CREATE OR REPLACE VIEW rf26_public_collections AS
SELECT c.chain_id,c.contract_address,c.owner_wallet,d.project_id,c.mint_page,
       c.created_at,c.updated_at,p.slug,p.featured,p.feature_requested
FROM collections c
JOIN rf26_publications p USING(chain_id,contract_address)
JOIN rf26_networks n ON n.chain_id=c.chain_id
JOIN rf26_deployments d ON d.chain_id=c.chain_id AND d.contract_address=c.contract_address
WHERE d.architecture='v2' AND n.kind='production' AND n.public_enabled AND p.listed=TRUE
  AND c.owner_wallet=p.owner_wallet AND d.owner_wallet=c.owner_wallet;

-- Cleanly separate legacy publication fields from testnet records without
-- discarding artwork, metadata, or presentation settings.
UPDATE collections c
SET mint_page=(c.mint_page - 'showcaseEnabled' - 'featured' - 'featureRequested' - 'listed' - 'slug')
             || jsonb_build_object('showcaseEnabled',false),updated_at=now()
WHERE NOT EXISTS (
  SELECT 1 FROM rf26_networks n WHERE n.chain_id=c.chain_id
  AND n.kind='production' AND n.public_enabled
)
AND (c.mint_page ? 'slug' OR c.mint_page ? 'featured'
     OR c.mint_page ? 'featureRequested' OR c.mint_page ? 'listed'
     OR c.mint_page->>'showcaseEnabled'='true');
