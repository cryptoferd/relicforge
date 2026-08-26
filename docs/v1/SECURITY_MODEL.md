# RelicForge V1 Security Model

## Public trust statement target

> Before control is renounced, only the creator wallet controls mutable collection settings. After control is renounced, nobody controls them.

That statement must remain provable from verified deployed bytecode.

## Release gates

V1 is not mainnet-ready until all of the following are complete:

1. Deterministic compilation and bytecode/runtime-size snapshots.
2. Unit tests for every privileged state transition and mint/reveal boundary.
3. High-run fuzz tests.
4. Stateful invariant tests.
5. Static analysis (Slither or equivalent).
6. Adversarial ERC-721 receiver/payment tests.
7. Merkle proof replay and boundary tests.
8. Randomness duplicate/out-of-order/failure/replay tests.
9. Gas/DoS tests for large phase counts, mint batches and reveal batches.
10. Renderer/data corruption tests.
11. Formal verification of critical invariants where practical.
12. Independent professional audit.
13. Remediation and re-review of every audit finding.
14. Full Sepolia/testnet release-candidate rehearsal.
15. Mainnet source/bytecode freeze and verification.
16. Public bug bounty after launch.

## Critical invariants

- `totalMinted <= maxSupply` always.
- `totalAssignedRecipes <= maxSupply` always.
- A token receives at most one recipe.
- A recipe is assigned to at most one token.
- No mint succeeds before content sealing.
- No user mint succeeds unless master minting and the selected phase are both open.
- Phase supply, wallet limits and whitelist allowances cannot be bypassed.
- Later randomness fulfillment cannot reorder the shared recipe pool.
- Randomness recovery cannot create a second random word for the same request.
- Sealed project data cannot change.
- RelicForge infrastructure cannot call creator-only collection controls.
- Renounced controller can never be restored.
- Withdrawal destination can never be selected by the caller.
- Royalties/payout remain configured after renunciation.
- Every sealed recipe references valid traits.

## Deliberate V1 attack-surface reductions

- No upgradeable factory.
- No factory owner.
- No RelicForge admin role on collections.
- No onchain collaborator/delegate roles in V1.
- No controller transfer in V1.
- No iteration over all mint phases.
- Bounded mint quantity per transaction.
- Bounded recipe validation and reveal processing.
- Raw custom 1/1 JSON is replaced with structured attributes to avoid malformed metadata injection.
