# Relic Forge R12-v2 R11 - Revenue Security R3

R11 R1 removed the Reserve's O(N) revenue-release scan and passed 346/346 repository tests.
R1 also showed that the Collection runtime is now 24,562 bytes, leaving only 14 bytes under
EIP-170. R2 therefore does not modify RelicCollectionV2 at all.

## Platform revenue destination

Platform funds have one fixed onchain destination:

`RelicForgeReserveV2.revenueTreasury`

`releaseRevenue()` has no recipient argument. Callers cannot redirect a withdrawal.

## Two-step treasury change

The one-step `setRevenueTreasury()` function is removed.

A treasury change now requires:

1. current `founder` calls `proposeRevenueTreasury(newTreasury)`;
2. `newTreasury` itself calls `acceptRevenueTreasury()`.

Until step 2 succeeds, `revenueTreasury` remains unchanged. A typo or inaccessible address therefore
cannot immediately strand/redirection platform revenue.

For mainnet the founder should be a dedicated administrative multisig and the revenue treasury
should be a separate treasury multisig. Two-step acceptance does not replace multisig security.

## Two-step founder change

The one-step `transferFounder()` function is removed.

Founder handoff now requires:

1. current founder calls `proposeFounder(newFounder)`;
2. new founder calls `acceptFounder()`.

When founder handoff completes, any pending treasury proposal made by the old founder is cleared.
The new founder must explicitly propose a treasury change again.

## End-to-end revenue certification

R2 adds a production-shaped test proving:

collector mint
-> creator sale proceeds are separately accounted
-> platform fee enters Collection hopper
-> actual randomness cost consumes hopper first
-> completed collection makes remaining hopper sweepable
-> exact unused platform fee moves to Reserve
-> required Reserve floor remains
-> only true surplus reaches configured revenueTreasury
-> creator proceeds remain untouched throughout
-> creator withdraw receives the exact creator sale proceeds separately

## EIP-170 freeze

R2 requires RelicCollectionV2 deployed bytecode to remain exactly 24,562 bytes.
Any Collection runtime change causes the R2 installer to abort.

Mainnet activation remains disabled until all remaining R11 mainnet-readiness gates are complete.
