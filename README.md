## V10.5.2 whitelist snapshot RPC fix

- ERC-721 holder snapshots now try a **current-state snapshot first** instead of reconstructing the entire transfer history.
- Current-state snapshots use Multicall3 + `totalSupply()` / `ownerOf()` (and ERC-721 Enumerable when available), so normal sequential/ERC721A collections do not require an archive RPC.
- Historical transfer-log reconstruction is now a fallback for unusual token-ID layouts and ERC-1155 collections.
- Added an optional **Advanced snapshot RPC** field for an archive-capable Alchemy/Infura/custom RPC.
- This is a front-end whitelist scanner change only; V10.5.1 test infrastructure/factory remains compatible and can be reused.

## V10.5.1 cross-network whitelist snapshot fix

- Whitelist snapshots now select their own source network independently of the Sepolia deployment wallet.
- Added Ethereum Mainnet and Ethereum Sepolia source options.
- Snapshot scanner uses a read-only source-chain RPC and stores source chain ID + exact snapshot block with the Merkle commitment.
- Improved wrong-network error messages so an Ethereum mainnet NFT is no longer reported as a non-NFT merely because Studio is connected to Sepolia.

## V10.5.0 whitelist / holder snapshot

- Added optional whitelist minting using an onchain Merkle root.
- Creators can snapshot current ERC-721 or ERC-1155 holders from a collection contract at a specific Sepolia block.
- Creators can paste or upload CSV/TXT/JSON custom allowlists.
- Custom lists support optional per-address mint allowances.
- Snapshot/custom lists are deduplicated and saved with the local wallet-scoped Studio project.
- Collection contract records the whitelist root, source collection, snapshot block, and source type.
- Added whitelistMint() test path while preserving public mint and unlimited creator mint behavior.
- Fixed duplicate "Use Forged Collection" viewer button.

## V10.4.0 batch mint + wallet limits + gas controls + one-action Forge Reveal test

### V10.4.0 changes

- Cost estimator now shows live Sepolia gwei and supports a creator-entered custom gwei value.
- Added collection-level max mints per wallet (0 = unlimited).
- Public mint supports a quantity in one transaction and enforces the wallet cap.
- Collection creator gets a creatorMint(quantity) path that bypasses price and wallet limits, bounded only by remaining supply and transaction gas.
- Forge Reveal now batches token assignment by mint transaction. The Sepolia mock auto-fulfills inside the mint transaction so testing requires one wallet transaction. Production must use an asynchronous verifiable-randomness callback; the minter still signs only the mint transaction.
- Large Forge Reveal batches are split into 25-token randomness chunks so a production VRF callback can stay within practical callback gas limits.
- V10.4 requires newly deployed shared test infrastructure because the implementation/factory ABI changed.

## V10.3.0 testnet marketplace viewer (previous)

### V10.3.0 changes

- Added a built-in Sepolia marketplace-style viewer inside Studio Step 5.
- Viewer can load a forged collection or any pasted Sepolia Relic Forge collection address.
- Viewer reads onchain `tokenURI()` / `contractURI()` data and renders token cards with owners, reveal state, and traits.

### Earlier changes

- Fixes Solidity `Stack too deep` compilation by enabling `viaIR` and refactoring trait registration into tuple batches.
- Stops blindly vectorizing PNGs. Each PNG trait is compared as original PNG, browser-recompressed lossless PNG, and pixel-SVG geometry; Relic Forge stores the smallest lossless representation.
- The onchain renderer can now compose raw PNG/JPEG/WEBP trait bytes inside the final SVG. Raster bytes remain fully onchain.
- Renames the compiler metric from `Compiled art` to `Onchain art` and calculates `Art savings` against source artwork only (DNA is shown separately).
- Keeps the V10.2 wallet-scoped IndexedDB project-saving workflow.


- Keeps the V10.2.1 fix that renamed the Solidity state variable `sealed` to `isSealed`.
- Replaces the Unicode em dash in the unrevealed token-name Solidity string with ASCII (`#123 - Forging`) so Solidity 0.8.30 parses the source normally.
- Makes the Solidity test source ASCII-only.
- No Studio workflow or collection-format changes.

# Relic Forge v10.2 — Wallet Projects + Sepolia Forge Test

This build is based directly on **Relic Forge v9** and keeps the same flat, static GitHub/Vercel structure. It adds the first integrated onchain compilation + Ethereum Sepolia deployment flow to Studio Step 5.

## Drag/drop update for an existing GitHub repo

