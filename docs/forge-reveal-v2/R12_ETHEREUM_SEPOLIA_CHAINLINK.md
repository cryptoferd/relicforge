# Relic Forge Reveal V2 — R12 Ethereum Sepolia / Chainlink VRF v2.5

Status: **candidate pending local validation + live read-only Sepolia fork**

Production enabled: **NO**

## R12 architecture

Ethereum mainnet is the target production network. Ethereum Sepolia is the proving ground.

1. collector reserves/mints into the Forge queue,
2. batch locks,
3. a later permissionless executor quotes and pays Chainlink,
4. Chainlink callback stores exactly one verified word and returns,
5. a later permissionless `replayFulfillment(localRequestId)` delivers that exact word,
6. `settleReady(maxTokens)` settles NFTs in batch order.

No collection call occurs inside Chainlink's upstream VRF callback.

## Official Ethereum Sepolia Chainlink snapshot

Reviewed 2026-09-03 from Chainlink VRF v2.5 Supported Networks.

- Chain ID: `11155111`
- LINK: `0x779877A7B0D9E8603169DdbD7836e478b4624789`
- VRF v2.5 Coordinator: `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`
- VRF v2.5 Wrapper: `0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1`
- 500 gwei key hash: `0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae`
- Native-payment premium: 24%
- Minimum confirmations: 3
- Direct-funding max random values: 10
- Wrapper gas overhead: 13,400
- Coordinator native gas overhead: 90,000
- Coordinator gas overhead per word: 435

## This package intentionally does not

- send a Sepolia transaction,
- use a private key,
- deploy the final Factory V2,
- enable production/mainnet,
- modify the R11 Robinhood evidence,
- add provider rerolls/refunds.

After this passes, the next R12 slice is the production-shaped Collection V2 + Reserve V2 + Factory V2 deployment stack, followed by a live Sepolia canary.
