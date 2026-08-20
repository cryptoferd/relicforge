# Relic Forge v10 — Sepolia Forge Test

This build is based directly on **Relic Forge v9** and keeps the same flat, static GitHub/Vercel structure. It adds the first integrated onchain compilation + Ethereum Sepolia deployment flow to Studio Step 5.

## Drag/drop update for an existing GitHub repo

1. Unzip this package.
2. Open the `relic-forge-test-v10` folder.
3. Drag **all files and folders inside it** into the root of the existing Relic Forge GitHub repository.
4. Allow GitHub to replace the existing `index.html`, `studio.html`, `styles.css`, `app.js`, `README.md`, and `vercel.json` files.
5. Keep the new `forge.js`, `contracts/`, and `js/` paths.
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
