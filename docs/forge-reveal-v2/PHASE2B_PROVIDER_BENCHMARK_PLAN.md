# Phase 2B — Provider Benchmark Plan

Phase 2A determines the gas required by Relic Forge itself.

Phase 2B then evaluates randomness providers against those measured callback requirements.

Candidate classes:
- existing Chainlink VRF v2.5 adapter;
- Pyth Entropy adapter;
- Supra dVRF adapter;
- chain-native verified randomness where explicitly supported.

For each chain/provider pair record:

1. mainnet/testnet contract addresses;
2. request fee in native currency;
3. funding model;
4. callback gas configuration and maximum;
5. typical and worst-case latency;
6. confirmation/finality behavior;
7. exact-word replay capability;
8. provable terminal-failure behavior;
9. callback ordering behavior;
10. supported EVM chains;
11. provider-specific attack assumptions;
12. 1/5/10/20/50-token Forge feasibility using Phase 2A gas;
13. Reveal Later one-shot cost;
14. RF certification state.

A chain is not marked Forge-capable until at least one provider passes the profile.

RF must never silently fall back to block.timestamp, blockhash, PREVRANDAO, sequencer values, msg.sender, or similar pseudo-randomness.
