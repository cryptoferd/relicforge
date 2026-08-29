import crypto from 'node:crypto';
import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import { getBuffer, headObject, objectKey, presignGet, presignPut } from '../lib/storage.js';

const PROJECT_ALLOWED_TYPES = new Set(['application/json','application/zip','text/plain','application/octet-stream']);
const PROJECT_MAX_BYTES = 25 * 1024 * 1024;
const MINT_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const PROJECT_LIMIT = Math.max(1, Number(process.env.PROJECT_LIMIT || 10));
const ALLOWED_PURPOSES = new Set(['project','mint-page']);

function allowedType(contentType, purpose) {
  const type = String(contentType || '').toLowerCase();
  if (purpose === 'mint-page') return type.startsWith('image/');
  return type.startsWith('image/') || PROJECT_ALLOWED_TYPES.has(type);
}

export default async function assetRoutes(app) {
  app.post('/api/assets/presign', { preHandler: authenticate }, async (request, reply) => {
    const { filename, contentType = 'application/octet-stream', size = 0, sha256 = '', purpose = 'project', projectId = null } = request.body || {};
    const bytes = Number(size || 0);
    if (!filename || !ALLOWED_PURPOSES.has(purpose) || !allowedType(contentType, purpose)) return reply.code(400).send({ error: purpose === 'mint-page' ? 'Mint-page media must be an image.' : 'Unsupported asset type.' });
    const maxBytes = purpose === 'mint-page' ? MINT_PAGE_MAX_BYTES : PROJECT_MAX_BYTES;
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > maxBytes) return reply.code(400).send({ error: purpose === 'mint-page' ? 'Mint-page images are limited to 2 MB each.' : 'Asset exceeds the 25 MB cloud upload limit.' });

    if (purpose === 'project' && projectId) {
      const existingProject = await one('SELECT id FROM projects WHERE id=$1 AND owner_wallet=$2', [projectId, request.user.wallet]);
      if (!existingProject) {
        const count = Number((await one('SELECT COUNT(*)::int AS count FROM projects WHERE owner_wallet=$1', [request.user.wallet]))?.count || 0);
        if (count >= PROJECT_LIMIT) return reply.code(409).send({ error: `Active cloud project limit reached (${PROJECT_LIMIT}). Delete a project before uploading another project's artwork.` });
      }
    }

    if (sha256) {
      const params = [request.user.wallet, String(sha256).toLowerCase(), purpose];
      let reuseSql = `SELECT id,filename,content_type,size_bytes FROM assets
                      WHERE owner_wallet=$1 AND sha256=$2 AND purpose=$3 AND status='ready'`;
      if (purpose === 'project') {
        params.push(projectId || null);
        reuseSql += ' AND project_id IS NOT DISTINCT FROM $4';
      }
      reuseSql += ' ORDER BY created_at DESC LIMIT 1';
      const existing = await one(reuseSql, params);
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
    const asset = await one('SELECT id,object_key,size_bytes,content_type,purpose FROM assets WHERE id=$1 AND owner_wallet=$2', [request.params.id, request.user.wallet]);
    if (!asset) return reply.code(404).send({ error: 'Asset not found.' });
    try {
      const remote = await headObject(asset.object_key);
      const uploadedBytes = Number(remote.ContentLength || 0);
      if (Number(asset.size_bytes || 0) !== uploadedBytes) {
        return reply.code(400).send({ error: 'Uploaded asset size does not match the prepared upload.' });
      }
      if (asset.purpose === 'mint-page' && uploadedBytes > MINT_PAGE_MAX_BYTES) return reply.code(400).send({ error: 'Mint-page images are limited to 2 MB each.' });
    } catch (error) {
      request.log.warn({ err: error, assetId: asset.id }, 'Bucket upload verification failed');
      return reply.code(400).send({ error: 'Uploaded object could not be verified in the Railway Bucket.' });
    }
    await db.query(`UPDATE assets SET status='ready',completed_at=now() WHERE id=$1 AND owner_wallet=$2`, [request.params.id, request.user.wallet]);
    return { ok: true };
  });

  app.get('/api/assets/:id/download', { preHandler: authenticate }, async (request, reply) => {
    const asset = await one(
      'SELECT id,object_key,filename,content_type,size_bytes FROM assets WHERE id=$1 AND owner_wallet=$2 AND status=$3',
      [request.params.id, request.user.wallet, 'ready']
    );
    if (!asset) return reply.code(404).send({ error: 'Asset not found.' });

    try {
      const body = await getBuffer(asset.object_key);
      reply
        .type(asset.content_type || 'application/octet-stream')
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Length', String(body.length));
      return reply.send(body);
    } catch (error) {
      request.log.warn({ err: error, assetId: asset.id }, 'Private asset proxy download failed');
      return reply.code(502).send({ error: 'Cloud artwork could not be read from private storage.' });
    }
  });
  app.get('/api/assets/:id/url', { preHandler: authenticate }, async (request, reply) => {
    const asset = await one('SELECT id,object_key,filename,content_type,size_bytes FROM assets WHERE id=$1 AND owner_wallet=$2 AND status=$3', [request.params.id, request.user.wallet, 'ready']);
    if (!asset) return reply.code(404).send({ error: 'Asset not found.' });
    return { asset, url: await presignGet(asset.object_key, 3600) };
  });
}
