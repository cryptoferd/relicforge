# R9 Sepolia Recovery R5 - EIP-1167 Explorer Handling

The R4 live recovery successfully persisted the real delayed-reveal Chainlink request.

It then stopped because the R8 Etherscan worker called `verifyproxycontract`. That endpoint asks
Etherscan to detect an implementation and optionally checks that the detected address equals
`expectedimplementation`.

For canonical EIP-1167 clones, the immutable implementation is already encoded directly into the
45-byte runtime. The standard was specifically designed so explorer tooling can discover the
implementation from those bytes.

R5 therefore separates two guarantees:

1. **Onchain linkage -- strict and blocking**
   - clone runtime must be exactly canonical 45-byte EIP-1167,
   - implementation extracted from runtime must exactly equal the certified implementation,
   - certified implementation must have runtime code,
   - certified implementation ABI must already be published on Etherscan.

2. **Explorer presentation -- fail-visible and non-blocking**
   - Etherscan is polled for automatic clone ABI recognition,
   - if Etherscan has caught up, required user-facing ABI methods are enforced,
   - if explorer indexing is still pending, status is printed as PENDING,
   - the onchain mint/Chainlink/reveal canary continues.

This matches the locked Relic Forge product requirement that explorer outages/indexing must never
invalidate or block an otherwise successful Factory launch.

The Etherscan Free-tier pace remains 1100 ms minimum between API requests.
