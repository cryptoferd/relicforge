# Forge Reveal V2 — Phase 2D R5 Provider Comparison and Selection Policy

Status: experimental local decision-matrix candidate only  
Relic Forge baseline: `forge-reveal-v2` at `79cc49507ce68c72b539b88dfc14bd09f1c85892`  
Provider documentation review: 2026-09-01  
Production enabled: **false**

## R5 objective

R1–R4 each answered whether a provider architecture can deliver one verified random word through the Relic Forge thin-callback model while preserving exact-word persistence, no rerolls, canonical consumers, callback gas isolation and later permissionless settlement.

R5 answers a different question:

> Given the architectures already characterized, which provider should Relic Forge advance toward production on each target chain, and which candidates should remain blocked or secondary until their open gates are closed?

R5 is deliberately a **selection-policy round**, not a production activation round. A provider can be the primary advancement candidate while `productionEnabled` remains false.

## Locked invariants carried from R1–R4

R5 does not relax any earlier rule:

- verified asynchronous provider randomness only;
- no `block.prevrandao`, `block.difficulty`, `block.timestamp`, `blockhash`, sequencer-local entropy or similar fallback;
- exact provider request identity;
- store the final verified word before attempting collection delivery;
- failed collection delivery may replay only that exact stored word;
- no provider reroll after a word exists;
- canonical Relic Forge collections only;
- provider callback remains thin; 20-NFT settlement happens later in an ordinary transaction;
- unknown chain/provider pairs fail closed;
- no automatic cross-provider fallback after a randomness request has been created.

The last rule is important: switching providers in response to an inconvenient request outcome or failed callback can become a selection/reroll surface. A secondary provider in the R5 matrix is a **governed research/contingency candidate**, not a runtime retry target.

## R1–R4 comparison

| Provider path | Local result | Funding/accounting shape | Main unresolved production gate | R5 disposition |
| --- | --- | --- | --- | --- |
| Chainlink VRF v2.5 Direct Native | R1 passed | live wrapper native quote paid atomically per request | live chain/fork validation, production adapter audit, governed registry/rotation | **primary advancement candidate** on Ethereum + Base |
| Chainlink VRF v2.5 Native Subscription | R2 passed/characterized | collection reservation funds shared subscription; exact actual payment is finalized after callback | exact on-chain per-request attribution/reconciliation under shared liquidity | not selected |
| Pyth Entropy V2 full custom request | R3 passed | `getFeeV2()` exact native request payment | production-grade independent user contribution source and its governance/liveness | **secondary Base candidate** |
| Supra dVRF V3 | R4 passed/characterized | separate client-wallet prepaid subscription plus collection reservation escrow | exact collection attribution/reconciliation, atomic replenishment, V3 audit evidence | not selected |

## Why Chainlink Direct Native is the R5 primary advancement path

Chainlink Direct Native is the only candidate in the current matrix that simultaneously has:

1. the R1 persist-first thin callback architecture already passing locally;
2. current official VRF v2.5 deployment support on both Ethereum and Base;
3. an on-chain wrapper quote before request dispatch;
4. native payment attached to the individual request transaction;
5. no shared subscription balance that another collection can drain;
6. no separate independent user-contribution source that Relic Forge must operate or govern.

This does **not** mean the production gate is closed. R5 still requires live testnet/fork execution, deployment-time parameter/address reverification, production adapter audit, registry/rotation governance and operational monitoring before activation.

### Current Chainlink VRF v2.5 snapshot

Official supported-network page reviewed for R5:

- https://docs.chain.link/vrf/v2-5/supported-networks

Ethereum Mainnet:

- Coordinator: `0xD7f86b4b8Cae7D942340FF628F82735b7a20893a`
- Direct Funding Wrapper: `0x02aae1A04f9828517b3007f83f6181900CaD910c`
- native-payment premium snapshot: 24%
- direct-funding wrapper native coordinator overhead snapshot: 90,000 gas
- wrapper overhead snapshot: 13,400 gas

Base Mainnet:

- Coordinator: `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634`
- Direct Funding Wrapper: `0xb0407dbe851f8318bd31404A49e658143C982F23`
- native-payment premium snapshot: 60%
- direct-funding wrapper native coordinator overhead snapshot: 128,500 gas
- wrapper overhead snapshot: 13,400 gas

All addresses and live coordinator/wrapper parameters must be reverified immediately before deployment.

## Why Pyth is the Base secondary candidate rather than the primary

R3 produced the cleanest accounting fit after Chainlink Direct:

- `getFeeV2()` gives a live request price;
- that amount is paid with the request itself;
- no shared provider subscription needs post-request collection reconciliation;
- callback failure recovery and exact local replay were successfully characterized.

The blocker is security/operations rather than accounting. R3 intentionally used the full custom `requestV2(provider,userRandomNumber,gasLimit)` path, and Relic Forge still needs a production-grade independent user-contribution source whose generation, governance and liveness cannot be controlled by a permissionless request executor.

R5 therefore keeps Pyth as a **secondary Base research candidate**, not an automatic fallback.

Official sources reviewed for R5:

- https://docs.pyth.network/entropy
- https://docs.pyth.network/entropy/chainlist
- https://docs.pyth.network/entropy/debug-callback-failures

