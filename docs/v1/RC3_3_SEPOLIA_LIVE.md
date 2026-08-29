# RelicForge Contracts V1 — RC3.3 Ethereum Sepolia Live Integration

RC3.3 moves the green RC3.2 contracts from mocked provider testing to a real Chainlink VRF v2.5 direct-funded test on Ethereum Sepolia.

## Production Solidity

RC3.3 intentionally makes **no changes to the production contracts**. RC3.2 remains the production-contract baseline:

- 100/100 Foundry tests
- 20,000 fuzz cases
- 3 stateful invariants × 64,000 calls
- gas/DoS suite green
- Slither remediation baseline reviewed

RC3.3 adds deployment and live-chain integration tooling only.

## Chainlink Ethereum Sepolia configuration

Pinned for the RC3.3 live test:

- Chain ID: `11155111`
- VRF v2.5 wrapper: `0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1`
- VRF coordinator: `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`
- LINK token: `0x779877A7B0D9E8603169DdbD7836e478b4624789`
- Key hash recorded for audit evidence: `0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae`
- Callback gas: `500,000`
- Confirmations: `3`
- Immutable request-price ceiling: `0.01 Sepolia ETH`

The RelicForge adapter uses the Chainlink wrapper, so it does not directly consume the key hash or coordinator address. Those values are recorded and code-checked during deployment for audit evidence.

## Live test sequence

The local runner performs five phases:

1. Deploy the V1 collection/data implementations, renderer, direct-funded VRF adapter, and immutable factory.
2. Bind the adapter to the factory and verify the bootstrap authority is burned.
3. Create a disposable 2-token collection, upload/seal tiny onchain art/DNA, fund its isolated VRF credit, and creator-mint one Forge token.
4. Poll the existing Chainlink request until the adapter has a verified/delivered random word. It never re-requests or rerolls on timeout.
5. Check replay idempotency, process the reveal, recover unused randomness credit, and verify immutable wiring/read-only end state.

## Security behavior under timeout

If Chainlink fulfillment does not arrive within the runner's 15-minute observation window, the runner stops. It does **not** create a replacement request, redeploy, cancel, or reroll. The existing request must be investigated and allowed to resolve or be replayed from its stored word if delivery reached the adapter.

## Local secrets

Use a disposable Sepolia-only wallet.

Never commit `.env`. RC3.3 adds a repository `.gitignore` covering `.env`, Foundry broadcast data, and local build/cache outputs.

Required local variables:

```text
SEPOLIA_RPC_URL=...
DEPLOYER_PRIVATE_KEY=...
```

Optional:

```text
ETHERSCAN_API_KEY=...
```

The private key is used only by the local Foundry process and is never written into the generated deployment manifests or live report.

## Acceptance criteria

RC3.3 is accepted only after:

- normal GitHub CI remains green with the new scripts compiled;
- the real Sepolia deployment succeeds;
- real Chainlink VRF callback reaches `wordReady=true` and `delivered=true`;
- the same request cannot be rerolled and replay is idempotent;
- token reveal processes successfully;
- unused isolated VRF credit is recoverable;
- the generated verification script passes against live chain state;
- public deployment manifests/report are reviewed and committed as audit evidence.
