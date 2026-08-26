# RelicForge Contracts V1 — Release Candidate

**Status:** development release candidate. **Not audited. Not for mainnet deployment.**

This directory is intentionally separate from `contracts/RelicForgeTest.sol`. The existing Sepolia/browser-compiled test stack remains intact while V1 is hardened.

## V1 architecture

- `RFCoreV1.sol` — shared libraries, interfaces, immutable data shard, compact errors.
- `RelicProjectDataV1.sol` — creator-owned collection content/config; permanently immutable after `sealContent`.
- `RelicCollectionV1.sol` — ERC-721, creator-only sale control, unlimited storage-driven phases, hybrid epoch/Forge reveal, payout/royalty separation, irreversible controller renunciation.
- `RelicRendererV1.sol` — shared canonical onchain renderer.
- `RelicForgeFactoryV1.sol` — ownerless immutable clone factory. No admin setters or upgrade path.
- `RelicRandomnessAdapterBaseV1.sol` — vendor-neutral same-word replay-safe delivery base.
- `RelicRandomnessMockV1.sol` — test-only manual randomness provider. Never use on mainnet.

## Critical design rules

1. Collections deploy with master minting **OFF**.
2. Only the original creator/controller can alter onchain collection controls. V1 has no controller transfer.
3. RelicForge/factory/backend have no collection-admin privileges.
4. Factory infrastructure addresses are immutable. A future engine means a new versioned factory.
5. Mint phases are mapping-backed and effectively unbounded; no function loops over all phases.
6. Phase timestamps/prices/roots/limits/enabled state remain creator-editable until controller renunciation.
7. Whitelist leaves bind `chainId + collection + phaseId + wallet + allowance`.
8. Content sealing is separate from sale control.
9. Deferred reveal assigns recipes only to tokens in a snapshotted epoch; future token mappings do not exist.
10. Future mints may switch between deferred epoch reveal and Forge reveal.
11. Both reveal modes draw without replacement from one shared recipe pool.
12. Reveal requests are processed in request sequence order. Out-of-order callbacks can store randomness but cannot reorder recipe consumption.
13. `processReveal` is permissionless and bounded.
14. `payoutReceiver`, `royaltyReceiver`, and controller are separate concepts.
15. Renouncing controller is irreversible and does not remove payout/royalty routing.
16. `withdraw()` can be triggered by anyone but can only pay the configured payout receiver.
17. RelicForge site moderation is offchain only; it cannot pause or mutate a launched contract.

## Randomness

The included mock proves the expected consumer interface and same-word replay semantics. Production requires a chain-specific audited VRF adapter. The V1 factory must be deployed with that immutable adapter address.

## Compilation baseline

- Solidity 0.8.30
- optimizer enabled
- runs = 1
- viaIR = true
- Cancun EVM
- runtime targets must remain below current EIP-170 limits until/unless a future network upgrade is actually active.

## Before mainnet

Do not deploy this RC to mainnet until compilation, gas/runtime snapshots, unit tests, fuzz/invariant tests, static analysis, formal checks of critical invariants, testnet rehearsal, and an independent audit are complete.

## RC2 security hardening

RC2 adds explicit DNA read bounds, bounded seal-time behavior, uint64 reveal cursors, overflow-safe royalty arithmetic, immutable render policy after content seal, fail-closed randomness-consumer authorization hooks for production adapters, and idempotent successful randomness delivery. See `docs/v1/RC2_HARDENING.md` and `docs/v1/SECURITY_TEST_MATRIX.md`.
