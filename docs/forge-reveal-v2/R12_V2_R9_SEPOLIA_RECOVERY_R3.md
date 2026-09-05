# R12-v2 R9 Sepolia Recovery R3

Baseline commit: `330d1da53a184dffb7ce89fedc2ebb7bd4d48094`

## Live finding

The first real Sepolia canary successfully deployed and source-verified the shared V2
infrastructure, created the real collection clones, wrote/sealed real art and DNA shards, enabled
the phase, and minted two hidden NFTs.

The first `requestDelayedReveal()` transaction then exhausted its broadcast gas limit **after**:

- the collection quoted Chainlink,
- the Forge Reserve supplied the exact shortfall,
- the adapter called the official Sepolia VRF v2.5 wrapper,
- the wrapper called the official coordinator,
- the coordinator returned a real upstream request ID,
- the adapter emitted `ThinRandomnessRequested`.

Because the outer collection transaction ran out of gas before returning, the entire transaction
reverted atomically. Onchain recovery-state checks confirmed:

- `delayedRevealRequested == false`
- `delayedRevealed == false`
- adapter `nextRequestId == 1`
- Reserve lifetime subsidy remains zero
- Reserve balance remains intact

No orphan Chainlink request survived.

## Root cause

Foundry `forge script` uses a gas-estimate multiplier. The failed transaction consumed its entire
broadcast gas allowance of 440,533 gas. The trace shows the provider call returned successfully and
the OOG happened in the outer Collection frame while it still had post-provider storage/event work
to perform.

R3 retries with a 300% gas-estimate multiplier. Unused gas limit is not charged; only actual gas
consumed is paid.

The same higher multiplier is used for the later Forge randomness request because it has the same
provider-call-then-persist shape.

## Recovery behavior

The recovery does not redeploy infrastructure and does not launch another collection.

It:

1. validates the existing canary state,
2. retries only `requestDelayedReveal()` with 300% gas-estimate headroom,
3. replaces simulation-only request IDs in the stage-1 JSON with the IDs that actually persist,
4. links/verifies the three canary clones on Etherscan using the existing Free-tier pacing,
5. waits for the real delayed word,
6. advances the canary using 300% gas-estimate headroom,
7. waits for the real Forge word,
8. finalizes and runs the existing read-only final verifier.

The runner is restart-safe at the Chainlink waiting boundaries.

Mainnet activation remains disabled.


## R4 installer allowlist correction

The live R9 broadcast created two untracked deployment manifests in the repository. R3 treated
those expected live artifacts as unrelated working-tree changes and aborted before installing the
recovery script.

R4 allows exactly:

- `deployments/r12-v2-r9/sepolia-infrastructure.json`
- `deployments/r12-v2-r9/sepolia-canary-stage1.json`

All other unrelated changes remain fail-closed.
