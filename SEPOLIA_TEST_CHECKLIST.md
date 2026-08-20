# Relic Forge v10 — Sepolia Test Checklist

## Studio regression
- [ ] Landing page opens.
- [ ] Open Studio navigation works.
- [ ] Artwork folder drag/drop still works.
- [ ] Layer ordering/renaming still works.
- [ ] Rarity / percentage / exact count modes still work.
- [ ] Rules still compile.
- [ ] Manual token recipes still work.
- [ ] CSV/JSON manifest imports still work.
- [ ] Step 4 preview and manifest/CSV exports still work.

## Onchain compiler
- [ ] Step 5 refuses to compile if Step 4 is invalid.
- [ ] Source art byte count appears.
- [ ] Compiled artwork byte count appears.
- [ ] DNA byte count appears.
- [ ] Art/DNA shard counts appear.
- [ ] Duplicate compiled artwork is deduplicated.
- [ ] >16 KB traits show warning.
- [ ] >22 KB compiled trait fails in this V1 test build.
- [ ] Provenance hash appears.
- [ ] Changing collection name/symbol/description/reveal invalidates the onchain compile.

## Reveal modes
- [ ] Forge Reveal uses generated Relic Forge placeholder.
- [ ] Creator Reveal requires uploaded placeholder.
- [ ] Creator Reveal placeholder dimensions must match collection canvas.

## Wallet / infrastructure
- [ ] Connect wallet switches to Sepolia.
- [ ] Solidity compiler completes without errors.
- [ ] RelicCollectionV1 runtime is below 24,576 bytes.
- [ ] Implementation deploys.
- [ ] Randomness mock deploys.
- [ ] Factory deploys.
- [ ] Saved factory/randomness addresses restore after reload.

## Collection Forge
- [ ] Factory creates clone.
- [ ] Clone owner is creator wallet.
- [ ] All art shards deploy.
- [ ] Layer names register.
- [ ] Trait batches register.
- [ ] DNA shards deploy.
- [ ] Placeholder deploys.
- [ ] Provenance finalizes.
- [ ] Collection appears on Sepolia Etherscan.

## Forge Reveal test
- [ ] Mint creates token.
- [ ] Before fulfillment tokenURI shows forging placeholder.
- [ ] ForgeRequested request ID is captured.
- [ ] Test randomness fulfillment succeeds.
- [ ] tokenURI then returns final SVG + attributes.
- [ ] Two fulfilled tokens cannot receive the same recipe.

## Creator Reveal test
- [ ] Mint shows creator placeholder before reveal.
- [ ] Creator can request reveal.
- [ ] Test randomness fulfillment sets collection reveal seed.
- [ ] Existing minted token metadata reveals.
- [ ] Token recipe permutation is collision-free.

## Metadata / marketplace compatibility
- [ ] tokenURI is `data:application/json;base64,...`.
- [ ] image is `data:image/svg+xml;base64,...`.
- [ ] attributes use `trait_type` + `value`.
- [ ] contractURI returns onchain collection JSON.
- [ ] royaltyInfo reports configured receiver/bps.
