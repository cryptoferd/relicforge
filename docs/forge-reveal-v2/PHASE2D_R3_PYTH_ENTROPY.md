# Forge Reveal V2 — Phase 2D R3 Pyth Entropy V2 Certification

Status: experimental local certification candidate only  
Relic Forge baseline: `forge-reveal-v2` at `5a10aaa35d32dab1348b8ed1415e31f5fa824452`  
Pyth source snapshot: `pyth-network/pyth-crosschain` at `4dd956ede61a7ad6b19317e6001a3b95c308dcf2`  
Production enabled: **false**

## R3 objective

R3 evaluates Pyth Entropy V2 as a provider for Forge Reveal V2 using the same thin-callback architecture already validated for Chainlink. The key question is whether Pyth's native per-request fee and retry semantics fit the Phase 2C collection hopper / chain Forge Reserve accounting model without weakening the exact-word and no-reroll guarantees.

R3 intentionally does **not** claim that Pyth is production certified. It separates provider mechanics that can be locally proven from the remaining operational trust question around the user's Entropy contribution.

## Official-source findings locked into R3

### 1. Use IEntropyV2, not deprecated V1 request methods

The current Pyth SDK exposes multiple `requestV2` variants. The basic and gas-only variants generate the user's contribution using an in-contract PRNG. Pyth explicitly documents that this changes the security assumption: a dishonest validator and provider can collude to manipulate the result.

R3 therefore tests the full custom form:

```solidity
requestV2(address provider, bytes32 userRandomNumber, uint32 gasLimit)
```

The adapter does not use the basic PRNG variants.

### 2. Pyth's implementation disables blockhash mixing for V2 callback requests

The current Entropy implementation calls the full custom request helper with `useBlockhash = false`. Its source comment states this is intentional because including the request block hash permits a provider + miner collusion scenario.

This is compatible with Relic Forge's rule that block-local values must never become a fallback randomness source.

### 3. The Entropy result is two-party randomness

Pyth describes Entropy as a provider/user commit-reveal construction. The provider commits to a hash chain in advance and the user contributes another random value. The resulting number is random when either party is honest, subject to Pyth's documented front-running/censorship assumptions.

That means Relic Forge cannot treat `userRandomNumber` as an arbitrary nonce merely to satisfy the ABI. A production contribution source must be independently random and must not be selectable by a permissionless executor who colludes with the provider.

R3 externalizes that policy behind `IRelicPythContributionSourceV2`. The harness tests freshness, nonzero enforcement, exact request binding, and accounting, but **does not certify a production contribution-source implementation**.

### 4. Pyth V2 callback failures are recoverable with the same request

For requests with an explicit V2 gas limit and a nonzero provider default gas limit, the current Entropy implementation catches callback failure and marks the request `CALLBACK_FAILED`. A later `revealWithCallback` call recomputes the result from the same user contribution and provider revelation.

R3 models this and tests that a failed upstream callback can retry without a second provider request fee and returns the same exact random number.

Once the Relic Forge adapter has successfully stored the verified word, collection delivery failure is handled by the existing local `replayFulfillment()` path. That replay never calls Pyth again and cannot reroll.

### 5. Pyth charges an on-chain fee before the request

`getFeeV2(provider, gasLimit)` returns the provider fee plus the Pyth protocol fee. The current contract checks that the request paid at least that amount before assigning the request.

For callback gas above the provider default, the provider portion scales proportionally after the gas limit is rounded up to 10,000-gas units. The callback itself is lower-bounded by the provider's configured default gas limit.

This fits Phase 2C accounting more naturally than Chainlink subscription funding:

1. collection asks the adapter for the live `getFeeV2` quote;
2. collection hopper pays first;
3. Forge Reserve covers the exact shortfall;
4. adapter pays that request fee atomically;
5. no shared provider subscription balance is required.

