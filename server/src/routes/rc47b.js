import crypto from 'node:crypto';
import { getAddress, ZeroHash } from 'ethers';
import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import { collectionFor, verifyCollectionOwner } from '../lib/rpc.js';
import { getBuffer, objectKey, putBuffer } from '../lib/storage.js';
import {
  classifyProjectChanges,
  protectedDeploymentBindingsChanged,
  validPermissionIds,
  COLLAB_PERMISSION_IDS,
} from '../lib/project-diff.js';

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MINT_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const ZERO = String(ZeroHash).toLowerCase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function wallet(value) {
  return getAddress(String(value || '')).toLowerCase();
}

function uuid(value) {
  return UUID_RE.test(String(value || '')) ? String(value) : null;
}

function cleanNote(value, required = false) {
  const note = String(value || '').trim().slice(0, 1000);
  if (required && !note) throw Object.assign(new Error('A short change note is required for collaborator saves.'), { statusCode: 400 });
  return note || null;
}

function publicAssetPath(id) {
  return id ? `/api/public/assets/${encodeURIComponent(id)}` : null;
}

async function accessFor(projectId, requester) {
  const project = await one(
    `SELECT id,owner_wallet,name,current_version,snapshot,created_at,updated_at
     FROM projects WHERE id=$1`,
    [projectId]
  );
  if (!project) return null;
  const owner = String(project.owner_wallet).toLowerCase();
  if (owner === String(requester).toLowerCase()) {
    return { project, role: 'owner', permissions: [...COLLAB_PERMISSION_IDS] };
  }
  const collab = await one(
    `SELECT wallet,permissions,created_at,updated_at
     FROM project_collaborators WHERE project_id=$1 AND wallet=$2`,
    [projectId, String(requester).toLowerCase()]
  );
  if (!collab) return null;
  return { project, role: 'collaborator', permissions: validPermissionIds(collab.permissions || []) };
}

function requireOwner(access) {
  if (!access || access.role !== 'owner') throw Object.assign(new Error('Only the project creator can perform this action.'), { statusCode: 403 });
}

function requirePermission(access, permission) {
  if (!access) throw Object.assign(new Error('Shared project access is not available.'), { statusCode: 404 });
  if (access.role === 'owner') return;
  if (!access.permissions.includes(permission)) {
    throw Object.assign(new Error(`This collaborator does not have ${permission} permission.`), { statusCode: 403 });
  }
}

async function actorCanPublishProject(projectId, requester, contractAddress, permission) {
  if (!projectId) return false;
  const access = await accessFor(projectId, requester);
  if (!access) return false;
  requirePermission(access, permission);
  const bound = String(access.project.snapshot?.forge?.collectionAddress || '').toLowerCase();
  return bound && bound === String(contractAddress).toLowerCase();
}

async function authorizeCollectionAction({ chainId, contractAddress, requester, projectId, permission }) {
  const creator = String(await verifyCollectionOwner(chainId, contractAddress, requester).catch(() => '')).toLowerCase();
  if (creator && creator === String(requester).toLowerCase()) return { creator, role: 'creator' };

  // For collaborators, prove the collection's real creator first and require the
  // shared project's owner/binding to match that creator + collection.
  const contract = collectionFor(chainId, contractAddress);
  let onchainCreator;
  try { onchainCreator = String(await contract.creator()).toLowerCase(); }
  catch { return null; }
  const allowed = await actorCanPublishProject(projectId, requester, contractAddress, permission);
  if (!allowed) return null;
  const project = await one('SELECT owner_wallet FROM projects WHERE id=$1', [projectId]);
  if (!project || String(project.owner_wallet).toLowerCase() !== onchainCreator) return null;
  return { creator: onchainCreator, role: 'collaborator' };
}

function phaseJson(phaseId, phase, open = false) {
  if (!phaseId || !phase) return null;
  return {
    id: Number(phaseId),
    price: String(phase.price ?? phase[0] ?? 0n),
    startTime: Number(phase.startTime ?? phase[1] ?? 0n),
    endTime: Number(phase.endTime ?? phase[2] ?? 0n),
    phaseSupply: Number(phase.phaseSupply ?? phase[3] ?? 0n),
    minted: Number(phase.minted ?? phase[4] ?? 0n),
    maxPerWallet: Number(phase.maxPerWallet ?? phase[5] ?? 0n),
    merkleRoot: String(phase.merkleRoot ?? phase[6] ?? ZeroHash),
    accessType: Number(phase.accessType ?? phase[7] ?? 0n),
    priority: Number(phase.priority ?? phase[8] ?? 0n),
    enabled: Boolean(phase.enabled ?? phase[9] ?? false),
    open: Boolean(open),
  };
}