Current Base Entropy address carried from the R3 official snapshot:

- Entropy: `0x6E7D74FA7d5c90FEF9F0512987605a6d546181Bb`
- default provider snapshot: `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506`

## Why the two subscription paths are not selected

### Chainlink Subscription

R2 proved that conservative reservation can prevent one request from intentionally free-riding on shared liquidity when the reservation is sufficient. It also proved the critical ordering problem: Chainlink computes/finalizes the actual subscription payment after the callback path, so exact atomic per-request collection attribution is not available inside the callback architecture we need.

That remains a production accounting gate.

### Supra dVRF V3

R4 proved strong request/callback integrity and retry behavior, but the third-party EVM product uses a prepaid client-wallet subscription. The collection-side reservation escrow is separate from the actual Supra subscription charge. R4 therefore could not certify exact collection reconciliation or atomic subscription replenishment.

Official V3 network table reviewed for R5:

- https://docs.supra.com/dvrf/learn-supra-dvrf/networks

Current snapshot still lists V3 on Ethereum and Base with a 30% service premium, but passing network support does not close the funding/reconciliation or audit gates.

## Robinhood Chain decision

Robinhood Chain remains **unsupported / fail closed** for Forge Reveal randomness in R5.

Robinhood's current official documentation confirms:

- mainnet chain ID `4663`;
- EVM compatibility;
- Chainlink Data Streams integration on Robinhood Chain.

Sources:

- https://docs.robinhood.com/chain/connecting/
- https://docs.robinhood.com/chain/data-streams/

However, the current Chainlink **VRF v2.5 supported-network page** reviewed for R5 does not list Robinhood Chain. The current Pyth Entropy and Supra dVRF V3 network snapshots used in R3/R4 also do not provide a certified Robinhood route.

R5 therefore explicitly rejects this inference:

```text
Chainlink Data Feeds/Data Streams support on Robinhood
    !=
Chainlink VRF support on Robinhood
```

No block-local fallback is permitted while a verified provider is unavailable.

## R5 chain decision matrix

### Ethereum — chain ID 1

Primary advancement provider:

`chainlink_vrf_v2_5_direct_native`

Production enabled: **false**

Open activation gates:

1. live Sepolia/fork request through the candidate production adapter;
2. deployment-time coordinator/wrapper/config reverification;
3. production adapter audit;
4. governed provider registry and emergency rotation policy;
5. operational monitoring/failure runbook.

No secondary provider is selected in R5. Supra and Chainlink Subscription remain blocked by shared-liquidity attribution/reconciliation. Pyth Entropy is not carried as an Ethereum candidate from the current R3 deployment snapshot.

### Base — chain ID 8453

Primary advancement provider:

`chainlink_vrf_v2_5_direct_native`

Secondary research candidate:

`pyth_entropy_v2`

Production enabled: **false**

Additional Base-specific gate:

- benchmark L1 data fee and callback economics under realistic Base conditions.

Pyth may become a governed alternative only after its independent contribution-source gate and all normal live/audit/configuration gates are closed.

### Robinhood Chain — chain ID 4663

Primary advancement provider: **none**  
Secondary candidate: **none**  
Production enabled: **false**  
Status: `unsupported_fail_closed`

## R5 harness policy

`RelicProviderDecisionMatrixV2Harness.sol` encodes only the decision state above:

- Ethereum primary advancement = Chainlink Direct Native;
- Base primary advancement = Chainlink Direct Native;
- Base secondary research candidate = Pyth Entropy V2;
- Robinhood and unknown chains = no provider;
- `requireProductionProvider()` always reverts in R5;
- automatic provider fallback is always false;
- Chainlink Subscription and Supra are classified as shared-liquidity attribution-gated;
- Pyth is classified as requiring an independent user-contribution policy;
- Chainlink Direct and Pyth are classified as atomic per-request native-payment models.

The harness is intentionally impossible to interpret as a production router because no chain can resolve a production provider.

## R5 local test plan

Focused R5 tests verify:

- Ethereum primary advancement selection;
- Base primary + secondary research selection;
- Robinhood fail-closed selection;
- unknown-chain fail closed;
- no production provider can be resolved;
- automatic provider fallback is always disabled;
- atomic per-request payment classification;
- shared-liquidity attribution-gate classification;
- Pyth independent-contribution classification;
- Base secondary candidate cannot become an automatic retry/fallback path.

The installer also reruns all Phase 2D tests, all experimental tests and the full repository regression.

## R5 conclusion target

If the local package passes, Phase 2D's provider architecture decision becomes:

```text
Ethereum:
  advance Chainlink VRF v2.5 Direct Native
  productionEnabled = false

Base:
  advance Chainlink VRF v2.5 Direct Native
  keep Pyth Entropy V2 as secondary research candidate
  productionEnabled = false

Robinhood Chain:
  no certified provider
  fail closed
```

R5 completes the **architecture-selection** portion of Phase 2D. It does not complete provider production certification. The next work after R5 should be live-chain/fork activation certification for the selected Chainlink Direct path, beginning on testnet/fork and preserving every Phase 2D invariant.
