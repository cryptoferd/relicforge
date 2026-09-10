import crypto from 'node:crypto';
import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import { getBuffer, headObject, objectKey, presignGet, presignPut, putBuffer } from '../lib/storage.js';

const PROJECT_ALLOWED_TYPES = new Set(['application/json','application/zip','text/plain','application/octet-stream']);
const PROJECT_MAX_BYTES = 25 * 1024 * 1024;
const MINT_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const PROJECT_LIMIT = Math.max(1, Number(process.env.PROJECT_LIMIT || 10));
const PROJECT_BATCH_PREPARE_MAX = 50;
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

  app.post('/api/assets/batch-prepare', {
    preHandler: authenticate,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { projectId = null, assets = [] } = request.body || {};
    if (!projectId) return reply.code(400).send({ error: 'projectId is required for batch artwork preparation.' });
    if (!Array.isArray(assets) || !assets.length || assets.length > PROJECT_BATCH_PREPARE_MAX) {
      return reply.code(400).send({ error: `Prepare between 1 and ${PROJECT_BATCH_PREPARE_MAX} project assets per batch.` });
    }

    const normalized = [];
    for (let index = 0; index < assets.length; index++) {
      const item = assets[index] || {};
      const filename = String(item.filename || '').trim();
      const contentType = String(item.contentType || 'application/octet-stream');
      const bytes = Number(item.size || 0);
      const sha256 = String(item.sha256 || '').toLowerCase();

      if (!filename || !allowedType(contentType, 'project')) {
        return reply.code(400).send({ error: `Asset ${index + 1} has an unsupported project asset type.` });
      }
      if (!Number.isFinite(bytes) || bytes < 0 || bytes > PROJECT_MAX_BYTES) {
        return reply.code(400).send({ error: `Asset ${index + 1} exceeds the 25 MB cloud upload limit.` });
      }
      if (!/^[0-9a-f]{64}$/.test(sha256)) {
        return reply.code(400).send({ error: `Asset ${index + 1} requires a SHA-256 fingerprint.` });
      }

      normalized.push({ filename, contentType, bytes, sha256 });
    }

    const existingProject = await one(
      'SELECT id FROM projects WHERE id=$1 AND owner_wallet=$2',
      [projectId, request.user.wallet]
    );
    if (!existingProject) {
      const count = Number((await one(
        'SELECT COUNT(*)::int AS count FROM projects WHERE owner_wallet=$1',
        [request.user.wallet]
      ))?.count || 0);
      if (count >= PROJECT_LIMIT) {
        return reply.code(409).send({
          error: `Active cloud project limit reached (${PROJECT_LIMIT}). Delete a project before uploading another project's artwork.`
        });
      }
    }

    const prepared = [];
    for (let index = 0; index < normalized.length; index++) {
      const item = normalized[index];

      const existing = await one(
        `SELECT id,filename,content_type,size_bytes,status
         FROM assets
         WHERE owner_wallet=$1
           AND sha256=$2
           AND purpose='project'
           AND project_id IS NOT DISTINCT FROM $3
         ORDER BY CASE WHEN status='ready' THEN 0 ELSE 1 END, created_at DESC
         LIMIT 1`,
        [request.user.wallet, item.sha256, projectId]
      );

      if (existing) {
        prepared.push({
          index,
          reused: existing.status === 'ready',
          needsUpload: existing.status !== 'ready',
          asset: {
            id: existing.id,
            filename: existing.filename,
            content_type: existing.content_type,
            size_bytes: Number(existing.size_bytes || 0),
            sha256: item.sha256
          }
        });
        continue;
      }

      const id = crypto.randomUUID();
      const key = objectKey({ wallet: request.user.wallet, purpose: 'project', filename: item.filename });
      await db.query(
        `INSERT INTO assets(id,owner_wallet,project_id,object_key,filename,content_type,size_bytes,sha256,purpose)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'project')`,
        [id, request.user.wallet, projectId, key, item.filename, item.contentType, item.bytes, item.sha256]
      );

      prepared.push({
        index,
        reused: false,
        needsUpload: true,
        asset: {
          id,
          filename: item.filename,
          content_type: item.contentType,
          size_bytes: item.bytes,
          sha256: item.sha256
        }
      });
    }

    return { assets: prepared };
  });

  app.put('/api/assets/:id/upload', {
    preHandler: authenticate,
    config: { rateLimit: { max: 540, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const asset = await one(
      `SELECT id,object_key,size_bytes,content_type,purpose,status
       FROM assets WHERE id=$1 AND owner_wallet=$2`,
      [request.params.id, request.user.wallet]
    );
    if (!asset) return reply.code(404).send({ error: 'Asset not found.' });
    if (asset.status === 'ready') return { ok: true, reused: true };

    const body = request.body;
    if (!Buffer.isBuffer(body)) return reply.code(400).send({ error: 'Binary artwork payload is required.' });

    const expected = Number(asset.size_bytes || 0);
    if (body.length !== expected) {
      return reply.code(400).send({ error: `Uploaded asset size mismatch. Expected ${expected} bytes, received ${body.length}.` });
    }
    const maxBytes = asset.purpose === 'mint-page' ? MINT_PAGE_MAX_BYTES : PROJECT_MAX_BYTES;
    if (body.length > maxBytes) {
      return reply.code(413).send({
        error: asset.purpose === 'mint-page'
          ? 'Mint-page images are limited to 2 MB each.'
          : 'Asset exceeds the 25 MB cloud upload limit.'
      });
    }

    try {
      await putBuffer(
        asset.object_key,
        body,
        asset.content_type || 'application/octet-stream',
        'private, no-store'
      );
      await db.query(
        `UPDATE assets SET status='ready',completed_at=now()
         WHERE id=$1 AND owner_wallet=$2`,
        [request.params.id, request.user.wallet]
      );
      return { ok: true };
    } catch (error) {
      request.log.error({ err: error, assetId: asset.id }, 'Private API asset upload failed');
      return reply.code(502).send({ error: 'Artwork could not be written to private storage.' });
    }
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
