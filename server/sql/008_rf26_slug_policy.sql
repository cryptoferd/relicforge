-- RelicForge Phase 2B R3B: permanent URL and publication policy.
-- Additive to 007. Review and back up the database before a separate migration.
-- This file does not enable production, change infrastructure, or alter artwork.

DO $$
BEGIN
 IF to_regclass('public.rf26_publications') IS NULL OR
    to_regclass('public.rf26_deployments') IS NULL OR
    to_regclass('public.rf26_networks') IS NULL THEN
   RAISE EXCEPTION 'RF26 foundation migration 007 must be applied first';
 END IF;
END $$;

-- Refuse to silently rename, delete, or transfer a pre-existing claim.
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM rf26_publications WHERE slug IS NOT NULL AND
   (slug = ANY(ARRAY[
     'admin','api','app','assets','auth','blog','collections','create','dashboard',
     'docs','ethereum','explore','favicon','forge','help','home','how-to','index',
     'login','logout','mainnet','mint','new','profile','projects','relicforge',
     'reliquary','settings','static','studio','support','test','testnet','upcoming',
     'v1','v2','www','sepolia'
   ]) OR slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'
      OR position('--' in slug)>0 OR slug ~ '^0x[0-9a-f]{40}$')
 ) THEN
   RAISE EXCEPTION 'Existing mint URL conflicts with R3B policy; review it before migration';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION rf26_enforce_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 n rf26_networks%ROWTYPE;
 c_owner TEXT;
 d_owner TEXT;
 d_factory TEXT;
 d_status TEXT;
 d_provenance TEXT;
 d_architecture TEXT;
BEGIN
 SELECT * INTO n FROM rf26_networks WHERE chain_id=NEW.chain_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unregistered network cannot publish collections'; END IF;
 SELECT owner_wallet INTO c_owner FROM collections
   WHERE chain_id=NEW.chain_id AND contract_address=NEW.contract_address;
 IF c_owner IS NULL OR lower(c_owner)<>lower(NEW.owner_wallet) THEN
   RAISE EXCEPTION 'Publication owner does not match collection owner';
 END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.chain_id IS DISTINCT FROM OLD.chain_id OR
      NEW.contract_address IS DISTINCT FROM OLD.contract_address OR
      lower(NEW.owner_wallet) IS DISTINCT FROM lower(OLD.owner_wallet) THEN
     RAISE EXCEPTION 'Publication identity is immutable';
   END IF;
   IF OLD.slug IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
     RAISE EXCEPTION 'Mint-page slug is permanent; a redirect-preserving rename is required';
   END IF;
 END IF;
 IF NEW.slug IS NOT NULL AND NEW.slug ~ '^0x[0-9a-f]{40}$' THEN
   RAISE EXCEPTION 'An EVM address cannot be used as a custom slug';
 END IF;
 IF NEW.slug IS NOT NULL AND NEW.slug = ANY(ARRAY[
   'admin','api','app','assets','auth','blog','collections','create','dashboard',
   'docs','ethereum','explore','favicon','forge','help','home','how-to','index',
   'login','logout','mainnet','mint','new','profile','projects','relicforge',
   'reliquary','settings','static','studio','support','test','testnet','upcoming',
   'v1','v2','www','sepolia'
 ]) THEN RAISE EXCEPTION 'This slug is reserved'; END IF;
 IF (NEW.listed OR NEW.feature_requested OR NEW.featured OR NEW.slug IS NOT NULL) THEN
   IF n.kind<>'production' OR NOT n.launch_enabled OR NOT n.public_enabled OR
      n.factory_address IS NULL OR n.release_id IS NULL OR n.release_manifest_hash IS NULL THEN
     RAISE EXCEPTION 'Only activated production networks may publish or claim slugs';
   END IF;
   SELECT owner_wallet,factory_address,status,provenance,architecture
     INTO d_owner,d_factory,d_status,d_provenance,d_architecture
     FROM rf26_deployments
     WHERE chain_id=NEW.chain_id AND contract_address=NEW.contract_address;
   IF d_architecture IS DISTINCT FROM 'v2' OR d_status IS DISTINCT FROM 'sealed' OR
      lower(d_owner) IS DISTINCT FROM lower(c_owner) OR
      lower(d_factory) IS DISTINCT FROM lower(n.factory_address) OR
      d_provenance IS NULL OR d_provenance !~ '^0x[0-9a-fA-F]{64}$' OR
      d_provenance= ('0x' || repeat('0',64)) THEN
     RAISE EXCEPTION 'A sealed verified V2 deployment is required for public publication';
   END IF;
 END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rf26_publication_guard ON rf26_publications;
CREATE TRIGGER rf26_publication_guard BEFORE INSERT OR UPDATE ON rf26_publications
FOR EACH ROW EXECUTE FUNCTION rf26_enforce_publication();

-- Keep the existing projection columns so Reliquary and discovery consumers
-- remain compatible. Never promote legacy showcase flags.
CREATE OR REPLACE VIEW rf26_public_collections AS
SELECT c.chain_id,c.contract_address,c.owner_wallet,d.project_id,c.mint_page,
       c.created_at,c.updated_at,p.slug,p.featured,p.feature_requested
FROM collections c
JOIN rf26_publications p USING(chain_id,contract_address)
JOIN rf26_networks n ON n.chain_id=c.chain_id
JOIN rf26_deployments d USING(chain_id,contract_address)
WHERE d.architecture='v2' AND d.status='sealed'
  AND d.provenance ~ '^0x[0-9a-fA-F]{64}$'
  AND d.provenance<>('0x' || repeat('0',64))
  AND n.kind='production' AND n.launch_enabled AND n.public_enabled
  AND n.factory_address IS NOT NULL AND n.release_id IS NOT NULL
  AND n.release_manifest_hash IS NOT NULL
  AND lower(d.factory_address)=lower(n.factory_address)
  AND p.listed=TRUE
  AND lower(c.owner_wallet)=lower(p.owner_wallet)
  AND lower(d.owner_wallet)=lower(c.owner_wallet);

-- Existing unique index and permanent-claim trigger from 007 remain in force.
-- No seeds, network flags, or historical collection records are changed.
