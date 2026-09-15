-- RelicForge R12-v2 R2: editable custom mint aliases.
-- The contract-address mint URL remains canonical and permanent.
-- A custom slug is a mutable database alias. Replacing it atomically releases
-- the old slug so another verified production collection may claim it.

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
      d_provenance=('0x' || repeat('0',64)) THEN
     RAISE EXCEPTION 'A sealed verified V2 deployment is required for public publication';
   END IF;
 END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS rf26_publication_guard ON rf26_publications;
CREATE TRIGGER rf26_publication_guard BEFORE INSERT OR UPDATE ON rf26_publications
FOR EACH ROW EXECUTE FUNCTION rf26_enforce_publication();

-- rf26_publications_slug_unique remains the global uniqueness authority.
-- Updating a row from old-slug -> new-slug removes old-slug from the database
-- in the same transaction, making it available immediately after COMMIT.
