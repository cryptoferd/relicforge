# Relic Forge R12-v2 - Final Cross-Contract Security Gate

This is the final pre-main-branch security gate for the current R12-v2 production candidate.

It makes no production changes and broadcasts no transactions.

The gate attacks the exact fresh Sepolia canary that passed the R11/R4 live certification, using
forked chain state at two known blocks:

- 11,635,046: collection fully configured and sold out, immediately before delayed reveal request.
- 11,635,053: exact-word replay completed and the two-token collection fully revealed.

The deterministic suite proves local/deployed Collection bytecode identity, immutable EIP-1167
linkage, Factory/Registry/Reserve binding, standards claims, privilege isolation, clone
reinitialization resistance, two-step FeePolicy and Reserve handoffs, revenue reserve boundaries,
full delayed-reveal lifecycle, storage-only callback behavior, permissionless replay idempotence,
and conservative Reserve accounting.

The stateful hostile handler randomly interleaves unauthorized Collection, MintPhases, FeePolicy,
Reserve and adapter actions with legitimate delayed-reveal request, wrapper fulfillment,
permissionless replay, duplicate replay, Reserve sync, sold-out mint attempts and NFT theft attempts.

The invariant engine continuously asserts that no hostile privileged action succeeds, supply and
recipe bounds hold, roles and immutable bindings never drift, clone linkage remains exact, cached
Reserve liabilities never understate live liabilities, reveal delivery remains coherent, and ERC
interface claims remain exact.

Runner policy:
- 5,000 invariant runs;
- depth 256;
- fail-on-revert enabled;
- existing production attack-surface scanner;
- R4 adversarial regressions;
- R11 Reserve/revenue regressions;
- R10 standards regression;
- PlatformFeeSecurity regression;
- full repository regression;
- strict production and working-tree allowlists.

A green result is the code/security gate for committing the R12-v2 production changes to the
forge-reveal-v2 branch and then merging/pushing them to main. It is not a third-party audit guarantee.
