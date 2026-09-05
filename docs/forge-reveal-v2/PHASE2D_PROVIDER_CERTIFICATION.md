# Forge Reveal V2 — Phase 2D R1 Provider Certification

Status: experimental validation only
Research snapshot: 2026-09-01
Locked baseline: `forge-reveal-v2` at `7bb698233db92b8ea0c66928345e3ce86b45d0c3`

## R1 result

R1 validates a Chainlink VRF v2.5 native direct-funding **thin adapter** against the Phase 2C queue/hopper/reserve shape. It does not certify a production deployment and does not enable any chain/provider pair in production.

The validated lifecycle is:

1. A canonical collection locks a Forge batch and requests randomness outside the collector mint transaction.
2. The collection retains its conservative settlement envelope (2,450,000 gas for 20 NFTs).
3. The adapter obtains the wrapper's live native quote using a fixed 300,000-gas upstream callback.
4. The Chainlink wrapper calls the adapter with one verified word.
5. The adapter stores that exact word before attempting collection delivery.
6. The adapter forwards at most 150,000 gas so the collection stores the word but does not settle NFTs.
7. Any caller later executes `settleReady(20)` as an ordinary transaction.
8. Failed collection delivery remains permissionlessly replayable with the same stored word. A second word cannot replace it.

This preserves the collector's one-signature experience while removing the expensive 20-NFT settlement from the provider callback.

## Why the callback is thin

Chainlink's current billing documentation says direct funding prices the request before fulfillment, bills the configured callback gas limit, and does not refund an overestimated limit. Its security guidance also says a fulfillment must not revert and recommends storing randomness while moving complex follow-on work to separate calls.

The Phase 2C settlement workload is roughly 1.8–2.0M gas for 20 distinct recipients. Provisioning that work inside a direct-funded VRF callback creates both avoidable premium billing and a larger liveness-critical surface. The R1 adapter instead asks Chainlink for 300,000 gas and uses an ordinary permissionless transaction for settlement.

Primary references:

