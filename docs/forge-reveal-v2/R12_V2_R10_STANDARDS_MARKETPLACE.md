# Relic Forge V2 R10 — Standards + Marketplace Compatibility

R10 is the post-R9 marketplace-compatibility hardening gate.

## R9 external-indexer findings

The R9 Sepolia collection completed the real delayed-reveal → Forge lifecycle and its individual
token page scored **5/5 Fully On-Chain** in OnChainChecker.

Two independent explorer/indexer issues were then observed:

1. **OnChainChecker collection scan failed on `_fromTokenId`.**
   `RelicCollectionV2` advertised ERC-4906 but declared `MetadataUpdate` and
   `BatchMetadataUpdate` with indexed token arguments and non-canonical argument names.
   ERC-4906 specifies non-indexed token/range arguments.

2. **Etherscan could not populate Max Total Supply.**
   The collection exposed `totalMinted()` and `maxSupply()` but no conventional `totalSupply()`.

R10 fixes the contract rather than adding explorer-specific offchain workarounds.

## Standards surface after R10

| Surface | R10 policy |
| --- | --- |
| ERC-165 | Required / advertised |
| ERC-721 Core | Required / advertised |
| ERC-721 Metadata | Required / advertised |
| ERC-721 `getApproved()` invalid token semantics | Enforced |
| `totalSupply()` | Added for explorer/indexer compatibility |
| Full ERC-721 Enumerable | **Not claimed** |
| ERC-2981 | Required / advertised |
| ERC-4906 | Canonical events + interface |
| ERC-173 | Added and advertised |
| ERC-5313 ownership getter | Satisfied by ERC-173 `owner()` |
| ERC-7572 `contractURI()` | Preserved |
| EIP-1167 clone linkage | Preserved |

## ERC-4906

R10 uses the canonical declarations:

```solidity
event MetadataUpdate(uint256 _tokenId);
event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
```

The certification test records real EVM logs and requires:

- `MetadataUpdate`: one topic (event signature), 32 bytes of data.
- `BatchMetadataUpdate`: one topic (event signature), 64 bytes of data.

This catches both indexed-layout drift and bad argument encoding.

## Supply

R10 adds:

```solidity
function totalSupply() external view returns (uint256) {
    return totalMinted;
}
```

This is the number of ERC-721 tokens that actually exist. It is intentionally distinct from
`maxSupply`, and R10 does not claim the full ERC-721 Enumerable interface because it does not
implement `tokenByIndex()` / `tokenOfOwnerByIndex()`.

## Ownership

OpenSea uses ERC-173 for contract creator/owner attribution. R10 maps Relic Forge ownership to the
active `controller` while retaining `creator` as immutable launch provenance:

- `creator()` = original collection creator.
- `owner()` = current ERC-173 administrative owner/controller.
- `transferOwnership(newOwner)` transfers Collection control and MintPhases control atomically.
- renouncing ownership also renounces MintPhases control.

## ERC-721 approval semantics

The old public mapping getter returned zero for nonexistent tokens. ERC-721 requires
`getApproved(tokenId)` to throw for an invalid NFT. R10 keeps the same storage slot as a private
mapping and exposes a validating `getApproved()` function.

## Read-method count

Relic Forge collections expose more read methods than a minimal ERC-721 because reveal state,
sharding references, fee state, Forge batches, Reserve accounting and provenance-related state are
publicly inspectable.

Extra read methods do not invalidate ERC compliance. R10 includes an ABI auditor that prints the
actual read/write method counts while separately enforcing the standardized surface.

R10 does not remove transparency getters merely to make the Etherscan Read tab look smaller.

## Deployment policy

R10 does not repair the already-deployed R9 canary in place; that EIP-1167 clone permanently points
to the old implementation.

After R10 passes and is checkpointed, a **fresh Sepolia marketplace canary** is required. Mainnet
activation remains closed until the new collection:

- shows a nonzero `totalSupply()` on Etherscan,
- is recognized as ERC-721 / ERC-2981,
- exposes the proxy ABI,
- loads as a collection in OnChainChecker without the ERC-4906 scan error,
- and still scores 5/5 Fully On-Chain at the token level.
