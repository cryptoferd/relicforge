(() => {
  'use strict';

  const DB_NAME = 'relicforge_studio_projects';
  const DB_VERSION = 1;
  const STORE = 'projects';
  const MAX_CLOUD_PROJECTS = 10;
  const BACKUP_SCHEMA = 'relic-forge/project-backup@1';
  let dbPromise = null;
  let wallet = null;
  let currentProjectId = null;
  let currentProjectOwner = null;
  let cloudProjects = [];
  let cloudProjectLimit = MAX_CLOUD_PROJECTS;
  let hasUnsavedChanges = false;
  let lastSavedAt = null;
  let dirtyTrackingReady = false;

  const $ = id => document.getElementById(id);

  function shortAddress(address) {
    return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connect Wallet';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function slug(value) {
    return String(value || 'relic-forge-project').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'relic-forge-project';
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('owner', 'owner', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open project storage.'));
    });
    return dbPromise;
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Project save failed.'));
      tx.onabort = () => reject(tx.error || new Error('Project save was aborted.'));
    });
  }

  async function idbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Project delete failed.'));
    });
  }

  async function idbListByOwner(owner) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const index = tx.objectStore(STORE).index('owner');
      const req = index.getAll(IDBKeyRange.only(owner.toLowerCase()));
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
      req.onerror = () => reject(req.error);
    });
  }

  function setWallet(address, source = 'wallet') {
    const normalized = address ? address.toLowerCase() : null;
    const changed = wallet && normalized && wallet !== normalized;
    wallet = normalized;
    if (changed && currentProjectOwner && currentProjectOwner !== wallet) {
      currentProjectId = null;
      currentProjectOwner = null;
      setStatus('Wallet changed. Saving will create a new project for this wallet.', 'warning');
    }
    const btn = $('projectWalletBtn');
    if (btn) {
      btn.textContent = wallet ? shortAddress(wallet) : 'Connect Wallet';
      btn.classList.toggle('wallet-connected', !!wallet);
      btn.title = wallet ? `Project wallet: ${wallet}` : 'Connect an EVM wallet to save projects';
    }
    const save = $('saveProjectBtn');
    if (save) save.disabled = !wallet;
    const open = $('openProjectsBtn');
    if (open) open.disabled = !wallet;
    const modalWallet = $('projectManagerWallet');
    if (modalWallet) modalWallet.textContent = wallet ? wallet : 'No wallet connected';
    if (source !== 'init') renderProjects().catch(() => {});
  }

  function saveTimeLabel(value) {
    if (!value) return 'Not saved yet';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Save time unavailable';
    return `Last saved ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  }

  function saveSafetyText() {
    if (hasUnsavedChanges) return `${saveTimeLabel(lastSavedAt)} · Closing this tab will lose unsaved progress.`;
    return lastSavedAt ? `${saveTimeLabel(lastSavedAt)} · All current changes are saved.` : 'Not saved yet · No changes to protect yet.';
  }

  function setStatus(message, type = '') {
    const node = $('projectSaveStatus');
    if (node) {
      node.innerHTML = `<strong>${esc(message)}</strong><span>${esc(saveSafetyText())}</span>`;
      node.className = `project-save-status ${type}${hasUnsavedChanges ? ' unsaved' : ''}`.trim();
    }
  }

  function markDirty() {
    if (!dirtyTrackingReady) return;
    if (!hasUnsavedChanges) {
      hasUnsavedChanges = true;
      setStatus('Unsaved changes', 'warning');
    }
  }

  function markSaved(value = new Date()) {
    hasUnsavedChanges = false;
    lastSavedAt = value instanceof Date ? value.toISOString() : String(value || new Date().toISOString());
    setStatus('All changes saved', 'success');
  }

  async function ensureCloudSession() {
    const cloud = window.RelicForgeCloud;
    if (!wallet || !cloud?.enabled?.()) return null;
    const active = cloud.loadSession?.();
    if (active?.wallet?.toLowerCase() === wallet) return active;
    setStatus('Wallet connected. Sign once to enable private cloud sync…');
    const signed = await cloud.ensureSignedIn(wallet);
    setStatus(`Cloud sync enabled for ${shortAddress(wallet)}.`, 'success');
    return signed;
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setStatus('No injected EVM wallet was found.', 'error');
      throw new Error('No injected EVM wallet found.');
    }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('Wallet did not return an account.');
    setWallet(accounts[0]);
    window.dispatchEvent(new CustomEvent('relicforge:wallet-connected', { detail: { address: accounts[0] } }));
    if (window.RelicForgeCloud?.enabled?.()) {
      try { await ensureCloudSession(); }
      catch (error) { setStatus(`Wallet connected. Local saves work; cloud sign-in was not completed: ${error.message}`, 'warning'); }
    } else {
      setStatus(`Projects are scoped to ${shortAddress(accounts[0])}. Cloud API not configured yet.`, 'success');
    }
    return accounts[0];
  }

  function approximateProjectBytes(studio, forge) {
    let bytes = 0;
    for (const layer of studio?.state?.layers || []) {
      for (const trait of layer.traits || []) bytes += Number(trait.file?.size || 0);
    }
    for (const item of studio?.state?.oneOfOnes || []) bytes += Number(item.file?.size || 0);
    bytes += Number(forge?.placeholderFile?.size || 0);
    bytes += Number(forge?.mintPageImageFile?.size || 0);
    bytes += Number(forge?.mintPageBannerFile?.size || 0);
    return bytes;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'No artwork bytes';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function cloudMeta() {
    if (!window.RelicForgeCloud?.enabled?.()) return { projects: [], count: 0, limit: MAX_CLOUD_PROJECTS };
    await ensureCloudSession();
    const meta = await window.RelicForgeCloud.listProjectsMeta();
    cloudProjectLimit = Number(meta.limit || MAX_CLOUD_PROJECTS);
    cloudProjects = meta.projects || [];
    return { ...meta, count: Number(meta.count ?? cloudProjects.length), limit: cloudProjectLimit };
  }

  async function saveProject({ asNew = false } = {}) {
    if (!wallet) await connectWallet();
    const studioBridge = window.RelicForgeStudioBridge;
    if (!studioBridge?.getStudioProjectSnapshot) {
      throw new Error('Studio core did not finish loading. Refresh the page (Ctrl+Shift+R) and try again.');
    }

    const studio = studioBridge.getStudioProjectSnapshot();
    const forge = window.RelicForgeForge?.getForgeProjectState?.() || null;
    const name = String(studio?.ui?.collectionName || 'Untitled Collection').trim() || 'Untitled Collection';
    const reuseCurrent = !asNew && currentProjectId && currentProjectOwner === wallet;
    const id = reuseCurrent ? currentProjectId : crypto.randomUUID();

    if (!reuseCurrent && window.RelicForgeCloud?.enabled?.()) {
      const meta = await cloudMeta();
      if (meta.count >= meta.limit) {
        throw new Error(`Cloud project limit reached (${meta.limit}/${meta.limit}). Download a backup and delete a project before creating another cloud project.`);
      }
    }

    const key = `${wallet}:${id}`;
    const existing = await idbGet(key);
    const now = new Date().toISOString();
    const record = {
      key,
      id,
      owner: wallet,
      name,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      bytes: approximateProjectBytes(studio, forge),
      studio,
      forge,
    };

    setStatus('Saving project + artwork locally…');
    try {
      await idbPut(record);
    } catch (error) {
      if (error?.name === 'QuotaExceededError') throw new Error('Browser storage is full. Download a project backup or remove older local projects, then try again.');
      throw error;
    }
    currentProjectId = id;
    currentProjectOwner = wallet;
    hasUnsavedChanges = false;
    lastSavedAt = now;
    if (window.RelicForgeCloud?.enabled?.()) {
      try {
        await ensureCloudSession();
        setStatus(`Saved locally · syncing “${name}” to RelicForge Cloud…`);
        await window.RelicForgeCloud.saveProject({ id, name, studio, forge });
        setStatus(`Saved locally + globally · ${new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, 'success');
      } catch (error) {
        setStatus(`Saved locally. Cloud sync pending: ${error.message}`, 'warning');
      }
    } else {
      setStatus(`Saved locally · ${new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, 'success');
    }
    await renderProjects();
    return record;
  }

  function cloudRowFor(id) {
    return cloudProjects.find(project => String(project.id) === String(id)) || null;
  }

  async function fetchProjectRecord(id, { preferFreshCloud = true } = {}) {
    if (!wallet) await connectWallet();
    const key = `${wallet}:${id}`;
    let local = await idbGet(key);
    let remoteMeta = cloudRowFor(id);
    if (window.RelicForgeCloud?.enabled?.() && (!remoteMeta || preferFreshCloud)) {
      try {
        const meta = await cloudMeta();
        remoteMeta = meta.projects.find(project => String(project.id) === String(id)) || null;
      } catch (_) {}
    }
    const remoteNewer = remoteMeta && (!local || String(remoteMeta.updated_at || '') > String(local.updatedAt || ''));
    if (window.RelicForgeCloud?.enabled?.() && remoteMeta && (remoteNewer || !local)) {
      await ensureCloudSession();
      setStatus('Downloading project + artwork from RelicForge Cloud…');
      const remote = await window.RelicForgeCloud.loadProject(id);
      const payload = remote.snapshot || {};
      if (!payload.studio) throw new Error('Cloud project snapshot is incomplete.');
      local = {
        key,
        id: remote.id,
        owner: wallet,
        name: remote.name,
        createdAt: remote.created_at,
        updatedAt: remote.updated_at,
        bytes: approximateProjectBytes(payload.studio, payload.forge),
        studio: payload.studio,
        forge: payload.forge || null,
      };
      await idbPut(local);
      return { record: local, fromCloud: true };
    }
    return { record: local, fromCloud: false };
  }

  async function loadProject(id) {
    const { record, fromCloud } = await fetchProjectRecord(id);
    if (!record) throw new Error('That project was not found for the connected wallet.');
    setStatus(`Opening “${record.name}”…`);
    await window.RelicForgeStudioBridge.restoreStudioProjectSnapshot(record.studio);
    window.RelicForgeForge?.restoreForgeProjectState?.(record.forge);
    currentProjectId = record.id;
    currentProjectOwner = record.owner;
    hasUnsavedChanges = false;
    lastSavedAt = record.updatedAt || new Date().toISOString();
    closeManager();
    setStatus(`Opened “${record.name}”${fromCloud ? ' from the latest cloud save' : ''}.`, 'success');
  }

  async function deleteProject(id) {
    if (!wallet) return;
    let local = await idbGet(`${wallet}:${id}`);
    let remote = cloudRowFor(id);
    if (window.RelicForgeCloud?.enabled?.()) {
      try { const meta = await cloudMeta(); remote = meta.projects.find(project => String(project.id) === String(id)) || remote; } catch (_) {}
    }
    const name = local?.name || remote?.name || 'this project';
    if (remote) {
      if (!window.confirm(`Delete “${name}” from RelicForge Cloud and this browser?\n\nThis permanently removes the editable cloud project and any project artwork no longer used by another project. Download a backup first if you may want to revisit it. Deployed contracts and published mint pages are not deleted.`)) return;
      setStatus(`Deleting “${name}” from cloud and freeing bucket space…`);
      await ensureCloudSession();
      const result = await window.RelicForgeCloud.deleteProject(id);
      await idbDelete(`${wallet}:${id}`);
      if (currentProjectId === id && currentProjectOwner === wallet) {
        currentProjectId = null;
        currentProjectOwner = null;
        lastSavedAt = null;
        hasUnsavedChanges = false;
      }
      const freed = Number(result?.freedBytes || 0);
      setStatus(`Deleted “${name}” globally${freed ? ` · freed ${formatBytes(freed)}` : ''}.`, 'success');
    } else if (local) {
      if (!window.confirm(`Delete the local project “${name}”?\n\nThis removes the saved artwork and settings from this browser. Deployed contracts and downloaded backups are not affected.`)) return;
      await idbDelete(local.key);
      if (currentProjectId === id && currentProjectOwner === wallet) {
        currentProjectId = null;
        currentProjectOwner = null;
        lastSavedAt = null;
        hasUnsavedChanges = false;
      }
      setStatus(`Deleted local save “${name}”.`, 'success');
    }
    await renderProjects();
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function encodeBackupValue(value, assets, fileMap) {
    if (value instanceof Blob) {
      if (fileMap.has(value)) return { __relicforgeBackupAsset: fileMap.get(value) };
      const id = `asset-${assets.length + 1}`;
      fileMap.set(value, id);
      assets.push({
        id,
        name: value.name || 'asset.bin',
        type: value.type || 'application/octet-stream',
        size: Number(value.size || 0),
        lastModified: Number(value.lastModified || Date.now()),
        data: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
      });
      return { __relicforgeBackupAsset: id };
    }
    if (Array.isArray(value)) return Promise.all(value.map(child => encodeBackupValue(child, assets, fileMap)));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = await encodeBackupValue(child, assets, fileMap);
      return out;
    }
    return value;
  }

  function decodeBackupValue(value, assetMap) {
    if (value?.__relicforgeBackupAsset) {
      const saved = assetMap.get(value.__relicforgeBackupAsset);
      if (!saved) throw new Error(`Backup artwork ${value.__relicforgeBackupAsset} is missing.`);
      return saved;
    }
    if (Array.isArray(value)) return value.map(child => decodeBackupValue(child, assetMap));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = decodeBackupValue(child, assetMap);
      return out;
    }
    return value;
  }

  async function createBackup({ name, studio, forge, sourceProjectId = null, sourceOwner = null }) {
    const assets = [];
    const fileMap = new Map();
    const snapshot = await encodeBackupValue({ studio, forge }, assets, fileMap);
    return {
      schema: BACKUP_SCHEMA,
      relicForgeVersion: '11.1.1',
      exportedAt: new Date().toISOString(),
      project: {
        name: String(name || studio?.ui?.collectionName || 'Untitled Collection'),
        sourceProjectId,
        sourceOwner,
        snapshot,
      },
      assets,
    };
  }

  function downloadJsonFile(filename, payload) {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/vnd.relicforge.project+json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadProjectBackup(id) {
    if (!wallet) await connectWallet();
    const { record } = await fetchProjectRecord(id);
    if (!record) throw new Error('Project not found.');
    setStatus(`Building complete backup for “${record.name}”…`);
    const backup = await createBackup({ name: record.name, studio: record.studio, forge: record.forge, sourceProjectId: record.id, sourceOwner: wallet });
    downloadJsonFile(`${slug(record.name)}.relicforge`, backup);
    setStatus(`Downloaded complete backup for “${record.name}” · ${backup.assets.length} embedded artwork file${backup.assets.length === 1 ? '' : 's'}.`, 'success');
  }

  async function downloadCurrentProjectBackup() {
    const studioBridge = window.RelicForgeStudioBridge;
    if (!studioBridge?.getStudioProjectSnapshot) throw new Error('Studio core is not ready.');
    const studio = studioBridge.getStudioProjectSnapshot();
    const forge = window.RelicForgeForge?.getForgeProjectState?.() || null;
    const name = String(studio?.ui?.collectionName || 'Untitled Collection').trim() || 'Untitled Collection';
    setStatus(`Building self-contained backup for “${name}”…`);
    const backup = await createBackup({ name, studio, forge, sourceProjectId: currentProjectId, sourceOwner: wallet });
    downloadJsonFile(`${slug(name)}.relicforge`, backup);
    setStatus(`Downloaded complete project backup · settings, rules, and ${backup.assets.length} artwork file${backup.assets.length === 1 ? '' : 's'} included.`, 'success');
  }

  async function importProjectBackup(file) {
    if (!file) return;
    setStatus(`Reading backup “${file.name}”…`);
    let backup;
    try { backup = JSON.parse(await file.text()); }
    catch { throw new Error('That file is not a valid Relic Forge project backup.'); }
    if (backup?.schema !== BACKUP_SCHEMA || !backup?.project?.snapshot?.studio) {
      if (backup?.schema === 'relic-forge/project@0.1') throw new Error('This is a legacy settings-only export and does not contain the artwork binaries needed for full restore. Use a V11.1.1 .relicforge backup for portable projects.');
      throw new Error('Unsupported Relic Forge backup format.');
    }
    const assetMap = new Map();
    for (const asset of backup.assets || []) {
      if (!asset?.id || typeof asset.data !== 'string') throw new Error('Backup contains an invalid artwork record.');
      const bytes = base64ToBytes(asset.data);
      assetMap.set(asset.id, new File([bytes], asset.name || 'asset.bin', { type: asset.type || 'application/octet-stream', lastModified: Number(asset.lastModified || Date.now()) }));
    }
    const restored = decodeBackupValue(backup.project.snapshot, assetMap);
    if (!restored?.studio) throw new Error('Backup Studio state is missing.');
    await window.RelicForgeStudioBridge.restoreStudioProjectSnapshot(restored.studio);
    window.RelicForgeForge?.restoreForgeProjectState?.(restored.forge || null);
    currentProjectId = null;
    currentProjectOwner = null;
    lastSavedAt = null;
    hasUnsavedChanges = true;
    closeManager();
    setStatus(`Loaded backup “${backup.project.name || file.name}”. It is open as a new unsaved project; click Save Project to add it to your wallet cloud.`, 'success');
  }

  async function renderStorageEstimate() {
    const node = $('projectStorageEstimate');
    if (!node) return;
    let browserText = '';
    if (navigator.storage?.estimate) {
      try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        browserText = quota ? `Browser cache: ${formatBytes(usage)} of ~${formatBytes(quota)}` : `Browser cache: ${formatBytes(usage)}`;
      } catch {}
    }
    const cloudText = window.RelicForgeCloud?.enabled?.() ? `Cloud slots: ${cloudProjects.length} / ${cloudProjectLimit}` : 'Cloud sync not configured';
    node.textContent = [cloudText, browserText].filter(Boolean).join(' · ');
  }

  async function renderProjects() {
    const list = $('projectList');
    if (!list) return;
    if (!wallet) {
      list.innerHTML = '<div class="empty-state">Connect a wallet to view its globally synced projects.</div>';
      await renderStorageEstimate();
      return;
    }
    const localProjects = await idbListByOwner(wallet);
    cloudProjects = [];
    if (window.RelicForgeCloud?.enabled?.()) {
      try {
        const meta = await cloudMeta();
        cloudProjects = meta.projects || [];
      } catch (error) {
        setStatus(`Cloud project list unavailable: ${error.message}`, 'warning');
      }
    }
    const merged = new Map();
    for (const project of cloudProjects) merged.set(project.id, { id: project.id, name: project.name, updatedAt: project.updated_at, createdAt: project.created_at, bytes: Number(project.storage_bytes || 0), cloud: true, local: false });
    for (const project of localProjects) {
      const prior = merged.get(project.id) || {};
      const cloudNewer = prior.cloud && String(prior.updatedAt || '') > String(project.updatedAt || '');
      merged.set(project.id, { ...prior, ...project, updatedAt: cloudNewer ? prior.updatedAt : project.updatedAt, cloud: !!prior.cloud, local: true, cloudNewer });
    }
    const projects = [...merged.values()].sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (!projects.length) {
      list.innerHTML = `<div class="empty-state">No projects saved for this wallet${window.RelicForgeCloud?.enabled?.() ? ' in RelicForge Cloud or this browser' : ' in this browser yet'}.</div>`;
      await renderStorageEstimate();
      return;
    }
    list.innerHTML = projects.map(project => {
      const active = project.id === currentProjectId && currentProjectOwner === wallet;
      const updated = new Date(project.updatedAt);
      const location = project.cloud && project.local ? (project.cloudNewer ? 'Cloud newer · local cache available' : 'Cloud + local cache') : project.cloud ? 'Cloud' : 'Local only';
      return `<article class="saved-project-card ${active ? 'active' : ''}">
        <div class="saved-project-main">
          <div class="saved-project-title-row"><strong>${esc(project.name)}</strong>${active ? '<span class="project-current-badge">OPEN</span>' : ''}</div>
          <span>${esc(updated.toLocaleString())} · ${esc(location)}${project.bytes ? ` · ${esc(formatBytes(project.bytes))}` : ''}</span>
        </div>
        <div class="saved-project-actions">
          <button class="ghost-btn" data-load-project="${esc(project.id)}" type="button">Open</button>
          <button class="ghost-btn" data-backup-project="${esc(project.id)}" type="button">Download Backup</button>
          <button class="ghost-btn danger-btn" data-delete-project="${esc(project.id)}" type="button">${project.cloud ? 'Delete Project' : 'Delete Local'}</button>
        </div>
      </article>`;
    }).join('');
    await renderStorageEstimate();
  }

  function openManager() {
    const modal = $('projectManagerModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    renderProjects().catch(error => setStatus(error.message, 'error'));
  }

  function closeManager() {
    $('projectManagerModal')?.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  async function initWalletState() {
    if (!window.ethereum) {
      setWallet(null, 'init');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      setWallet(accounts?.[0] || null, 'init');
    } catch {
      setWallet(null, 'init');
    }
    window.ethereum.on?.('accountsChanged', accounts => setWallet(accounts?.[0] || null));
  }

  function bind() {
    $('projectWalletBtn')?.addEventListener('click', () => connectWallet().catch(error => setStatus(error.message, 'error')));
    $('saveProjectBtn')?.addEventListener('click', () => saveProject().catch(error => setStatus(error.message, 'error')));
    $('openProjectsBtn')?.addEventListener('click', openManager);
    $('projectManagerCloseBtn')?.addEventListener('click', closeManager);
    $('projectManagerBackdrop')?.addEventListener('click', closeManager);
    $('projectManagerSaveBtn')?.addEventListener('click', () => saveProject().catch(error => setStatus(error.message, 'error')));
    $('projectManagerSaveAsBtn')?.addEventListener('click', () => saveProject({ asNew: true }).catch(error => setStatus(error.message, 'error')));
    $('projectManagerImportBtn')?.addEventListener('click', () => $('projectBackupInput')?.click());
    $('importProjectBtn')?.addEventListener('click', () => $('projectBackupInput')?.click());
    $('projectBackupInput')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) importProjectBackup(file).catch(error => setStatus(error.message, 'error'));
    });
    $('projectList')?.addEventListener('click', event => {
      const load = event.target.closest('[data-load-project]');
      if (load) { loadProject(load.dataset.loadProject).catch(error => setStatus(error.message, 'error')); return; }
      const backup = event.target.closest('[data-backup-project]');
      if (backup) { downloadProjectBackup(backup.dataset.backupProject).catch(error => setStatus(error.message, 'error')); return; }
      const del = event.target.closest('[data-delete-project]');
      if (del) deleteProject(del.dataset.deleteProject).catch(error => setStatus(error.message, 'error'));
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeManager(); });
    window.addEventListener('relicforge:studio-bridge-ready', () => {
      if (window.RelicForgeStudioBridge?.getStudioProjectSnapshot) {
        const status = $('projectSaveStatus');
        if (status?.textContent?.includes('Studio core')) setStatus('Project saving is ready.', 'success');
      }
    });
    window.addEventListener('relicforge:wallet-connected', event => {
      const address = event.detail?.address;
      if (address) setWallet(address);
    });

    const menuBtn = $('studioMenuBtn');
    const menu = $('studioProjectActions');
    menuBtn?.addEventListener('click', event => {
      event.stopPropagation();
      const open = !menu?.classList.contains('mobile-open');
      menu?.classList.toggle('mobile-open', open);
      menuBtn.classList.toggle('active', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', event => {
      if (!menu?.classList.contains('mobile-open')) return;
      if (menu.contains(event.target) || menuBtn?.contains(event.target)) return;
      menu.classList.remove('mobile-open');
      menuBtn?.classList.remove('active');
      menuBtn?.setAttribute('aria-expanded', 'false');
    });

    const mutationClickSelector = [
      '#createLayerBtn','#addCategoryBtn','.delete-layer-btn','.trait-thumb-remove','.rarity-remove-trait-btn',
      '.autofill-btn','.equalize-btn','.exact-autofill-btn','.exact-equalize-btn','#addRuleBtn','.rule-remove',
      '#saveManualTokenBtn','#clearManualTokenBtn','#compileBtn','#regenerateBtn','.oneofone-remove-btn',
      '[data-add-oneofone-meta]','[data-remove-oneofone-meta]'
    ].join(',');
    const isStudioEditTarget = target => !!target?.closest?.('#studioApp main');
    document.addEventListener('input', event => { if (isStudioEditTarget(event.target)) markDirty(); }, true);
    document.addEventListener('change', event => { if (isStudioEditTarget(event.target)) markDirty(); }, true);
    document.addEventListener('click', event => { if (event.target.closest?.(mutationClickSelector)) setTimeout(markDirty, 0); }, true);
    document.addEventListener('drop', event => { if (isStudioEditTarget(event.target)) setTimeout(markDirty, 0); }, true);
    window.addEventListener('beforeunload', event => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    });

    initWalletState();
    setTimeout(() => {
      dirtyTrackingReady = true;
      setStatus('No unsaved changes', '');
    }, 0);
  }

  window.RelicForgeProjects = {
    version: '11.1.1',
    connectWallet,
    saveProject,
    openManager,
    getWallet: () => wallet,
    getCurrentProjectId: () => currentProjectId,
    hasUnsavedChanges: () => hasUnsavedChanges,
    markDirty,
    ensureCloudSession,
    downloadCurrentProjectBackup,
    downloadProjectBackup,
    importProjectBackup,
    maxCloudProjects: MAX_CLOUD_PROJECTS,
  };

  bind();
})();
