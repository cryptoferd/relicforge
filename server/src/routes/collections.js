import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import { verifyCollectionOwner, collectionFor } from '../lib/rpc.js';
import { deleteObjects } from '../lib/storage.js';

const MINT_PAGE_MAX_BYTES = 2 * 1024 * 1024;

function normAddress(value) { return String(value || '').toLowerCase(); }

export default async function collectionRoutes(app) {
  app.get('/api/collections', { preHandler: authenticate }, async request => {
    const { rows } = await db.query(
      `SELECT chain_id,contract_address,project_id,mint_page,created_at,updated_at FROM collections WHERE owner_wallet=$1 ORDER BY updated_at DESC LIMIT 500`,
      [request.user.wallet]
    );
    return { collections: rows };
  });

  app.put('/api/collections/:chainId/:contract/mint-page', { preHandler: authenticate }, async (request, reply) => {
    const chainId = Number(request.params.chainId);
    const contract = normAddress(request.params.contract);
    try { await verifyCollectionOwner(chainId, contract, request.user.wallet); }
    catch (error) { return reply.code(403).send({ error: error.message }); }
    const config = request.body?.config || {};
    const previous = await one('SELECT mint_page FROM collections WHERE chain_id=$1 AND contract_address=$2 AND owner_wallet=$3', [chainId, contract, request.user.wallet]);
    for (const assetId of [config.collectionImageAssetId, config.bannerImageAssetId].filter(Boolean)) {
      const asset = await one('SELECT id,object_key,content_type,size_bytes,purpose FROM assets WHERE id=$1 AND owner_wallet=$2 AND status=$3', [assetId, request.user.wallet, 'ready']);
      if (!asset) return reply.code(400).send({ error: 'Mint page asset is missing or belongs to another wallet.' });
      if (asset.purpose !== 'mint-page' || !String(asset.content_type || '').toLowerCase().startsWith('image/')) return reply.code(400).send({ error: 'Mint page media must be an uploaded image.' });
      if (Number(asset.size_bytes || 0) > MINT_PAGE_MAX_BYTES) return reply.code(400).send({ error: 'Mint-page images are limited to 2 MB each.' });
    }
    await db.query(
      `INSERT INTO collections(chain_id,contract_address,owner_wallet,project_id,mint_page)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(chain_id,contract_address) DO UPDATE SET owner_wallet=EXCLUDED.owner_wallet,project_id=COALESCE(EXCLUDED.project_id,collections.project_id),mint_page=EXCLUDED.mint_page,updated_at=now()`,
      [chainId, contract, request.user.wallet, request.body?.projectId || null, JSON.stringify(config)]
    );

    // Replacing a banner/image should not leak old objects into the Bucket forever.
    // Keep shared deduplicated mint-page assets while another collection still references them.
    const oldIds = new Set([previous?.mint_page?.collectionImageAssetId, previous?.mint_page?.bannerImageAssetId].filter(Boolean).map(String));
    const newIds = new Set([config.collectionImageAssetId, config.bannerImageAssetId].filter(Boolean).map(String));
    for (const oldId of oldIds) {
      if (newIds.has(oldId)) continue;
      try {
        const stillUsed = await one(
          `SELECT 1 FROM collections
           WHERE owner_wallet=$1 AND NOT (chain_id=$2 AND contract_address=$3)
             AND ((mint_page->>'collectionImageAssetId')=$4 OR (mint_page->>'bannerImageAssetId')=$4)
           LIMIT 1`,
          [request.user.wallet, chainId, contract, oldId]
        );
        if (stillUsed) continue;
        const oldAsset = await one("SELECT object_key FROM assets WHERE id=$1 AND owner_wallet=$2 AND purpose='mint-page'", [oldId, request.user.wallet]);
        if (!oldAsset) continue;
        await deleteObjects([oldAsset.object_key]);
        await db.query("DELETE FROM assets WHERE id=$1 AND owner_wallet=$2 AND purpose='mint-page'", [oldId, request.user.wallet]);
      } catch (error) {
        app.log.warn({ err: error, assetId: oldId }, 'Mint page updated but replaced asset cleanup failed');
      }
    }
    return { ok: true, publishedAt: new Date().toISOString() };
  });

  app.put('/api/collections/:chainId/:contract/whitelist', { preHandler: authenticate, bodyLimit: 25 * 1024 * 1024 }, async (request, reply) => {
    const chainId = Number(request.params.chainId);
    const contract = normAddress(request.params.contract);
    try { await verifyCollectionOwner(chainId, contract, request.user.wallet); }
    catch (error) { return reply.code(403).send({ error: error.message }); }
    const wl = request.body || {};
    const entries = Array.isArray(wl.entries) ? wl.entries : [];
    if (!wl.merkleRoot || entries.length > 250000) return reply.code(400).send({ error: 'Whitelist root required; maximum 250,000 entries per publish.' });
    const onchainRoot = String(await collectionFor(chainId, contract).whitelistRoot()).toLowerCase();
    if (onchainRoot !== String(wl.merkleRoot).toLowerCase()) return reply.code(400).send({ error: 'Published whitelist root does not match the collection whitelistRoot onchain.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO whitelists(chain_id,contract_address,merkle_root,source_type,source_chain_id,source_contract,snapshot_block)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(chain_id,contract_address) DO UPDATE SET merkle_root=EXCLUDED.merkle_root,source_type=EXCLUDED.source_type,source_chain_id=EXCLUDED.source_chain_id,source_contract=EXCLUDED.source_contract,snapshot_block=EXCLUDED.snapshot_block,updated_at=now()`,
        [chainId, contract, String(wl.merkleRoot).toLowerCase(), Number(wl.sourceType || 0), Number(wl.sourceChainId || 0), wl.sourceContract ? normAddress(wl.sourceContract) : null, Number(wl.snapshotBlock || 0)]
      );
      await client.query('DELETE FROM whitelist_entries WHERE chain_id=$1 AND contract_address=$2', [chainId, contract]);
      for (let i = 0; i < entries.length; i += 1000) {
        const chunk = entries.slice(i, i + 1000);
        const values = [];
        const placeholders = chunk.map((entry, index) => {
          const base = index * 5;
          values.push(chainId, contract, normAddress(entry.address), Number(entry.allowance || 0), JSON.stringify(entry.proof || []));
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5}::jsonb)`;
        });
        if (placeholders.length) await client.query(
          `INSERT INTO whitelist_entries(chain_id,contract_address,wallet,allowance,proof) VALUES ${placeholders.join(',')}`,
          values
        );
      }
      await client.query('COMMIT');
      return { ok: true, entries: entries.length };
    } catch (error) {
      await client.query('ROLLBACK');
      return reply.code(400).send({ error: error.message });
    } finally { client.release(); }
  });
}
