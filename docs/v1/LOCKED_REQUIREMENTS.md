# RelicForge Contracts V1 — Locked Requirements

This document is the authoritative V1 requirements baseline. If older notes conflict with this document, this document wins.

## Ownership and trust boundary

- The original creator is the only V1 onchain controller.
- V1 does not support controller transfer. Controller can only remain the creator or be irreversibly renounced to `address(0)`.
- RelicForge, factory deployer, backend, renderer and randomness provider receive no general collection-admin role.
- Collaborative/editor permissions belong to Studio/backend project management, not V1 collection authority. Only the creator signs launch/onchain control transactions.
- RelicForge may hide/delist projects from its own website/index, but cannot pause, freeze, redirect, destroy or otherwise modify the launched collection contract.

## Mint lifecycle

- New collections always launch with master minting OFF.
- The creator may enable/disable master minting at any time before renunciation.
- Mint phases are mapping-backed and do not increase collection bytecode as more are added.
- There is no restrictive onchain phase-count or whitelist-count cap.
- Contract functions must never loop over every phase.
- Each phase independently supports price, start time, end time, enabled state, public/Merkle access, phase allocation, wallet limit and priority.
- Start/end times are dynamic. The creator may move them earlier or later, including after a phase has begun.
- `endTime == 0` means no automatic ending.
- Phases may overlap.
- The mint page should show a countdown based on the onchain timestamps and connected wallet local time. The contract, not the UI, is authoritative.
- The UI should identify all active phases a connected wallet qualifies for and default to the highest-priority/best eligible tier.
- Merkle leaves bind chain ID, collection address, phase ID, wallet and allowance to prevent cross-phase/cross-chain/cross-collection proof reuse.
- A bounded per-transaction mint batch is allowed for gas/DoS safety; this is separate from the unlimited number of phases.

## Reveal lifecycle

- The unique compiled recipe pool is shared by every reveal method.
- Deferred/Creator Reveal may snapshot the currently minted range into reveal epochs.
- An epoch only assigns recipes to tokens that were minted as deferred tokens in that snapshot range.
- Future token IDs have no recipe mapping until a later reveal assignment occurs.
- After requesting/revealing an epoch, the creator may switch future mints to Forge Reveal.
- The creator may switch future reveal mode again later; the setting affects future mints only.
- Forge and epoch reveal requests are globally sequence ordered. Later randomness may arrive first, but recipe assignment still consumes the pool in request order.
- Randomness is never rerolled. Failed delivery may only replay the exact verified word.
- Reveal processing is permissionless and bounded so large collections cannot exceed a block gas limit.

## Content and metadata

- Content sealing is independent from sale controls.
- Artwork, DNA/recipes, layer configuration and provenance become permanently immutable after content seal.
- No token may mint before project content has successfully sealed.
- Recipe count is exactly the collection max supply for V1.
- Trait shard reads are bounds checked.
- DNA recipes are validated in bounded sequential batches before sealing.
- Metadata strings are JSON escaped.
- Canonical onchain rendering remains available even if optional flattened presentation services disappear.

## Money

- `controller`, `payoutReceiver` and `royaltyReceiver` are separate.
- Renouncing control does not delete or redirect payout/royalty configuration.
- Renunciation is blocked while deferred tokens still need an epoch. If minting remains armed with unsold supply, future reveal mode must be Forge so future tokens cannot become unrevealable.
- `withdraw()` may be permissionless to trigger, but it can only send the full balance to `payoutReceiver`.
- ERC-2981 royalties remain configured after renunciation; marketplaces may still choose whether to honor royalties.

## Factory/versioning

- `RelicForgeFactoryV1` is ownerless and immutable.
- V1 factory cannot swap implementation, renderer or randomness provider.
- Existing collections remain bound to the exact V1 implementation embedded in their minimal proxy.
- Future contract improvements deploy as a new versioned factory/implementation stack rather than silently upgrading V1.
- Testnets remain supported permanently alongside mainnets.
