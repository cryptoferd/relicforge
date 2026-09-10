(() => {
  'use strict';

  const cloud = window.RelicForgeCloud;
  if (!cloud?.enabled || !cloud?.apiBase || !cloud?.loadSession) {
    console.warn('RelicForge batch-direct save: base Cloud module unavailable.');
    return;
  }

  const PIPELINE_VERSION = '6e04-batch-direct1';
  const PREPARE_BATCH_SIZE = 100;
  const COMPLETE_BATCH_SIZE = 100;
  const SMALL_FILE_BYTES = 512 * 1024;
  const MEDIUM_FILE_BYTES = 2 * 1024 * 1024;
  const LARGE_FILE_BYTES = 8 * 1024 * 1024;
  const SMALL_UPLOAD_CONCURRENCY = 32;
  const MEDIUM_UPLOAD_CONCURRENCY = 20;
  const LARGE_UPLOAD_CONCURRENCY = 10;
  const HUGE_UPLOAD_CONCURRENCY = 4;
  const DOWNLOAD_CONCURRENCY = 6;
  const MAX_RETRY_ATTEMPTS = 6;

  const CACHE_DB = 'relicforge_cloud_fast_asset_cache';
  const CACHE_DB_VERSION = 1;
  const CACHE_STORE = 'assets';
  const CACHE_SCOPE_INDEX = 'scope';

  const markerByBlob = new WeakMap();
  let cacheDbPromise = null;

  const previousLoadProject = typeof cloud.loadProject === 'function'
    ? cloud.loadProject.bind(cloud)
    : null;
  const previousDeleteProject = typeof cloud.deleteProject === 'function'
    ? cloud.deleteProject.bind(cloud)
    : null;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function session() {
    return cloud.loadSession?.() || null;
  }

  function wallet() {
    return String(session()?.wallet || '').toLowerCase();
  }

  function scopeFor(projectId) {
    return `${wallet()}|project|${String(projectId || '')}`;
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
      request.onerror = () => reject(request.error || new Error('Could not open fast asset cache.'));
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
            if (row?.signature && row?.marker?.id) map.set(row.signature, row.marker);
          }
          resolve(map);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (error) {
      console.warn('RelicForge fast asset cache unavailable; continuing without it.', error);
      return new Map();
    }
  }

  async function storeCacheRows(scope, rows) {
    if (!rows?.length) return;
    try {
      const db = await openCacheDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        const store = tx.objectStore(CACHE_STORE);
        for (const row of rows) {
          store.put({
            key: `${scope}|${row.signature}`,
            scope,
            signature: row.signature,
            marker: row.marker,
            updatedAt: new Date().toISOString()
          });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (error) {
      console.warn('RelicForge fast asset cache write failed; save can continue.', error);
    }
  }

  async function clearScopeCache(scope) {
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
      console.warn('RelicForge fast asset cache cleanup failed.', error);
    }
  }

  function stableArraySegment(value, index) {
    if (value && typeof value === 'object' && !(value instanceof Blob) && value.id != null) {
      return `[id:${String(value.id)}]`;
    }
    return `[${index}]`;
  }

  function collectBlobRefs(value, path = '$', out = [], seenObjects = new WeakSet(), seenBlobs = new Set()) {
    if (value instanceof Blob) {
      if (!seenBlobs.has(value)) {
        seenBlobs.add(value);
        out.push({ file: value, logicalKey: path });
      }
      return out;
    }

    if (!value || typeof value !== 'object') return out;
    if (seenObjects.has(value)) return out;
    seenObjects.add(value);

    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        collectBlobRefs(child, `${path}${stableArraySegment(child, index)}`, out, seenObjects, seenBlobs);
      });
      return out;
    }

    for (const [key, child] of Object.entries(value)) {
      collectBlobRefs(child, `${path}.${key}`, out, seenObjects, seenBlobs);
    }
    return out;
  }

  function fastSignature(scope, ref) {
    const file = ref.file;
    return [
      'v1',
      scope,
      ref.logicalKey,
      String(file?.webkitRelativePath || ''),
      String(file?.name || 'asset.bin'),
      Number(file?.size || 0),
      Number(file?.lastModified || 0),
      String(file?.type || 'application/octet-stream').toLowerCase()
    ].join('|');
  }

  function markerFor(file, asset, projectId) {
    return {
      __relicforgeAsset: 1,
      id: asset.id,
      name: file?.name || asset.filename || 'asset.bin',
      type: file?.type || asset.content_type || asset.contentType || 'application/octet-stream',
      size: Number(file?.size || asset.size_bytes || asset.size || 0),
      lastModified: Number(file?.lastModified || Date.now()),
      sha256: '',
      projectId,
      purpose: 'project'
    };
  }

  async function apiRequest(path, options = {}, maxAttempts = MAX_RETRY_ATTEMPTS) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const active = session();
      if (!active?.token) throw new Error('Cloud sign-in required.');

      const headers = {
        ...(options.headers || {}),
        authorization: `Bearer ${active.token}`
      };
      if (options.body != null && !headers['content-type']) headers['content-type'] = 'application/json';

      let response;
      try {
        response = await fetch(`${cloud.apiBase()}${path}`, { ...options, headers });
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) throw error;
        await sleep(Math.min(10000, 400 * (2 ** (attempt - 1))));
        continue;
      }

      const text = await response.text();
      let body = {};
      if (text) {
        try { body = JSON.parse(text); }
        catch { body = { value: text }; }
      }

      if (response.ok) return body;
      if (response.status === 401) cloud.clearSession?.();

      lastError = new Error(body?.error || `Cloud request failed (${response.status}).`);
      lastError.status = response.status;

      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt >= maxAttempts) {
        throw lastError;
      }

      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const wait = retryAfter > 0
        ? retryAfter * 1000
        : Math.min(10000, 400 * (2 ** (attempt - 1)));
      await sleep(wait);
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

    await Promise.all(
      Array.from(
        { length: Math.min(Math.max(1, concurrency), Math.max(1, source.length)) },
        () => consume()
      )
    );
    return results;
  }

  function directUploadConcurrency(files) {
    const maxBytes = files.length ? Math.max(...files.map(file => Number(file?.size || 0))) : 0;
    if (maxBytes <= SMALL_FILE_BYTES) return SMALL_UPLOAD_CONCURRENCY;
    if (maxBytes <= MEDIUM_FILE_BYTES) return MEDIUM_UPLOAD_CONCURRENCY;
    if (maxBytes <= LARGE_FILE_BYTES) return LARGE_UPLOAD_CONCURRENCY;
    return HUGE_UPLOAD_CONCURRENCY;
  }

  async function directPut(uploadUrl, file) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      let response;
      try {
        response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: file
        });
      } catch (error) {
        lastError = error;
        if (attempt >= MAX_RETRY_ATTEMPTS) throw error;
        await sleep(Math.min(8000, 300 * (2 ** (attempt - 1))));
        continue;
      }

      if (response.ok) return;

      lastError = new Error(`Direct artwork upload failed (${response.status}).`);
      lastError.status = response.status;

      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt >= MAX_RETRY_ATTEMPTS) {
        throw lastError;
      }

      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 300 * (2 ** (attempt - 1))));
    }

    throw lastError || new Error('Direct artwork upload failed.');
  }

  function progress(onProgress, detail) {
    try { onProgress?.(detail); } catch {}
    window.dispatchEvent(new CustomEvent('relicforge:cloud-save-progress', { detail }));
  }

  function encodeSnapshot(value, markers, seen = new WeakMap()) {
    if (value instanceof Blob) {
      const marker = markers.get(value);
      if (!marker) throw new Error(`Artwork ${value.name || 'file'} was not prepared for cloud save.`);
      return marker;
    }

    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const out = [];
      seen.set(value, out);
      for (const child of value) out.push(encodeSnapshot(child, markers, seen));
      return out;
    }

    const out = {};
    seen.set(value, out);
    for (const [key, child] of Object.entries(value)) {
      out[key] = encodeSnapshot(child, markers, seen);
    }
    return out;
  }

  async function completeBatch(projectId, assetIds) {
    let remaining = [...assetIds];

    for (let attempt = 1; attempt <= 4 && remaining.length; attempt++) {
      const response = await apiRequest('/api/assets/batch-complete', {
        method: 'POST',
        body: JSON.stringify({ projectId, assetIds: remaining })
      });

      const failed = Array.isArray(response?.failed) ? response.failed : [];
      if (!failed.length) return;
      remaining = failed.map(item => String(item.id || '')).filter(Boolean);

      if (remaining.length) await sleep(250 * attempt);
    }

    if (remaining.length) {
      throw new Error(`${remaining.length} uploaded artwork files could not be verified in cloud storage.`);
    }
  }

  async function saveProjectBatchDirect({ id, name, studio, forge, onProgress = null }) {
    const meta = await cloud.listProjectsMeta();
    const exists = (meta.projects || []).some(project => String(project.id) === String(id));

    if (!exists && Number(meta.count ?? (meta.projects || []).length) >= Number(meta.limit || 10)) {
      throw new Error(`Cloud project limit reached (${meta.limit || 10}/${meta.limit || 10}). Delete a project before saving another.`);
    }

    const projectValue = { schema: 'relic-forge/cloud-project@1', studio, forge };
    const refs = collectBlobRefs(projectValue);
    const total = refs.length;
    const scope = scopeFor(id);
    const persistent = await loadScopeCache(scope);
    const markers = new Map();
    const missing = [];
    let reused = 0;

    progress(onProgress, {
      phase: 'scan',
      completed: 0,
      total,
      cached: 0,
      uploaded: 0,
      transport: 'batch-direct'
    });

    for (const ref of refs) {
      const signature = fastSignature(scope, ref);
      const inMemory = markerByBlob.get(ref.file);
      const cached = inMemory?.id ? inMemory : persistent.get(signature);

      if (cached?.id) {
        markers.set(ref.file, cached);
        markerByBlob.set(ref.file, cached);
        reused++;
      } else {
        missing.push({ ...ref, signature });
      }
    }

    progress(onProgress, {
      phase: 'prepare-direct',
      completed: reused,
      total,
      cached: reused,
      uploaded: 0,
      pending: missing.length,
      transport: 'batch-direct'
    });

    let uploaded = 0;

    for (let start = 0; start < missing.length; start += PREPARE_BATCH_SIZE) {
      const batch = missing.slice(start, start + PREPARE_BATCH_SIZE);

      const prepared = await apiRequest('/api/assets/batch-presign', {
        method: 'POST',
        body: JSON.stringify({
          projectId: id,
          assets: batch.map(item => ({
            filename: item.file.name || 'asset.bin',
            contentType: item.file.type || 'application/octet-stream',
            size: Number(item.file.size || 0)
          }))
        })
      });

      const rows = Array.isArray(prepared?.assets) ? prepared.assets : [];
      if (rows.length !== batch.length) {
        throw new Error(`Cloud prepared ${rows.length} assets for a ${batch.length}-asset batch.`);
      }

      const uploadJobs = rows.map((row, index) => ({
        ref: batch[index],
        row
      }));

      const uploadConcurrency = directUploadConcurrency(uploadJobs.map(job => job.ref.file));

      await runPool(uploadJobs, uploadConcurrency, async job => {
        if (!job.row?.asset?.id || !job.row?.uploadUrl) {
          throw new Error('Cloud returned an invalid direct upload record.');
        }

        await directPut(job.row.uploadUrl, job.ref.file);
        uploaded++;

        progress(onProgress, {
          phase: 'upload-direct',
          completed: reused + uploaded,
          total,
          cached: reused,
          uploaded,
          uploadConcurrency,
          transport: 'direct-bucket'
        });
      });

      await completeBatch(id, rows.map(row => row.asset.id));

      const cacheRows = [];
      for (let index = 0; index < rows.length; index++) {
        const ref = batch[index];
        const marker = markerFor(ref.file, rows[index].asset, id);
        markers.set(ref.file, marker);
        markerByBlob.set(ref.file, marker);
        cacheRows.push({ signature: ref.signature, marker });
      }
      await storeCacheRows(scope, cacheRows);

      progress(onProgress, {
        phase: 'prepare-direct',
        completed: reused + uploaded,
        total,
        cached: reused,
        uploaded,
        pending: Math.max(0, missing.length - (start + batch.length)),
        transport: 'batch-direct'
      });
    }

    progress(onProgress, {
      phase: 'snapshot',
      completed: total,
      total,
      cached: reused,
      uploaded
    });

    const snapshot = encodeSnapshot(projectValue, markers);

    const result = await apiRequest(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name, snapshot })
    });

    progress(onProgress, {
      phase: 'done',
      completed: total,
      total,
      cached: reused,
      uploaded
    });

    return result;
  }

  function seedMarkers(raw, decoded, projectId, path = '$', rows = [], seen = new WeakSet()) {
    if (raw?.__relicforgeAsset && raw.id && decoded instanceof Blob) {
      const marker = {
        ...raw,
        projectId,
        purpose: 'project'
      };
      markerByBlob.set(decoded, marker);
      const ref = { file: decoded, logicalKey: path };
      rows.push({
        signature: fastSignature(scopeFor(projectId), ref),
        marker
      });
      return rows;
    }

    if (!raw || !decoded || typeof raw !== 'object' || typeof decoded !== 'object') return rows;
    if (seen.has(raw)) return rows;
    seen.add(raw);

    if (Array.isArray(raw) && Array.isArray(decoded)) {
      for (let index = 0; index < Math.min(raw.length, decoded.length); index++) {
        seedMarkers(
          raw[index],
          decoded[index],
          projectId,
          `${path}${stableArraySegment(decoded[index], index)}`,
          rows,
          seen
        );
      }
      return rows;
    }

    for (const key of Object.keys(raw)) {
      if (!(key in decoded)) continue;
      seedMarkers(raw[key], decoded[key], projectId, `${path}.${key}`, rows, seen);
    }
    return rows;
  }

  cloud.saveProject = saveProjectBatchDirect;

  if (previousLoadProject) {
    cloud.loadProject = async id => {
      const decodedProject = await previousLoadProject(id);

      try {
        const rawResponse = await apiRequest(`/api/projects/${encodeURIComponent(id)}`, { method: 'GET' });
        const rows = seedMarkers(rawResponse?.project?.snapshot, decodedProject?.snapshot, id);
        await storeCacheRows(scopeFor(id), rows);
      } catch (error) {
        console.warn('RelicForge could not seed fast asset markers after cloud load.', error);
      }

      return decodedProject;
    };
  }

  if (previousDeleteProject) {
    cloud.deleteProject = async id => {
      const result = await previousDeleteProject(id);
      await clearScopeCache(scopeFor(id));
      return result;
    };
  }

  cloud.batchDirectSavePipeline = Object.freeze({
    version: PIPELINE_VERSION,
    mandatoryFingerprinting: false,
    prepareBatchSize: PREPARE_BATCH_SIZE,
    completeBatchSize: COMPLETE_BATCH_SIZE,
    smallFileUploadConcurrency: SMALL_UPLOAD_CONCURRENCY,
    mediumFileUploadConcurrency: MEDIUM_UPLOAD_CONCURRENCY,
    largeFileUploadConcurrency: LARGE_UPLOAD_CONCURRENCY,
    hugeFileUploadConcurrency: HUGE_UPLOAD_CONCURRENCY,
    railwayAssetProxyUploads: false
  });

  window.dispatchEvent(new CustomEvent('relicforge:batch-direct-save-ready', {
    detail: cloud.batchDirectSavePipeline
  }));
})();
