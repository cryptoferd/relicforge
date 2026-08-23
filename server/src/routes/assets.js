import crypto from 'node:crypto';
import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import { headObject, objectKey, presignGet, presignPut } from '../lib/storage.js';

const ALLOWED_TYPES = new Set(['image/png','image/jpeg','image/webp','image/svg+xml','application/json','application/zip','text/plain','application/octet-stream']);
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_PURPOSES = new Set(['project','mint-page']);

export default async function assetRoutes(app) {
  app.post('/api/assets/presign', { preHandler: authenticate }, async (request, reply) => {
    const { filename, contentType = 'application/octet-stream', size = 0, sha256 = '', purpose = 'project', projectId = null } = request.body || {};
    const bytes = Number(size || 0);
    if (!filename || !ALLOWED_TYPES.has(contentType)) return reply.code(400).send({ error: 'Unsupported asset type.' });
    if (!ALLOWED_PURPOSES.has(purpose)) return reply.code(400).send({ error: 'Unsupported asset purpose.' });
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_BYTES) return reply.code(400).send({ error: 'Asset exceeds the 25 MB cloud upload limit.' });
    if (sha256) {
      const existing = await one(
        `SELECT id,filename,content_type,size_bytes FROM assets
         WHERE owner_wallet=$1 AND sha256=$2 AND purpose=$3 AND status='ready' ORDER BY created_at DESC LIMIT 1`,
        [request.user.wallet, String(sha256).toLowerCase(), purpose]
      );
      if (existing) return { reused: true, asset: existing };
    }
    const id = crypto.randomUUID();
    const key = objectKey({ wallet: request.user.wallet, purpose, filename });
    await db.query(
      `INSERT INTO assets(id,owner_wallet,project_id,object_key,filename,content_type,size_bytes,sha256,purpose)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, request.user.wallet, projectId || null, key, filename, contentType, bytes, sha256 ? String(sha256).toLowerCase() : null, purpose]
    );
    const uploadUrl = await presignPut(key, contentType, 900);
    return { reused: false, asset: { id, filename, contentType, size: bytes }, uploadUrl };
  });

  app.post('/api/assets/:id/complete', { preHandler: authenticate }, async (request, reply) => {
    const asset = await one('SELECT id,object_key,size_bytes,content_type FROM assets WHERE id=$1 AND owner_wallet=$2', [request.params.id, request.user.wallet]);
    if (!asset) return reply.code(404).send({ error: 'Asset not found.' });
    try {
      const remote = await headObject(asset.object_key);
      const uploadedBytes = Number(remote.ContentLength || 0);
      if (Number(asset.size_bytes || 0) !== uploadedBytes) {
        return reply.code(400).send({ error: 'Uploaded asset size does not match the prepared upload.' });
      }
    } catch (error) {
      request.log.warn({ err: error, assetId: asset.id }, 'Bucket upload verification failed');
      return reply.code(400).send({ error: 'Uploaded object could not be verified in the Railway Bucket.' });
    }
    await db.query(`UPDATE assets SET status='ready',completed_at=now() WHERE id=$1 AND owner_wallet=$2`, [request.params.id, request.user.wallet]);
    return { ok: true };
  });

  app.get('/api/assets/:id/url', { preHandler: authenticate }, async (request, reply) => {
    const asset = await one('SELECT id,object_key,filename,content_type,size_bytes FROM assets WHERE id=$1 AND owner_wallet=$2 AND status=$3', [request.params.id, request.user.wallet, 'ready']);
    if (!asset) return reply.code(404).send({ error: 'Asset not found.' });
    return { asset, url: await presignGet(asset.object_key, 3600) };
  });
}
