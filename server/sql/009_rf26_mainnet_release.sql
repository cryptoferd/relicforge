-- RelicForge Mainnet Part 6C R1: stage the certified Ethereum Mainnet release.
-- IMPORTANT: this migration CONFIGURES the release but does NOT enable creator
-- launches or public discovery. Part 6D is the separate activation boundary.

INSERT INTO rf26_networks(
  chain_id,label,kind,launch_enabled,public_enabled,factory_address,
  release_id,release_manifest_hash,configuration,updated_at
)
VALUES (
  1,
  'Ethereum Mainnet',
  'production',
  FALSE,
  FALSE,
  '0xd614d4dd3757365fb456789d2669dd55b6e6d6d5',
  'RelicForge-Mainnet-R12V2-R1',
  'ad99569e1dd416a01c0f159ab2bb6c2fe7749ee50aa44527c32639983ee57c14',
  jsonb_build_object(
    'manifestSchema','relic-forge/production-release@1',
    'environment','production',
    'planId','13633669dfa0f4a98fcf21d0ee8d3a4b512cd9c9cc146d1244b4702e7f232382',
    'sourceCommit','ef328f5416604a0ac86c2bdd1d94f4bd14995dc9',
    'addresses',jsonb_build_object(
      'factory','0xd614d4dd3757365fb456789d2669dd55b6e6d6d5',
      'feePolicy','0x61c5c153e96a9ded09fe3afcdca65a5958281e67',
      'collectionImplementation','0x43bc4a9181960601c13b96f630adee74a0b219cf',
      'dataImplementation','0x5cac5280b00ee729c9351c0e3235151c645f9834',
      'mintPhasesImplementation','0xd7ef23619fab079941b05bdc2ac0f5ff90af4e4a',
      'renderer','0xf449700e0fafdb1d0edb1af40096f61c229bc41f',
      'randomnessAdapter','0x231ccd119188c3e9a8ae18b62dc536d8e3ed675a',
      'reserve','0xf20442fcf072f87bb694eb6b7697ee2362ce5a49',
      'canonicalRegistry','0xc9a8096aa3ead34282fbf24eaacabd414a00ee31'
    ),
    'reservePolicy',jsonb_build_object(
      'minimumReserveWei','200000000000000000',
      'launchPrefundingRequired',FALSE,
      'operatingMode','underfunded-operation-permitted-with-revenue-release-floor'
    )
  ),
  now()
)
ON CONFLICT (chain_id) DO UPDATE SET
  label=EXCLUDED.label,
  kind=EXCLUDED.kind,
  launch_enabled=FALSE,
  public_enabled=FALSE,
  factory_address=EXCLUDED.factory_address,
  release_id=EXCLUDED.release_id,
  release_manifest_hash=EXCLUDED.release_manifest_hash,
  configuration=EXCLUDED.configuration,
  updated_at=now();
