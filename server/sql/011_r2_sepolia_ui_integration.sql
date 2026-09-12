-- RelicForge R12V2 R2 Sepolia UI Integration Part A
-- Switches only the private Sepolia deployment policy to the live-certified R2
-- Factory. Mainnet release policy and public discovery are intentionally untouched.

UPDATE rf26_networks
SET
  factory_address = '0xd6604d82ec0ca67b4d34843a7f40a6ff7299fa46',
  release_id = 'r12-v2-r2-sepolia-live-certified',
  configuration = COALESCE(configuration, '{}'::jsonb) || jsonb_build_object(
    'architectureVersion', 'R12V2-R2',
    'factory', '0xD6604d82ec0ca67B4d34843a7F40a6Ff7299fA46',
    'collectionImplementation', '0x1D3E42d22BFd1844fF672ddeAf5eAb20F451983B',
    'dataImplementation', '0x8e404F79CB2e4e290F237253041595454a267945',
    'mintPhasesImplementation', '0x2408bCD15bf2363c236DfE61EEe0ED3016a7C14C',
    'renderer', '0xDB75F85712E4cd68f98B7f93a557643A57735749',
    'randomnessAdapter', '0xFd048cc2636c6def06a10BF35EC53Eb6ACB7Dc40',
    'reserve', '0xCa7E36F99807b74c280e1a38c192816FbD193C26',
    'canonicalRegistry', '0xBb6733A3FAF4f46813f5bEE9A88Ecb649F094A5e',
    'feePolicy', '0x9eD612FBeC226DDb086CeEDbFaDbf0bE333aB2d0',
    'certifiedForgeCollection', '0x95dE1A0fb735b95c687e8240CdAF66bBB6cDa094',
    'certifiedDelayedCollection', '0xbce23634c81f5efc4f793f97b3348DB0AaE4D065',
    'automaticConsumerDelivery', true,
    'immediateOwnership', true,
    'delayedRevealTransactions', 2
  ),
  updated_at = now()
WHERE chain_id = 11155111
  AND kind = 'testnet'
  AND public_enabled = FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rf26_networks
    WHERE chain_id = 11155111
      AND kind = 'testnet'
      AND public_enabled = FALSE
      AND lower(factory_address) = '0xd6604d82ec0ca67b4d34843a7f40a6ff7299fa46'
  ) THEN
    RAISE EXCEPTION 'RelicForge R2 Sepolia network-policy activation failed';
  END IF;
END $$;
