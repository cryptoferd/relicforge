import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import { deleteObjects } from '../lib/storage.js';
import { classifyProjectChanges } from '../lib/project-diff.js';

const PROJECT_LIMIT = Math.max(1, Number(process.env.PROJECT_LIMIT || 10));

function collectAssetIds(value, out = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (value.__relicforgeAsset && value.id) out.add(String(value.id));
  if (Array.isArray(value)) {
    for (const child of value) collectAssetIds(child, out);
  } else {
    for (const child of Object.values(value)) collectAssetIds(child, out);
  }
  return out;
}

async function protectedAssetIds(ownerWallet, excludeProjectId = null) {
  const values = [ownerWallet];
  let sql = 'SELECT id,snapshot FROM projects WHERE owner_wallet=$1';
  if (excludeProjectId) { values.push(excludeProjectId); sql += ' AND id<>$2'; }
  const { rows } = await db.query(sql, values);
  const ids = new Set();
  for (const row of rows) collectAssetIds(row.snapshot, ids);
  return ids;
}

async function cleanupAssets({ ownerWallet, projectId, candidateIds = new Set(), keepIds = new Set() }) {
  const { rows } = await db.query(
    `SELECT id,object_key,size_bytes FROM assets
     WHERE owner_wallet=$1 AND purpose='project' AND (project_id=$2 OR id = ANY($3::uuid[]))`,
    [ownerWallet, projectId, [...candidateIds]]
  );
  if (!rows.length) return { deletedAssets: 0, freedBytes: 0 };
  const elsewhere = await protectedAssetIds(ownerWallet, projectId);
  const deletable = rows.filter(row => !keepIds.has(String(row.id)) && !elsewhere.has(String(row.id)));
  if (!deletable.length) return { deletedAssets: 0, freedBytes: 0 };
  await deleteObjects(deletable.map(row => row.object_key));
  await db.query('DELETE FROM assets WHERE owner_wallet=$1 AND id = ANY($2::uuid[])', [ownerWallet, deletable.map(row => row.id)]);
  return {
    deletedAssets: deletable.length,
    freedBytes: deletable.reduce((sum, row) => sum + Number(row.size_bytes || 0), 0),
  };
}

