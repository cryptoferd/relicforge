# R12-v2 R8 — Main-Branch Sharding Compatibility + Etherscan Verification Certification

Baseline:
`31ab844423dc1a9d1d58c8cd0402d166e1679ded`
(`Build Relic Forge V2 production collection stack`)

Status:
- production contracts unchanged from R7
- productionEnabled: false
- activationAllowed: false
- no deployment transaction in R8

## Main-branch compatibility gate

R8 does not replace `RelicProjectDataV1` or `RelicRendererV1`.

The new focused integration test launches a real V2 collection through `RelicForgeFactoryV2`, then
uses the existing V1/Main-style pipeline:

- EIP-1167 `RelicProjectDataV1` clone
- two immutable code-backed art shards
- two immutable code-backed DNA shards
- two layers / four traits
- shard offsets and lengths
- `recipesPerShard = 2`
- recipe validation
- provenance hash
- permanent content seal
- placeholder shard
- exact shared `RelicRendererV1`

The test mints half of supply in Deferred mode, performs cheap delayed reveal, automatically switches
future mints to Forge Reveal, sells out through a Forge batch, replays exact provider words, settles,
and then renders every NFT through the real shared renderer.

For every final NFT it verifies:
- recipe is unique and in range,
- recipe DNA is read back through immutable DNA shards,
- background SVG fragment is read from the correct art shard,
- foreground SVG fragment is read from the correct art shard,
- `renderToken()` returns composed SVG,
- `tokenURI()` remains a full onchain data URI.

It also proves the three Factory-created clone runtimes are the exact canonical 45-byte EIP-1167
runtime and encode the intended Collection / ProjectData / MintPhases implementation addresses.

## Etherscan launch-verification gate

R8 adds `tools/etherscan/relicforge-v2-proxy-verifier.mjs`.

The worker is designed for automatic post-launch execution. It:

1. reads the launched clone runtime from RPC,
2. parses the canonical EIP-1167 implementation address,
3. fails if it differs from the certified implementation,
4. requires the implementation ABI to already be published on Etherscan,
5. submits Etherscan API V2 `verifyproxycontract` with `expectedimplementation`,
6. polls `checkproxyverification`,
7. fetches Etherscan's source/proxy record,
8. requires Etherscan's resolved implementation to match,
9. fetches the ABI at the proxy address,
10. requires the Read/Write method set creators and collectors need to see.

The worker covers:
- Collection clone
- ProjectData clone
- MintPhases clone

R8 certifies the worker offline. The first live Etherscan submission belongs to the real R12 Sepolia
deployment/canary package because R8 intentionally broadcasts no transactions.

## Mainnet gate remains closed

R8 does not authorize Ethereum mainnet. Before mainnet:
- real Sepolia infrastructure must be deployed,
- shared implementations must be source-verified,
- a real Factory V2 clone launch must pass Etherscan proxy linking and ABI visibility,
- real mint -> Chainlink -> replay -> settlement -> renderer lifecycle must pass,
- Reserve revenue-release scaling gate must be resolved/certified.


## R2 installer parser correction

R1 was rejected by PowerShell before execution because `$mainRef:` appeared inside a double-quoted
status string. R2 uses `${mainRef}:` so the installer parses correctly. Certification payload
behavior is otherwise unchanged.


## R3 Foundry ABI JSON-mode correction

R2 reached the compiled ABI visibility gate after all shard compatibility and R7 production-stack
tests had passed. Current Foundry renders `forge inspect <contract> abi` as a human-readable table
unless JSON output is explicitly requested.

R3 changes the offline verification worker to use `forge inspect --json <contract> abi`
and validates both supported JSON shapes before enforcing the required method set. No production
contract source changes are introduced.


## R4 Foundry flag compatibility

R3 reached the offline ABI visibility gate and the installed Foundry toolchain reported that
`--json` and `--quiet` cannot be used together. R4 keeps machine-readable JSON mode and removes
only `--quiet`. stderr remains separately captured by the Node worker, so ABI stdout is parsed
without mixing human-readable diagnostics into the JSON stream.

No production Solidity changes are introduced.
