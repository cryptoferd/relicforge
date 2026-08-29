import crypto from 'node:crypto';
import { db, one } from '../lib/db.js';
import { authenticateFounder, normalizeWallet } from '../lib/auth.js';
import { headObject, objectKey, presignGet, presignPut } from '../lib/storage.js';

const PROJECT_MAX_BYTES = 25 * 1024 * 1024;
const PROJECT_ALLOWED_TYPES = new Set([
  'application/json','application/zip','text/plain','application/octet-stream'
]);

function allowedProjectType(contentType) {
  const type = String(contentType || '').toLowerCase();
  return type.startsWith('image/') || PROJECT_ALLOWED_TYPES.has(type);
}

async function audit(founderWallet, ownerWallet, projectId, action, note = null, metadata = {}) {
  await db.query(
    `INSERT INTO founder_support_audit(founder_wallet,owner_wallet,project_id,action,note,metadata)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [founderWallet, ownerWallet, projectId, action, note ? String(note).slice(0, 1000) : null, JSON.stringify(metadata || {})]
  );
}

export default async function founderRoutes(app) {
  app.get('/api/founder/projects', { preHandler: authenticateFounder }, async request => {
    const owner = request.query?.owner ? normalizeWallet(request.query.owner) : null;
    const q = String(request.query?.q || '').trim().slice(0, 120);
    const values = [];
    const where = [];

    if (owner) {
      values.push(owner);
      where.push(`p.owner_wallet=$${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      where.push(`(p.name ILIKE $${values.length} OR p.id::text ILIKE $${values.length} OR p.owner_wallet ILIKE $${values.length})`);
    }

    const sql = `
      SELECT p.id,p.owner_wallet,p.name,p.current_version,p.created_at,p.updated_at,
             COALESCE((SELECT SUM(a.size_bytes) FROM assets a
                       WHERE a.owner_wallet=p.owner_wallet AND a.project_id=p.id
                         AND a.purpose='project' AND a.status='ready'),0)::bigint AS storage_bytes
      FROM projects p
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.updated_at DESC
      LIMIT 250
    `;
    const { rows } = await db.query(sql, values);
    return { projects: rows, founder: request.user.wallet };
  });

  app.get('/api/founder/projects/:owner/:id', { preHandler: authenticateFounder }, async (request, reply) => {
    const ownerWallet = normalizeWallet(request.params.owner);
    const project = await one(
      `SELECT id,owner_wallet,name,current_version,snapshot,created_at,updated_at
       FROM projects WHERE id=$1 AND owner_wallet=$2`,
      [request.params.id, ownerWallet]
    );
    if (!project) return reply.code(404).send({ error: 'Project not found.' });

    await audit(request.user.wallet, ownerWallet, project.id, 'open');
    return {
      project,
      support: {
        founderWallet: request.user.wallet,
        ownerWallet,
        onchainAuthority: false,
        creatorSignatureStillRequired: true
      }
    };
  });

  app.put('/api/founder/projects/:owner/:id', { preHandler: authenticateFounder }, async (request, reply) => {
    const ownerWallet = normalizeWallet(request.params.owner);
    const { name, snapshot, note } = request.body || {};
    if (!snapshot || typeof snapshot !== 'object') {
      return reply.code(400).send({ error: 'Project snapshot is required.' });
    }
    if (!String(note || '').trim()) {
      return reply.code(400).send({ error: 'A troubleshooting note is required for founder saves.' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ownerWallet]);
      const existing = await client.query(
        `SELECT id,name,current_version FROM projects
         WHERE id=$1 AND owner_wallet=$2 FOR UPDATE`,
        [request.params.id, ownerWallet]
      );
      if (!existing.rows.length) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Project not found. Founder Support Mode never creates projects for a creator.' });
      }

      const prior = existing.rows[0];
      const version = Number(prior.current_version) + 1;
      const nextName = String(name || prior.name).slice(0, 180);

      await client.query(
        `UPDATE projects SET name=$3,current_version=$4,snapshot=$5::jsonb,updated_at=now()
         WHERE id=$1 AND owner_wallet=$2`,
        [request.params.id, ownerWallet, nextName, version, JSON.stringify(snapshot)]
      );
      await client.query(
        `INSERT INTO project_versions(project_id,version,snapshot) VALUES($1,$2,$3::jsonb)`,
        [request.params.id, version, JSON.stringify(snapshot)]
      );
      await client.query(
        `INSERT INTO founder_support_audit(founder_wallet,owner_wallet,project_id,action,note,metadata)
         VALUES($1,$2,$3,'save',$4,$5::jsonb)`,
        [
          request.user.wallet,
          ownerWallet,
          request.params.id,
          String(note).trim().slice(0, 1000),
          JSON.stringify({ fromVersion: Number(prior.current_version), toVersion: version })
        ]
      );
      await client.query('COMMIT');

      const project = await one(
        `SELECT id,owner_wallet,name,current_version,created_at,updated_at
         FROM projects WHERE id=$1 AND owner_wallet=$2`,
        [request.params.id, ownerWallet]
      );
      return {
        project,
        support: {
          founderWallet: request.user.wallet,
          ownerWallet,
          onchainAuthority: false,
          creatorSignatureStillRequired: true
        }
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/founder/projects/:owner/:projectId/assets/presign', { preHandler: authenticateFounder }, async (request, reply) => {
    const ownerWallet = normalizeWallet(request.params.owner);
    const { filename, contentType = 'application/octet-stream', size = 0, sha256 = '' } = request.body || {};
    const bytes = Number(size || 0);

    const project = await one('SELECT id FROM projects WHERE id=$1 AND owner_wallet=$2', [request.params.projectId, ownerWallet]);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    if (!filename || !allowedProjectType(contentType)) return reply.code(400).send({ error: 'Unsupported project asset type.' });
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > PROJECT_MAX_BYTES) {
      return reply.code(400).send({ error: 'Asset exceeds the 25 MB cloud upload limit.' });
    }

    if (sha256) {
      const existing = await one(
        `SELECT id,filename,content_type,size_bytes FROM assets
         WHERE owner_wallet=$1 AND project_id=$2 AND sha256=$3
           AND purpose='project' AND status='ready'
         ORDER BY created_at DESC LIMIT 1`,
        [ownerWallet, request.params.projectId, String(sha256).toLowerCase()]
      );
      if (existing) return { reused: true, asset: existing };
    }

    const id = crypto.randomUUID();
    const key = objectKey({ wallet: ownerWallet, purpose: 'project', filename });
    await db.query(
      `INSERT INTO assets(id,owner_wallet,project_id,object_key,filename,content_type,size_bytes,sha256,purpose)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'project')`,
      [
        id, ownerWallet, request.params.projectId, key, filename, contentType, bytes,
        sha256 ? String(sha256).toLowerCase() : null
      ]
    );
    return {
      reused: false,
      asset: { id, filename, contentType, size: bytes },
      uploadUrl: await presignPut(key, contentType, 900)
    };
  });

  app.post('/api/founder/projects/:owner/:projectId/assets/:assetId/complete', { preHandler: authenticateFounder }, async (request, reply) => {
    const ownerWallet = normalizeWallet(request.params.owner);
    const asset = await one(
      `SELECT id,object_key,size_bytes FROM assets
       WHERE id=$1 AND owner_wallet=$2 AND project_id=$3 AND purpose='project'`,
      [request.params.assetId, ownerWallet, request.params.projectId]
    );
    if (!asset) return reply.code(404).send({ error: 'Asset not found.' });

    try {
      const remote = await headObject(asset.object_key);
      if (Number(remote.ContentLength || 0) !== Number(asset.size_bytes || 0)) {
        return reply.code(400).send({ error: 'Uploaded asset size does not match the prepared upload.' });
      }
    } catch {
      return reply.code(400).send({ error: 'Uploaded object could not be verified in the Railway Bucket.' });
    }

    await db.query(
      `UPDATE assets SET status='ready',completed_at=now()
       WHERE id=$1 AND owner_wallet=$2 AND project_id=$3`,
      [request.params.assetId, ownerWallet, request.params.projectId]
    );
    return { ok: true };
  });

  app.get('/api/founder/projects/:owner/:projectId/assets/:assetId/url', { preHandler: authenticateFounder }, async (request, reply) => {
    const ownerWallet = normalizeWallet(request.params.owner);
    const asset = await one(
      `SELECT id,object_key,filename,content_type,size_bytes FROM assets
       WHERE id=$1 AND owner_wallet=$2 AND project_id=$3
         AND purpose='project' AND status='ready'`,
      [request.params.assetId, ownerWallet, request.params.projectId]
    );
    if (!asset) return reply.code(404).send({ error: 'Asset not found.' });
    return { asset, url: await presignGet(asset.object_key, 3600) };
  });

  app.get('/api/founder/support-audit', { preHandler: authenticateFounder }, async request => {
    const owner = request.query?.owner ? normalizeWallet(request.query.owner) : null;
    const projectId = request.query?.projectId ? String(request.query.projectId) : null;
    const values = [];
    const where = [];
    if (owner) { values.push(owner); where.push(`owner_wallet=$${values.length}`); }
    if (projectId) { values.push(projectId); where.push(`project_id=$${values.length}`); }

    const { rows } = await db.query(
      `SELECT id,founder_wallet,owner_wallet,project_id,action,note,metadata,created_at
       FROM founder_support_audit
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT 500`,
      values
    );
    return { entries: rows };
  });
}
