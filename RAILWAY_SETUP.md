# RelicForge V11.0.5 — Railway + Alchemy Setup

This guide takes the V11 ZIP from static files to a cloud-backed RelicForge test deployment.

## 0. What you need

- The V11 repository pushed to GitHub.
- A Railway account.
- An Alchemy account. V11.0.5 uses one private API key with a built-in EVM endpoint registry instead of one Railway variable per chain.
- Your existing static frontend host (GitHub Pages or Vercel is fine).
- Preferably a stable API hostname you control, e.g. `api.relicforge.xyz`.

**Do not send or commit your Alchemy key, database password, Bucket secret, or `SESSION_SECRET`. Put them directly into Railway Variables.**

---

## 1. Create the Railway project

Create a new Railway project, for example **RelicForge Cloud**.

Add three resources in the same production environment:

1. **PostgreSQL**
2. **Bucket** (for example `relicforge-assets`)
3. **GitHub service** connected to the RelicForge repository

For the GitHub/API service, set the **Root Directory** to:

```text
/server
```

The `/server/railway.json` file tells Railway to start the API and use `/health` as its health check.

---

## 2. PostgreSQL

Add a Railway PostgreSQL service.

For initial testing, a direct `DATABASE_URL` reference works. For production/high traffic, enable Railway's managed PgBouncer:

**Postgres -> Database -> Config -> Connection Pooling -> Add PgBouncer**

Transaction mode is appropriate for the normal API traffic. The V11 migration script deliberately uses `DATABASE_UNPOOLED_URL` when it is present because its advisory lock needs a dedicated database session.

Add these references to the API service:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_UNPOOLED_URL=${{Postgres.DATABASE_UNPOOLED_URL}}
```

After PgBouncer is enabled, Railway's `DATABASE_URL` points to the pooler and `DATABASE_UNPOOLED_URL` points directly to Postgres.

Do not expose Postgres publicly unless you actually need external administration.

---

## 3. Railway Bucket

Create a Bucket in the same Railway environment.

V11 accepts Railway's current AWS-style Bucket credential variables directly:

```text
AWS_ENDPOINT_URL
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET_NAME
AWS_DEFAULT_REGION
AWS_S3_URL_STYLE
```

Use Railway's Bucket credential injection/reference feature rather than copying secrets into source code.

The server also recognizes Railway-style aliases such as `ENDPOINT`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, and `BUCKET`.

### Bucket CORS

RelicForge project files upload **directly from the browser to the Bucket using a short-lived presigned PUT URL**. Configure Bucket CORS to allow your frontend origin(s).

At minimum allow:

```text
Origins:
https://YOUR-FRONTEND-DOMAIN
http://localhost:8080        (development only)

Methods:
PUT
GET
HEAD

Headers:
Content-Type
```

Do not use `*` for the production origin if you know the exact RelicForge frontend hostname.

Project files remain private; cross-device restore gets an authenticated presigned GET URL. Public mint/banner media and flattened renders are deliberately proxied through public API routes with cache headers.

---

## 4. Add Alchemy — one key, all mapped EVM endpoints

V11.0.5 no longer stores a full Alchemy URL per network. Add **one private variable** to the Railway API service:

```text
ALCHEMY_API_KEY=YOUR_PRIVATE_ALCHEMY_KEY
```

RelicForge keeps the non-secret endpoint bases in `server/src/lib/alchemy-networks.js` and builds the final URL only on Railway. For example:

```text
chain 1       -> https://eth-mainnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>
chain 8453    -> https://base-mainnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>
chain 42161   -> https://arb-mainnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>
chain 4663    -> https://robinhood-mainnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>
```

The key is never returned by `/api/public/networks`, `/api/public/rpc/:chainId`, the Studio frontend, or the mint page.

### Optional RPC overrides

For an emergency provider change or a chain that should not use Alchemy, you may add either:

```text
RPC_8453_URL=https://your-custom-base-rpc.example
```

or one JSON variable for several chains:

```text
RPC_OVERRIDES_JSON={"8453":"https://your-custom-base-rpc.example","42161":"https://your-custom-arbitrum-rpc.example"}
```

For a newly launched Alchemy endpoint whose EIP-155 chain ID is not yet mapped in the built-in registry, map the chain ID to an existing Alchemy network key without changing source code:

```text
ALCHEMY_NETWORK_OVERRIDES_JSON={"123456":"some-network-mainnet"}
```

`RPC_<chainId>_URL` has highest priority, then `RPC_OVERRIDES_JSON`, then the Alchemy registry.

**Never place `ALCHEMY_API_KEY` in `relicforge-config.js`, GitHub, a Vercel public environment variable, or a standalone mint page.**

The public non-secret catalog is available after deployment at:

```text
GET /api/public/networks
```

That endpoint is also what Studio uses to populate supported whitelist snapshot networks.

---

## 5. API service variables

Set the remaining API variables in Railway:

```text
NODE_ENV=production

CORS_ORIGINS=https://YOUR-FRONTEND-DOMAIN
AUTH_DOMAIN=RelicForge
AUTH_URI=https://YOUR-FRONTEND-DOMAIN
SESSION_SECRET=GENERATE_A_LONG_RANDOM_SECRET

