# R12-v2 — Ethereum Production Stack / Sepolia Candidate

Status: **production-shaped contract candidate; local/fork validation required**
Mainnet activation: **NO**

## Contracts introduced

- `RelicForgeV2Core.sol`
- `RFRevealPermutationV2.sol`
- `RelicForgeCanonicalRegistryV2.sol`
- `RelicForgeReserveV2.sol`
- `RelicCollectionV2.sol`
- `RelicForgeFactoryV2.sol`
- `RelicMintPhasesV2.sol`

`RelicChainlinkVRFV25DirectAdapterV2.sol` is also promoted onto the production V2 core and now
fails closed if quote/request/callback execution occurs on a chain other than its immutable
`targetChainId`.

## Clone launch architecture

Factory V2 deploys EIP-1167 minimal-proxy clones of:
- one shared `RelicCollectionV2` implementation,
- one shared `RelicProjectDataV1` implementation.

Every collection clone has its own address and storage. Creator ownership/control is initialized
to the launch caller. The factory records `creator -> collections`, exposes
`isRelicForgeCollection`, and atomically registers each clone in:
- `RelicForgeCanonicalRegistryV2` for provider billing authorization,
- `RelicForgeReserveV2` for exact-shortfall reserve access.

The registry and reserve each have a one-time factory-binding ceremony. Their bootstrap authority
is burned after binding.

## Reveal architecture

### Delayed reveal
Hidden sequential ERC-721s are minted normally. A later delayed reveal request obtains one
Chainlink word. The collection stores only:
- seed,
- affine-bijection multiplier,
- affine-bijection offset,
- delayed reveal supply boundary.

There are no per-token reveal writes.

### Unsold collection after delayed reveal
If supply remains, the collection irreversibly switches all future mints to Forge Reveal.

Previously revealed token `i` uses permutation index `i-1`.
Future Forge Reveal draws unique indices only from `[delayedRevealSupply, maxSupply)`, then applies
the same permutation. Therefore the Forge pool is exactly the complement of the recipes consumed by
the delayed population, without enumerating or marking those recipes.

### Forge reveal
Collector mint transactions reserve supply only. They do not call Chainlink.
Reservations lock into batches of at most 20 NFTs. A later permissionless executor requests VRF.
The Chainlink upstream callback stores the verified word in the adapter and returns.
A later `replayFulfillment()` delivers the exact word to the collection.
A later `settleReady()` assigns recipes and mints the final NFTs in batch order.

## Economics

- Sponsored launch funds are held as the collection hopper, not immediately treated as revenue.
- Minter-supported platform fees feed the collection hopper.
- Creator/team mints in minter-supported mode pay half of the current per-NFT platform fee
  (rounded up to the nearest cent) so large team allocations cannot consume unpaid RNG capacity.
- Hopper pays randomness first.
- Forge Reserve can cover only the exact onchain-reported shortfall.
- Creator mint proceeds remain escrowed until Forge settlement.
- `withdraw()` can move only tracked creator proceeds to the fixed payout receiver.
- Excess hopper funds can be pulled only by the canonical Reserve.

## Known mainnet gate

`RelicForgeReserveV2.releaseRevenue()` still re-syncs the complete registered-collection list.
That is intentionally acceptable for the Sepolia production canary, but mainnet activation remains
blocked on replacing the O(N) global revenue sync if scale makes it impractical.

R12-v2 is not a mainnet activation package.


## R2 EIP-170 modularization

R1 compiled `RelicCollectionV2` to 26,755 deployed bytes, exceeding Ethereum's 24,576-byte
EIP-170 ceiling by 2,179 bytes. The size gate stopped the package before any commit or deployment.

R2 does not remove sale functionality. Instead, every launched project now receives a third
45-byte EIP-1167 clone, `RelicMintPhasesV2`, alongside its Collection and ProjectData clones.

The sale clone owns:
- master sale enable/disable,
- phase creation/update/enable state,
- public/Merkle phase validation,
- per-wallet counters,
- phase supply counters,
- public mint fee quotes,
- creator/team fee quotes.

The ERC-721 collection keeps the user-facing `mint()` and `creatorMint()` entrypoints. During
`mint()`, it calls only its own bound sale clone to consume the phase allowance. This removes a
large amount of phase bookkeeping bytecode from the ERC-721 implementation while keeping the
same sale behavior and keeping collector mint transactions provider-independent.

Studio will read/configure phases through `collection.mintPhases()` / Factory's
`mintPhasesForCollection(collection)`.


## R3 test-fixture correction

R2's sale-module split remains unchanged. R2 compilation stopped because the package generator
duplicated local sale-clone variables in one new test fixture and omitted them in a second fixture.
R3 corrects only the test setup and adds an installer guard to prevent recurrence.


## R4 compiler stack-shape correction

R3 reached production compilation but Yul reported `var_collection` one slot too deep in the stack.
The Factory's public launch methods remain ABI-compatible; internally R4 now passes a `LaunchConfig`
structure and initializes `RelicCollectionV2` with one shared `RelicCollectionInitV2` tuple.

This is a compiler-shape refactor only. It does not remove or alter the sharded ProjectData /
Renderer pipeline or any reveal/economics behavior.


## R5 V2 launch ABI compaction

R4 proved the remaining Yul stack overflow was still present after internal launch compaction.
The remaining high-width ABI surface was the new 14-argument `createCollectionV2` entrypoint.

R5 preserves the legacy-compatible `createCollection` and `createCollectionWithFeeMode` function
shapes and changes only the new V2 extended launch API to one `LaunchConfig calldata` tuple.
This avoids the via-IR ABI-decoder stack ceiling and is the intended Studio API for V2-specific
reveal and randomness configuration.


## R6 EIP-1167 clone-state correction

R5 compiled at 24,002 deployed bytes, but the hybrid test exposed a production-relevant clone
initialization issue: Solidity inline storage initializers do not initialize EIP-1167 proxy
storage. The queue sentinels therefore started at zero in launched clones.

R6 explicitly initializes `nextReservationId`, `openBatchId`, and `nextSettleBatchId` to 1 inside
`RelicCollectionV2.initialize()` and adds both static and runtime clone assertions.

The permutation helper's revert strings were also converted to custom errors to recover bytecode
headroom while preserving all reveal-domain checks.


## R7 test getter correction

R6 compilation stopped in the new batch-lock assertion because the test destructured only 10
components from the 12-component public `batches(1)` getter. R7 selects the correct `locked`
(component 10) and `settled` (component 12) positions. Production Solidity is unchanged from R6.
