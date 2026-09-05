# Relic Forge R12-v2 R11 R4 - Fresh Sepolia Canary R1

Purpose: close the externally reported ERC-7572 discovery finding on a fresh immutable EIP-1167
collection and re-prove the real Chainlink delayed-reveal path after the R4 hardening changes.

This package intentionally deploys a fresh Sepolia stack because the previous canary's EIP-1167
runtime permanently points to the older Collection implementation.

Fresh-chain gates:
- deploy the current locally certified RelicCollectionV2 implementation;
- deploy fresh ProjectData, MintPhases, Renderer, Registry, Reserve, Chainlink adapter, FeePolicy, Factory;
- prove the implementation reports supportsInterface(0xe8a3d485) == true;
- launch a fresh EIP-1167 collection clone and prove the same exact query returns true through delegatecall;
- prove ERC721Enumerable remains unclaimed;
- seal real sharded art + DNA;
- mint two hidden NFTs;
- request a real Chainlink VRF v2.5 delayed reveal with explicit 1,500,000 transaction gas;
- recover local/upstream request IDs from actual onchain state, not simulation JSON;
- wait for the storage-only callback;
- replay the exact word with explicit 1,000,000 transaction gas;
- require deliveredForLocalRequest == true after the replay transaction;
- prove both tokens reveal, recipes are unique, tokenURI/renderToken work, contractURI works;
- prove FeePolicy and Reserve admin/treasury pending state is clean;
- best-effort source verification and EIP-1167 proxy recognition on Etherscan.

Explorer verification is non-blocking. Onchain runtime/linkage and final state are authoritative.

This is Sepolia only. Mainnet remains disabled.
