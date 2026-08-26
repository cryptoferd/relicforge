# V1 Infrastructure Deployment Order

Production infrastructure is deployed once per supported EVM chain.

1. Deploy the audited chain-specific randomness adapter.
2. Deploy `RelicCollectionV1` implementation.
3. Deploy `RelicProjectDataV1` implementation.
4. Deploy shared `RelicRendererV1`.
5. Deploy ownerless `RelicForgeFactoryV1` with those four immutable addresses.
6. Verify source and constructor args on the chain explorer.
7. Record addresses, chain ID, bytecode hashes and V1 version in the Studio production chain registry.
8. Create a throwaway test collection through the factory and complete content upload, validation, seal, public phase, whitelist phase, deferred epoch, Forge reveal, payout and renunciation tests.

A future V2 deploys a new complete versioned stack. V1 factory addresses are never repointed.

## Foundry script

`script/v1/DeployV1.s.sol` expects:

- `DEPLOYER_PRIVATE_KEY`
- `RF_RANDOMNESS_ADAPTER`

The production repository/CI should use a secure secret mechanism; do not commit private keys or `.env` files.
