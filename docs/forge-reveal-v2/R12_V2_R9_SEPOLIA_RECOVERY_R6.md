# R9 Sepolia Recovery R6 - Explicit Gas for Exact-Word Replay

## R5 live finding

The real delayed Chainlink word was already stored in the adapter.

`replayFulfillment(1)` then mined successfully, but the Collection remained:

- `delayedRevealRequested = true`
- `delayedRevealed = false`
- `futureRevealMode = Deferred`
- `hybridForgeActive = false`

The subsequent mint correctly reverted with `RFV2_DelayedRevealPendingProd()`.

## Exact cause

The adapter intentionally does not revert when a caller provides too little transaction gas for
consumer delivery.

Its production `_deliver()` path requires more than:

- 400,000 gas reserved for the Collection callback
- plus 50,000 gas retained by the adapter

If `gasleft()` is at or below that threshold, `replayFulfillment()` emits a failed-delivery event
and returns `false`.

That behavior is useful for permissionless replay safety, but it interacts badly with generic gas
estimation: an estimator can discover the inexpensive, non-reverting `false` path and broadcast a
transaction whose status is SUCCESS even though the word was not delivered.

That is exactly what happened in R5.

## R6 correction

R6 does not change production Solidity.

The PowerShell runner sends both exact-word replay transactions directly with:

`--gas-limit 1000000`

It then verifies `deliveredForLocalRequest == true` before continuing.

The delayed replay is followed by an explicit check that the Collection actually reached:

- `delayedRevealed == true`
- `hybridForgeActive == true`

R6 also removes replay calls from the subsequent Foundry broadcast scripts so Foundry cannot
re-estimate these permissionless delivery transactions.

## Stage2 manifest correction

Foundry script JSON writes occur during script execution/simulation, so a failed broadcast can
leave a stage2 JSON containing simulation-only request IDs.

R6 therefore runs a separate read-only recorder after the Forge request transaction has mined.
That recorder queries the actual persisted Collection/Adapter state and overwrites stage2 JSON with
the real local and upstream request IDs.

No mainnet activation is authorized by R6.
