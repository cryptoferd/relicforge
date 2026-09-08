# Relic Forge R2.6 Phase 1 — Ethereum Mainnet Read-Only Preflight R13

Status: **PRE-DEPLOYMENT / NO MAINNET TRANSACTIONS**

This phase establishes a reproducible Ethereum mainnet readiness gate for the certified R12-v2 production stack before any infrastructure contract is broadcast.

## Scope

R13 does not deploy Relic Forge to Ethereum mainnet and does not enable mainnet in the website.

It adds a live Ethereum mainnet Chainlink VRF v2.5 fork preflight, ETH/USD feed health checks, full V2 infrastructure deployment inside Foundry's local mainnet fork, Factory/Registry/Reserve binding checks, bootstrap-authority burn checks, fee-policy quoting through the live feed, EIP-1167 collection creation on the fork, focused R12-v2 production security regressions, full repository regression, contract-size reporting, dependency code-hash capture, and a website-language inventory for the next mainnet-facing cleanup phase.

## Ethereum VRF snapshot

Reviewed against Chainlink VRF v2.5 Supported Networks on 2026-09-06:

- LINK: `0x514910771AF9Ca656af840dff83E8264EcF986CA`
- VRF Coordinator: `0xD7f86b4b8Cae7D942340FF628F82735b7a20893a`
- VRF Wrapper: `0x02aae1A04f9828517b3007f83f6181900CaD910c`
- native ETH premium: 24%
- minimum confirmations: 3
- maximum confirmations: 200
- direct-funded maximum random values: 10
- wrapper gas overhead: 13,400
- coordinator native gas overhead: 90,000
- coordinator gas overhead per word: 435

Source: `https://docs.chain.link/vrf/v2-5/supported-networks`

## ETH/USD fee oracle

The fork gate pins the Ethereum Chainlink ETH/USD proxy:

`0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`

It requires runtime code, `description() == "ETH / USD"`, 8 decimals, a positive completed round, a non-future timestamp, and an update age no greater than one day.

## Full-stack dry run

Inside the fork only, R13 deploys the exact production Collection, ProjectData, MintPhases, Renderer, FeePolicy, CanonicalRegistry, Reserve, Chainlink adapter, and Factory. It binds Registry and Reserve to the Factory, verifies both bootstrap authorities are burned, verifies `infrastructureReady()`, quotes both fee modes, creates a tiny minter-supported collection, verifies 45-byte EIP-1167 clones, and verifies creator/canonical registrations.

No state is written to Ethereum mainnet.

## Required gate output

R13 is successful only if all of these pass:

- exact baseline commit;
- clean tree except the four R13 files;
- `forge build --sizes`;
- R12 Final Security Gate;
- R12 Production Stack;
- R12 Ethereum adapter local suite;
- Phase 2D Chainlink adapter local suite;
- R13 Ethereum mainnet live fork;
- full `forge test`;
- `git diff --check`;
- no changes under `contracts/production`.

The runner captures current mainnet dependency code hashes. Those hashes become the comparison baseline for the final deployment-day preflight.

## Website language cleanup

The next phase rewrites the entire user-facing site to present Relic Forge as production software rather than a test environment. R13 first produces a non-destructive inventory of `test`, `testing`, `Sepolia`, `preproduction`, `candidate`, `sandbox`, `demo`, `beta`, `not deployed`, and `not mainnet` occurrences in tracked HTML/JS/CSS so the rewrite is complete rather than piecemeal.

## Activation

`productionEnabled` remains `false`.

Ethereum mainnet deployment remains blocked until the live R13 output is reviewed.
