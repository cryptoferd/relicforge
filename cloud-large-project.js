(() => {
  'use strict';

  const cloud = window.RelicForgeCloud;
  if (!cloud?.enabled || !cloud?.json || !cloud?.fetchBlob) {
    console.warn('RelicForge large-project cloud pipeline: base Cloud module is unavailable.');
    return;
  }

  const PIPELINE_VERSION = '6e02-save1';
  const HASH_CONCURRENCY = 4;
  const UPLOAD_CONCURRENCY = 6;
  const DOWNLOAD_CONCURRENCY = 6;
  const PREPARE_BATCH_SIZE = 50;
  const ASSET_REQUEST_INTERVAL_MS = 140;
  const MAX_RETRY_ATTEMPTS = 6;

  const CACHE_DB = 'relicforge_cloud_asset_marker_cache';
  const CACHE_DB_VERSION = 1;
  const CACHE_STORE = 'markers';
  const CACHE_SCOPE_INDEX = 'scope';

  const fileHashCache = new WeakMap();
  const decodedMarkerCache = new WeakMap();
  let cacheDbPromise = null;
  let requestGateTail = Promise.resolve();
  let lastAssetRequestStartedAt = 0;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function activeSession() {
    return cloud.loadSession?.() || null;
  }

  function activeWallet() {
    return String(activeSession()?.wallet || '').toLowerCase();
  }

  function cacheScope(context = {}) {
    return `${activeWallet()}|${String(context.purpose || 'project')}|${String(context.projectId || '')}`;
  }

  function fingerprint(hash, file) {
    return `${String(hash || '').toLowerCase()}|${Number(file?.size || 0)}|${String(file?.type || 'application/octet-stream').toLowerCase()}`;
  }

  function markerForFile(base, file, hash, context = {}) {
    return {
      __relicforgeAsset: 1,
      id: base.id,
      name: file?.name || base.name || 'asset.bin',
      type: file?.type || base.type || base.contentType || 'application/octet-stream',
      size: Number(file?.size || base.size || base.size_bytes || 0),
      lastModified: Number(file?.lastModified || Date.now()),
      sha256: String(hash || base.sha256 || '').toLowerCase(),
      projectId: context.projectId || base.projectId || null,
      purpose: context.purpose || base.purpose || 'project'
    };
  }

  function openCacheDb() {
    if (cacheDbPromise) return cacheDbPromise;
    cacheDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(CACHE_DB, CACHE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        let store;
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          store = db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        } else {
          store = request.transaction.objectStore(CACHE_STORE);
        }
        if (!store.indexNames.contains(CACHE_SCOPE_INDEX)) {
          store.createIndex(CACHE_SCOPE_INDEX, 'scope', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open cloud asset marker cache.'));
    });
    return cacheDbPromise;
  }

  async function loadScopeCache(scope) {
    try {
      const db = await openCacheDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const req = tx.objectStore(CACHE_STORE).index(CACHE_SCOPE_INDEX).getAll(IDBKeyRange.only(scope));
        req.onsuccess = () => {
          const map = new Map();
          for (const row of req.result || []) {
            if (row?.fingerprint && row?.marker?.id) map.set(row.fingerprint, row.marker);
          }
          resolve(map);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (error) {
      console.warn('RelicForge asset marker cache read failed; continuing without persistent cache.', error);
      return new Map();
    }
  }

  async function storeCachedMarker(scope, fp, marker) {
    try {
      const db = await openCacheDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).put({
          key: `${scope}|${fp}`,
          scope,
          fingerprint: fp,
          marker,
          updatedAt: new Date().toISOString()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (error) {
      console.warn('RelicForge asset marker cache write failed; save can continue.', error);
    }
  }

  async function clearProjectCache(projectId, purpose = 'project') {
    const scope = cacheScope({ projectId, purpose });
    if (!activeWallet() || !projectId) return;
    try {
      const db = await openCacheDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        const index = tx.objectStore(CACHE_STORE).index(CACHE_SCOPE_INDEX);
        const req = index.openCursor(IDBKeyRange.only(scope));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          cursor.delete();
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      console.warn('RelicForge asset marker cache cleanup failed.', error);
    }
  }

  function retryDelayMs(response, attempt) {
    const raw = response?.headers?.get?.('retry-after');
    if (raw) {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.max(250, seconds * 1000);
      const dateMs = Date.parse(raw);
      if (Number.isFinite(dateMs)) return Math.max(250, dateMs - Date.now());
    }
    return Math.min(15000, 500 * (2 ** Math.max(0, attempt - 1)));
  }

  function retryableStatus(status) {
    return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
  }

  async function waitForAssetRequestSlot() {
    let release;
    const previous = requestGateTail;
    requestGateTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => {});
    try {
      const wait = Math.max(0, lastAssetRequestStartedAt + ASSET_REQUEST_INTERVAL_MS - Date.now());
      if (wait) await sleep(wait);
      lastAssetRequestStartedAt = Date.now();
    } finally {
      release();
    }
  }

  async function authenticatedRequest(path, options = {}, {
    responseType = 'json',
    paceAssetRequest = false,
    maxAttempts = MAX_RETRY_ATTEMPTS
  } = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (paceAssetRequest) await waitForAssetRequestSlot();

      const session = activeSession();
      if (!session?.token) throw new Error('Cloud sign-in required.');

      const headers = { ...(options.headers || {}), authorization: `Bearer ${session.token}` };
      if (options.body != null && !headers['content-type']) headers['content-type'] = 'application/json';

      let response;
      try {
        response = await fetch(`${cloud.apiBase()}${path}`, { ...options, headers });
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) throw error;
        await sleep(Math.min(15000, 500 * (2 ** (attempt - 1))));
        continue;
      }

      if (response.ok) {
        if (responseType === 'blob') return response.blob();
        const text = await response.text();
        if (!text) return {};
        try { return JSON.parse(text); }
        catch { return { value: text }; }
      }

      if (response.status === 401) cloud.clearSession?.();

      let message = `Cloud request failed (${response.status}).`;
      try {
        const text = await response.text();
        if (text) {
          try { message = JSON.parse(text)?.error || message; }
          catch { message = text; }
        }
      } catch {}

      lastError = new Error(message);
      lastError.status = response.status;

      if (!retryableStatus(response.status) || attempt >= maxAttempts) throw lastError;
      await sleep(retryDelayMs(response, attempt));
    }

    throw lastError || new Error('Cloud request failed.');
  }

  async function runPool(items, concurrency, worker) {
    const source = [...items];
    const results = new Array(source.length);
    let next = 0;

    async function consume() {
      while (true) {
        const index = next++;
        if (index >= source.length) return;
        results[index] = await worker(source[index], index);
      }
    }

    const workers = Array.from(
      { length: Math.min(Math.max(1, concurrency), Math.max(1, source.length)) },
      () => consume()
    );
    await Promise.all(workers);
    return results;
  }

  function collectUniqueBlobs(value, out = [], seenObjects = new WeakSet(), seenBlobs = new Set()) {
    if (value instanceof Blob) {
      if (!seenBlobs.has(value)) {
        seenBlobs.add(value);
        out.push(value);
      }
      return out;
    }
    if (!value || typeof value !== 'object') return out;
    if (seenObjects.has(value)) return out;
    seenObjects.add(value);

    if (Array.isArray(value)) {
      for (const child of value) collectUniqueBlobs(child, out, seenObjects, seenBlobs);
    } else {
      for (const child of Object.values(value)) collectUniqueBlobs(child, out, seenObjects, seenBlobs);
    }
    return out;
  }

  async function fileSha256(file) {
    if (fileHashCache.has(file)) return fileHashCache.get(file);
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
    fileHashCache.set(file, hash);
    return hash;
  }

  function progressReporter(onProgress, totalFiles) {
    let lastAt = 0;
    let lastKey = '';
    return detail => {
      const payload = { total: totalFiles, ...detail };
      const key = `${payload.phase}|${payload.completed}|${payload.total}|${payload.uploaded}|${payload.cached}`;
      const now = Date.now();
      const terminal = payload.completed === payload.total || payload.phase === 'snapshot' || payload.phase === 'done';
      if (!terminal && key === lastKey) return;
      if (!terminal && now - lastAt < 100) return;
      lastAt = now;
      lastKey = key;
      try { onProgress?.(payload); } catch {}
      window.dispatchEvent(new CustomEvent('relicforge:cloud-save-progress', { detail: payload }));
    };
  }

  async function prepareProjectAssets(rootValue, context, onProgress) {
    const files = collectUniqueBlobs(rootValue);
    const report = progressReporter(onProgress, files.length);
    report({ phase: 'scan', completed: 0, cached: 0, uploaded: 0 });

    if (!files.length) return { markerByFile: new Map(), stats: { total: 0, cached: 0, uploaded: 0 } };

    let hashed = 0;
    report({ phase: 'hash', completed: 0, cached: 0, uploaded: 0 });

    const hashedFiles = await runPool(files, HASH_CONCURRENCY, async file => {
      const marker = decodedMarkerCache.get(file);
      const hash = String(marker?.sha256 || await fileSha256(file)).toLowerCase();
      hashed++;
      report({ phase: 'hash', completed: hashed, cached: 0, uploaded: 0 });
      return { file, hash, fp: fingerprint(hash, file), decodedMarker: marker || null };
    });

    const groups = new Map();
    for (const entry of hashedFiles) {
      if (!groups.has(entry.fp)) groups.set(entry.fp, { ...entry, files: [] });
      groups.get(entry.fp).files.push(entry.file);
    }

    const scope = cacheScope(context);
    const persistent = await loadScopeCache(scope);
    const markerBaseByFingerprint = new Map();
    const uncachedGroups = [];
    let cachedFiles = 0;

    for (const group of groups.values()) {
      const decoded = group.decodedMarker;
      const cached = decoded?.id ? decoded : persistent.get(group.fp);
      if (cached?.id) {
        markerBaseByFingerprint.set(group.fp, cached);
        cachedFiles += group.files.length;
      } else {
        uncachedGroups.push(group);
      }
    }

    let preparedFiles = cachedFiles;
    report({ phase: 'prepare', completed: preparedFiles, cached: cachedFiles, uploaded: 0 });

    for (let start = 0; start < uncachedGroups.length; start += PREPARE_BATCH_SIZE) {
      const batch = uncachedGroups.slice(start, start + PREPARE_BATCH_SIZE);
      const response = await authenticatedRequest('/api/assets/batch-prepare', {
        method: 'POST',
        body: JSON.stringify({
          projectId: context.projectId,
          assets: batch.map(group => ({
            filename: group.file.name || 'asset.bin',
            contentType: group.file.type || 'application/octet-stream',
            size: Number(group.file.size || 0),
            sha256: group.hash
          }))
        })
      }, { paceAssetRequest: true });

      const rows = Array.isArray(response?.assets) ? response.assets : [];
      if (rows.length !== batch.length) {
        throw new Error(`Cloud batch prepare returned ${rows.length} records for ${batch.length} assets.`);
      }

      for (let i = 0; i < batch.length; i++) {
        const group = batch[i];
        const row = rows[i];
        if (!row?.asset?.id) throw new Error('Cloud batch prepare returned an invalid asset record.');

        const base = {
          id: row.asset.id,
          name: group.file.name || row.asset.filename || 'asset.bin',
          type: group.file.type || row.asset.content_type || row.asset.contentType || 'application/octet-stream',
          size: Number(group.file.size || row.asset.size_bytes || row.asset.size || 0),
          sha256: group.hash,
          projectId: context.projectId,
          purpose: context.purpose || 'project',
          needsUpload: row.needsUpload !== false
        };
        markerBaseByFingerprint.set(group.fp, base);

        if (row.needsUpload === false) {
          await storeCachedMarker(scope, group.fp, markerForFile(base, group.file, group.hash, context));
          cachedFiles += group.files.length;
        }
        preparedFiles += group.files.length;
      }

      report({ phase: 'prepare', completed: preparedFiles, cached: cachedFiles, uploaded: 0 });
    }

    const uploads = [];
    for (const group of groups.values()) {
      const base = markerBaseByFingerprint.get(group.fp);
      if (base?.needsUpload) uploads.push({ group, base });
    }

    let uploadedGroups = 0;
    let uploadedFiles = 0;
    report({ phase: 'upload', completed: cachedFiles, cached: cachedFiles, uploaded: 0, uniqueUploads: uploads.length });

    await runPool(uploads, UPLOAD_CONCURRENCY, async ({ group, base }) => {
      await authenticatedRequest(`/api/assets/${encodeURIComponent(base.id)}/upload`, {
        method: 'PUT',
        headers: { 'content-type': 'application/vnd.relicforge.asset' },
        body: group.file
      }, { paceAssetRequest: true });

      uploadedGroups++;
      uploadedFiles += group.files.length;
      const storedMarker = markerForFile(base, group.file, group.hash, context);
      await storeCachedMarker(scope, group.fp, storedMarker);
      report({
        phase: 'upload',
        completed: Math.min(files.length, cachedFiles + uploadedFiles),
        cached: cachedFiles,
        uploaded: uploadedFiles,
        uniqueUploadsCompleted: uploadedGroups,
        uniqueUploads: uploads.length
      });
    });

    const markerByFile = new Map();
    for (const group of groups.values()) {
      const base = markerBaseByFingerprint.get(group.fp);
      if (!base?.id) throw new Error('Prepared asset marker is missing.');
      for (const file of group.files) {
        const marker = markerForFile(base, file, group.hash, context);
        markerByFile.set(file, marker);
        decodedMarkerCache.set(file, marker);
      }
    }

    return {
      markerByFile,
      stats: { total: files.length, cached: cachedFiles, uploaded: uploadedFiles, uniqueUploads: uploads.length },
      report
    };
  }

  function encodePreparedValue(value, markerByFile, seen = new WeakMap()) {
    if (value instanceof Blob) {
      const marker = markerByFile.get(value);
      if (!marker) throw new Error(`Artwork ${value.name || 'file'} was not prepared for cloud save.`);
      return marker;
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const out = [];
      seen.set(value, out);
      for (const child of value) out.push(encodePreparedValue(child, markerByFile, seen));
      return out;
    }

    const out = {};
    seen.set(value, out);
    for (const [key, child] of Object.entries(value)) {
      out[key] = encodePreparedValue(child, markerByFile, seen);
    }
    return out;
  }

  async function optimizedSaveProject({ id, name, studio, forge, onProgress = null }) {
    const meta = await cloud.listProjectsMeta();
    const exists = (meta.projects || []).some(project => String(project.id) === String(id));
    if (!exists && Number(meta.count ?? (meta.projects || []).length) >= Number(meta.limit || 10)) {
      throw new Error(`Cloud project limit reached (${meta.limit || 10}/${meta.limit || 10}). Delete a project before saving another.`);
    }

    const projectValue = { schema: 'relic-forge/cloud-project@1', studio, forge };
    const context = { projectId: id, purpose: 'project' };
    const prepared = await prepareProjectAssets(projectValue, context, onProgress);

    prepared.report?.({
      phase: 'snapshot',
      completed: prepared.stats.total,
      cached: prepared.stats.cached,
      uploaded: prepared.stats.uploaded
    });

    const snapshot = encodePreparedValue(projectValue, prepared.markerByFile);

    const result = await authenticatedRequest(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name, snapshot })
    });

    prepared.report?.({
      phase: 'done',
      completed: prepared.stats.total,
      cached: prepared.stats.cached,
      uploaded: prepared.stats.uploaded
    });

    return result;
  }

  async function downloadProjectAsset(marker, context) {
    const blob = await authenticatedRequest(
      `/api/assets/${encodeURIComponent(marker.id)}/download`,
      { method: 'GET' },
      { responseType: 'blob', paceAssetRequest: true }
    );

    const file = new File([blob], marker.name || 'asset', {
      type: marker.type || blob.type || 'application/octet-stream',
      lastModified: marker.lastModified || Date.now()
    });

    if (marker.sha256) fileHashCache.set(file, String(marker.sha256).toLowerCase());
    decodedMarkerCache.set(file, { ...marker, projectId: context.projectId, purpose: context.purpose || 'project' });

    if (marker.sha256) {
      const scope = cacheScope(context);
      await storeCachedMarker(scope, fingerprint(marker.sha256, file), {
        ...marker,
        projectId: context.projectId,
        purpose: context.purpose || 'project'
      });
    }

    return file;
  }

  function collectAssetMarkers(value, out = new Map(), seen = new WeakSet()) {
    if (!value || typeof value !== 'object') return out;
    if (value.__relicforgeAsset && value.id) {
      if (!out.has(String(value.id))) out.set(String(value.id), value);
      return out;
    }
    if (seen.has(value)) return out;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) collectAssetMarkers(child, out, seen);
    } else {
      for (const child of Object.values(value)) collectAssetMarkers(child, out, seen);
    }
    return out;
  }

  function decodePreparedValue(value, fileById, seen = new WeakMap()) {
    if (value?.__relicforgeAsset && value.id) {
      const file = fileById.get(String(value.id));
      if (!file) throw new Error(`Cloud artwork ${value.id} was not downloaded.`);
      return file;
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const out = [];
      seen.set(value, out);
      for (const child of value) out.push(decodePreparedValue(child, fileById, seen));
      return out;
    }

    const out = {};
    seen.set(value, out);
    for (const [key, child] of Object.entries(value)) {
      out[key] = decodePreparedValue(child, fileById, seen);
    }
    return out;
  }

  async function optimizedLoadProject(id) {
    const response = await authenticatedRequest(`/api/projects/${encodeURIComponent(id)}`, { method: 'GET' });
    const markers = [...collectAssetMarkers(response.project.snapshot).values()];
    const context = { projectId: id, purpose: 'project' };
    const fileById = new Map();

    await runPool(markers, DOWNLOAD_CONCURRENCY, async marker => {
      const file = await downloadProjectAsset(marker, context);
      fileById.set(String(marker.id), file);
    });

    const decoded = decodePreparedValue(response.project.snapshot, fileById);
    return { ...response.project, snapshot: decoded };
  }

  const originalDeleteProject = cloud.deleteProject?.bind(cloud);

  cloud.saveProject = optimizedSaveProject;
  cloud.loadProject = optimizedLoadProject;

  if (originalDeleteProject) {
    cloud.deleteProject = async id => {
      const result = await originalDeleteProject(id);
      await clearProjectCache(id, 'project');
      return result;
    };
  }

  cloud.largeProjectPipeline = Object.freeze({
    version: PIPELINE_VERSION,
    hashConcurrency: HASH_CONCURRENCY,
    uploadConcurrency: UPLOAD_CONCURRENCY,
    prepareBatchSize: PREPARE_BATCH_SIZE,
    assetRequestIntervalMs: ASSET_REQUEST_INTERVAL_MS,
    maxRetryAttempts: MAX_RETRY_ATTEMPTS
  });

  window.dispatchEvent(new CustomEvent('relicforge:large-project-cloud-ready', {
    detail: cloud.largeProjectPipeline
  }));
})();
