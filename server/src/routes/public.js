import crypto from 'node:crypto';
import sharp from 'sharp';
import { getAddress } from 'ethers';
import { db, one } from '../lib/db.js';
import { collectionFor, providerFor, rpcUrl } from '../lib/rpc.js';
import { publicAlchemyNetworkCatalog } from '../lib/alchemy-networks.js';
import { getBuffer, objectKey, putBuffer } from '../lib/storage.js';

const STATE_CACHE = new Map();
function cacheGet(key, ttl) {
  const hit = STATE_CACHE.get(key);
  return hit && Date.now() - hit.at < ttl ? hit.value : null;
}
function cacheSet(key, value) { STATE_CACHE.set(key, { at: Date.now(), value }); return value; }
function address(value) { return getAddress(String(value || '')).toLowerCase(); }
function publicAssetUrl(request, id) {
  const configured = String(process.env.PUBLIC_API_BASE || '').replace(/\/$/, '');
  const base = configured || `${request.protocol}://${request.headers.host}`;
  return `${base}/api/public/assets/${id}`;
}

const SAFE_RPC_METHODS = new Set([
  'eth_chainId','net_version','eth_blockNumber','eth_getCode','eth_call','eth_getBalance','eth_getTransactionCount',
  'eth_getBlockByNumber','eth_getBlockByHash','eth_getLogs','eth_gasPrice','eth_feeHistory','eth_estimateGas','eth_getTransactionReceipt','eth_getTransactionByHash'
]);
function validateRpcCall(call) {
  if (!call || call.jsonrpc !== '2.0' || !SAFE_RPC_METHODS.has(call.method)) throw new Error('RPC method is not allowed.');
  if (call.method === 'eth_getLogs') {
    const filter = call.params?.[0] || {};
    if (filter.fromBlock && filter.toBlock && /^0x/.test(filter.fromBlock) && /^0x/.test(filter.toBlock)) {
      const span = Number(BigInt(filter.toBlock) - BigInt(filter.fromBlock));
      if (span > 500000) throw new Error('eth_getLogs range exceeds 500,000 blocks.');
    }
  }
}

