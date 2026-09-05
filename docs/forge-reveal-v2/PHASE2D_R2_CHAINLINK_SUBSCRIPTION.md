# Forge Reveal V2 — Phase 2D R2: Chainlink VRF v2.5 Native Subscription Certification

Status: **experimental / not production certified**
Baseline: `forge-reveal-v2` @ `726ca7df6b33e775c9f0b165709b03e5c951b2b8`

## Purpose
R2 compares Chainlink VRF v2.5 native subscription funding with the committed R1 direct-native thin-callback path while preserving the Forge Reveal V2 invariants: canonical consumers only, one verified word, persist-before-delivery, exact-word replay, no rerolls, thin 300k provider callbacks, separate permissionless NFT settlement, and Phase 2C hopper/reserve responsibility.

## Critical coordinator-ordering finding
The reviewed Chainlink coordinator flow verifies the proof, deletes the request commitment, invokes the consumer callback, then calculates/charges the final payment and emits `RandomWordsFulfilled` with that payment. Therefore the exact subscription payment does not exist for the adapter to record during its callback. The callback also cannot read a log that will be emitted later in the same transaction.

Consequences:
- exact per-request provider cost is available in the coordinator fulfillment event after callback;
- an adapter can know its pre-request reservation but not the final charge during fulfillment;
- shared-subscription balance deltas are not a robust exact-attribution primitive because concurrent fulfillment/top-ups can make deltas ambiguous;
- R2 MUST NOT claim Phase 2C-style atomic exact cost attribution is solved for subscriptions.

## Experimental reservation model
Each canonical collection pays a fixed conservative reservation before its request is dispatched. The adapter forwards that value into the shared native subscription and only then requests one word with a 300,000-gas callback. Per-consumer pending-request caps throttle a single canonical collection. The adapter tracks reservation funding by consumer and request.

If reservation >= actual provider charge, the request does not consume previously shared liquidity. If reservation < actual charge, the difference necessarily comes from shared subscription liquidity. The R2 tests intentionally demonstrate both outcomes.

A reservation is **not a live quote** and is **not exact actual cost attribution**. Chainlink coordinator/keyHash/premium/flat-fee/gas-price configuration can change. The coordinator request ABI does not expose a per-request maximum-payment cap. A stale reservation therefore remains a production risk.

## Locally testable behavior
R2 tests cover coordinator ABI fields, configured subId/keyHash/confirmations, fixed 300k callback despite a 2.45M collection settlement envelope, funding-before-request, canonical consumer enforcement, coordinator consumer admission, per-consumer pending caps, two-consumer independence, sufficient-reservation protection, under-reservation shared-buffer drain, exact-word persistence/replay, duplicate-callback no-reroll, coordinator-only fulfillment, callback-before-charge ordering, and deferred `settleReady(20)` NFT settlement.

## Production certification gates still open
1. Production-safe reservation derivation that remains conservative across coordinator/keyHash/config rotations.
2. Exact per-request actual-cost attribution if Relic Forge requires on-chain collection-level reconciliation.
3. Trusted/reconciled reporting design for `RandomWordsFulfilled.payment`, or a more isolated subscription architecture.
4. Governance/rotation process for subscription owner, consumers, lanes, reservations, and emergency pause.
5. Live testnet/fork validation against current deployed coordinator behavior and addresses.
6. Production adapter audit.

Until these gates close, Chainlink VRF v2.5 subscription-native remains `productionEnabled: false` and unknown/uncertified chain-provider pairs continue to fail closed.