async function readConfiguredPhase(contract, phaseId) {
  const id = Number(phaseId || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  const count = Number(await contract.phaseCount());
  if (!Number.isInteger(count) || id > count) throw new Error(`V1 phase ${id} does not exist (phaseCount=${count}).`);
  const [phase, open] = await Promise.all([contract.phases(id), contract.phaseIsOpen(id)]);
  return phaseJson(id, phase, open);
}

function imageType(contentType) {
  return String(contentType || '').toLowerCase().startsWith('image/');
}

export default async function rc47bRoutes(app) {
  // ---------------- Collaboration dashboard ----------------
  app.get('/api/rc47b/collab/projects', { preHandler: authenticate }, async request => {
    const requester = String(request.user.wallet).toLowerCase();
    const { rows } = await db.query(
      `SELECT p.id,p.owner_wallet,p.name,p.current_version,p.created_at,p.updated_at,
              CASE WHEN p.owner_wallet=$1 THEN 'owner' ELSE 'collaborator' END AS role,
              CASE WHEN p.owner_wallet=$1 THEN $2::jsonb ELSE pc.permissions END AS permissions
       FROM projects p
       LEFT JOIN project_collaborators pc ON pc.project_id=p.id AND pc.wallet=$1
       WHERE p.owner_wallet=$1 OR pc.wallet=$1
       ORDER BY p.updated_at DESC LIMIT 300`,
      [requester, JSON.stringify(COLLAB_PERMISSION_IDS)]
    );
    return { projects: rows.map(row => ({ ...row, permissions: validPermissionIds(row.permissions || []) })) };
  });

  app.get('/api/rc47b/collab/projects/:id', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    if (!id) return reply.code(400).send({ error: 'Invalid project id.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Shared project not found.' });
    return {
      project: access.project,
      role: access.role,
      permissions: access.permissions,
      permissionCatalog: COLLAB_PERMISSION_IDS,
    };
  });

  app.get('/api/rc47b/collab/projects/:id/collaborators', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    if (!id) return reply.code(400).send({ error: 'Invalid project id.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Project not found.' });
    try { requireOwner(access); } catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
    const { rows } = await db.query(
      `SELECT wallet,permissions,invited_by,created_at,updated_at
       FROM project_collaborators WHERE project_id=$1 ORDER BY created_at ASC`,
      [id]
    );
    return { collaborators: rows.map(row => ({ ...row, permissions: validPermissionIds(row.permissions || []) })) };
  });

  app.put('/api/rc47b/collab/projects/:id/collaborators/:wallet', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    if (!id) return reply.code(400).send({ error: 'Invalid project id.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Project not found.' });
    try { requireOwner(access); } catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
    let collaborator;
    try { collaborator = wallet(request.params.wallet); }
    catch { return reply.code(400).send({ error: 'Collaborator wallet is invalid.' }); }
    if (collaborator === String(access.project.owner_wallet).toLowerCase()) return reply.code(400).send({ error: 'The creator already has full project access.' });
    const supplied = request.body?.permissions;
    const permissions = validPermissionIds(supplied || []);
    if (!Array.isArray(supplied) || permissions.length !== new Set(supplied.map(String)).size) {
      return reply.code(400).send({ error: 'One or more collaborator permissions are invalid.' });
    }
    const result = await one(
      `INSERT INTO project_collaborators(project_id,wallet,permissions,invited_by)
       VALUES($1,$2,$3::jsonb,$4)
       ON CONFLICT(project_id,wallet) DO UPDATE
       SET permissions=EXCLUDED.permissions,invited_by=EXCLUDED.invited_by,updated_at=now()
       RETURNING wallet,permissions,invited_by,created_at,updated_at`,
      [id, collaborator, JSON.stringify(permissions), request.user.wallet]
    );
    return { collaborator: { ...result, permissions } };
  });

  app.delete('/api/rc47b/collab/projects/:id/collaborators/:wallet', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    if (!id) return reply.code(400).send({ error: 'Invalid project id.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Project not found.' });
    try { requireOwner(access); } catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
    let collaborator;
    try { collaborator = wallet(request.params.wallet); }
    catch { return reply.code(400).send({ error: 'Collaborator wallet is invalid.' }); }
    await db.query('DELETE FROM project_collaborators WHERE project_id=$1 AND wallet=$2', [id, collaborator]);
    return { ok: true };
  });

  app.get('/api/rc47b/collab/projects/:id/versions', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    if (!id) return reply.code(400).send({ error: 'Invalid project id.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Shared project not found.' });
    const { rows } = await db.query(
      `SELECT version,actor_wallet,action,note,change_sections,created_at
       FROM project_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 500`,
      [id]
    );
    return { versions: rows };
  });

  app.post('/api/rc47b/collab/projects/:id/versions', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    if (!id) return reply.code(400).send({ error: 'Invalid project id.' });
    const { name, snapshot } = request.body || {};
    if (!snapshot || typeof snapshot !== 'object') return reply.code(400).send({ error: 'Project snapshot is required.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Shared project not found.' });

    const changed = classifyProjectChanges(access.project.snapshot, snapshot);
    if (access.role === 'collaborator') {
      if (protectedDeploymentBindingsChanged(access.project.snapshot, snapshot)) {
        return reply.code(403).send({ error: 'Collaborators cannot change deployed collection/data addresses or bound phase IDs.' });
      }
      const denied = changed.filter(section => !access.permissions.includes(section));
      if (denied.length) return reply.code(403).send({ error: `Save rejected. This wallet cannot change: ${denied.join(', ')}.`, deniedSections: denied });
    }

    let note;
    try { note = cleanNote(request.body?.note, access.role === 'collaborator'); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT current_version,snapshot,name FROM projects WHERE id=$1 FOR UPDATE', [id]);
      if (!locked.rows.length) throw Object.assign(new Error('Project not found.'), { statusCode: 404 });
      const latest = locked.rows[0];
      // Recompute against the locked latest version so two collaborators cannot bypass
      // permission checks by saving against a stale snapshot. Re-read collaborator
      // permissions inside the same transaction so a creator revocation wins even if
      // it races an already-open Shared Studio tab.
      const finalChanged = classifyProjectChanges(latest.snapshot, snapshot);
      if (access.role === 'collaborator') {
        const live = await client.query(
          'SELECT permissions FROM project_collaborators WHERE project_id=$1 AND wallet=$2 FOR SHARE',
          [id, String(request.user.wallet).toLowerCase()]
        );
        if (!live.rows.length) throw Object.assign(new Error('Collaboration access was revoked before this save completed.'), { statusCode: 403 });
        const livePermissions = validPermissionIds(live.rows[0].permissions || []);
        if (protectedDeploymentBindingsChanged(latest.snapshot, snapshot)) throw Object.assign(new Error('Collaborators cannot change protected deployment binding fields.'), { statusCode: 403 });
        const denied = finalChanged.filter(section => !livePermissions.includes(section));
        if (denied.length) throw Object.assign(new Error(`Save rejected. This wallet cannot change: ${denied.join(', ')}.`), { statusCode: 403 });
      }
      const version = Number(latest.current_version) + 1;
      const snapshotName = String(snapshot?.studio?.ui?.collectionName || '').trim();
      // The project display name is derived from the snapshot whenever possible, so a
      // collaborator cannot smuggle an unclassified rename through the outer request.
      const nextName = String(snapshotName || name || latest.name || 'Untitled Collection').slice(0, 180);
      await client.query(
        `UPDATE projects SET name=$2,current_version=$3,snapshot=$4::jsonb,updated_at=now() WHERE id=$1`,
        [id, nextName, version, JSON.stringify(snapshot)]
      );
      await client.query(
        `INSERT INTO project_versions(project_id,version,snapshot,actor_wallet,action,note,change_sections)
         VALUES($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb)`,
        [id, version, JSON.stringify(snapshot), request.user.wallet, access.role === 'owner' ? 'owner_save' : 'collaborator_save', note, JSON.stringify(finalChanged)]
      );
      await client.query('COMMIT');
      return { ok: true, version, role: access.role, changeSections: finalChanged };
    } catch (error) {
      await client.query('ROLLBACK');
      return reply.code(error.statusCode || 400).send({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/rc47b/collab/projects/:id/rollback/:version', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    const targetVersion = Number(request.params.version);
    if (!id || !Number.isInteger(targetVersion) || targetVersion < 1) return reply.code(400).send({ error: 'Invalid rollback target.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Project not found.' });
    try { requireOwner(access); } catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
    const old = await one('SELECT version,snapshot FROM project_versions WHERE project_id=$1 AND version=$2', [id, targetVersion]);
    if (!old) return reply.code(404).send({ error: 'Historical project version not found.' });
    const note = cleanNote(request.body?.note || `Restore version ${targetVersion}`);
    const changed = classifyProjectChanges(access.project.snapshot, old.snapshot);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT current_version FROM projects WHERE id=$1 FOR UPDATE', [id]);
      if (!locked.rows.length) throw Object.assign(new Error('Project not found.'), { statusCode: 404 });
      const version = Number(locked.rows[0].current_version) + 1;
      await client.query('UPDATE projects SET current_version=$2,snapshot=$3::jsonb,updated_at=now() WHERE id=$1', [id, version, JSON.stringify(old.snapshot)]);
      await client.query(
        `INSERT INTO project_versions(project_id,version,snapshot,actor_wallet,action,note,change_sections)
         VALUES($1,$2,$3::jsonb,$4,'rollback',$5,$6::jsonb)`,
        [id, version, JSON.stringify(old.snapshot), request.user.wallet, note, JSON.stringify(changed)]
      );
      await client.query('COMMIT');
      return { ok: true, restoredVersion: targetVersion, version, changeSections: changed };
    } catch (error) {
      await client.query('ROLLBACK');
      return reply.code(error.statusCode || 400).send({ error: error.message });
    } finally { client.release(); }
  });

  // ---------------- Shared-project asset proxy ----------------
  app.post('/api/rc47b/collab/projects/:id/assets/prepare', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    if (!id) return reply.code(400).send({ error: 'Invalid project id.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Shared project not found.' });
    const { filename, contentType = 'application/octet-stream', size = 0, sha256 = '', section = 'artwork' } = request.body || {};
    if (!['artwork', 'launch', 'mint_page'].includes(section)) return reply.code(400).send({ error: 'Invalid asset section.' });
    try { requirePermission(access, section); } catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
    const bytes = Number(size || 0);
    const max = section === 'mint_page' ? MINT_PAGE_MAX_BYTES : MAX_ASSET_BYTES;
    if (!filename || !Number.isFinite(bytes) || bytes < 0 || bytes > max) return reply.code(400).send({ error: `Asset exceeds the ${Math.round(max / 1024 / 1024)} MB limit.` });
    if (section === 'mint_page' && !imageType(contentType)) return reply.code(400).send({ error: 'Mint-page media must be an image.' });
    const assetPurpose = section === 'mint_page' ? 'mint-page' : 'project';
    if (sha256) {
      const existing = await one(
        `SELECT id,filename,content_type,size_bytes,sha256 FROM assets
         WHERE project_id=$1 AND owner_wallet=$2 AND sha256=$3 AND purpose=$4 AND status='ready'
         ORDER BY created_at DESC LIMIT 1`,
        [id, access.project.owner_wallet, String(sha256).toLowerCase(), assetPurpose]
      );
      if (existing) return { reused: true, asset: existing };
    }
    const assetId = crypto.randomUUID();
    const key = objectKey({ wallet: access.project.owner_wallet, purpose: assetPurpose, filename });
    await db.query(
      `INSERT INTO assets(id,owner_wallet,project_id,object_key,filename,content_type,size_bytes,sha256,purpose,collab_section)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [assetId, access.project.owner_wallet, id, key, String(filename).slice(-180), String(contentType).slice(0, 180), bytes, sha256 ? String(sha256).toLowerCase() : null, assetPurpose, section]
    );
    return { reused: false, asset: { id: assetId, filename, contentType, size: bytes, sha256 } };
  });

  app.put('/api/rc47b/collab/projects/:id/assets/:assetId/upload', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    const assetId = uuid(request.params.assetId);
    if (!id || !assetId) return reply.code(400).send({ error: 'Invalid project or asset id.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Shared project not found.' });
    const asset = await one(
      `SELECT id,object_key,size_bytes,content_type,status,purpose,collab_section FROM assets
       WHERE id=$1 AND project_id=$2 AND owner_wallet=$3 AND purpose IN ('project','mint-page')`,
      [assetId, id, access.project.owner_wallet]
    );
    if (!asset) return reply.code(404).send({ error: 'Project asset not found.' });
    try { requirePermission(access, asset.purpose === 'mint-page' ? 'mint_page' : (asset.collab_section === 'launch' ? 'launch' : 'artwork')); }
    catch (error) { return reply.code(error.statusCode).send({ error: error.message }); }
    if (asset.status === 'ready') return { ok: true, reused: true };
    if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: 'Binary artwork payload is required.' });
    if (request.body.length !== Number(asset.size_bytes)) return reply.code(400).send({ error: 'Uploaded asset size does not match the prepared asset.' });
    await putBuffer(asset.object_key, request.body, asset.content_type || 'application/octet-stream', 'private, no-store');
    await db.query('UPDATE assets SET status=$2,completed_at=now() WHERE id=$1', [assetId, 'ready']);
    return { ok: true };
  });

  app.get('/api/rc47b/collab/projects/:id/assets/:assetId/download', { preHandler: authenticate }, async (request, reply) => {
    const id = uuid(request.params.id);
    const assetId = uuid(request.params.assetId);
    if (!id || !assetId) return reply.code(400).send({ error: 'Invalid project or asset id.' });
    const access = await accessFor(id, request.user.wallet);
    if (!access) return reply.code(404).send({ error: 'Shared project not found.' });
    const asset = await one(
      `SELECT id,object_key,filename,content_type,size_bytes FROM assets
       WHERE id=$1 AND project_id=$2 AND owner_wallet=$3 AND purpose IN ('project','mint-page') AND status='ready'`,
      [assetId, id, access.project.owner_wallet]
    );
    if (!asset) return reply.code(404).send({ error: 'Project asset not found.' });
    const body = await getBuffer(asset.object_key);
    reply.type(asset.content_type || 'application/octet-stream').header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff');
    return reply.send(body);
  });

  // ---------------- Canonical V1 mint-page publication ----------------
  app.put('/api/rc47b/collections/:chainId/:contract/mint-page', { preHandler: authenticate }, async (request, reply) => {
    const chainId = Number(request.params.chainId);
    let contractAddress;
    try { contractAddress = getAddress(request.params.contract); }
    catch { return reply.code(400).send({ error: 'Invalid collection address.' }); }
    const config = request.body?.config;
    const projectId = uuid(request.body?.projectId) || null;
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !config || typeof config !== 'object') return reply.code(400).send({ error: 'chainId, contract and mint-page config are required.' });
    if (config.schema !== 'relic-forge/mint-page@2') return reply.code(400).send({ error: 'RC4.7B requires relic-forge/mint-page@2.' });

    const auth = await authorizeCollectionAction({ chainId, contractAddress, requester: request.user.wallet, projectId, permission: 'mint_page' });
    if (!auth) return reply.code(403).send({ error: 'Connected wallet is not authorized to publish this collection mint page.' });

    const contract = collectionFor(chainId, contractAddress);
    let publicPhase = null, whitelistPhase = null;
    try {
      publicPhase = await readConfiguredPhase(contract, config.publicPhaseId);
      whitelistPhase = await readConfiguredPhase(contract, config.whitelistPhaseId);
    } catch (error) {
      return reply.code(400).send({ error: `Configured V1 mint phase could not be verified: ${error.shortMessage || error.message}` });
    }
    if (publicPhase && publicPhase.accessType !== 0) return reply.code(400).send({ error: 'Configured publicPhaseId is not a public V1 phase.' });
    if (whitelistPhase && whitelistPhase.accessType !== 1) return reply.code(400).send({ error: 'Configured whitelistPhaseId is not a Merkle V1 phase.' });

    // Prefer canonical onchain phase timing whenever a published phase has an
    // explicit start. This keeps discovery synchronized with the actual mint gate
    // even if an older client supplied a stale/manual showcase timestamp.
    const scheduledStarts = [publicPhase?.startTime, whitelistPhase?.startTime]
      .map(Number).filter(value => Number.isFinite(value) && value > 0);
    let showcaseStart = scheduledStarts.length
      ? new Date(Math.min(...scheduledStarts) * 1000).toISOString()
      : null;
    if (!showcaseStart && config.showcaseStart) {
      const parsedStart = new Date(config.showcaseStart);
      if (!Number.isFinite(parsedStart.getTime())) return reply.code(400).send({ error: 'Upcoming Mints requires a valid mint start date/time.' });
      showcaseStart = parsedStart.toISOString();
    }
    const sanitized = {
      schema: 'relic-forge/mint-page@2',
      chainId,
      contract: contractAddress,
      title: String(config.title || config.collectionTitle || '').slice(0, 180),
      description: String(config.description || config.collectionDescription || '').slice(0, 3000),
      publicPhaseId: publicPhase?.id || null,
      whitelistPhaseId: whitelistPhase?.id || null,
      collectionImageAssetId: config.collectionImageAssetId || null,
      bannerImageAssetId: config.bannerImageAssetId || null,
      showcaseEnabled: Boolean(config.showcaseEnabled),
      showcaseStart,
      updatedAt: new Date().toISOString(),
    };
    if (sanitized.showcaseEnabled && !sanitized.showcaseStart) return reply.code(400).send({ error: 'Upcoming Mints requires a mint start date/time.' });
    if (sanitized.collectionImageAssetId) {
      const image = await one(`SELECT id FROM assets WHERE id=$1 AND owner_wallet=$2 AND purpose='mint-page' AND status='ready'`, [sanitized.collectionImageAssetId, auth.creator]);
      if (!image) return reply.code(400).send({ error: 'Collection image asset is unavailable for this creator.' });
    }
    if (sanitized.bannerImageAssetId) {
      const banner = await one(`SELECT id FROM assets WHERE id=$1 AND owner_wallet=$2 AND purpose='mint-page' AND status='ready'`, [sanitized.bannerImageAssetId, auth.creator]);
      if (!banner) return reply.code(400).send({ error: 'Banner asset is unavailable for this creator.' });
    }
    await db.query(
      `INSERT INTO collections(chain_id,contract_address,owner_wallet,project_id,mint_page)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(chain_id,contract_address) DO UPDATE
       SET owner_wallet=EXCLUDED.owner_wallet,project_id=COALESCE(EXCLUDED.project_id,collections.project_id),mint_page=EXCLUDED.mint_page,updated_at=now()`,
      [chainId, contractAddress.toLowerCase(), auth.creator, projectId, JSON.stringify(sanitized)]
    );
    return { ok: true, config: sanitized, publicPhase, whitelistPhase };
  });

  app.put('/api/rc47b/collections/:chainId/:contract/whitelist/:phaseId', { preHandler: authenticate }, async (request, reply) => {
    const chainId = Number(request.params.chainId);
    const phaseId = Number(request.params.phaseId);
    let contractAddress;
    try { contractAddress = getAddress(request.params.contract); }
    catch { return reply.code(400).send({ error: 'Invalid collection address.' }); }
    if (!Number.isInteger(phaseId) || phaseId <= 0) return reply.code(400).send({ error: 'Invalid whitelist phase id.' });
    const projectId = uuid(request.body?.projectId) || null;
    const auth = await authorizeCollectionAction({ chainId, contractAddress, requester: request.user.wallet, projectId, permission: 'launch' });
    if (!auth) return reply.code(403).send({ error: 'Connected wallet is not authorized to publish this V1 whitelist.' });
    const contract = collectionFor(chainId, contractAddress);
    let phase;
    try { phase = await readConfiguredPhase(contract, phaseId); }
    catch (error) { return reply.code(400).send({ error: `Whitelist phase could not be read: ${error.shortMessage || error.message}` }); }
    if (!phase || phase.accessType !== 1) return reply.code(400).send({ error: 'The configured phase is not a Merkle whitelist phase.' });
    const root = String(request.body?.merkleRoot || '').toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(root) || root === ZERO || root !== String(phase.merkleRoot).toLowerCase()) return reply.code(400).send({ error: 'Published whitelist root does not match the canonical V1 phase root.' });
    const entries = Array.isArray(request.body?.entries) ? request.body.entries : [];
    const normalized = [];
    try {
      for (const row of entries) {
        const address = wallet(row.address);
        const allowance = Number(row.allowance || 0);
        const proof = Array.isArray(row.proof) ? row.proof.map(String) : [];
        if (!Number.isInteger(allowance) || allowance < 1 || allowance > 4294967295) throw new Error('Invalid whitelist allowance.');
        if (proof.some(item => !/^0x[0-9a-fA-F]{64}$/.test(item))) throw new Error('Invalid whitelist proof.');
        normalized.push({ address, allowance, proof });
      }
    } catch (error) { return reply.code(400).send({ error: error.message }); }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO whitelists(chain_id,contract_address,merkle_root,phase_id,source_type,source_chain_id,source_contract,snapshot_block)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(chain_id,contract_address) DO UPDATE
         SET merkle_root=EXCLUDED.merkle_root,phase_id=EXCLUDED.phase_id,source_type=EXCLUDED.source_type,source_chain_id=EXCLUDED.source_chain_id,source_contract=EXCLUDED.source_contract,snapshot_block=EXCLUDED.snapshot_block,updated_at=now()`,
        [chainId, contractAddress.toLowerCase(), root, phaseId, Number(request.body?.sourceType || 0), Number(request.body?.sourceChainId || 0), request.body?.sourceContract || null, Number(request.body?.snapshotBlock || 0)]
      );
      await client.query('DELETE FROM whitelist_entries WHERE chain_id=$1 AND contract_address=$2', [chainId, contractAddress.toLowerCase()]);
      for (let i = 0; i < normalized.length; i += 500) {
        const batch = normalized.slice(i, i + 500);
        if (!batch.length) continue;
        const values = [];
        const params = [];
        batch.forEach((row, j) => {
          const base = j * 6;
          values.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6}::jsonb)`);
          params.push(chainId, contractAddress.toLowerCase(), phaseId, row.address, row.allowance, JSON.stringify(row.proof));
        });
        await client.query(`INSERT INTO whitelist_entries(chain_id,contract_address,phase_id,wallet,allowance,proof) VALUES ${values.join(',')}`, params);
      }
      await client.query('COMMIT');
      return { ok: true, phaseId, count: normalized.length, merkleRoot: root };
    } catch (error) {
      await client.query('ROLLBACK');
      return reply.code(400).send({ error: error.message });
    } finally { client.release(); }
  });

  // ---------------- Public V1 mint adapter API ----------------
  app.get('/api/rc47b/public/mint/:chainId/:contract/state', async (request, reply) => {
    const chainId = Number(request.params.chainId);
    let contractAddress;
    try { contractAddress = getAddress(request.params.contract); }
    catch { return reply.code(400).send({ error: 'Invalid collection address.' }); }
    const row = await one('SELECT mint_page FROM collections WHERE chain_id=$1 AND contract_address=$2', [chainId, contractAddress.toLowerCase()]);
    if (!row?.mint_page || row.mint_page.schema !== 'relic-forge/mint-page@2') return reply.code(404).send({ error: 'V1 mint page not published.' });
    const c = collectionFor(chainId, contractAddress);
    try {
      const [name, description, creator, controller, maxSupply, totalMinted, masterMintEnabled, futureRevealMode, publicPhase, whitelistPhase] = await Promise.all([
        c.name(), c.description(), c.creator(), c.controller(), c.maxSupply(), c.totalMinted(), c.masterMintEnabled(), c.futureRevealMode(),
        readConfiguredPhase(c, row.mint_page.publicPhaseId), readConfiguredPhase(c, row.mint_page.whitelistPhaseId),
      ]);
      return {
        schema: 'relic-forge/v1-mint-state@1', chainId, contract: contractAddress,
        name, description, creator, controller, maxSupply: Number(maxSupply), totalMinted: Number(totalMinted),
        masterMintEnabled: Boolean(masterMintEnabled), futureRevealMode: Number(futureRevealMode), publicPhase, whitelistPhase,
      };
    } catch (error) {
      return reply.code(502).send({ error: `Could not read canonical V1 mint state: ${error.shortMessage || error.message}` });
    }
  });

  app.get('/api/rc47b/public/mint/:chainId/:contract/wallet/:wallet', async (request, reply) => {
    const chainId = Number(request.params.chainId);
    let contractAddress, holder;
    try { contractAddress = getAddress(request.params.contract); holder = getAddress(request.params.wallet); }
    catch { return reply.code(400).send({ error: 'Invalid collection or wallet address.' }); }
    const row = await one('SELECT mint_page FROM collections WHERE chain_id=$1 AND contract_address=$2', [chainId, contractAddress.toLowerCase()]);
    if (!row?.mint_page || row.mint_page.schema !== 'relic-forge/mint-page@2') return reply.code(404).send({ error: 'V1 mint page not published.' });
    const c = collectionFor(chainId, contractAddress);
    const result = { wallet: holder, publicMinted: 0, whitelistMinted: 0 };
    if (row.mint_page.publicPhaseId) result.publicMinted = Number(await c.phaseWalletMinted(Number(row.mint_page.publicPhaseId), holder));
    if (row.mint_page.whitelistPhaseId) result.whitelistMinted = Number(await c.phaseWalletMinted(Number(row.mint_page.whitelistPhaseId), holder));
    return result;
  });

  app.get('/api/rc47b/public/mint/:chainId/:contract/quote/:phaseId/:qty', async (request, reply) => {
    const chainId = Number(request.params.chainId), phaseId = Number(request.params.phaseId), qty = Number(request.params.qty);
    let contractAddress;
    try { contractAddress = getAddress(request.params.contract); }
    catch { return reply.code(400).send({ error: 'Invalid collection address.' }); }
    if (!Number.isInteger(phaseId) || phaseId <= 0 || !Number.isInteger(qty) || qty < 1 || qty > 50) return reply.code(400).send({ error: 'Invalid mint quote request.' });
    const c = collectionFor(chainId, contractAddress);
    try {
      const quote = await c.quoteMint(phaseId, qty);
      return {
        creatorPrice: String(quote.creatorPrice ?? quote[0]),
        platformFeeWei: String(quote.platformFeeWei ?? quote[1]),
        minimumValue: String(quote.minimumValue ?? quote[2]),
        oracleHealthy: Boolean(quote.oracleHealthy ?? quote[3]),
        feeActive: Boolean(quote.feeActive ?? quote[4]),
      };
    } catch (error) { return reply.code(400).send({ error: error.shortMessage || error.message }); }
  });

  app.get('/api/rc47b/public/mint/:chainId/:contract/whitelist/:wallet', async (request, reply) => {
    const chainId = Number(request.params.chainId);
    let contractAddress, holder;
    try { contractAddress = getAddress(request.params.contract); holder = getAddress(request.params.wallet).toLowerCase(); }
    catch { return reply.code(400).send({ error: 'Invalid collection or wallet address.' }); }
    const row = await one(
      `SELECT w.merkle_root,w.phase_id,e.allowance,e.proof
       FROM whitelists w LEFT JOIN whitelist_entries e
       ON e.chain_id=w.chain_id AND e.contract_address=w.contract_address AND e.phase_id=w.phase_id AND e.wallet=$3
       WHERE w.chain_id=$1 AND w.contract_address=$2`,
      [chainId, contractAddress.toLowerCase(), holder]
    );
    if (!row) return reply.code(404).send({ error: 'Whitelist not published.' });
    return { merkleRoot: row.merkle_root, phaseId: Number(row.phase_id || 0), entry: row.allowance ? { allowance: Number(row.allowance), proof: row.proof || [] } : null };
  });

  // ---------------- Public discovery ----------------
  app.get('/api/rc47b/upcoming', async (request, reply) => {
    reply.header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    const { rows } = await db.query(
      `SELECT chain_id,contract_address,mint_page,updated_at
       FROM collections
       WHERE mint_page->>'schema'='relic-forge/mint-page@2'
         AND mint_page->'showcaseEnabled'='true'::jsonb
         AND NULLIF(mint_page->>'showcaseStart','') IS NOT NULL
         AND (mint_page->>'showcaseStart')::timestamptz >= now() - interval '24 hours'
       ORDER BY CASE WHEN (mint_page->>'showcaseStart')::timestamptz >= now() THEN 0 ELSE 1 END,
                (mint_page->>'showcaseStart')::timestamptz ASC
       LIMIT 60`
    );
    return {
      generatedAt: new Date().toISOString(),
      mints: rows.map(row => ({
        chainId: Number(row.chain_id),
        contract: row.contract_address,
        title: row.mint_page.title || 'Untitled Collection',
        description: row.mint_page.description || '',
        start: row.mint_page.showcaseStart,
        collectionImageAssetId: row.mint_page.collectionImageAssetId || null,
        imagePath: publicAssetPath(row.mint_page.collectionImageAssetId),
        bannerImageAssetId: row.mint_page.bannerImageAssetId || null,
        mintPage: `./mint.html?contract=${encodeURIComponent(row.contract_address)}&chain=${Number(row.chain_id)}`,
      })),
    };
  });
}
