-- RelicForge R12-v2 R2 adaptive Sepolia browser-canary policy.
-- This migration is intentionally PRIVATE TESTNET ONLY.
-- PUBLIC DISCOVERY MUST REMAIN OFF.
-- Mainnet configuration is untouched.

UPDATE rf26_networks
SET
  factory_address = '0xab920d3abecebf506711d1817179bc1067e9e6ca',
  release_id = 'r12-v2-r2-adaptive-sepolia-browser-canary',
  configuration = COALESCE(configuration, '{}'::jsonb) || jsonb_build_object(
    'architectureVersion', 'R12V2-R2-ADAPTIVE',
    'factory', '0xAb920d3AbeceBF506711D1817179BC1067e9E6Ca',
    'collectionImplementation', '0x884760377f041833A5E4336d3a847306Febea738',
    'dataImplementation', '0x8e404F79CB2e4e290F237253041595454a267945',
    'mintPhasesImplementation', '0x2408bCD15bf2363c236DfE61EEe0ED3016a7C14C',
    'renderer', '0xDB75F85712E4cd68f98B7f93a557643A57735749',
    'randomnessAdapter', '0x85Bf6B934028d5e029922283CE8Cf97174ff0ecc',
    'reserve', '0x5e810b6E6fa5cA34F75c79B521847F99f38180f5',
    'canonicalRegistry', '0x4cB5b8d41082cB97FC8Dc6dDb26dD9B2ca545452',
    'feePolicy', '0x9eD612FBeC226DDb086CeEDbFaDbf0bE333aB2d0',
    'certifiedForgeCollection', '0x3ff6750f82a6eDFDe0B295Fde860343dAa792A42',
    'automaticConsumerDelivery', true,
    'immediateOwnership', true,
    'delayedRevealTransactions', 2,
    'platformBatchWindowSeconds', 30,
    'platformMaxRandomnessCostPerRequestWei', '5000000000000000',
    'maxAutoRevealGroupNfts', 20,
    'adaptiveGas1', 400000,
    'adaptiveGas2To4', 550000,
    'adaptiveGas5To10', 900000,
    'adaptiveGas11To15', 1150000,
    'adaptiveGas16To20', 1400000
  ),
  public_enabled = FALSE,
  updated_at = now()
WHERE chain_id = 11155111
  AND kind = 'testnet'
  AND public_enabled = FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM rf26_networks
    WHERE chain_id = 11155111
      AND kind = 'testnet'
      AND public_enabled = FALSE
      AND lower(factory_address) = '0xab920d3abecebf506711d1817179bc1067e9e6ca'
  ) THEN
    RAISE EXCEPTION 'RelicForge adaptive R2 Sepolia private browser-canary policy activation failed';
  END IF;
END $$;