- [Chainlink VRF v2.5 billing](https://docs.chain.link/vrf/v2-5/billing)
- [Chainlink VRF v2.5 security considerations](https://docs.chain.link/vrf/v2-5/security)
- [Chainlink VRF v2.5 direct funding](https://docs.chain.link/vrf/v2-5/overview/direct-funding)
- [Chainlink VRF v2.5 supported networks](https://docs.chain.link/vrf/v2-5/supported-networks)

## Current Chainlink parameters used by the deterministic model

These values are documentation snapshots, not runtime configuration. Production deployment must re-read the provider contracts and reverify every address.

| Network | Chain ID | Native premium | Coordinator native overhead | Wrapper overhead | Per-word overhead | Max coordinator callback gas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ethereum | 1 | 24% | 90,000 | 13,400 | 435 | 2,500,000 |
| Base | 8453 | 60% | 128,500 | 13,400 | 435 | 2,500,000 |

Current direct-funding wrapper snapshots:

- Ethereum: `0x02aae1A04f9828517b3007f83f6181900CaD910c`
- Base: `0xb0407dbe851f8318bd31404A49e658143C982F23`

Neither address is activated by this package.

## Deterministic cost comparison at 1 gwei

The model applies the published direct-funding formula and premium to one word. `LIFE` adds the Phase 2C measured 1,825,108-gas permissionless settlement without a VRF premium.

| Label | Scenario | Modeled cost |
| --- | --- | ---: |
| `CL_ETH_THIN` | Ethereum, 300k direct callback | 0.0005007554 ETH |
| `CL_ETH_FAT` | Ethereum, 2.45M direct callback | 0.0031667554 ETH |
| `CL_ETH_LIFE` | Ethereum thin callback + settlement | 0.0023258634 ETH |
| `CL_BASE_THIN` | Base, 300k direct callback | 0.000707736 ETH |
| `CL_BASE_FAT` | Base, 2.45M direct callback | 0.004147736 ETH |
| `CL_BASE_LIFE` | Base thin callback + settlement | 0.002532844 ETH |
| `CL_SUB_ACTUAL` | Example actual-gas subscription charge | 0.0002604 ETH |

These values are comparative test vectors only. Real requests must use live wrapper quotes, real gas prices, current premiums, and chain-specific L1-data costs where applicable.

## Local R1 gas labels

The isolated R1 gas test uses 20 distinct one-NFT reservations and a zero-price ABI-shaped wrapper mock.

| Label | Local gas observed | Meaning |
| --- | ---: | --- |
| `CL_REQ_20` | 369,069 | Collection request, adapter authorization/quote, wrapper request, reserve telemetry |
| `CL_WORD_20` | 172,120 | Wrapper bookkeeping, adapter persist-first callback, 150k collection word delivery |
| `CL_SETTLE_20` | 2,033,059 | Separate ordinary settlement transaction for 20 recipients |

Gas snapshots vary with Foundry/Solc versions. The enforced properties are the separation of work, a 300k upstream callback, no callback settlement, and bounded independent settlement.

## Validation result

- Phase 2D R1: 8 passed, 0 failed, 0 skipped.
- All experimental Forge Reveal tests: 78 passed, 0 failed, 0 skipped.
- Full V1 + V2 regression with Foundry 1.8.1-dev: 203 passed, 0 failed, 0 skipped.
- The untouched `7bb6982` baseline reports 195 tests under the same current toolchain, so R1 adds exactly eight tests.
- The Phase 2C handoff's historical 194 count came from its earlier Foundry environment; no historical test was removed or weakened.
- `forge build`, targeted formatting, JSON parsing, and `git diff --check` pass.
- Production V1 sources are unchanged.

## Security properties covered by R1

- Only a registry-approved canonical collection can create a billable adapter request.
- The adapter maps each upstream request ID to one local request ID and immutable collection context.
- The adapter records the verified word before untrusted collection delivery.
- Failed delivery remains replayable by anyone.
- Replay uses the exact stored word.
- A duplicate callback cannot replace the stored word or reroll the batch.
- Only the configured Chainlink wrapper can inject upstream words.
- The collection's price cap checks the wrapper's live thin quote and fails closed on a spike.
- The collection's 2.45M settlement envelope is retained for audit but is never forwarded upstream.
- The 20-NFT settlement is intentionally absent from the Chainlink callback.

## Provider certification gates

A chain/provider pair remains disabled unless all of these are satisfied:

1. Verified asynchronous randomness.
2. No block-local fallback.
3. Exact request identity.
4. Final word persisted before collection delivery.
5. Exact-word replay/recovery.
6. No reroll after a word exists.
7. Request price cap and sane live quote.
8. Known callback gas semantics.
9. Documented liveness/retry path.
10. Documented trust and security assumptions.
11. Audited or otherwise production-acceptable deployment.
12. Chain-specific addresses verified immediately before deployment.
13. Only canonical Relic Forge collections can consume provider funds.
14. Unknown or uncertified chain/provider pairs fail closed.

The machine-readable status is in `PROVIDER_CERTIFICATION_REGISTRY_V2.json`.

## Other providers researched in R1

### Pyth Entropy V2

Pyth documents dynamic native fees through `getFeeV2()`, configurable callback gas, callback status/re-request tooling, and multiple request variants. The basic and custom-gas variants use an in-contract PRNG for the user's contribution. The full-control variant accepts a user-provided random number. Pyth's protocol documentation also states provider censorship, front-running, and hash-chain secrecy assumptions. Relic Forge must select and test an exact variant and contribution policy before certification.

Primary references:

- [Pyth Entropy V2 changes](https://docs.pyth.network/entropy/whats-new-entropyv2)
- [Pyth Entropy request variants](https://docs.pyth.network/entropy/request-callback-variants)
- [Pyth Entropy protocol design](https://docs.pyth.network/entropy/protocol-design)
- [Pyth Entropy fees and chainlist](https://docs.pyth.network/entropy/chainlist)

Status: research required; disabled.

### Supra dVRF V3

Supra documents a subscription model with configurable maximum gas price/limit and a 30% service fee on VRF transaction gas cost. Ethereum, Base, and other EVM mainnets are currently listed, but exact cost attribution, shared-subscription isolation, persist-before-delivery behavior, and replay semantics still require adapter-level validation.

Primary references:

- [Supra dVRF overview](https://docs.supra.com/dvrf/overview)
- [Supra dVRF available networks](https://docs.supra.com/dvrf/learn-supra-dvrf/networks)
- [Supra subscription setup](https://docs.supra.com/dvrf/build-third-party-evm-networks/create-your-subscription)

Status: research required; disabled.

### Robinhood Chain

Robinhood's documentation explicitly states that `block.prevrandao`/`block.difficulty` are constant and must not be used as randomness. Robinhood Chain is not present in Chainlink's current VRF v2.5 supported-network table, and no provider has passed the Relic Forge certification gates.

Primary reference: [Robinhood Chain differences from Ethereum](https://docs.robinhood.com/chain/differences-from-ethereum/)

Status: fail closed. No weak fallback is permitted.

## Remaining work before production certification

- Execute fork/live-testnet requests against the current wrapper deployments.
- Measure callback gas with the real wrapper and chain-specific gas accounting.
- Reverify coordinator, wrapper, key hash, confirmation, and premium settings immediately before deployment.
- Define upgrade ownership and emergency rotation through a Safe/governed registry.
- Benchmark Chainlink subscription funding and prove per-collection cost attribution and liquidity isolation.
- Establish executor incentives and outage/circuit-breaker policy.
- Audit the production adapter and registry implementation.
- Keep every pair disabled until its registry entry records all evidence and an explicit production approval.
