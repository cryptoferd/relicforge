## V10.8.3 curated-token rarity regression test

1. Create a percentage layer with an obvious distribution (for example 2% trait / 98% None).
2. Switch to **Build it myself** and curate several token IDs, including at least one token using the rare trait.
3. Leave some layers on Generate automatically.
4. Build Collection.
5. Confirm the Step 4 Rarity Audit reports exact Target = Actual totals.
6. Confirm curated assignments are included in those totals rather than added on top.
7. Confirm a curated count above a trait's allowed target produces a compiler error instead of silently changing the rarity.
8. Forge a fresh collection using the existing shared test infrastructure and confirm minted tokens are drawn from the audited recipe pool.

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

## Whitelist / holder snapshot (V10.5)

- Enable **Whitelist mint** in Step 5.
- Snapshot test:
  - enter an ERC-721 or ERC-1155 Sepolia collection address;
  - click **Snapshot Current Holders**;
  - confirm Studio reports a fixed snapshot block, eligible wallet count, and Merkle root.
- Custom test:
  - paste addresses or upload `.csv`, `.txt`, or `.json`;
  - optional format: `address,allowance`;
  - confirm duplicates are removed and the highest allowance for a duplicate address wins.
- Forge a fresh collection with V10.5 infrastructure.
- Confirm the collection exposes `whitelistRoot`, `whitelistSourceContract`, `whitelistSnapshotBlock`, and `whitelistSourceType`.
- With an eligible connected wallet, use **Whitelist Mint** and verify the Merkle proof succeeds.
- Attempt to exceed the wallet's whitelist allowance and confirm the transaction is rejected.
- Confirm creator mint still bypasses mint price and public wallet limit.


## V10.5.2 whitelist snapshot

- [ ] Snapshot an Ethereum Mainnet ERC-721 while the deployment wallet remains on Sepolia.
- [ ] Confirm current-state ownership scan completes without PublicNode archive access for a sequential/ERC721A collection.
- [ ] Confirm the displayed snapshot block and holder count are populated.
- [ ] Optional: paste an archive-capable RPC in Advanced snapshot RPC and verify historical fallback can be used.


## V10.6.0 public mint page

- Upload a collection image and banner in Step 5 and confirm the Studio preview updates.
- Forge a collection (existing V10.5-compatible test infrastructure may be reused).
- Open Mint Page and confirm the page reads name, description, supply, price, wallet cap and reveal mode from Sepolia.
- Connect a non-owner wallet and public mint multiple NFTs. Confirm no creator-mint UI exists.
- For a whitelist project, open/download the mint page with the whitelist embedded, connect an eligible wallet, and confirm Whitelist Mint succeeds with a locally derived Merkle proof.
- Download Standalone Page, host/open it over HTTP(S), and confirm collection image/banner and mint controls work.


## V10.8.0 creator dashboard

- Launch at least one collection through the current Factory.
- Reload Studio and click **Launched Projects**.
- Confirm the connected creator wallet rediscovers the collection through the Factory.
- Confirm supply, mint price, reveal mode, wallet limit, whitelist state, royalties, provenance, and sealed state match the contract.
- Use **Creator Mint** from the dashboard and confirm no creator-mint control appears on `mint.html`.
- Change an unsealed mint setting and confirm the updated value reads back onchain.
- Open the public mint page and testnet viewer from the dashboard.
- Test manual recovery by pasting an owned collection address.
- Do not test **Seal Collection Permanently** on a collection you still need to modify unless you explicitly intend to lock it.

## V10.8.0 mint page checks

- Open **Launched Projects** and select a deployed collection.
- Replace the collection image and banner under **Public Mint Page** and click **Save Mint Page**.
- Open the public mint page and verify the new media renders.
- Set Max per Wallet to 3, connect a fresh minter wallet, and verify the public quantity input cannot exceed 3.
- Mint 2, refresh, and verify the public quantity input cannot exceed 1.
- For a whitelist allowance of 5 with a global max of 3, verify the whitelist quantity never exceeds the smaller global remaining allowance.
- Connect the creator wallet to the public mint page and verify public mint is still capped; use **Creator Mint** in Studio to bypass the cap.


## V10.8.1 mint page activity (UI-only)

- [ ] Open an already deployed compatible collection mint page; do not redeploy infrastructure just for V10.8.1.
- [ ] Connect a wallet with a finite wallet cap and confirm the mint input cannot remain above the remaining allowance.
- [ ] Confirm the page shows `X / Y` wallet mints and remaining allotment.
- [ ] Confirm minted NFTs appear as thumbnails, 10 per page.
- [ ] Search for a specific minted token number and clear the search.
- [ ] Confirm each token card shows its current owner in truncated form.
- [ ] Confirm Current Holders lists truncated addresses and current NFT balances.
- [ ] Transfer a test NFT, refresh holders, and confirm balances update.


## V10.8.2 My NFTs (UI-only)

- [ ] Open an existing compatible collection mint page; no infrastructure redeploy is required.
- [ ] Connect a wallet that owns no NFTs and confirm **My NFTs** reports none owned.
- [ ] Mint one or more NFTs and confirm they appear in **My NFTs** after confirmation.
- [ ] Confirm owned cards use live onchain tokenURI artwork/reveal state.
- [ ] If the wallet owns more than 10, confirm pagination works.
- [ ] Transfer an NFT away, refresh ownership, and confirm it disappears from **My NFTs**.
- [ ] Transfer an NFT into the connected wallet, refresh, and confirm it appears.
- [ ] Confirm the downloaded standalone mint page contains the same **My NFTs** UI.
