# RC4.3 Canonical V1 Sepolia Deployment

RelicForge creators do not deploy platform infrastructure. The founder deploys one canonical V1 stack on Ethereum Sepolia:

1. RelicCollectionV1 implementation
2. RelicProjectDataV1 implementation
3. RelicRendererV1
4. RelicChainlinkVRFV25DirectFundingAdapterV1
5. RelicForgeFeePolicyV1
6. RelicForgeFactoryV1

The Factory is permanently bound to the FeePolicy and the VRF adapter is permanently bound to the Factory.

After deployment, `scripts/rc4.3-deploy-sepolia-v1.ps1` verifies the runtime code and critical wiring, writes `deployments/rc4.3/sepolia-v1.json`, generates `relicforge-v1-addresses.js`, commits those two files, and pushes the addresses to `contracts-v1-production`.

Required `.env` values:

```text
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0xDISPOSABLE_SEPOLIA_DEPLOYER_PRIVATE_KEY
PLATFORM_ADMIN=0xYOUR_FOUNDER_ADMIN_WALLET
FEE_TREASURY=0xYOUR_PLATFORM_FEE_TREASURY
ETHERSCAN_API_KEY=
```

Only `DEPLOYER_PRIVATE_KEY` is private. `PLATFORM_ADMIN` and `FEE_TREASURY` are public EVM addresses.

Initial fee policy:

- Sponsored: $0.25 × max collection supply
- Minter Supported: $0.50 per NFT minted
- adjustable per-collection cap: $5.00/NFT
