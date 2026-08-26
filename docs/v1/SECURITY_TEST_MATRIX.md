# RelicForge Contracts V1 — Security Test Matrix

RC2 expands the V1 test gate from four smoke tests into domain-specific unit, adversarial, fuzz, and stateful-invariant suites.

## Sale / phase controls
- collection starts globally paused
- disabled, future, and expired phases cannot mint
- start time can move later or sooner
- exact phase price enforcement
- phase supply cap
- per-phase wallet cap
- global max supply across wallets
- phase supply cannot be reduced below already-minted quantity
- overlapping phases keep independent wallet accounting
- mint batch ceiling

## Whitelists
- single-leaf and multi-leaf Merkle proofs
- explicit allowance enforcement
- proof binds chain ID
- proof binds collection address
- proof binds phase ID
- wallet-specific proof enforcement

## Authority / immutability
- only creator/controller can mutate collection administration
- factory, renderer, and randomness provider have no collection-admin authority
- only creator can configure unsealed project data
- project data is immutable after content seal
- render policy becomes immutable when content seals
- renunciation blocked while deferred reveal work remains
- renunciation is irreversible
- preconfigured Forge mint remains operational after renunciation
- payout and royalties survive renunciation

## Randomness / reveal
- only configured randomness provider can fulfill collection requests
- unknown request IDs rejected
- out-of-order callbacks cannot reorder recipe consumption
- partial reveal processing is bounded and permissionless
- zero-step processing rejected
- deferred -> Forge -> deferred interleaving uses one no-replacement recipe pool
- full-supply Forge reveal cannot duplicate recipes
- random word cannot be rerolled
- failed delivery stores the same verified word for replay
- successful delivery is idempotent on further replay attempts

## Data integrity / rendering
- art shard bounds enforced
- DNA bounds explicitly enforced before extcodecopy can zero-pad
- missing trait references block validation
- impossible DNA shard configurations rejected
- all recipes must be validated before seal
- zero provenance hash rejected
- JSON quote/backslash/control-character escaping
- placeholder and revealed canonical rendering smoke tests

## ERC-721 / payout safety
- unauthorized transfers rejected
- approved transfers work and clear approval
- operator transfers work
- safe transfer receiver checks
- failed safe transfers roll back ownership
- zero-address transfer rejected
- permissionless withdrawal cannot redirect payout
- payout reentrancy cannot double-spend
- rejecting payout target cannot redirect or erase funds

## Fuzzing
Foundry fuzz runs exercise:
- exact mint-price accounting
- full-domain ERC-2981 royalty arithmetic
- no-replacement recipe selection across arbitrary random seeds
- wallet-limit boundaries

## Stateful invariants
The reveal handler randomly interleaves creator mints, reveal-mode changes, epoch requests, randomness fulfillment, and bounded processing. The following must always hold:
- `totalMinted <= maxSupply`
- `totalAssignedRecipes <= totalMinted`
- `deferredPendingCount <= totalMinted`
- every assigned recipe is in range
- no recipe is assigned twice
- assignment counter equals actual assigned-token count
- every minted token has a nonzero owner

## Still required before mainnet
This suite is not a substitute for independent audit or formal verification. Production also requires a chain/provider-specific randomness adapter with fail-closed consumer authorization, static analysis, gas/DoS profiling, testnet rehearsal, and an external security review.
