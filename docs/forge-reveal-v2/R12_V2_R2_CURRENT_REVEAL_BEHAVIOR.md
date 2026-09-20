# Relic Forge R12-v2 R2 — Current Reveal Behavior

Status: **current behavior note for the deployed adaptive R2 architecture**

This document clarifies the behavior implemented by the current R12-v2 R2 collection path. It supersedes older design notes that described a timed cross-transaction Forge batch queue.

## Forge Reveal

Forge Reveal is transaction-level:

1. A successful mint validates MintPhases and payment.
2. ERC-721 ownership is written immediately in that same mint transaction.
3. The NFTs from that mint transaction are split into automatic reveal groups of at most 20.
4. Each reveal group receives an adaptive callback-gas tier based on that group's quantity.
5. The Collection checks the verified-randomness quote against the current 0.005 ETH per-request/group ceiling.
6. The Collection requests Chainlink VRF automatically from the mint transaction.
7. The adapter records the exact verified word and attempts bounded automatic delivery.
8. Successful delivery assigns unique recipes and reveals that group. If delivery needs recovery, permissionless replay uses the same stored word and cannot reroll.

Examples:

- mint 1 => one 1-NFT reveal group;
- mint 10 => one 10-NFT reveal group;
- mint 20 => one 20-NFT reveal group;
- mint 50 => three reveal groups: 20 + 20 + 10.

A later, separate mint transaction starts its own reveal group or groups. The current R2 Forge path does **not** hold a mint open while waiting for later wallets, and it does **not** combine separate mint transactions using a 30-second timer.

## Adaptive callback tiers

| Reveal group quantity | Consumer callback gas |
| --- | ---: |
| 1 | 400,000 |
| 2–4 | 550,000 |
| 5–10 | 900,000 |
| 11–15 | 1,150,000 |
| 16–20 | 1,400,000 |

## Deferred Reveal

Deferred Reveal does not request VRF on each collector mint. NFTs are still owned immediately with the pre-reveal artwork. Later, the creator uses the current two-transaction reveal flow:

1. `prepareDelayedReveal()` freezes the currently minted set and prepares its randomness budget.
2. `requestDelayedReveal()` requests verified randomness using the prepared budget.

The verified callback completes reveal automatically. If supply remains after delayed reveal, future mints switch to Forge Reveal under the transaction-level behavior above.

## Legacy 30-second field

The deployed R2 Collection still exposes `batchWindowSeconds`, initialized to 30 seconds, and historical deployment/certification evidence records that value. The current automatic Forge mint path does not consult that field when forming reveal groups or requesting randomness. It remains part of deployed ABI/state compatibility and should not be described as an active cross-transaction batching window.

Do not rewrite historical deployment evidence to remove the field. Current UI and current architecture documentation should instead describe the implemented transaction-level grouping accurately.

## Randomness cost ceiling

The current platform ceiling remains 0.005 ETH per randomness request/group. This is independent of the legacy batch-window field. Forge groups are checked against the ceiling before requesting randomness.

## Terminology

Use these phrases for the current R2 architecture:

- **transaction-level Forge grouping**
- **automatic reveal group**
- **up to 20 NFTs per reveal group**
- **automatic VRF request in the mint transaction**

Avoid describing current R2 Forge behavior as a **30-second batch window**, **timed cross-wallet batch**, or **permissionless batch close**. Those phrases belong to superseded design documents, not the deployed automatic Forge path.
