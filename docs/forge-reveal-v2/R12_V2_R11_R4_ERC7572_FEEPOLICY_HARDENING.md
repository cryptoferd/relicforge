# Relic Forge R12-v2 R11 R4 - ERC-7572 + FeePolicy Hardening R3

R3 supersedes the previously prepared FeePolicy R2 package. Do not run the old R2 first.

This revision closes two R4 findings together:

1. ERC-7572 discoverability
   - `contractURI()` already existed.
   - `supportsInterface(0xe8a3d485)` incorrectly returned false.
   - CollectionV2 now reports ERC-7572 through ERC-165.
   - The support test is rewritten as an exact seven-ID membership expression to conserve bytecode.

2. FeePolicy control rotation
   - treasury and platform-admin changes become two-step.
   - destination/new-admin acceptance is required.
   - old-admin pending treasury proposals are cleared on accepted admin handoff.

The compact supportsInterface expression is exact:
- each XOR factor is a 32-bit value;
- seven factors produce a value below 2^224;
- therefore no uint256 overflow can occur;
- product == 0 iff one factor == 0;
- therefore it returns true iff the queried interface ID is exactly one of the seven certified IDs.

R3 permanently upgrades the R10 standards regression to include:
`supportsInterface(0xe8a3d485) == true`.

R3 also adds a dedicated EIP-1167 clone test reproducing the exact query reported by external review.

Mainnet remains disabled. A fresh Sepolia canary is required after local certification because
existing EIP-1167 clones permanently point to the older implementation.
