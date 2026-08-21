(() => {
  'use strict';

  const DB_NAME = 'relicforge_studio_projects';
  const DB_VERSION = 1;
  const STORE = 'projects';
  let dbPromise = null;
  let wallet = null;
  let currentProjectId = null;
  let currentProjectOwner = null;

  const $ = id => document.getElementById(id);

  function shortAddress(address) {
    return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connect Wallet';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  function setStatus(message, type = '') {
    const node = $('projectSaveStatus');
    if (node) {
      node.textContent = message;
      node.className = `project-save-status ${type}`.trim();
    }
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
    setStatus(`Projects are scoped to ${shortAddress(accounts[0])}.`, 'success');
    return accounts[0];
  }

  function approximateProjectBytes(studio, forge) {
    let bytes = 0;
    for (const layer of studio?.state?.layers || []) {
      for (const trait of layer.traits || []) bytes += Number(trait.file?.size || 0);
    }
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

  async function saveProject({ asNew = false } = {}) {
    if (!wallet) await connectWallet();
    const studioBridge = window.RelicForgeStudioBridge;
    if (!studioBridge?.getStudioProjectSnapshot) {
      throw new Error('Studio core did not finish loading. Refresh the page (Ctrl+Shift+R) and try again.');
    }

    const studio = studioBridge.getStudioProjectSnapshot();
    const forge = window.RelicForgeForge?.getForgeProjectState?.() || null;
    const name = String(studio?.ui?.collectionName || 'Untitled Collection').trim() || 'Untitled Collection';
    const id = (!asNew && currentProjectId && currentProjectOwner === wallet) ? currentProjectId : crypto.randomUUID();
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
      if (error?.name === 'QuotaExceededError') throw new Error('Browser storage is full. Export the project or remove older local projects, then try again.');
      throw error;
    }
    currentProjectId = id;
    currentProjectOwner = wallet;
    setStatus(`Saved “${name}” · ${new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, 'success');
    await renderProjects();
    return record;
  }

  async function loadProject(id) {
    if (!wallet) await connectWallet();
    const key = `${wallet}:${id}`;
    const record = await idbGet(key);
    if (!record) throw new Error('That project was not found for the connected wallet.');
    setStatus(`Opening “${record.name}”…`);
    await window.RelicForgeStudioBridge.restoreStudioProjectSnapshot(record.studio);
    window.RelicForgeForge?.restoreForgeProjectState?.(record.forge);
    currentProjectId = record.id;
    currentProjectOwner = record.owner;
    closeManager();
    setStatus(`Opened “${record.name}”.`, 'success');
  }

  async function deleteProject(id) {
    if (!wallet) return;
    const record = await idbGet(`${wallet}:${id}`);
    if (!record) return;
    if (!window.confirm(`Delete the local project “${record.name}”?\n\nThis removes the saved artwork and settings from this browser. Exported files and deployed contracts are not affected.`)) return;
    await idbDelete(record.key);
    if (currentProjectId === id && currentProjectOwner === wallet) {
      currentProjectId = null;
      currentProjectOwner = null;
    }
    setStatus(`Deleted local save “${record.name}”.`, 'success');
    await renderProjects();
  }

  async function renderStorageEstimate() {
    const node = $('projectStorageEstimate');
    if (!node || !navigator.storage?.estimate) return;
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      node.textContent = quota ? `Browser storage: ${formatBytes(usage)} used of approximately ${formatBytes(quota)}` : `Browser storage used: ${formatBytes(usage)}`;
    } catch {
      node.textContent = '';
    }
  }

  async function renderProjects() {
    const list = $('projectList');
    if (!list) return;
    if (!wallet) {
      list.innerHTML = '<div class="empty-state">Connect a wallet to view its locally saved projects.</div>';
      await renderStorageEstimate();
      return;
    }
    const projects = await idbListByOwner(wallet);
    if (!projects.length) {
      list.innerHTML = '<div class="empty-state">No projects saved for this wallet in this browser yet.</div>';
      await renderStorageEstimate();
      return;
    }
    list.innerHTML = projects.map(project => {
      const active = project.id === currentProjectId && currentProjectOwner === wallet;
      const updated = new Date(project.updatedAt);
      return `<article class="saved-project-card ${active ? 'active' : ''}">
        <div class="saved-project-main">
          <div class="saved-project-title-row"><strong>${esc(project.name)}</strong>${active ? '<span class="project-current-badge">OPEN</span>' : ''}</div>
          <span>${esc(updated.toLocaleString())} · ${esc(formatBytes(project.bytes || 0))}</span>
        </div>
        <div class="saved-project-actions">
          <button class="ghost-btn" data-load-project="${esc(project.id)}" type="button">Open</button>
          <button class="ghost-btn danger-btn" data-delete-project="${esc(project.id)}" type="button">Delete</button>
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
    $('projectList')?.addEventListener('click', event => {
      const load = event.target.closest('[data-load-project]');
      if (load) { loadProject(load.dataset.loadProject).catch(error => setStatus(error.message, 'error')); return; }
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
    initWalletState();
  }

  window.RelicForgeProjects = {
    version: '10.6.0',
    connectWallet,
    saveProject,
    openManager,
    getWallet: () => wallet,
    getCurrentProjectId: () => currentProjectId,
  };

  bind();
})();
