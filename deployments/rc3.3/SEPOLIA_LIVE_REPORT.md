# RelicForge Contracts V1 — RC3.3 Ethereum Sepolia Live Report

Generated: 2026-08-29T04:49:06Z

## Result

**RC3.3 LIVE CHAINLINK VRF INTEGRATION PASSED**

## Network

- Chain: Ethereum Sepolia
- Chain ID: 11155111
- Verification block: 11589594
- Test deployer: `0x9A1c3f885393F9edef49773fd137C920F76A1111`

## RelicForge infrastructure

- Factory: `0x332712B4100705aac9b0365043b8DaE45BD104Ea`
- Direct-funded VRF adapter: `0x898E28329c86F1a454090376e518e70E6629c101`
- Collection implementation: `0x2E668Bd68dF946e48998d9c1A29fa3041314247D`
- Data implementation: `0x5f806e47e6C94222B82dd25F205b1E50e7b2C5C6`
- Renderer: `0x1f776328091a90e7DdE069E51BFed341DD6Dc312`

## Chainlink VRF v2.5

- Wrapper: `0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1`
- Coordinator: `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`
- Callback gas: 500000
- Confirmations: 3
- Maximum request price: 10000000000000000 wei
- Actual live request cost: 858015004758598 wei

## Live disposable collection

- Collection: `0x41AF6450F0eD670F4B1014DB1F3D862C4F2F6900`
- Project data: `0xb013460b4B66Fc7A29BF0595C57E79667b1C5A92`
- Local RelicForge request ID: 1
- Chainlink upstream request ID: 51004703181363469444887885822904454068920634028483906583110731916548817923120
- Assigned recipe: 1

## Live assertions passed

- Real Chainlink randomness requested: PASS
- Chainlink callback authenticated: PASS
- Random word stored: PASS
- Consumer delivery completed: PASS
- Replay idempotency: PASS
- Recipe assignment: PASS
- Onchain tokenURI: PASS
- Canonical render: PASS
- Unused per-collection randomness credit recovered: PASS
- Final nativeCredit(collection): 0
- Immutable wiring verification: PASS

## Runtime code hashes

- Factory: `0x8abd958023fcd4b126be3f5ba9a6c70afa1839a1956b9266cfa18a40891ae52b`
- Adapter: `0xa5f014aef4c4afcb4b7131475d39ba24678e3fb2c76c0c33e4ad3ef574023a62`
- Collection clone: `0xad2ce8498826960e5821448d8106bdd4ffa458ac1868642d470b749d27821f4a`
- Project-data clone: `0x808a00f7bb9b8f6214e986e62435c01f283beef99c88f50eec3085cb610797a1`

## Explorer

- Factory: https://sepolia.etherscan.io/address/0x332712B4100705aac9b0365043b8DaE45BD104Ea
- Adapter: https://sepolia.etherscan.io/address/0x898E28329c86F1a454090376e518e70E6629c101
- Collection: https://sepolia.etherscan.io/address/0x41AF6450F0eD670F4B1014DB1F3D862C4F2F6900
- Project data: https://sepolia.etherscan.io/address/0xb013460b4B66Fc7A29BF0595C57E79667b1C5A92

This is testnet integration evidence, not an independent security audit.