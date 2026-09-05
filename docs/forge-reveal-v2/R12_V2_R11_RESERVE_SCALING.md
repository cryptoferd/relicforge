# Relic Forge V2 - R11 Reserve Scaling R1

## Goal

Remove the last known O(N) transaction from the production Reserve revenue path without
sacrificing the solvency boundary.

R10 left `RelicForgeReserveV2.releaseRevenue()` calling `syncAllCollections()` before every
revenue release. That was safe for a small Sepolia collection count, but one transaction
eventually becomes unexecutable as the number of registered collections grows.

## R11 accounting invariant

R11 changes the model from "scan everything immediately before release" to
"conservatively push-synchronized accounting."

A Collection transaction that can INCREASE Reserve liability must atomically call:

`IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this))`

If that synchronization fails, the liability-increasing Collection transaction reverts.

The two production mutation paths that can create new liability are:

1. `_mintDeferred()` - creates the delayed-reveal obligation.
2. `_queueForgeReservation()` - creates/open/locks Forge randomness obligations.

They are both mandatory-push-synchronized in R11.

Other transitions can only leave the Reserve metrics unchanged or reduce them:
- delayed reveal request,
- delayed reveal completion,
- randomness request,
- randomness settlement/completion.

Those may leave cached accounting stale only in the conservative direction. Existing
best-effort syncs and the permissionless `syncCollection()` can lower the cached requirement
and unlock revenue later. A stale cache therefore locks too much ETH; it cannot release too much.

`pullCollectionExcess()` remains safe because the Reserve itself invokes the collection sweep
and then synchronizes the collection in the same transaction.

## O(1) revenue release

`releaseRevenue()` no longer reads or loops over registered collections.

It uses only Reserve-local aggregate counters and balance, making its execution cost independent
of `collectionCount`.

The old `syncAllCollections()` unbounded loop is removed. Maintenance synchronization is replaced
with:

`syncCollections(uint256 cursor, uint256 maxCollections)`

and a hard maximum of 64 collections per call.

## Revenue-call reentrancy boundary

R11 adds a Reserve release lock. While ETH is being sent to `revenueTreasury`, operations that
could alter liabilities, Reserve outflow, policy, or the destination are blocked. This prevents
a smart treasury fallback from changing the solvency boundary after the release amount has been
computed.

## Collection bytecode constraint

R10 certified `RelicCollectionV2` at 24,327 deployed bytes, only 249 bytes below EIP-170.

R11 therefore adds only two mandatory sync calls to Collection and moves the scale mechanics into
`RelicForgeReserveV2`. The installer fails if Collection exceeds 24,576 bytes.

No additional Collection runtime feature should be added after this gate unless code is first
moved out of Collection.

## R1 certification gates

- R11 source audit.
- liability-increasing mint push synchronization.
- required sync failure atomically rolls back a mint.
- releaseRevenue succeeds even when every registered collection reverts if read.
- bounded cursor synchronization with hard 64-collection cap.
- accounting mutations blocked during revenue-treasury external call.
- R10 standards regression.
- R7 production-stack regression.
- R8 sharding regression.
- full repository regression.
- EIP-170 Collection size gate.

No transaction is broadcast by this package.
Mainnet activation remains disabled after R1; this closes the Reserve O(N) architecture blocker
only after all gates pass and the resulting diff is reviewed.
