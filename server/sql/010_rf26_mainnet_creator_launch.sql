-- RelicForge Mainnet Part 6E.1 R1.1
-- Backend Creator Launch Gate
--
-- Enables the certified Ethereum Mainnet release for creator deployment on the
-- backend while intentionally keeping the Studio/browser gate and public
-- discovery disabled.
--
-- The migration runner replays numbered SQL on every startup. Migration 009
-- restages the certified release locked; this migration then reapplies the
-- separately approved creator-launch policy after exact identity validation.

DO $rf26_creator_launch$
DECLARE
  r rf26_networks%ROWTYPE;
BEGIN
  SELECT *
    INTO r
    FROM rf26_networks
   WHERE chain_id = 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RF26 6E.1: Ethereum Mainnet network row is missing';
  END IF;

  IF r.kind IS DISTINCT FROM 'production' THEN
    RAISE EXCEPTION 'RF26 6E.1: chain 1 is not marked production';
  END IF;

  IF lower(COALESCE(r.factory_address, '')) <> '0xd614d4dd3757365fb456789d2669dd55b6e6d6d5' THEN
    RAISE EXCEPTION 'RF26 6E.1: certified Factory mismatch';
  END IF;

  IF COALESCE(r.release_id, '') <> 'RelicForge-Mainnet-R12V2-R1' THEN
    RAISE EXCEPTION 'RF26 6E.1: release ID mismatch';
  END IF;

  IF lower(COALESCE(r.release_manifest_hash, '')) <> 'ad99569e1dd416a01c0f159ab2bb6c2fe7749ee50aa44527c32639983ee57c14' THEN
    RAISE EXCEPTION 'RF26 6E.1: deployment manifest hash mismatch';
  END IF;

  IF COALESCE(r.configuration->>'manifestSchema', '') <> 'relic-forge/production-release@1' THEN
    RAISE EXCEPTION 'RF26 6E.1: manifest schema mismatch';
  END IF;

  IF COALESCE(r.configuration->>'environment', '') <> 'production' THEN
    RAISE EXCEPTION 'RF26 6E.1: production environment marker mismatch';
  END IF;

  IF lower(COALESCE(r.configuration->>'planId', '')) <> '13633669dfa0f4a98fcf21d0ee8d3a4b512cd9c9cc146d1244b4702e7f232382' THEN
    RAISE EXCEPTION 'RF26 6E.1: deployment plan ID mismatch';
  END IF;

  IF lower(COALESCE(r.configuration #>> '{addresses,factory}', '')) <> '0xd614d4dd3757365fb456789d2669dd55b6e6d6d5' OR
     lower(COALESCE(r.configuration #>> '{addresses,feePolicy}', '')) <> '0x61c5c153e96a9ded09fe3afcdca65a5958281e67' OR
     lower(COALESCE(r.configuration #>> '{addresses,collectionImplementation}', '')) <> '0x43bc4a9181960601c13b96f630adee74a0b219cf' OR
     lower(COALESCE(r.configuration #>> '{addresses,dataImplementation}', '')) <> '0x5cac5280b00ee729c9351c0e3235151c645f9834' OR
     lower(COALESCE(r.configuration #>> '{addresses,mintPhasesImplementation}', '')) <> '0xd7ef23619fab079941b05bdc2ac0f5ff90af4e4a' OR
     lower(COALESCE(r.configuration #>> '{addresses,renderer}', '')) <> '0xf449700e0fafdb1d0edb1af40096f61c229bc41f' OR
     lower(COALESCE(r.configuration #>> '{addresses,randomnessAdapter}', '')) <> '0x231ccd119188c3e9a8ae18b62dc536d8e3ed675a' OR
     lower(COALESCE(r.configuration #>> '{addresses,reserve}', '')) <> '0xf20442fcf072f87bb694eb6b7697ee2362ce5a49' OR
     lower(COALESCE(r.configuration #>> '{addresses,canonicalRegistry}', '')) <> '0xc9a8096aa3ead34282fbf24eaacabd414a00ee31'
  THEN
    RAISE EXCEPTION 'RF26 6E.1: certified infrastructure address set mismatch';
  END IF;

  IF COALESCE(r.configuration #>> '{reservePolicy,operatingMode}', '') <>
       'underfunded-operation-permitted-with-revenue-release-floor' THEN
    RAISE EXCEPTION 'RF26 6E.1: reserve operating mode mismatch';
  END IF;

  IF COALESCE((r.configuration #>> '{reservePolicy,launchPrefundingRequired}')::boolean, TRUE) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'RF26 6E.1: unexpected reserve prefunding requirement';
  END IF;

  UPDATE rf26_networks
     SET launch_enabled = TRUE,
         public_enabled = FALSE,
         updated_at = now()
   WHERE chain_id = 1;

  IF NOT EXISTS (
    SELECT 1
      FROM rf26_networks
     WHERE chain_id = 1
       AND kind = 'production'
       AND launch_enabled = TRUE
       AND public_enabled = FALSE
       AND lower(factory_address) = '0xd614d4dd3757365fb456789d2669dd55b6e6d6d5'
       AND release_id = 'RelicForge-Mainnet-R12V2-R1'
       AND lower(release_manifest_hash) = 'ad99569e1dd416a01c0f159ab2bb6c2fe7749ee50aa44527c32639983ee57c14'
  ) THEN
    RAISE EXCEPTION 'RF26 6E.1: creator launch policy did not reach the required final state';
  END IF;
END
$rf26_creator_launch$;
