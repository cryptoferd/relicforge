(() => {
  'use strict';
  const TOKEN_KEY = 'relicforge_cloud_session_v1';
  const MINT_PAGE_MAX_BYTES = 2 * 1024 * 1024;
  let session = null;

  function apiBase() {
    const query = new URLSearchParams(location.search).get('api');
    return String(query || window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  }
  function enabled() { return !!apiBase() && window.RELICFORGE_CONFIG?.cloudEnabled !== false; }
  function loadSession() {
    if (session) return session;
    try { session = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch { session = null; }
    return session;
  }
  function clearSession() { session = null; try { sessionStorage.removeItem(TOKEN_KEY); } catch {} }
  async function json(path, options = {}, authenticated = false) {
    if (!enabled()) throw new Error('RelicForge Cloud API is not configured yet.');
    const headers = { ...(options.headers || {}) };
    if (options.body != null && !headers['content-type']) headers['content-type'] = 'application/json';
    if (authenticated) {
      const active = loadSession();
      if (!active?.token) throw new Error('Cloud sign-in required.');
      headers.authorization = `Bearer ${active.token}`;
    }
    const res = await fetch(`${apiBase()}${path}`, { ...options, headers });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `HTTP ${res.status}` }; }
    if (!res.ok) {
      if (res.status === 401) clearSession();
      throw new Error(data?.error || `Cloud request failed (${res.status}).`);
    }
    return data;
  }
  async function signIn(wallet) {
    if (!enabled()) return null;
    if (!window.ethereum || !window.ethers) throw new Error('Wallet provider unavailable.');
    const normalized = window.ethers.getAddress(wallet);
    const existing = loadSession();
    if (existing?.wallet?.toLowerCase() === normalized.toLowerCase() && existing?.token) return existing;
    const challenge = await json('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ wallet: normalized }) });
    const provider = new window.ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const signerAddress = window.ethers.getAddress(await signer.getAddress());
    if (signerAddress.toLowerCase() !== normalized.toLowerCase()) throw new Error('Connected wallet changed before cloud sign-in.');
    const signature = await signer.signMessage(challenge.message);
    const verified = await json('/api/auth/verify', { method: 'POST', body: JSON.stringify({ wallet: normalized, signature }) });
    session = { token: verified.token, wallet: verified.wallet, signedInAt: new Date().toISOString() };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    return session;
  }
  async function ensureSignedIn(wallet) {
    const active = loadSession();
    if (active?.token && active?.wallet?.toLowerCase() === String(wallet || '').toLowerCase()) return active;
    return signIn(wallet);
  }
  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  async function uploadAsset(file, { projectId = null, purpose = 'project' } = {}) {
    if (!(file instanceof Blob)) return null;
    const filename = file.name || 'asset.bin';
    let contentType = file.type || 'application/octet-stream';
    if (purpose === 'mint-page') {
      if (file.size > MINT_PAGE_MAX_BYTES) throw new Error(`${filename} exceeds the 2 MB mint-page image limit.`);
      if (!String(contentType).toLowerCase().startsWith('image/')) {
        const ext = String(filename).split('.').pop()?.toLowerCase() || '';
        const imageTypes = { apng:'image/apng', avif:'image/avif', bmp:'image/bmp', gif:'image/gif', heic:'image/heic', heif:'image/heif', ico:'image/x-icon', jfif:'image/jpeg', jpeg:'image/jpeg', jpg:'image/jpeg', png:'image/png', svg:'image/svg+xml', tif:'image/tiff', tiff:'image/tiff', webp:'image/webp' };
        contentType = imageTypes[ext] || contentType;
      }
      if (!String(contentType).toLowerCase().startsWith('image/')) throw new Error(`${filename} is not recognized as an image.`);
    }
    const hash = await sha256(file);
    const prepared = await json('/api/assets/presign', {
      method: 'POST', body: JSON.stringify({ filename, contentType, size: file.size, sha256: hash, purpose, projectId })
    }, true);
    if (!prepared.reused) {
      const put = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
      if (!put.ok) throw new Error(`Artwork upload failed (${put.status}). Check the Railway Bucket CORS settings.`);
      await json(`/api/assets/${prepared.asset.id}/complete`, { method: 'POST', body: '{}' }, true);
    }
    return {
      __relicforgeAsset: 1,
      id: prepared.asset.id,
      name: filename,
      type: contentType,
      size: Number(file.size || prepared.asset.size_bytes || prepared.asset.size || 0),
      lastModified: Number(file.lastModified || Date.now()),
      sha256: hash
    };
  }
  async function encodeValue(value, context, cache = new Map()) {
    if (value instanceof Blob) {
      // Cache by Blob/File object identity. Two different trait files can legitimately
      // share a filename, size and timestamp and must never be collapsed together.
      if (!cache.has(value)) cache.set(value, uploadAsset(value, context));
      return cache.get(value);
    }
    if (Array.isArray(value)) return Promise.all(value.map(v => encodeValue(v, context, cache)));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = await encodeValue(child, context, cache);
      return out;
    }
    return value;
  }
  async function assetToFile(marker) {
    const response = await json(`/api/assets/${marker.id}/url`, {}, true);
    const fileRes = await fetch(response.url);
    if (!fileRes.ok) throw new Error(`Could not restore ${marker.name || 'cloud artwork'}.`);
    const blob = await fileRes.blob();
    return new File([blob], marker.name || response.asset?.filename || 'asset', {
      type: marker.type || response.asset?.content_type || blob.type,
      lastModified: marker.lastModified || Date.now()
    });
  }
  async function decodeValue(value, cache = new Map()) {
    if (value?.__relicforgeAsset && value.id) {
      if (!cache.has(value.id)) cache.set(value.id, assetToFile(value));
      return cache.get(value.id);
    }
    if (Array.isArray(value)) return Promise.all(value.map(v => decodeValue(v, cache)));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = await decodeValue(child, cache);
      return out;
    }
    return value;
  }
  async function listProjectsMeta() { return await json('/api/projects', {}, true); }
  async function saveProject({ id, name, studio, forge }) {
    const meta = await listProjectsMeta();
    const exists = (meta.projects || []).some(project => String(project.id) === String(id));
    if (!exists && Number(meta.count ?? (meta.projects || []).length) >= Number(meta.limit || 10)) throw new Error(`Cloud project limit reached (${meta.limit || 10}/${meta.limit || 10}). Delete a project before saving another.`);
    const snapshot = await encodeValue({ schema: 'relic-forge/cloud-project@1', studio, forge }, { projectId: id, purpose: 'project' });
    return json(`/api/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ name, snapshot }) }, true);
  }
  async function listProjects() { return (await listProjectsMeta()).projects || []; }
  async function loadProject(id) {
    const response = await json(`/api/projects/${encodeURIComponent(id)}`, {}, true);
    const decoded = await decodeValue(response.project.snapshot);
    return { ...response.project, snapshot: decoded };
  }
  async function deleteProject(id) { return json(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }, true); }
  async function publishMintPage({ chainId, contract, projectId = null, collectionImageFile = null, bannerImageFile = null, config = {}, whitelist = null }) {
    const collectionImage = collectionImageFile ? await uploadAsset(collectionImageFile, { projectId, purpose: 'mint-page' }) : null;
    const bannerImage = bannerImageFile ? await uploadAsset(bannerImageFile, { projectId, purpose: 'mint-page' }) : null;
    const publishedConfig = {
      ...config,
      collectionImageAssetId: collectionImage?.id || config.collectionImageAssetId || null,
      bannerImageAssetId: bannerImage?.id || config.bannerImageAssetId || null
    };
    delete publishedConfig.collectionImage;
    delete publishedConfig.bannerImage;
    delete publishedConfig.whitelistEntries;
    await json(`/api/collections/${chainId}/${contract}/mint-page`, { method: 'PUT', body: JSON.stringify({ projectId, config: publishedConfig }) }, true);
    if (whitelist?.entries?.length && whitelist?.root) {
      const rows = whitelist.entries.map(entry => {
        const proof = whitelist.proofByAddress?.[String(entry.address).toLowerCase()]?.proof || [];
        return { address: entry.address, allowance: Number(entry.allowance || 0), proof };
      });
      await json(`/api/collections/${chainId}/${contract}/whitelist`, { method: 'PUT', body: JSON.stringify({
        merkleRoot: whitelist.root, sourceType: whitelist.sourceType || 0, sourceChainId: whitelist.sourceChainId || 0,
        sourceContract: whitelist.sourceContract || null, snapshotBlock: whitelist.snapshotBlock || 0, entries: rows
      }) }, true);
    }
    return publishedConfig;
  }
  function publicUrl(path) { return `${apiBase()}${path}`; }

  window.RelicForgeCloud = {
    version: '11.1.2', apiBase, enabled, signIn, ensureSignedIn, clearSession, loadSession,
    uploadAsset, encodeValue, decodeValue, saveProject, listProjectsMeta, listProjects, loadProject, deleteProject, publishMintPage, publicUrl, json
  };
})();
