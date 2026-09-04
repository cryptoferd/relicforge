# Relic Forge V2 — Etherscan Proxy Verification Worker

This tool is intended to run automatically after a Factory V2 collection launch confirms.

It verifies the three per-project EIP-1167 clones:

1. Collection clone -> certified `RelicCollectionV2`
2. ProjectData clone -> certified `RelicProjectDataV1`
3. MintPhases clone -> certified `RelicMintPhasesV2`

The worker fails closed if the onchain 45-byte EIP-1167 runtime points to any implementation other
than the expected certified implementation.

It then uses Etherscan API V2 to:
- require that the shared implementation ABI is already published,
- submit proxy verification with `expectedimplementation`,
- poll proxy-verification status,
- read Etherscan's source/proxy record,
- require `Proxy == 1`,
- require Etherscan's resolved `Implementation` exactly matches the certified address,
- fetch the ABI at the launched proxy address,
- require the user-facing Read/Write method set.

The Etherscan API key is read ONLY from `ETHERSCAN_API_KEY`; it is never accepted as a CLI argument
or printed.

## Offline certification

```powershell
node tools/etherscan/relicforge-v2-proxy-verifier.mjs --self-test

node tools/etherscan/relicforge-v2-proxy-verifier.mjs `
  --check-repo-abis `
  --repo "C:\Windows\system32\relicforge"
```

## Post-launch Sepolia example

```powershell
$env:ETHERSCAN_API_KEY = "YOUR_PRIVATE_ETHERSCAN_KEY"

node tools/etherscan/relicforge-v2-proxy-verifier.mjs `
  --chain-id 11155111 `
  --rpc-url $env:SEPOLIA_RPC_URL `
  --collection "0xCOLLECTION_PROXY" `
  --collection-implementation "0xCERTIFIED_COLLECTION_IMPLEMENTATION" `
  --project-data "0xPROJECT_DATA_PROXY" `
  --data-implementation "0xCERTIFIED_DATA_IMPLEMENTATION" `
  --mint-phases "0xMINT_PHASES_PROXY" `
  --mint-phases-implementation "0xCERTIFIED_MINT_PHASES_IMPLEMENTATION"
```

## Launch behavior

Explorer verification is fail-visible, never chain-launch-blocking.

A successful Factory transaction remains a valid launch even if Etherscan is temporarily down.
The application/backend should persist a verification job and retry it. The launch UI should show
`Verification pending` until this worker succeeds.

Infrastructure implementations must be source-verified once per chain before project clones are
processed. The R12 Sepolia deployment package will perform that infrastructure source-verification
step and then use this worker on the real canary collection.


## Foundry ABI inspection

The offline ABI gate explicitly invokes:

```text
forge inspect --json <contract> abi
```

Current Foundry's default ABI output is intended for human display and may be a Unicode table.
JSON mode is required for machine parsing.


### Foundry flag compatibility

The certified local Foundry build rejects `--json` together with `--quiet`, so the worker uses
`forge inspect --json <contract> abi`. stderr is captured independently from stdout.
