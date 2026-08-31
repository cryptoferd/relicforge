# Relic Forge V2 Randomness Provider Audit

Research snapshot: 2026-08-31
Policy: unknown/uncertified EVM chains FAIL CLOSED for Forge Reveal.

## Core conclusion

Relic Forge must not equate "EVM compatible" with "safe same-transaction entropy."

`block.prevrandao`, block hashes, timestamps, sequencer fields, and similar block-local values have different
semantics and manipulation assumptions across EVM families. Some EVMs return constants or zero for PREVRANDAO.

The portable production design is therefore:

`Collection -> Relic randomness adapter -> chain/provider-specific verified randomness service`

The existing V1 vendor-neutral provider abstraction is worth preserving.

## Provider candidates

### Pyth Entropy v2

Official docs describe Entropy as:
- secure/verifiable RNG for EVM smart contracts;
- commit/reveal based;
- low latency (within a few blocks);
- native-gas fee payment;
- no registration for the basic integration;
- 20+ EVM chains;
- callback gas limit can be selected by the requester.

This makes Entropy especially interesting as a broad default adapter candidate for Relic Forge V2.

References:
- https://docs.pyth.network/entropy
- https://docs.pyth.network/entropy/generate-random-numbers-evm
- https://docs.pyth.network/entropy/request-callback-variants
- https://docs.pyth.network/entropy/chainlist

### Supra dVRF

Supra documents threshold/verifiable randomness and a broad EVM deployment set including major networks such as
Ethereum, Base, Arbitrum, Avalanche, BNB, Optimism, Polygon, Linea, Mantle and Monad. V3 uses a subscription/deposit
model and documents a service fee equal to 30% of callback gas cost.

References:
- https://docs.supra.com/dvrf
- https://docs.supra.com/dvrf/learn-supra-dvrf/networks

### Chainlink VRF v2.5

Relic Forge V1 already has a replay-safe Chainlink VRF v2.5 wrapper adapter and a live Sepolia integration.
It remains a strong provider where supported, but V2 should not hard-code the collection state machine to one
vendor.

Reference:
- https://docs.chain.link/vrf

### Native chain randomness

Some chains expose native VRF/randomness facilities. These can be adapter candidates where their security,
availability, callback model, and mainnet behavior are explicitly certified.

Example:
- Moonbeam randomness precompile:
  https://docs.moonbeam.network/builders/ethereum/precompiles/features/randomness/

## Chain-family policy

| Family / EVM | Block-local entropy policy | V2 Forge policy |
| --- | --- | --- |
| Ethereum PoS | PREVRANDAO exists but has proposer-bias / lookahead caveats | verified provider |
| OP Stack | L2 inherits L1-origin randomness semantics | verified provider |
| Arbitrum Nitro / Orbit | do not assume sequencer-produced fields are secure RNG | verified provider |
| ZKsync Era | PREVRANDAO documented as a constant | verified provider |
| Scroll | PREVRANDAO documented as zero | verified provider |
| Polygon PoS | validator-produced block fields are not RF-certified RNG | verified provider |
| BNB Smart Chain | validator-produced block fields are not RF-certified RNG | verified provider |
| Avalanche C-Chain | deterministic EVM; use explicit randomness facility | verified provider |
| Moonbeam | native VRF exists, asynchronous | native adapter candidate |
| Unknown EVM | unknown assumptions | Forge disabled until certified |

## Certification requirements for a new chain

A chain can enable Forge Reveal only after Relic Forge records:

1. chain ID and EVM family;
2. provider contract/router addresses;
3. provider security model;
4. request fee model;
5. callback/reveal latency;
6. maximum/custom callback gas behavior;
7. replay/failure behavior;
8. testnet integration results;
9. mainnet address verification;
10. an explicit RF certification state.

Never silently fall back to timestamp, blockhash, PREVRANDAO or msg.sender-derived pseudo-randomness.
