## V11.1.4

- Cloud wallet authentication is now single-flight: concurrent Studio/Forge/dashboard auth requests share one challenge and one wallet signature instead of racing multiple nonces.
- Disconnecting or changing wallets invalidates an in-progress auth result so a stale signature cannot silently restore the old session.

# Relic Forge V11.1.4

## V11.1.4 — wallet switching + save sign-in gate

- Connected Studio wallets now expose **Connect Different Wallet** and **Disconnect Wallet** actions. Disconnect clears the Relic Forge Cloud session and makes a best-effort provider permission revoke when the injected wallet supports it.
- **Connect Different Wallet** requests a fresh wallet/account chooser when supported, then requires a new Relic Forge Cloud signature for the newly selected wallet.
- Creator Dashboard has matching **Change Wallet** and **Disconnect** controls.
- Studio shows a persistent save gate whenever no wallet is connected, and a separate sign-in-required state when an account is connected but has not signed the Cloud login message.
- **Save Project** now requires wallet sign-in before a production Cloud save. A temporary IndexedDB cache is not presented as a successful save if the global Cloud write fails.
- The login signature is message-only: no transaction and no gas fee.

## V11.1.4 — readable per-trait rarity tiers

- Rarity-tier trait controls now use the full available control width instead of reserving a second empty grid column.
- Selected values such as Common, Uncommon, Rare, Very Rare, and Legendary remain visible inside each trait card.
- The control stays compact and responsive on mobile.

## V11.1.4 — View Image data-URI compatibility fix

- `View Image` no longer navigates the top frame directly to `data:image/...` URIs (blocked by modern Chromium browsers).
- Onchain data images are converted client-side to temporary `blob:` URLs before opening.
- Preserves the original MIME type and animation for SVG, GIF, PNG, JPEG, WebP, AVIF, and other browser-displayable image types.
- `ipfs://` and `ar://` image links are normalized to browser-viewable HTTP gateways.
- The same token-card action handler now works in both the minted collection gallery and the connected holder's NFT gallery.

## V11.1.4 — Studio UX + standalone Creator Dashboard

- Studio project actions collapse into a compact hamburger menu on mobile instead of stacking vertically above the workspace.
- Studio now tracks unsaved edits, shows the most recent save timestamp, and triggers the browser's leave-page warning while unsaved work exists.
- Creator Dashboard is now a dedicated `dashboard.html` page rather than a Studio popup.
- Relic Forge brand typography/header treatment is unified across landing, Studio, dashboard, and mint experiences.
- Rarity layer titles are larger with trait counts on their own line; rarity controls now live in a dedicated toolbar below the layer title next to the live total.
- Holder buttons are smaller/equal width and renamed **Render Offchain** / **View Image**. **View Image** uses the collection renderer rather than assuming PNG.
- Offchain rendering is adaptive without changing the V11 Solidity ABI: static renders can be cached as PNG, while GIF/SVG animation-sensitive tokens are cached and served as SVG with the correct HTTP content type. The legacy `.png` URL suffix remains because existing V11 contracts append it onchain.


## V11.1.4 — layer delineation

- Rarity/layer configuration now uses stronger rounded outlines, darker header bands, explicit interior dividers, and larger gutters between layers.
- Trait cells use a denser bordered grid that visually belongs to its parent layer, matching the supplied Studio reference while preserving all existing controls and behavior.
- Responsive wrapping keeps the same grouping on narrower screens.


## V11.1.4 — public gas oracle + full collection preview

- Studio deployment-cost GWEI now comes from direct public Sepolia RPCs (`eth_gasPrice`) with the connected wallet RPC as a fallback. The RelicForge Railway/Alchemy relay is not used for gas-price discovery.
- Step 4 now previews the entire compiled collection instead of 12 samples. The grid uses smaller cards and renders 24, 48, or 96 tokens per page with Previous/Next pagination.
- Pagination renders only the visible page so large collections and animated GIF traits do not overload the browser.


## Global Projects + portable backups
- Projects sync privately by connected wallet through Railway/Postgres + Railway Bucket storage.
- Hard limit: 10 active cloud projects per wallet (server-enforced).
- Deleting a cloud project removes unreferenced project artwork from the Bucket to free space.
- Project backups use a self-contained `.relicforge` JSON package containing the complete editable Studio + Forge state and embedded artwork binaries.
- Backups can be imported later and saved as a new cloud project.
- Mint-page collection image and banner: 2 MB maximum each; any image MIME type is accepted, including animated GIF.

# Relic Forge Studio V11.1.4 — Cloud + Alchemy + Render Modes


## Animated GIF artwork (V11.1.4)

