# Forge Reveal V2 — Phase 2D R10 Robinhood Randomness Interface Freeze

Baseline branch: `forge-reveal-v2`  
Baseline commit: `15ef5f8c320b332e2931e79ccc08cfcf0b9ca3a6`  
Baseline tree: `87684fca8edfe310eded557208d866a18eef0400`  
R10 status: **local interface-freeze certification PASSED; production activation remains blocked**  
Production enabled: **NO**

## Local validation result

Reviewed on 2026-09-02 using Foundry 1.7.1 / Solc 0.8.30:

- R10-owned Solidity formatting: PASS
- `forge build`: PASS
- focused R10 interface-freeze tests: 10 passed / 0 failed
- all Phase 2D tests: 109 passed / 0 failed
- all experimental tests: 179 passed / 0 failed
- full repository regression: 303 passed / 0 failed
- `git diff --check`: PASS
- changed-file allowlist: exactly the six R10 paths

R10 local certification freezes the Factory V2-facing Robinhood randomness seam. It does **not** certify a production contribution source, mainnet provider configuration, security audit, or production activation.

## Purpose

R10 freezes the Robinhood-facing randomness seam that the future Factory V2 and collection deployment system may depend on.

R10 does **not** redesign the R8/R9 Dice path. The frozen candidate inherits the R9 locally certified adapter so the live-certified storage-only callback behavior is not forked or reimplemented.

The R10 additions are limited to:

1. a generic Relic Forge V2 priced-randomness + replay interface;
2. Robinhood deployment/binding diagnostics;
3. a fixed Robinhood mainnet target chain identifier (`4663`);
4. a fixed adapter-family fingerprint;
5. a fixed Dice contribution-source ABI fingerprint;
6. tests proving the existing R9 request/callback/replay semantics still satisfy the frozen seam.

## Frozen generic collection-facing seam

Future collection/factory code may rely on only these provider-agnostic operations:

- `quoteRequestPrice(uint32 callbackGasLimit) -> uint256`
- `requestRandomness(uint256 context, uint32 callbackGasLimit) payable -> uint256 requestId`
- `replayFulfillment(uint256 localRequestId) -> bool delivered`

Collection contracts must not know or call Dice-specific request functions.

## Frozen Robinhood deployment diagnostics

The Robinhood adapter family additionally exposes:

- randomness interface version = `2`
- target production chain ID = `4663`
- a fixed factory binding fingerprint
- a fixed contribution ABI fingerprint
- `bindingValidForCurrentChain()`
- `providerReady()`
- `upstreamCallbackIsStorageOnly() == true`
- `automaticProviderRefundEnabled() == false`

These diagnostics are for Factory V2 / deployment / monitoring validation. They do not activate production.

## Factory V2 MAY assume

For a Robinhood collection bound to this adapter family:

- collector mint acceptance does not call Dice;
- randomness dispatch occurs later in a separate permissionless transaction;
- the provider request price is quoted before the request and paid exactly in native currency;
- only canonical collections can create billable requests;
- the upstream Dice callback stores the exact verified word and returns;
- collection delivery happens later through permissionless exact-word replay;
- NFT settlement happens outside the upstream callback;
- a failed downstream delivery never permits a reroll;
- a request that exists retains its identity;
- the queue/hopper pays first and Forge Reserve covers only the exact shortfall;
- provider-specific contribution generation is not supplied by the permissionless executor as a request argument.

## Factory V2 MUST NOT assume

Factory V2 must not assume:

- production is enabled;
- the current Robinhood mainnet Dice provider address is known or certified;
- the R9 test contribution mock is production safe;
- zero-default Dice mode has provider-side callback retry;
- any refund is safe once a Forge batch depends on the request;
- any automatic cross-provider fallback is permitted;
- block-local data may be used as replacement entropy;
- a provider outage may invalidate an already accepted collector reservation;
- a new provider/request may replace an existing request identity.

## Contribution source freeze

R10 freezes only the ABI:

`contributionForRequest(address consumer, uint256 context, uint256 localRequestId) returns (bytes32)`

The source address is immutable per adapter deployment. The production implementation remains OPEN and must separately establish independence, freshness, uniqueness/reuse prevention, liveness, failure semantics, governance/rotation, and no executor-controlled selection/reroll surface.

A future governed provider rotation can select a different adapter deployment before a new request is created. Once a request exists, that request's provider identity and exact result remain authoritative.

## R10 focused matrix

The R10 test file exercises:

1. factory binding version/chain/fingerprints;
2. fail-closed chain binding outside Robinhood mainnet;
3. generic quote/request/replay selector compatibility;
4. contribution source call identity and bound request context;
5. canonical collection admission at the billable request boundary;
6. immutable Dice/provider/registry/contribution-source bindings;
7. storage-only callback / no-refund / zero-default semantics;
8. duplicate callback exact-word immutability;
9. provider-config drift fail-closed behavior through the generic quote seam;
10. Phase 2C queue/hopper exact payment with no reserve subsidy when the hopper is sufficient.

## Gates that remain open after a successful R10

Even if all R10 local tests pass, Robinhood remains fail-closed until later gates are completed:

- Robinhood mainnet Dice oracle address + runtime bytecode re-verification;
- actual mainnet Dice provider discovery and configuration re-verification;
- production-grade independent user contribution source;
- mainnet fee/commitment/sequence/default-gas validation;
- storage-only callback mainnet/fork preflight;
- single-provider/keeper liveness monitoring and incident runbook;
- production-acceptable security review/audit;
- production adapter audit;
- explicit activation decision.

R10 is an **interface freeze**, not a production activation.
