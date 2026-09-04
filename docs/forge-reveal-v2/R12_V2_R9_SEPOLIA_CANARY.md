# R12-v2 R9 — Real Ethereum Sepolia Deployment + Canary

Baseline commit:
`330d1da53a184dffb7ce89fedc2ebb7bd4d48094`  
`Certify V2 sharding compatibility and Etherscan proxy verification`

## What R9 does

R9 is the first package that is capable of broadcasting the production-shaped V2 stack to
**Ethereum Sepolia**.

The install/certification script does **not** broadcast.

After that passes, the separate `Run-R9-Sepolia-Canary-R1.ps1 -Broadcast` command:

1. deploys the shared V2 infrastructure,
2. binds the canonical registry and Forge Reserve to the Factory,
3. source-verifies the shared contracts on Etherscan,
4. launches a real 4-NFT collection through `RelicForgeFactoryV2`,
5. writes/seals real code-backed art and DNA shards,
6. mints two hidden NFTs,
7. requests a real delayed-reveal Chainlink VRF v2.5 word,
8. proxy-verifies Collection / ProjectData / MintPhases on Etherscan,
9. waits for the exact verified word,
10. replays it and proves the automatic Deferred -> Forge transition,
11. mints/reserves the final two NFTs,
12. requests a second real Chainlink word for Forge Reveal,
13. replays that exact word and settles the batch,
14. proves all four recipes are unique,
15. reconstructs SVG + tokenURI through the real renderer,
16. runs a final read-only onchain certification.

## Etherscan Free tier

The user's selected Etherscan plan permits **3 API calls/second**.

R9 deliberately stays substantially below that:

- proxy verifier default minimum API interval: **1100 ms** (~0.9 calls/sec),
- automatic retries for HTTP 429 and 5xx,
- infrastructure source verification is strictly sequential,
- at least 2.2 seconds are inserted between completed source-verification jobs,
- verification failure never changes the validity of an already-mined Factory launch.

The Etherscan key is read from `ETHERSCAN_API_KEY` only.

## Secrets

R9 reads:

- `SEPOLIA_RPC_URL`
- `ETHERSCAN_API_KEY`
- `DEPLOYER_PRIVATE_KEY`

from the current process environment. If one is missing, the PowerShell scripts can load it from
`<repo>\.env`.

The scripts never intentionally print the values.

## Sepolia Reserve seed

The R9 canary seeds the V2 Forge Reserve with **0.01 Sepolia ETH** so the two real VRF requests can
exercise the exact-shortfall path. This is testnet-only canary capital, not a mainnet policy.

## Mainnet

`productionEnabled = false`  
`activationAllowed = false`

R9 does not authorize Ethereum mainnet deployment. The existing scale gate around Reserve revenue
release remains open after the Sepolia canary.


## R2 Windows PowerShell 5.1 parser correction

R1 was rejected before execution. The installer contained a non-ASCII em dash while the file was
UTF-8 without a BOM. Windows PowerShell 5.1 can interpret such a file using the local ANSI code
page, corrupting parsing. R2 makes every `.ps1` in the package ASCII-only.
