# Relic Forge R12-v2 R11 R4 - Adversarial Audit R1

This is an authorized defensive red-team pass against the Relic Forge production stack.

R1 deliberately changes no production Solidity. It adds attack harnesses and scans the current
R11 R3 working tree.

Attack categories in R1:
- unauthorized Reserve founder/treasury takeover attempts;
- stale treasury-proposal races;
- fake/unregistered collection Reserve calls;
- forced ETH into Reserve;
- revenue-release reentrancy;
- rejecting treasury rollback;
- Reserve safety-policy floor;
- bounded maintenance sync abuse;
- FeePolicy unauthorized admin calls;
- FeePolicy compromised-admin blast radius;
- fuzzed Reserve release-boundary preservation;
- production-wide scan for tx.origin, delegatecall, selfdestruct, low-level calls, assembly,
  and all public/external mutators.

Known static finding intentionally surfaced by R1:
RelicForgeFeePolicyV1 still has one-step setTreasury() and transferPlatformAdmin(). These are
onlyPlatformAdmin-gated, so this is not a public attacker bypass, but it increases damage from an
admin key compromise or address-entry mistake. R1 treats this as a mainnet hardening candidate.

R1 also raises the security workload:
- targeted adversarial tests;
- 50,000 fuzz runs for FuzzSecurity;
- 5,000 invariant runs with depth 128;
- full repository regression.

No transaction is broadcast.
No production source is modified.
Mainnet activation remains disabled.