1. Unzip this package.
2. Open the `relic-forge-test-v10.5.1` folder.
3. Drag **all files and folders inside it** into the root of the existing Relic Forge GitHub repository.
4. Allow GitHub to replace the existing `index.html`, `studio.html`, `styles.css`, `app.js`, `README.md`, and `vercel.json` files.
5. Keep the new `forge.js`, `project-storage.js`, `contracts/`, and `js/` paths.
6. Commit the changes.

There is no npm install and no build step. GitHub Pages and Vercel can continue serving the repo as static files.

## What changed from v9

- Preserves the V9 artwork/build/rules/preview compiler.
- Replaces the Step 5 deployment placeholder with a real **Ethereum Sepolia** Forge test workflow.
- Reuses V9's exact PNG → compact SVG path conversion for onchain artwork compilation.
- Packs compiled artwork into ~22 KB immutable data shards.
- Packs the exact Step 4 token recipes into compact one-byte-per-layer DNA shards for this V1 test format.
- Deduplicates byte-identical compiled trait artwork.
- Creates a collection provenance hash from the compiled collection.
- Adds live project-size / shard / rough gas estimation.
- Adds two reveal modes only:
  - **Forge Reveal** — per-mint assignment after test randomness fulfillment.
  - **Creator Reveal** — creator-uploaded placeholder until collection-wide reveal is requested/fulfilled.
- Adds wallet connection and forces the test deployment flow to Ethereum Sepolia.
- Adds shared test infrastructure deployment:
  - `RelicCollectionV1` implementation
  - `RelicRandomnessMock` (**TEST ONLY**)
  - `RelicForgeFactory`
- Each creator collection is an EIP-1167 clone with its own ERC-721 address and creator ownership.
- Onchain `tokenURI()` returns base64 JSON containing base64 SVG.
- `contractURI()` and ERC-2981 royalty reporting are included in the test contract.
- Includes mint/reveal/tokenURI inspection controls after deployment.

## Important testnet warning

`RelicRandomnessMock` is deliberately insecure and exists only to exercise the reveal state machine on Sepolia. It uses public block data during manual fulfillment and **must not be used for production/mainnet launches**. Production Forge Reveal should be connected to a proper verifiable randomness design.

The contracts in `contracts/RelicForgeTest.sol` are also **not audited** and are test-only.

## First Sepolia test

1. Run/open Studio.
2. Upload a small PNG layer collection.
3. Build it in Steps 1–4 until the Studio compiler reports valid.
4. Open Step 5.
5. Choose **Forge Reveal** or **Creator Reveal**.
6. For Creator Reveal, upload a placeholder with the same canvas dimensions as the trait artwork.
7. Click **Compile for Onchain**.
8. Review compiled bytes, shard counts, largest traits, provenance, and estimated gas.
9. Connect Rabby/MetaMask/another injected EVM wallet.
10. Click **Compile Contracts**.
11. Click **Deploy Test Infrastructure** the first time only. The addresses are saved in that browser's local storage.
12. Click **Forge Collection on Sepolia**.
13. Use the post-deploy controls to mint, fulfill test randomness, reveal, and inspect `tokenURI()`.

## Local test

The Solidity source is fetched by the page and the Solidity compiler runs in a Web Worker, so use an HTTP server instead of opening `studio.html` directly from `file://`.

```bash
python -m http.server 8080
```

Then open:

- `http://localhost:8080/`
- `http://localhost:8080/studio.html`

## External browser dependencies used only by Step 5

- ethers.js 6.13.7 from cdnjs
- official Solidity 0.8.30 `soljson` loaded by `js/solc-worker.js`

The core Steps 1–4 remain local-first and do not upload artwork to a Relic Forge backend.

## Wallet-scoped project saves

Studio can now save the full editable project in browser IndexedDB under the connected EVM wallet address. The save includes artwork File/Blob data, layer and trait settings, rules, curated/imported token recipes, compiled collection state, and launch/reveal settings (including a Creator Reveal placeholder).

- `Save Project` updates the currently opened wallet project.
- `My Projects` lists only saves belonging to the connected wallet in this browser.
- `Save As New` creates a separate copy under the same wallet.
- These saves are local to the current browser/device; they are not cloud-synced or encrypted.
- `Export Project` remains a settings export; keep the original artwork folder for portable recovery.



## Earlier hotfixes
- Cache-busts Studio JS/CSS assets so static hosting does not mix an older `app.js` with the new project-saving module.
- Publishes the Studio project bridge before optional UI event bindings.
- Improves the project-save error message if the Studio core does not load.