Studio accepts animated GIFs as normal layered traits, standalone 1/1 artwork, Creator Reveal placeholders, and custom mint-page images/banners. GIF animation is preserved by embedding the original GIF bytes as a `data:image/gif;base64,...` image inside the canonical onchain SVG. This deliberately uses the existing SVG-fragment encoding (`0`), so GIF projects remain compatible with already-deployed V11 factory/implementation contracts and do **not** require a factory redeployment. The existing 22 KB per-trait onchain shard limit applies to the compiled SVG fragment; base64 overhead means the practical source-GIF limit is somewhat below 22 KB. Offchain Render is adaptive: animation-sensitive GIF/SVG output is cached as SVG so animation survives, while static output may be rasterized and cached as PNG.

## V11.1.4 mint RPC policy

Public mint pages now use direct public JSON-RPC endpoints first for normal collection reads and use a public-only RPC pool for holder `eth_getLogs` scans. Railway remains responsible for global mint-page configuration, whitelist proofs, assets, and other Cloud persistence. The Railway/Alchemy RPC relay is preserved as a fallback for ordinary mint reads and remains the Studio/backend architecture.

The switch is controlled by `window.RELICFORGE_CONFIG.mintRpcMode`:

- `public-first` (default): public RPC first, Railway/Alchemy fallback for ordinary reads.
- `alchemy-first`: Railway/Alchemy first, public RPC fallback. Use this after moving to an Alchemy plan that supports the desired request ranges.
- `public-only`: never use the Railway/Alchemy RPC relay from the mint page.

Holder-history scans intentionally stay on the direct public RPC pool in this release because they can require large `eth_getLogs` ranges that exceed Alchemy Free-tier limits.

V11 is the first cloud-backed RelicForge build. It keeps the existing static Studio/mint frontend, adds a Railway API under `/server`, moves cross-device project/mint-page persistence to PostgreSQL + Railway Bucket storage, and routes production blockchain reads through a server-side Alchemy connection.

> **Test status:** the included Solidity file is still the Sepolia test contract suite and the included randomness provider is a mock. Do not use this build for a mainnet collection until the production verifiable-randomness implementation is added, the contracts compile cleanly, runtime sizes are checked, and the final contracts are audited.

## What changed in V11

### Cloud project saving
- Wallet challenge/signature login; no username/password and no gas transaction.
- IndexedDB remains the fast local cache.
- **Save Project** requires wallet sign-in and treats the Cloud write as the authoritative save; IndexedDB remains a fast local cache.
- Trait artwork, 1/1 artwork, mint-page media, rules, rarity settings, recipes, reveal settings, and creator settings are restored on another computer after signing in with the same wallet.
- Project snapshots are versioned in PostgreSQL so project-history UI can be added later.

### Railway backend
`/server` contains a Node 20 / Fastify service with:
- PostgreSQL project, collection, whitelist, and render-cache records.
- S3-compatible Railway Bucket uploads using presigned PUT URLs.
- Private project assets and public-only mint/render asset routes.
- Cloud mint-page publishing.
- Per-wallet whitelist proof lookup instead of distributing the whole whitelist.
- Alchemy-backed collection state and wallet allowance endpoints.
- A restricted read-only JSON-RPC relay used by the current Studio/viewer/gallery code.
- An adaptive offchain renderer backed by the canonical onchain `renderToken(tokenId)` output.

### Alchemy — one private key
The Alchemy key stays **only on Railway**. V11.1.4 requires a single `ALCHEMY_API_KEY`; endpoint bases are non-secret application configuration in `server/src/lib/alchemy-networks.js`. Do not put the key in `relicforge-config.js`, GitHub Pages, Vercel client variables, or a standalone mint page.

The server now includes a broad Alchemy EVM endpoint catalog covering Ethereum, Base, Arbitrum, OP, Polygon, Robinhood Chain, ZKsync, World Chain, Shape, Mantle, Berachain, Blast, Linea, Zora, Ronin, Rootstock, HyperEVM, Lens, Frax, Ink, Avalanche, Gnosis, BNB Smart Chain, Unichain, Superseed, Monad, Flow EVM, Mode, Moonbeam, ApeChain, Celo, Metis, Sonic, Sei, Scroll, opBNB, CrossFi, Abstract, Soneium and additional Alchemy EVM endpoints.

- `GET /api/public/networks` exposes the non-secret catalog.
- `POST /api/public/rpc/:chainId` chooses the proper Alchemy hostname and appends the private key server-side.
- Studio loads resolved catalog networks into the whitelist snapshot network selector automatically.
- Mint-page Cloud reads are no longer hardcoded to Ethereum Mainnet/Sepolia.
- `RPC_<chainId>_URL`, `RPC_OVERRIDES_JSON`, and `ALCHEMY_NETWORK_OVERRIDES_JSON` remain available for provider/new-chain overrides.

RelicForge **deployment support remains deliberately separate from RPC support**. V11 test forging is still Sepolia-only until a Factory, implementation, randomness router, explorer and deployment flow are validated for each production chain.

### Public mint pages are cross-device
Creator mint-page aesthetics are no longer dependent on the creator browser's `localStorage` when Cloud is configured. **Publish Mint Page** stores the public presentation config in PostgreSQL and the image/banner in the Railway Bucket.

