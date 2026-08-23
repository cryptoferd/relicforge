# Relic Forge V11.0.4 — Sepolia / Cloud acceptance checklist

## A. Railway + Alchemy
- [ ] Railway API deploys from repository root directory `/server`.
- [ ] `/health` returns `{ ok: true, version: "11.0.4" }` and reports Alchemy configured.
- [ ] API has `DATABASE_URL` and `DATABASE_UNPOOLED_URL` (when PgBouncer is enabled).
- [ ] Railway Bucket credentials are injected into the API service.
- [ ] Bucket CORS allows the exact frontend origin to `PUT` with `Content-Type`.
- [ ] Railway has one private `ALCHEMY_API_KEY` variable (no per-network Alchemy URL secrets required).
- [ ] `GET /api/public/networks` returns the non-secret EVM endpoint catalog with no API key.
- [ ] `POST /api/public/rpc/1` reaches Ethereum Mainnet through Alchemy.
- [ ] `POST /api/public/rpc/11155111` reaches Ethereum Sepolia through Alchemy.
- [ ] At least one additional mapped chain (for example Base `8453` or Robinhood Chain `4663`) returns the correct `eth_chainId`.
- [ ] No Alchemy key appears in page source, `relicforge-config.js`, or browser network request URLs.
- [ ] `PUBLIC_API_BASE`, `apiBase`, and `renderBase` use the intended stable API hostname.

## B. Cloud identity / projects
- [ ] Connect creator wallet and sign the RelicForge Cloud message (no gas transaction).
- [ ] Save a project containing normal traits, later-added traits, and at least one 1/1.
- [ ] Status reports **Saved locally + synced to cloud**.
- [ ] Open the same wallet/project on a second computer or private browser.
- [ ] Artwork files restore, not only JSON settings.
- [ ] Rarity percentages/exact counts, pinned values, rules, metadata visibility, custom 1/1 metadata, reveal settings, and mint-page settings restore.
- [ ] Local IndexedDB still works if Cloud is temporarily unreachable; Cloud failure is surfaced as pending/warning rather than deleting local work.

## C. Incremental artwork / compiler regression
- [ ] Upload an organized folder.
- [ ] Create a new empty layer later.
- [ ] Add one trait and then multiple traits into an existing category.
- [ ] Add/remove traits directly from the rarity page.
- [ ] New traits start blank/auto in percentage or exact-count mode.
- [ ] Manual values stay pinned when **Auto Fill Remainder** is used.
- [ ] Remove a trait/category and verify stale rule/curated references are cleaned up.
- [ ] Full 1/1 artwork occupies collection recipe slots and the normal generator applies to remaining supply.

## D. Metadata regression
- [ ] `None` can be globally omitted from token attributes without changing rendering/generation.
- [ ] A whole category can be hidden from metadata while its artwork still renders.
- [ ] An individual trait can be hidden only on tokens that use it.
- [ ] Full 1/1 supports custom token name, description, and arbitrary trait_type/value attributes.

## E. Solidity compile gate
- [ ] Studio Step 5 -> **Compile Contracts** reports zero errors using Solidity 0.8.30.
- [ ] `RelicCollectionV2` runtime is below 24,576 bytes.
- [ ] Factory and test randomness contracts compile.
- [ ] Deploy fresh **V11 Sepolia infrastructure**. Do not reuse V10 implementation/factory for render-mode testing.

## F. Forge / reveal regression
- [ ] Forge a small collection with exact recipes and Rarity Audit passing.
- [ ] Forge Reveal still requires only the minter wallet action; test mock fulfillment completes automatically.
- [ ] Creator Reveal still uses the creator placeholder and collection-wide reveal.
- [ ] Curated/manual recipes consume configured target allocations instead of switching the rest of the generator to tier weights.
- [ ] Creator Mint remains Studio/Dashboard-only and public mint page never exposes creator mint.

## G. Cloud mint page
- [ ] Set collection image + banner in Creator Dashboard.
- [ ] Click **Publish Mint Page**.
- [ ] Open the mint URL on a browser that has never opened Studio.
- [ ] Published image/banner load from Cloud, not creator `localStorage`.
- [ ] Public price, supply, max-per-wallet and mint enable state load through the Alchemy-backed API.
- [ ] Fresh wallet with full allotment gets an enabled mint button.
- [ ] Quantity max equals remaining wallet allowance/supply.
- [ ] Mint succeeds with MetaMask.
- [ ] Rabby can be tested too; read-only state must no longer depend on Rabby's RPC because V11 reads through Cloud/Alchemy.

## H. Whitelist Cloud proof distribution
- [ ] Publish whitelist after onchain `whitelistRoot` is set.
- [ ] Backend rejects a published root that does not match the onchain root.
- [ ] Fresh browser retrieves only the connected wallet's allowance/proof.
- [ ] Eligible wallet can whitelist mint.
- [ ] Noneligible wallet receives `eligible: false` and cannot whitelist mint.

## I. Alchemy-backed viewer / holder reads
- [ ] Studio viewer works without relying on the wallet provider for ordinary reads.
- [ ] Minted gallery loads tokens/owners.
- [ ] Current holders reconstruction works.
- [ ] My NFTs shows current ownership after transfers.
- [ ] Mainnet source-collection whitelist snapshot can use the Alchemy-backed read route.

## J. Holder render modes / flattened PNG
- [ ] Creator configures a stable renderer base URI before sealing.
- [ ] Default `0` returns fully onchain SVG in `tokenURI()`.
- [ ] `renderToken(tokenId)` returns the same canonical complete SVG regardless of selected render mode.
- [ ] `/api/public/render/<chain>/<collection>/<token>.png` returns a complete single PNG for a revealed token.
- [ ] Re-requesting the PNG uses the cached render record/object.
- [ ] Token owner selects **Flattened PNG** in My NFTs.
- [ ] `renderMode(tokenId) == 1`.
- [ ] `tokenURI()` `image` becomes the stable flattened renderer URL.
- [ ] ERC-4906 `MetadataUpdate(tokenId)` is emitted.
- [ ] Token owner switches back to **Onchain SVG** and `renderMode(tokenId) == 0`.
- [ ] Non-owner cannot change the token's render mode.
- [ ] After transfer, the new owner can change mode.

## K. Seal / failure-mode test
- [ ] Confirm renderer hostname is final before seal.
- [ ] `sealCollection()` prevents creator from changing render config afterward.
- [ ] Holder can still switch their token back to canonical mode after seal.
- [ ] Simulate RelicForge API/render service outage and verify mode-0 `renderToken()` / onchain `tokenURI()` remain usable.

## L. Pre-mainnet blockers
- [ ] Replace `RelicRandomnessMock` with audited production verifiable randomness.
- [ ] Final Solidity audit/review complete.
- [ ] Verify implementation/factory/randomness/router source on explorer.
- [ ] Configure CDN in front of public API/renderer domain.
- [ ] Enable/validate PgBouncer.
- [ ] Load test public mint config/state/whitelist/render paths.
- [ ] Confirm Alchemy plan/rate limits for expected traffic.
- [ ] Backups/monitoring/alerts configured.