export default async function publicRoutes(app) {
  app.get('/api/public/networks', async (request, reply) => {
    reply.header('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return {
      provider: 'alchemy',
      apiKeyConfigured: Boolean(process.env.ALCHEMY_API_KEY),
      networks: publicAlchemyNetworkCatalog()
    };
  });

  app.get('/api/public/mint/:chainId/:contract/config', async (request, reply) => {
    const chainId = Number(request.params.chainId);
    const contract = address(request.params.contract);
    const row = await one('SELECT mint_page,updated_at FROM collections WHERE chain_id=$1 AND contract_address=$2', [chainId, contract]);
    reply.header('Cache-Control', 'no-store');
    if (!row) return { config: { chainId, contract: getAddress(contract) }, published: false };
    const config = { ...(row.mint_page || {}), chainId, contract: getAddress(contract) };
    if (config.collectionImageAssetId) config.collectionImage = publicAssetUrl(request, config.collectionImageAssetId);
    if (config.bannerImageAssetId) config.bannerImage = publicAssetUrl(request, config.bannerImageAssetId);
    delete config.whitelistEntries;
    return { config, published: true, updatedAt: row.updated_at };
  });

  app.get('/api/public/collection/:chainId/:contract/state', async (request, reply) => {
    const chainId = Number(request.params.chainId);
    const contractAddress = address(request.params.contract);
    const key = `state:${chainId}:${contractAddress}`;
    const cached = cacheGet(key, 1800);
    if (cached) { reply.header('Cache-Control', 'public, s-maxage=2, stale-while-revalidate=8'); return cached; }
    const c = collectionFor(chainId, contractAddress);
    const [name, description, maxSupply, totalMinted, maxPerWallet, mintPrice, whitelistMintPrice, publicMintEnabled, whitelistMintEnabled, whitelistRoot, revealMode] = await Promise.all([
      c.name(), c.description().catch(() => ''), c.maxSupply(), c.totalMinted(), c.maxPerWallet().catch(() => 0n), c.mintPrice(),
      c.whitelistMintPrice().catch(() => 0n), c.publicMintEnabled().catch(() => true), c.whitelistMintEnabled().catch(() => false), c.whitelistRoot().catch(() => '0x' + '0'.repeat(64)), c.revealMode().catch(() => 0n)
    ]);
    const value = cacheSet(key, {
      chainId, contract: getAddress(contractAddress), name, description,
      maxSupply: Number(maxSupply), totalMinted: Number(totalMinted), maxPerWallet: Number(maxPerWallet),
      mintPrice: mintPrice.toString(), whitelistMintPrice: whitelistMintPrice.toString(), publicMintEnabled: Boolean(publicMintEnabled),
      whitelistMintEnabled: Boolean(whitelistMintEnabled), whitelistRoot, revealMode: Number(revealMode)
    });
    reply.header('Cache-Control', 'public, s-maxage=2, stale-while-revalidate=8');
    return value;
  });

  app.get('/api/public/collection/:chainId/:contract/wallet/:wallet', async (request, reply) => {
    const chainId = Number(request.params.chainId);
    const contractAddress = address(request.params.contract);
    const wallet = address(request.params.wallet);
    const key = `wallet:${chainId}:${contractAddress}:${wallet}`;
    const cached = cacheGet(key, 1500);
    if (cached) { reply.header('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=3'); return cached; }
    const c = collectionFor(chainId, contractAddress);
    const [minted, whitelistMinted, balance] = await Promise.all([
      c.mintedByWallet(wallet).catch(() => 0n), c.whitelistMintedByWallet(wallet).catch(() => 0n), c.balanceOf(wallet).catch(() => 0n)
    ]);
    const value = cacheSet(key, { wallet: getAddress(wallet), mintedByWallet: Number(minted), whitelistMintedByWallet: Number(whitelistMinted), balance: Number(balance) });
    reply.header('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=3');
    return value;
  });

  app.get('/api/public/whitelist/:chainId/:contract/:wallet', async (request, reply) => {
    const chainId = Number(request.params.chainId), contract = address(request.params.contract), wallet = address(request.params.wallet);
    const row = await one('SELECT allowance,proof FROM whitelist_entries WHERE chain_id=$1 AND contract_address=$2 AND wallet=$3', [chainId, contract, wallet]);
    reply.header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return row ? { eligible: true, wallet: getAddress(wallet), allowance: Number(row.allowance), proof: row.proof || [] } : { eligible: false, wallet: getAddress(wallet), allowance: 0, proof: [] };
  });

  app.get('/api/public/assets/:id', async (request, reply) => {
    const asset = await one("SELECT object_key,content_type FROM assets WHERE id=$1 AND status=$2 AND purpose IN ('mint-page','render')", [request.params.id, 'ready']);
    if (!asset) return reply.code(404).send({ error: 'Asset not found.' });
    const body = await getBuffer(asset.object_key);
    // Asset IDs are immutable. Send the actual object through the API so the edge
    // can cache a stable 200 response instead of caching an expiring presigned redirect.
    reply.type(asset.content_type || 'application/octet-stream');
    reply.header('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    return reply.send(body);
  });

  app.post('/api/public/rpc/:chainId', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const isBatch = Array.isArray(request.body);
      const calls = isBatch ? request.body : [request.body];
      // ethers v6 may coalesce many simultaneous contract reads into one JSON-RPC
      // batch. Accept a reasonable client batch here and split it into upstream-safe
      // chunks instead of turning an otherwise healthy read into HTTP 400.
      if (!calls.length || calls.length > 100) throw new Error('RPC batch size must be 1-100.');
      calls.forEach(validateRpcCall);
      const chainId = Number(request.params.chainId);
      // Force an eth_chainId verification through ethers before using a mapped
      // endpoint. This protects against an outdated/incorrect endpoint->chain
      // mapping and fails closed instead of silently reading a different chain.
      await providerFor(chainId).getNetwork();

      const allResults = [];
      for (let i = 0; i < calls.length; i += 20) {
        const chunk = calls.slice(i, i + 20);
        const upstreamBody = isBatch ? chunk : chunk[0];
        const response = await fetch(rpcUrl(chainId), {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(upstreamBody)
        });
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { jsonrpc: '2.0', id: chunk[0]?.id ?? null, error: { code: -32000, message: text || 'Upstream RPC error.' } };
        }
        if (!response.ok) return reply.code(response.status).send(data);
        if (!isBatch) return reply.code(response.status).send(data);
        if (Array.isArray(data)) allResults.push(...data);
        else allResults.push(data);
      }
      return reply.code(200).send(allResults);
    } catch (error) {
      reply.code(400).send({ jsonrpc: '2.0', id: request.body?.id ?? null, error: { code: -32600, message: error.message } });
    }
  });

  app.get('/api/public/render/:chainId/:contract/:tokenId.png', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const chainId = Number(request.params.chainId), contractAddress = address(request.params.contract), tokenId = Number(request.params.tokenId);
    if (!Number.isInteger(tokenId) || tokenId < 1) return reply.code(400).send({ error: 'Invalid token ID.' });
    // Only Cloud-registered RelicForge collections may consume renderer CPU/storage.
    // This prevents the public endpoint from becoming a generic arbitrary-SVG rasterizer.
    const registered = await one('SELECT 1 FROM collections WHERE chain_id=$1 AND contract_address=$2', [chainId, contractAddress]);
    if (!registered) return reply.code(404).send({ error: 'Collection is not registered with RelicForge Cloud.' });
    const cached = await one(
      `SELECT a.object_key, a.content_type FROM render_cache r JOIN assets a ON a.id=r.asset_id
       WHERE r.chain_id=$1 AND r.contract_address=$2 AND r.token_id=$3 AND a.status='ready' AND a.purpose='render-v2'`,
      [chainId, contractAddress, tokenId]
    );
    if (cached) {
      const body = await getBuffer(cached.object_key);
      reply.type(cached.content_type || 'application/octet-stream');
      reply.header('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
      return reply.send(body);
    }
    const c = collectionFor(chainId, contractAddress);
    if (!(await c.isRevealed(tokenId))) return reply.code(409).send({ error: 'Token is not revealed yet.' });
    const [svg, owner] = await Promise.all([c.renderToken(tokenId), c.owner().catch(() => '0x0000000000000000000000000000000000000000')]);
    const svgBytes = Buffer.byteLength(svg, 'utf8');
    if (svgBytes > 8 * 1024 * 1024) return reply.code(413).send({ error: 'Rendered SVG exceeds the 8 MB renderer safety limit.' });

    // The contract's legacy mode-1 URL ends in .png, but the HTTP response is now adaptive.
    // Animation-capable GIF/WebP/AVIF and embedded SVG content must not be flattened to a static frame. For those tokens we
    // cache and serve the canonical SVG with the correct Content-Type. Static SVGs are still
    // rasterized to PNG for broad marketplace compatibility. If Sharp cannot decode a source
    // image type, fall back to canonical SVG instead of making offchain rendering fail.
    const animationSensitive = /data:image\/(?:gif|webp|avif|svg\+xml)(?:;|,)|<animate(?:Transform|Motion)?\b|<set\b/i.test(svg);
    let body;
    let contentType;
    let filename;
    if (animationSensitive) {
      body = Buffer.from(svg, 'utf8');
      contentType = 'image/svg+xml';
      filename = `${tokenId}.svg`;
    } else {
      try {
        let image = sharp(Buffer.from(svg));
        const metadata = await image.metadata();
        const maxSide = Math.max(Number(metadata.width || 0), Number(metadata.height || 0));
        if (maxSide > 0 && maxSide < 512) {
          const factor = Math.max(1, Math.floor(512 / maxSide));
          image = image.resize({ width: Number(metadata.width) * factor, height: Number(metadata.height) * factor, kernel: sharp.kernel.nearest });
        }
        body = await image.png({ compressionLevel: 9 }).toBuffer();
        contentType = 'image/png';
        filename = `${tokenId}.png`;
      } catch {
        body = Buffer.from(svg, 'utf8');
        contentType = 'image/svg+xml';
        filename = `${tokenId}.svg`;
      }
    }
    const key = objectKey({ wallet: String(owner).toLowerCase(), purpose: `renders-v2/${chainId}/${contractAddress}`, filename });
    await putBuffer(key, body, contentType);
    const assetId = crypto.randomUUID();
    await db.query(
      `INSERT INTO assets(id,owner_wallet,object_key,filename,content_type,size_bytes,purpose,status,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,'render-v2','ready',now())`,
      [assetId, String(owner).toLowerCase(), key, filename, contentType, body.length]
    );
    await db.query(
      `INSERT INTO render_cache(chain_id,contract_address,token_id,asset_id) VALUES($1,$2,$3,$4)
       ON CONFLICT(chain_id,contract_address,token_id) DO UPDATE SET asset_id=EXCLUDED.asset_id,created_at=now()`,
      [chainId, contractAddress, tokenId, assetId]
    );
    reply.type(contentType);
    reply.header('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return reply.send(body);
  });
}
