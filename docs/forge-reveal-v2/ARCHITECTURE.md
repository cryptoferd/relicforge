# Relic Forge Reveal V2 — Phase 1 Architecture

Status: EXPERIMENTAL
Baseline branch: `forge-reveal-v2`
Baseline commit: `188f5c779795d81b1c9fabe3bf1ad63832a0c89c`

## Why this branch exists

The V1 reveal pipeline obtains strong randomness, but then physically assigns recipes token-by-token through
`processReveal()`. That creates an O(N) reveal cost and an unacceptable creator workflow at large supply.

V2 separates the two user experiences instead of forcing them through one state machine.

## Forge Reveal V2

Product promise:

> A collector signs once. Supply is reserved. Verified randomness arrives. A random unused NFT is minted directly
> to the collector, already revealed.

Prototype flow:

1. Collector requests a Forge mint.
2. Supply is committed immediately so concurrent pending requests cannot oversell.
3. No placeholder ERC-721 is minted.
4. The configured randomness provider returns a verified word asynchronously.
5. Random words are *recorded* whenever they arrive.
6. Reservations settle strictly in request order.
7. Settlement draws random unused token IDs from a sparse Fisher-Yates deck.
8. The token ID directly selects the recipe: `recipeId = tokenId - 1`.
9. The ERC-721 therefore comes into existence already revealed.

### Why strict settlement order matters

If multiple randomness callbacks are ready at the same time, allowing the provider/sequencer to choose which
one draws from the remaining token deck first creates an ordering-bias surface.

The prototype therefore gives every reservation an immutable sequence and only consumes the deck in that order.
A later callback may arrive first, but it waits until earlier sequence gaps are filled.

Normal callbacks attempt bounded automatic settlement. A permissionless `settleReady(maxTokens)` recovery path
exists for callback-gas limits or an out-of-order backlog. This never requires the collector or creator to sign
again; production can pair it with an automation/keeper if necessary.

### Forge gas reality

Forge Reveal cannot avoid the storage required to mint an ERC-721. Random-without-replacement also needs some
state unless a future provider offers a verifiable random permutation primitive.

The sparse deck requires at most one additional swap write per drawn NFT. Phase 1 measures 1/50-token callback
costs before any production callback gas limit is selected.

## Reveal Later V2

Product promise:

> Mint hidden NFTs normally. When the creator reveals, one verified random word establishes the whole
> token-to-recipe mapping.

Prototype flow:

1. Hidden token IDs mint sequentially.
2. Creator requests reveal once.
3. Further minting freezes at reveal request so the now-public mapping cannot be used to snipe future mints.
4. Provider returns one verified random word.
5. Contract derives two small permutation parameters and stores them.
6. Every existing NFT becomes revealed immediately.
7. `recipeForToken(tokenId)` computes its unique recipe in O(1).

There is no per-token reveal storage, no `processReveal()`, and no creator batch-processing loop.

## Phase 1 permutation

The prototype uses an affine permutation:

`recipe = (a * (tokenId - 1) + b) mod maxSupply`

with `gcd(a, maxSupply) = 1`.

This guarantees:
- no duplicate recipes;
- no missing recipes across the full domain;
- O(1) lookup;
- O(1) reveal state.

This is a *prototype primitive*, not a final cryptographic PRP decision. A stronger format-preserving permutation
can replace it later if we want a less visibly structured mapping. The reveal state machine does not depend on
which bijection library is ultimately selected.

## Deliberately not changed in Phase 1

- `RelicCollectionV1.sol`
- `RelicForgeFactoryV1.sol`
- current Chainlink adapter
- Studio
- Creator Dashboard
- production deployments

Phase 1 must prove behavior, uniqueness, callback ordering, and gas first.
