# Relic Forge Studio V11.0.0 — Cloud + Alchemy + Render Modes

V11 is the first cloud-backed RelicForge build. It keeps the existing static Studio/mint frontend, adds a Railway API under `/server`, moves cross-device project/mint-page persistence to PostgreSQL + Railway Bucket storage, and routes production blockchain reads through a server-side Alchemy connection.

> **Test status:** the included Solidity file is still the Sepolia test contract suite and the included randomness provider is a mock. Do not use this build for a mainnet collection until the production verifiable-randomness implementation is added, the contracts compile cleanly, runtime sizes are checked, and the final contracts are audited.

## What changed in V11

### Cloud project saving
- Wallet challenge/signature login; no username/password and no gas transaction.
- IndexedDB remains the fast local cache.
- **Save Project** now saves locally first and then syncs the full editable project to RelicForge Cloud.
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
- A flattened PNG renderer backed by the canonical onchain `renderToken(tokenId)` output.

### Alchemy
The Alchemy key stays **only on Railway**. Do not put it in `relicforge-config.js`, GitHub Pages, Vercel client variables, or a standalone mint page.

Supported out of the box:
- Ethereum Mainnet — chain ID `1`
- Ethereum Sepolia — chain ID `11155111`

Additional EVM chains can be added later with `RPC_<chainId>_URL` Railway variables and frontend chain definitions.

### Public mint pages are cross-device
Creator mint-page aesthetics are no longer dependent on the creator browser's `localStorage` when Cloud is configured. **Publish Mint Page** stores the public presentation config in PostgreSQL and the image/banner in the Railway Bucket.

A fresh visitor can load the collection URL, receive the published config, read current collection state through the Alchemy-backed API, connect a wallet, and mint without ever having opened RelicForge before.

### Holder-controlled render modes
`RelicCollectionV2` adds two token presentation modes:

- `0` — **Fully Onchain SVG** (canonical/default recommended mode)
- `1` — **Flattened PNG** served from the configured RelicForge renderer

The collection creator configures the renderer URL/default mode before sealing. If holder switching is enabled, the current token owner can call `setRenderMode(tokenId, mode)`. The contract emits ERC-4906 `MetadataUpdate(tokenId)` so marketplaces can refresh metadata.

Important properties:
- `renderToken(tokenId)` always returns the canonical onchain SVG, regardless of display mode.
- Flattened PNG mode changes only the `image` field returned inside the otherwise-onchain `tokenURI()` JSON.
- A holder can always switch back to mode `0` (onchain SVG).
- Creator render configuration is locked by `sealCollection()`.
- Holder render selection remains usable after sealing.
- Do not seal a collection with a temporary Railway renderer hostname. Use the stable custom hostname you intend to keep, e.g. `https://api.relicforge.xyz`.

### Flattened renderer
For a URL such as:

`/api/public/render/11155111/0xCOLLECTION/123.png`

RelicForge Cloud:
1. verifies the collection is registered,
2. verifies token `123` is revealed,
3. reads `renderToken(123)` through Alchemy,
4. rasterizes the complete SVG with Sharp,
5. nearest-neighbor upscales small pixel art to at least ~512 px,
6. stores the PNG in the Railway Bucket,
7. caches the result permanently by chain + collection + token.

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
10. Do not seal until both onchain SVG and flattened PNG rendering have been tested from a fresh device.

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
