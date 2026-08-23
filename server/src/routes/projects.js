import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';

export default async function projectRoutes(app) {
  app.get('/api/projects', { preHandler: authenticate }, async request => {
    const { rows } = await db.query(
      `SELECT id,name,current_version,created_at,updated_at
       FROM projects WHERE owner_wallet=$1 ORDER BY updated_at DESC LIMIT 200`,
      [request.user.wallet]
    );
    return { projects: rows };
  });

  app.get('/api/projects/:id', { preHandler: authenticate }, async (request, reply) => {
    const project = await one(
      `SELECT id,name,current_version,snapshot,created_at,updated_at FROM projects WHERE id=$1 AND owner_wallet=$2`,
      [request.params.id, request.user.wallet]
    );
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    return { project };
  });

  app.put('/api/projects/:id', { preHandler: authenticate }, async (request, reply) => {
    const { name, snapshot } = request.body || {};
    if (!name || !snapshot || typeof snapshot !== 'object') return reply.code(400).send({ error: 'Project name and snapshot are required.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT current_version FROM projects WHERE id=$1 AND owner_wallet=$2 FOR UPDATE', [request.params.id, request.user.wallet]);
      if (!existing.rows.length) {
        await client.query(
          `INSERT INTO projects(id,owner_wallet,name,current_version,snapshot) VALUES($1,$2,$3,1,$4::jsonb)`,
          [request.params.id, request.user.wallet, String(name).slice(0, 180), JSON.stringify(snapshot)]
        );
        await client.query(`INSERT INTO project_versions(project_id,version,snapshot) VALUES($1,1,$2::jsonb)`, [request.params.id, JSON.stringify(snapshot)]);
      } else {
        const version = Number(existing.rows[0].current_version) + 1;
        const owned = await client.query(
          `UPDATE projects SET name=$3,current_version=$4,snapshot=$5::jsonb,updated_at=now()
           WHERE id=$1 AND owner_wallet=$2 RETURNING id`,
          [request.params.id, request.user.wallet, String(name).slice(0, 180), version, JSON.stringify(snapshot)]
        );
        if (!owned.rows.length) throw new Error('Project ownership mismatch.');
        await client.query(`INSERT INTO project_versions(project_id,version,snapshot) VALUES($1,$2,$3::jsonb)`, [request.params.id, version, JSON.stringify(snapshot)]);
      }
      await client.query('COMMIT');
      const project = await one(`SELECT id,name,current_version,created_at,updated_at FROM projects WHERE id=$1`, [request.params.id]);
      return { project };
    } catch (error) {
      await client.query('ROLLBACK');
      return reply.code(400).send({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.delete('/api/projects/:id', { preHandler: authenticate }, async (request, reply) => {
    const result = await db.query('DELETE FROM projects WHERE id=$1 AND owner_wallet=$2', [request.params.id, request.user.wallet]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Project not found.' });
    return { ok: true };
  });
}
