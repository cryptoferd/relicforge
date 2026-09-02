# Forge Reveal V2 — Phase 2D R9 Robinhood Production-Integration Certification

Baseline branch: `forge-reveal-v2`  
Baseline commit: `ec03553fd3aff1f82b66a9ca1780a567eea6784f`  
R9 status: **local production-integration certification PASSED; production activation remains blocked**  
Production enabled: **NO**

## Local validation result

Reviewed on 2026-09-02 using Foundry 1.7.1 / Solc 0.8.30:

- R9-owned Solidity formatting: PASS
- `forge build`: PASS
- focused R9 integration: 10 passed / 0 failed
- all Phase 2D: 99 passed / 0 failed
- all experimental: 169 passed / 0 failed
- full repository regression: 293 passed / 0 failed
- `git diff --check`: PASS
- changed-file allowlist: exactly the six R9 paths

Repo-wide `forge fmt --check` is not a certification gate for R9 because the locked R8 baseline contains pre-existing formatter drift across unrelated committed files. The two R9-owned Solidity files passed formatting validation.

## Purpose

R9 does not invent a new Robinhood randomness design. It promotes the already live-certified R8 Dice storage-only callback path into a production-integration candidate and tests it against the existing Phase 2C queue/hopper/reserve/settlement architecture.

The collector transaction remains isolated from Dice. A successful collector reservation is final with respect to provider availability: Dice outage, fee spike, keeper delay, executor disappearance, downstream word-delivery failure, or reserve shortage may delay reveal/settlement, but must not retroactively invalidate the accepted reservation.

## R9 candidate adapter

`RelicDiceEntropyV10RobinhoodAdapterV2Candidate.sol` intentionally inherits the exact R8 `RelicDiceEntropyV10StorageOnlyAdapterV2Harness` implementation.

This is deliberate. R9 must not fork the R8 callback behavior that was live-certified on Robinhood testnet sequence 840.

The Dice upstream callback remains storage-only:

1. authenticate the pinned Dice oracle;
2. authenticate the pinned Dice provider;
3. resolve Dice sequence -> local request;
4. reject unknown/already-recorded requests;
5. store the exact Dice word;
6. mark the word ready;
7. emit the record event;
8. return.

It does **not** call the collection, settle NFTs, transfer ETH, touch Forge Reserve, request replacement randomness, or call Dice refund functions.

## Integrated Phase 2C path

### Collector transaction

`requestForgeMint(...)`

- validates payment and supply;
- reserves recipient/quantity;
- escrows creator proceeds;
- credits the collection hopper;
- appends to the current immutable batch;
- locks full/final batches when applicable;
- makes **zero** RNG provider calls.

### Later permissionless RNG dispatch

`requestRandomnessForBatch(batchId)`

- requires a locked, unrequested batch;
- obtains the Dice exact request fee through the adapter;
- enforces the collection's maximum randomness cost;
- consumes collection hopper first;
- draws only the exact remaining shortfall from the chain-local Forge Reserve;
- requests one Dice sequence;
- binds one local request identity to one Forge batch.

### Real/verified Dice callback

The adapter stores the exact word and returns. No collection delivery occurs in the upstream callback.

### Later permissionless exact-word delivery

`replayFulfillment(localRequestId)` calls the Forge collection with the exact stored word. A failed downstream delivery leaves the word unchanged and replayable.

### Later permissionless settlement

`settleReady(maxTokens)` performs the NFT work after the collection has accepted the word. Twenty-NFT settlement remains outside the Dice callback.

## R9-v1 adverse-case test matrix

`ForgeRevealV2Phase2DRobinhoodProductionIntegration.t.sol` explicitly exercises:

- Dice unavailable before request;
- Dice fee spike above the collection cap;
- delayed keeper/fulfillment after a request exists;
- replacement-randomness attempt after request creation;
- original executor disappears after mint;
- original executor disappears after callback;
- different permissionless actors perform dispatch, replay, and settlement;
- downstream consumer temporarily rejects word delivery;
- exact stored word survives failed delivery;
- duplicate Dice callback cannot replace the word;
- duplicate replay is idempotent;
- dangerous provider default-gas drift fails closed;
- exhausted provider sequence range fails closed;
- insufficient hopper + reserve liquidity delays dispatch without invalidating mint;
- noncanonical collection cannot create a billable Dice request;
- collection exposes no runtime provider-switch surface;
- no automatic cross-provider fallback;
- no refund/reroll path is introduced.

## Independent contribution source remains OPEN

R9 intentionally does **not** claim that the production Dice user-contribution problem is solved.

The candidate still requires an `IRelicDiceContributionSourceV2` implementation. A production implementation must separately prove:

- entropy independence from the permissionless request executor;
- freshness;
- uniqueness/reuse prevention;
- governance and rotation;
- liveness;
- failure semantics;
- no executor-controlled selection/reroll surface.

R9-v1 uses a deterministic test mock only to exercise the integration seam. That mock is not a production recommendation.

## Robinhood activation gates still open

Before `productionEnabled` can ever become true:

1. reverify Robinhood mainnet Dice oracle address and deployed bytecode;
2. discover/reverify the actual mainnet provider address;
3. reverify provider commitment, sequence range, fee, and `defaultGasLimit` behavior;
4. independently review/audit the production candidate and its dependencies;
5. close the independent contribution-source gate;
6. establish keeper/provider/fee/config monitoring and incident runbooks;
7. explicitly accept or mitigate zero-default remaining-gas residual risk;
8. re-run mainnet/fork activation preflight immediately before deployment.

## R9-v1 does not modify production V1

All R9 additions remain under `contracts/production/experimental`, `test/v1/experimental`, and `docs/forge-reveal-v2`.

Production V1 remains untouched.

## Certification meaning

If the R9-v1 installer passes focused tests, all Phase 2D tests, all experimental tests, and the full repository regression, the result means:

**Robinhood Dice R8 storage-only randomness is locally integrated with the actual Phase 2C Forge queue/hopper/reserve/permissionless-settlement architecture and survives the required adverse cases.**

It does **not** mean Robinhood mainnet production activation is approved.