export default async function projectRoutes(app) {
  app.get('/api/projects', { preHandler: authenticate }, async request => {
    const [{ rows }, countRow] = await Promise.all([
      db.query(
        `SELECT p.id,p.name,p.current_version,p.founder_support_enabled,p.founder_support_updated_at,p.created_at,p.updated_at,
                COALESCE((SELECT SUM(a.size_bytes) FROM assets a WHERE a.owner_wallet=p.owner_wallet AND a.project_id=p.id AND a.purpose='project' AND a.status='ready'),0)::bigint AS storage_bytes
         FROM projects p WHERE p.owner_wallet=$1 ORDER BY p.updated_at DESC LIMIT 200`,
        [request.user.wallet]
      ),
      one('SELECT COUNT(*)::int AS count FROM projects WHERE owner_wallet=$1', [request.user.wallet])
    ]);
    return { projects: rows, count: Number(countRow?.count || 0), limit: PROJECT_LIMIT };
  });

  app.get('/api/projects/:id', { preHandler: authenticate }, async (request, reply) => {
    const project = await one(
      `SELECT id,name,current_version,founder_support_enabled,founder_support_updated_at,snapshot,created_at,updated_at FROM projects WHERE id=$1 AND owner_wallet=$2`,
      [request.params.id, request.user.wallet]
    );
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    return { project };
  });

  app.put('/api/projects/:id', { preHandler: authenticate }, async (request, reply) => {
    const { name, snapshot } = request.body || {};
    if (!name || !snapshot || typeof snapshot !== 'object') return reply.code(400).send({ error: 'Project name and snapshot are required.' });
    const client = await db.connect();
    let created = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [request.user.wallet]);
      const existing = await client.query('SELECT current_version,snapshot FROM projects WHERE id=$1 AND owner_wallet=$2 FOR UPDATE', [request.params.id, request.user.wallet]);
      if (!existing.rows.length) {
        const countResult = await client.query('SELECT COUNT(*)::int AS count FROM projects WHERE owner_wallet=$1', [request.user.wallet]);
        const count = Number(countResult.rows[0]?.count || 0);
        if (count >= PROJECT_LIMIT) {
          const error = new Error(`Active cloud project limit reached (${PROJECT_LIMIT}). Download a backup and delete a project before creating another.`);
          error.statusCode = 409;
          throw error;
        }
        created = true;
        const changed = classifyProjectChanges(null, snapshot);
        await client.query(
          `INSERT INTO projects(id,owner_wallet,name,current_version,snapshot) VALUES($1,$2,$3,1,$4::jsonb)`,
          [request.params.id, request.user.wallet, String(name).slice(0, 180), JSON.stringify(snapshot)]
        );
        await client.query(
          `INSERT INTO project_versions(project_id,version,snapshot,actor_wallet,action,change_sections)
           VALUES($1,1,$2::jsonb,$3,'owner_save',$4::jsonb)`,
          [request.params.id, JSON.stringify(snapshot), request.user.wallet, JSON.stringify(changed)]
        );
      } else {
        const version = Number(existing.rows[0].current_version) + 1;
        const changed = classifyProjectChanges(existing.rows[0].snapshot, snapshot);
        const owned = await client.query(
          `UPDATE projects SET name=$3,current_version=$4,snapshot=$5::jsonb,updated_at=now()
           WHERE id=$1 AND owner_wallet=$2 RETURNING id`,
          [request.params.id, request.user.wallet, String(name).slice(0, 180), version, JSON.stringify(snapshot)]
        );
        if (!owned.rows.length) throw new Error('Project ownership mismatch.');
        await client.query(
          `INSERT INTO project_versions(project_id,version,snapshot,actor_wallet,action,change_sections)
           VALUES($1,$2,$3::jsonb,$4,'owner_save',$5::jsonb)`,
          [request.params.id, version, JSON.stringify(snapshot), request.user.wallet, JSON.stringify(changed)]
        );
      }
      await client.query('COMMIT');
      const project = await one(`SELECT id,name,current_version,created_at,updated_at FROM projects WHERE id=$1`, [request.params.id]);

      // RC4.7B intentionally does NOT delete artwork that disappeared from the latest
      // snapshot. Historical project_versions remain rollback-capable, so their asset
      // markers must stay valid. Full project deletion still removes project assets.
      return { project, limit: PROJECT_LIMIT, deletedAssets: 0, freedBytes: 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      if (created || error.statusCode === 409) {
        try { await cleanupAssets({ ownerWallet: request.user.wallet, projectId: request.params.id, candidateIds: new Set(), keepIds: new Set() }); } catch (_) {}
      }
      return reply.code(error.statusCode || 400).send({ error: error.message, limit: PROJECT_LIMIT });
    } finally {
      client.release();
    }
  });

  app.put('/api/projects/:id/founder-support', { preHandler: authenticate }, async (request, reply) => {
    const enabled = request.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled must be true or false.' });
    }
    const { rows } = await db.query(
      `UPDATE projects
       SET founder_support_enabled=$3,founder_support_updated_at=now(),updated_at=now()
       WHERE id=$1 AND owner_wallet=$2
       RETURNING id,name,founder_support_enabled,founder_support_updated_at`,
      [request.params.id, request.user.wallet, enabled]
    );
    if (!rows.length) return reply.code(404).send({ error: 'Project not found.' });
    return { project: rows[0] };
  });

  app.delete('/api/projects/:id', { preHandler: authenticate }, async (request, reply) => {
    const project = await one('SELECT id,name,snapshot FROM projects WHERE id=$1 AND owner_wallet=$2', [request.params.id, request.user.wallet]);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    const projectRefs = collectAssetIds(project.snapshot);
    let cleanup = { deletedAssets: 0, freedBytes: 0 };
    try {
      // Selecting by project_id removes every historical project asset, not merely
      // those still referenced by the latest snapshot.
      cleanup = await cleanupAssets({ ownerWallet: request.user.wallet, projectId: request.params.id, candidateIds: projectRefs, keepIds: new Set() });
    } catch (error) {
      request.log.error({ err: error, projectId: request.params.id }, 'Could not free project bucket objects');
      return reply.code(502).send({ error: 'Project was not deleted because its Railway Bucket artwork could not be removed safely. Try again.' });
    }
    const result = await db.query('DELETE FROM projects WHERE id=$1 AND owner_wallet=$2', [request.params.id, request.user.wallet]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Project not found.' });
    return { ok: true, ...cleanup, limit: PROJECT_LIMIT };
  });
}
