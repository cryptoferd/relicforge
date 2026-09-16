-- RelicForge Mainnet R12-v2 R2 Fresh Activation
-- This migration intentionally runs AFTER the historical R1 release migrations.
-- It atomically replaces the active chain-1 creator-launch release with the newly
-- deployed and live-certified fresh adaptive R2 Mainnet infrastructure.
-- Public discovery remains disabled; creator deployment is enabled.

DO $rf26_mainnet_r2_fresh$
DECLARE
  r rf26_networks%ROWTYPE;
BEGIN
  SELECT *
    INTO r
    FROM rf26_networks
   WHERE chain_id = 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RF26 R2 Fresh: Ethereum Mainnet network row is missing';
  END IF;

  IF r.kind IS DISTINCT FROM 'production' THEN
    RAISE EXCEPTION 'RF26 R2 Fresh: chain 1 is not marked production';
  END IF;

  UPDATE rf26_networks
     SET factory_address = '0x56c9fd8a81f5d0ce389d04c7e5ea372093930da7',
         release_id = 'RelicForge-Mainnet-R12V2-R2-FRESH',
         release_manifest_hash = 'f6d70c79f814ef2ae74375f9360ff6c2e8903bd2e671c7811abf719bb726cb9c',
         launch_enabled = TRUE,
         public_enabled = FALSE,
         configuration = jsonb_build_object(
           'manifestSchema','relic-forge/production-release@1',
           'environment','production',
           'architectureVersion','R12V2-R2-ADAPTIVE',
           'sourceCommit','58870d152d6d46568ccf803cc83a41f98904c903',
           'deploymentManifestHash','f6d70c79f814ef2ae74375f9360ff6c2e8903bd2e671c7811abf719bb726cb9c',
           'immediateOwnership',TRUE,
           'automaticConsumerDelivery',TRUE,
           'delayedRevealTransactions',2,
           'addresses',jsonb_build_object(
             'factory','0x56c9fd8a81f5d0ce389d04c7e5ea372093930da7',
             'feePolicy','0x0f155ab81e61faea80ec5bf194f31fbc33af2cac',
             'collectionImplementation','0x0fad7f74e7f2db759a9b7e3c01c0d12b52140398',
             'dataImplementation','0x22ecfee673c4d0f6bcff60f95ed86deadb982967',
             'mintPhasesImplementation','0xe502867f6e894d61d36286a68d36233101a0a754',
             'renderer','0xbfca27d86932f644baf2349cc8e74ff8379cb4ac',
             'randomnessAdapter','0x258cf686e3bddeb02c804739baeddd521329a59b',
             'reserve','0x9cf57a87da3d1a594f028add879207a1598b8dc0',
             'canonicalRegistry','0xc1be92446e96b09851692aa8682c9bbde9a11e82'
           ),
           'external',jsonb_build_object(
             'ethUsdPriceFeed','0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
             'chainlinkVrfWrapper','0x02aae1a04f9828517b3007f83f6181900cad910c'
           ),
           'r2Policy',jsonb_build_object(
             'platformBatchWindowSeconds',30,
             'platformMaxRandomnessCostPerRequestWei','5000000000000000',
             'maxAutoRevealGroupNfts',20,
             'delayedRevealConsumerCallbackGas',500000,
             'adapterCallbackOverheadGas',250000,
             'deliveryGasReserve',75000,
             'adaptiveGas1',400000,
             'adaptiveGas2To4',550000,
             'adaptiveGas5To10',900000,
             'adaptiveGas11To15',1150000,
             'adaptiveGas16To20',1400000
           ),
           'reservePolicy',jsonb_build_object(
             'minimumReserveWei','200000000000000000',
             'perActiveBatchBufferWei','20000000000000000',
             'exposureSafetyBps',15000,
             'maxSubsidyPerRequestWei','20000000000000000',
             'maxSubsidyPerCollectionWei','200000000000000000',
             'launchPrefundingRequired',FALSE,
             'operatingMode','underfunded-operation-permitted-with-revenue-release-floor'
           )
         ),
         updated_at = now()
   WHERE chain_id = 1;

  IF NOT EXISTS (
    SELECT 1
      FROM rf26_networks
     WHERE chain_id = 1
       AND kind = 'production'
       AND launch_enabled = TRUE
       AND public_enabled = FALSE
       AND lower(factory_address) = '0x56c9fd8a81f5d0ce389d04c7e5ea372093930da7'
       AND release_id = 'RelicForge-Mainnet-R12V2-R2-FRESH'
       AND lower(release_manifest_hash) = 'f6d70c79f814ef2ae74375f9360ff6c2e8903bd2e671c7811abf719bb726cb9c'
       AND configuration->>'manifestSchema' = 'relic-forge/production-release@1'
       AND configuration->>'environment' = 'production'
       AND configuration->>'architectureVersion' = 'R12V2-R2-ADAPTIVE'
       AND lower(configuration #>> '{addresses,factory}') = '0x56c9fd8a81f5d0ce389d04c7e5ea372093930da7'
       AND lower(configuration #>> '{addresses,feePolicy}') = '0x0f155ab81e61faea80ec5bf194f31fbc33af2cac'
       AND lower(configuration #>> '{addresses,collectionImplementation}') = '0x0fad7f74e7f2db759a9b7e3c01c0d12b52140398'
       AND lower(configuration #>> '{addresses,dataImplementation}') = '0x22ecfee673c4d0f6bcff60f95ed86deadb982967'
       AND lower(configuration #>> '{addresses,mintPhasesImplementation}') = '0xe502867f6e894d61d36286a68d36233101a0a754'
       AND lower(configuration #>> '{addresses,renderer}') = '0xbfca27d86932f644baf2349cc8e74ff8379cb4ac'
       AND lower(configuration #>> '{addresses,randomnessAdapter}') = '0x258cf686e3bddeb02c804739baeddd521329a59b'
       AND lower(configuration #>> '{addresses,reserve}') = '0x9cf57a87da3d1a594f028add879207a1598b8dc0'
       AND lower(configuration #>> '{addresses,canonicalRegistry}') = '0xc1be92446e96b09851692aa8682c9bbde9a11e82'
  ) THEN
    RAISE EXCEPTION 'RF26 R2 Fresh: final production activation state failed validation';
  END IF;
END
$rf26_mainnet_r2_fresh$;