A fresh visitor can load the collection URL, receive the published config, read current collection state through the Alchemy-backed API, connect a wallet, and mint without ever having opened RelicForge before.

### Holder-controlled render modes
`RelicCollectionV2` adds two token presentation modes:

- `0` — **Fully Onchain SVG** (canonical/default recommended mode)
- `1` — **Offchain Render** served from the configured RelicForge renderer

The collection creator configures the renderer URL/default mode before sealing. If holder switching is enabled, the current token owner can call `setRenderMode(tokenId, mode)`. The contract emits ERC-4906 `MetadataUpdate(tokenId)` so marketplaces can refresh metadata.

Important properties:
- `renderToken(tokenId)` always returns the canonical onchain SVG, regardless of display mode.
- Offchain Render changes only the `image` field returned inside the otherwise-onchain `tokenURI()` JSON; `renderToken()` remains canonical.
- A holder can always switch back to mode `0` (onchain SVG).
- Creator render configuration is locked by `sealCollection()`.
- Holder render selection remains usable after sealing.
- Do not seal a collection with a temporary Railway renderer hostname. Use the stable custom hostname you intend to keep, e.g. `https://api.relicforge.xyz`.

### Adaptive offchain renderer
For a URL such as:

`/api/public/render/11155111/0xCOLLECTION/123.png`

RelicForge Cloud:
1. verifies the collection is registered,
2. verifies token `123` is revealed,
3. reads `renderToken(123)` through Alchemy,
4. detects animation-sensitive GIF/SVG content,
5. preserves animated output as cached SVG or rasterizes static output to PNG with Sharp,
6. nearest-neighbor upscales small static pixel art to at least ~512 px,
7. stores the rendered asset in the Railway Bucket and caches it by chain + collection + token.

The renderer never uses the token's flattened `tokenURI()` image to render itself, so there is no recursion.

## Repository layout

```text
/
├─ index.html
├─ studio.html
├─ mint.html
├─ app.js
├─ forge.js
├─ project-storage.js
├─ cloud.js
├─ mint.js
├─ relicforge-config.js
├─ contracts/
│  └─ RelicForgeTest.sol
└─ server/
   ├─ package.json
   ├─ railway.json
   ├─ .env.example
   ├─ sql/001_init.sql
   ├─ scripts/migrate.js
   └─ src/
      ├─ index.js
      ├─ lib/
      └─ routes/
```

The root frontend still has no npm/build step. Railway only builds `/server`.

## First deployment

Read **`RAILWAY_SETUP.md`** before forging a V11 collection.

The short version is:
1. Push V11 to GitHub.
2. Create Railway PostgreSQL, Bucket, and API service.
3. Point the API service's root directory at `/server`.
4. Add Postgres/Bucket/Alchemy variables.
5. Give the API a stable public/custom domain.
6. Set that public URL in `relicforge-config.js`.
7. Deploy the static frontend.
8. Verify `/health`, cloud sign-in, cross-device project restore, and mint-page publishing.
9. In Studio, run **Compile Contracts** and require zero Solidity errors before deploying V11 Sepolia infrastructure.
10. Do not seal until both onchain SVG and Offchain Render have been tested from a fresh device.

## High-traffic design

The mint transaction still goes directly from the connected wallet to the collection contract. Railway does not relay or custody mint transactions.

Public configuration/state responses include CDN-friendly cache headers. Mint/banner media and flattened renders are immutable URLs once published. For a genuinely hyped mint, put a CDN in front of the stable API/renderer hostname so repeated image/render/config requests are absorbed at the edge rather than repeatedly reaching Railway.

The general request path is:

```text
visitor -> static CDN -> RelicForge mint UI
                     -> cached RelicForge API state/config
wallet  ---------------------------------> collection contract
Railway API -> Alchemy (read-only state)
Railway API -> Postgres / Bucket (persistent app data)
```

## Security boundaries

- Never commit `.env`, Alchemy keys, Bucket credentials, or database credentials.
- Project assets are private and require wallet-authenticated signed URLs to restore.
- Only assets explicitly uploaded as mint-page media or generated as public renders are exposed through the public asset route.
- The public RPC relay only permits a restricted set of read-only JSON-RPC methods and is rate-limited. It does not expose `eth_sendRawTransaction`.
- The contract remains authoritative for supply, wallet limits, ownership, whitelist root, royalties, reveal state, and mint validity.
- Cloud data is a creator/mint UX layer; final NFT artwork/DNA/metadata remain onchain except when a holder deliberately selects the optional flattened presentation URL.

## Validation performed on this package

- Browser JavaScript syntax checked with Node.
- Railway server JavaScript syntax checked with Node.
- Static HTML duplicate-ID scan performed.
- Contract source has structural/static checks, but this environment could not download the solc binary or npm dependencies because outbound package DNS was unavailable.

**The in-Studio Solidity 0.8.30 Compile Contracts step is therefore a required deployment gate.** Verify zero errors and confirm the collection implementation runtime is below the EVM 24,576-byte contract-code limit before deploying test infrastructure.