PUBLIC_API_BASE=https://api.relicforge.xyz
```

`SESSION_SECRET` should be a long random value (32+ random bytes is recommended). Do not reuse a wallet key/API key.

If you have both a GitHub Pages preview and a production domain, `CORS_ORIGINS` is comma separated:

```text
CORS_ORIGINS=https://relicforge.xyz,https://cryptoferd.github.io
```

V11 deliberately refuses to boot in `NODE_ENV=production` if `CORS_ORIGINS` is empty.

### Generate a secret locally

One simple option:

```bash
openssl rand -hex 32
```

Paste the output directly into Railway's `SESSION_SECRET` variable.

---

## 6. Give the API a public domain

For temporary testing, Railway's generated domain is fine.

Before you **seal** any collection that might use flattened render mode, use a hostname you intend to keep permanently, for example:

```text
https://api.relicforge.xyz
```

Set the same stable hostname as:

```text
PUBLIC_API_BASE=https://api.relicforge.xyz
```

The collection stores its flattened renderer base URI onchain. `sealCollection()` intentionally prevents the creator from changing that renderer config afterward.

---

## 7. Point the frontend at Railway

Edit the root file:

```text
relicforge-config.js
```

Set:

```js
window.RELICFORGE_CONFIG = Object.freeze({
  apiBase: 'https://api.relicforge.xyz',
  renderBase: 'https://api.relicforge.xyz',
  cloudEnabled: true,
  version: '11.0.5'
});
```

If you are temporarily testing with a Railway-generated domain, use that for both values. **Do not seal a real collection until you move to the stable domain.**

Deploy the root static files to GitHub Pages/Vercel as usual. The frontend still requires no Node build.

---

## 8. Confirm the backend is alive

Open:

```text
https://api.relicforge.xyz/health
```

Expected shape:

```json
{
  "ok": true,
  "service": "relicforge-cloud-api",
  "version": "11.0.5"
}
```

If `/health` fails, check Railway deployment logs before testing Studio.

---

## 9. Cross-device cloud test

On Computer A:

1. Open Studio.
2. Connect the creator wallet.
3. Approve the **RelicForge Cloud Sign-In** message. It is a message signature, not a transaction and costs no gas.
4. Create/upload a small test project.
5. Click **Save Project**.
6. Confirm the status says **Saved locally + synced to cloud**.

On Computer B/private browser:

1. Open the same Studio deployment.
2. Connect the same wallet.
3. Sign the Cloud Sign-In message.
4. Open **My Projects**.
5. Confirm the project is marked **Cloud** and opens with its artwork intact.

Do not move on to collection deployment until this works.

---

## 10. Public mint-page persistence test

1. From a deployed test collection in Creator Dashboard, set a collection image and banner.
2. Click **Publish Mint Page** / save the mint-page changes.
3. Open the mint URL in a completely fresh browser/device.
4. Confirm the same image/banner loads without any creator `localStorage`.
5. Connect a fresh wallet and confirm public allowance/state loads.
6. If whitelist is enabled, confirm only that wallet's allowance/proof is retrieved and whitelist minting works.

---

## 11. V11 contract compile gate

V11 changes the collection implementation to `RelicCollectionV2`, so old V10 infrastructure cannot test the new render-mode behavior.

In Studio Step 5:

1. Click **Compile Contracts**.
2. Require **zero Solidity compiler errors**.
3. Check the reported runtime size for `RelicCollectionV2` is below **24,576 bytes**.
4. Only then deploy fresh **V11 Sepolia test infrastructure**.

The included `RelicRandomnessMock` is test-only and is not appropriate for a mainnet Forge Reveal.

---

## 12. Render-mode test

Forge a very small Sepolia collection and enable holder render switching.

For at least one revealed token verify:

1. `renderToken(tokenId)` returns the complete canonical SVG.
2. `tokenURI()` in mode `0` contains an onchain SVG data URI.
3. The renderer URL returns one complete PNG.
4. The current holder switches to **Flattened PNG** from **My NFTs**.
5. `renderMode(tokenId)` becomes `1`.
6. `tokenURI()` now advertises the renderer PNG URL.
7. The holder switches back to **Onchain SVG**.
8. `renderMode(tokenId)` becomes `0` and the onchain image returns.
9. Transfer the token to another wallet and verify only the new owner can call `setRenderMode`.

Only after this works should you test sealing.

---

## 13. Sealing test

Before sealing, verify the renderer hostname is final.

After `sealCollection()`:

- creator `setRenderConfig(...)` should revert,
- normal sealed creator settings should remain locked,
- token holders should still be able to change their own `setRenderMode(...)`,
- mode `0` / canonical `renderToken()` must still work even if the RelicForge API is unavailable.

---

## 14. High-traffic production notes

Before a public mainnet launch:

- Put a CDN/proxy such as Cloudflare in front of the stable public API/renderer domain.
- Keep the mint frontend static/edge-cached.
- Keep Railway API replicas stateless.
- Enable PgBouncer and keep Node's database pool small.
- Watch Alchemy Compute Unit usage and choose a plan appropriate for the mint.
- Load-test the public config/state/whitelist routes before a hyped mint.
- Avoid polling wallet-specific state continuously; V11 reads it on connection/refresh/mint completion.
- The actual mint transaction must remain **wallet -> blockchain**, never wallet -> RelicForge server -> blockchain.

The public JSON-RPC relay is restricted and rate-limited, but it still consumes your Alchemy quota. For a very large production launch, monitor it closely and consider moving nonessential gallery/history reads behind dedicated indexed/cached endpoints rather than increasing generic relay limits.

---

## Troubleshooting order

If something fails, use this order:

1. `/health`
2. Railway API logs
3. Postgres reference variables
4. Bucket credentials/CORS
5. Alchemy Mainnet/Sepolia URL variables
6. Browser Network tab for `/api/...`
7. Wallet transaction/signing only after read-state calls are healthy

Never paste secret Railway/Alchemy credentials into screenshots or support messages.
