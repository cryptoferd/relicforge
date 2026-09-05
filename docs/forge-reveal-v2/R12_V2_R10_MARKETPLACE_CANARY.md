# R12-v2 R10 Marketplace Canary R1

This is the external standards/marketplace gate that follows R10 Standards + Marketplace R3.

The canary is deliberately smaller than R9. R9 already certified the complete delayed-to-Forge
lifecycle. R10 Marketplace Canary focuses on ecosystem recognition:

- fresh R10 RelicCollectionV2 implementation,
- fresh R10 RelicMintPhasesV2 implementation,
- fresh Factory/Registry/Reserve/Chainlink adapter stack,
- real EIP-1167 collection / ProjectData / MintPhases clones,
- real code-backed art and DNA shards,
- two real ERC-721 mints,
- `totalSupply() == 2`,
- ERC-173 owner surface,
- canonical ERC-4906 non-indexed BatchMetadataUpdate on a real reveal,
- one real Chainlink VRF v2.5 native-funded request,
- explicit replay gas limit to avoid the R9 false-success low-gas path,
- Etherscan source verification and EIP-1167 ABI recognition,
- final tokenURI / SVG / royalty / interface certification.

The onchain runner does not claim the external marketplace gate is complete by itself. After the
runner finishes, the user must confirm:

1. Etherscan token overview reports Max Total Supply = 2.
2. OnChainChecker collection scanning succeeds without the `_fromTokenId` destructuring error.
3. Direct token display remains 5/5 Fully On-Chain.

Mainnet activation remains disabled.