R3 requests 300,000 callback gas. The adapter also checks live provider configuration and fails closed if the provider has no V2 callback-status gas floor or if its configured default callback floor exceeds the R3 safety ceiling of 500,000 gas.

## Thin Pyth lifecycle under test

```text
canonical Forge collection
    -> live getFeeV2(provider, 300k)
    -> hopper first / Forge Reserve exact shortfall
    -> Pyth requestV2(provider, independent user contribution, 300k)
    -> Pyth verifies provider revelation and derives final random number
    -> Entropy calls adapter _entropyCallback
    -> adapter stores exact final word FIRST
    -> adapter attempts 150k collection word delivery
    -> provider callback returns
    -> permissionless settleReady(20)
```

No 20-NFT settlement is performed inside the Pyth callback.

## Base deployment snapshot

At the pinned Pyth source snapshot, the official deployment data contains:

- Base chain ID: `8453`
- Entropy: `0x6E7D74FA7d5c90FEF9F0512987605a6d546181Bb`
- mainnet default provider documented by Pyth: `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506`

Every address and live provider configuration must be reverified immediately before deployment.

The same official Entropy deployment snapshot does **not** contain Ethereum mainnet or Robinhood Chain entries. R3 therefore does not claim Pyth Entropy support for either chain.

## Audit/security snapshot

Pyth's published security page lists a January 2024 Trail of Bits audit scoped to `pyth-crosschain-entropy contracts and fortuna web service`, and Pyth operates an Immunefi bug bounty. This is useful provider evidence, but it does not replace an audit of the Relic Forge adapter, contribution source, registry, or integration.

## R3 local test plan

### Adapter/security tests

- live `getFeeV2(provider, 300k)` quote used;
- exact full-custom `requestV2(provider,userRandomNumber,gasLimit)` shape;
- 2.45M collection settlement envelope is retained only as telemetry;
- unauthorized collection cannot create a billable Pyth request;
- live provider configuration is checked and fails closed on incompatible drift;
- contribution source must return a nonzero, never-reused value;
- exact contribution is bound to local request ID and collection context;
- verified Pyth word is persisted before collection delivery;
- no NFT settlement inside Pyth callback;
- permissionless `settleReady(20)` completes later;
- failed collection delivery replays only the stored word;
- duplicate callback cannot reroll;
- only configured Entropy contract can call the adapter callback;
- callback provider must equal configured provider;
- failed Pyth callback retry uses the same request/result and no second request fee;
- live Pyth fee spike above collection cap fails closed.

### Economics/gas tests

- provider fee floor + Pyth protocol fee;
- 10k callback-gas rounding;
- proportional provider fee scaling above default gas;
- collection hopper pays first;
- Forge Reserve covers exact shortfall only;
- provider receives exact request payment;
- labels: `PYTH_REQ_20`, `PYTH_WORD_20`, `PYTH_SETTLE_20`;
- cost labels: `PYTH_DEFAULT`, `PYTH_THIN`, `PYTH_ROUND`.

## Production gates intentionally left open

1. **Independent user contribution source.** The R3 mock proves the adapter boundary, not the production entropy-generation mechanism.
2. Live Base fork/test request against the current Entropy deployment and provider.
3. Reverify provider `defaultGasLimit`, current commitment, sequence range, fee and reveal-delay behavior immediately before activation.
4. Operational policy for provider censorship/front-running and request recovery.
5. Contribution-source liveness, governance and rotation design.
6. Production adapter/registry/contribution-source audit.
7. Full provider comparison against Chainlink and Supra before activation.

Until these gates are closed, `productionEnabled` remains `false`.

## Current R3 conclusion target

If the local package passes, the intended status is:

```text
Base / Pyth Entropy V2
status: phase2d_r3_local_harness_candidate
productionEnabled: false
```

That status means the ABI, fee, callback, replay and queue-accounting shape has been locally validated. It does **not** mean the provider is approved for production Forge Reveal yet.
