(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const projectId = params.get('collab');
  if (!projectId) return;

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let dirty = false;
  let booted = false;
  let access = null;
  let sourceSnapshot = null;
  let permissionObserver = null;
  let permissionRefreshQueued = false;

  function setStatus(message, tone = '') {
    let node = $('rc47bCollabStatus');
    if (!node) {
      node = document.createElement('div');
      node.id = 'rc47bCollabStatus';
      node.className = 'rc47b-collab-banner';
      const top = document.querySelector('.project-save-status') || document.querySelector('.wallet-save-gate') || document.querySelector('.topbar');
      top?.insertAdjacentElement('afterend', node);
    }
    node.className = `rc47b-collab-banner ${tone}`.trim();
    node.textContent = message;
  }

  async function waitForCore() {
    for (let i = 0; i < 200; i++) {
      if (window.RelicForgeCloud?.json && window.RelicForgeStudioBridge?.getStudioProjectSnapshot && window.RelicForgeForge?.getForgeProjectState) return;
      await sleep(50);
    }
    throw new Error('Shared Studio could not initialize because the Studio core did not become ready.');
  }

  async function ensureWallet() {
    if (!window.ethers) throw new Error('ethers.js is unavailable.');
    const provider = window.RelicForgeWalletSession?.getProvider?.() || window.RelicForgeWallets?.getProvider?.() || window.ethereum;
    let wallet = null;
    if (provider?.request) {
      const accounts = await provider.request({ method:'eth_accounts' }).catch(() => []);
      wallet = accounts?.[0] || null;
    }
    if (!wallet) {
      wallet = await window.RelicForgeWalletSession?.requestAccount?.({ forceChooser:false });
      if (!wallet) throw new Error('Connect a wallet to open this shared project.');
    }
    wallet = window.ethers.getAddress(wallet);
    await window.RelicForgeCloud.ensureSignedIn(wallet);
    return wallet;
  }

  async function collabBlob(marker) {
    const blob = await window.RelicForgeCloud.fetchBlob(
      `/api/rc47b/collab/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(marker.id)}/download`,
      true
    );
    return new File([blob], marker.name || 'asset', {
      type: marker.type || blob.type || 'application/octet-stream',
      lastModified: Number(marker.lastModified || Date.now()),
    });
  }

  async function decodeShared(value, cache = new Map()) {
    if (value?.__relicforgeAsset && value.id) {
      if (!cache.has(value.id)) cache.set(value.id, collabBlob(value));
      return cache.get(value.id);
    }
    if (Array.isArray(value)) return Promise.all(value.map(child => decodeShared(child, cache)));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = await decodeShared(child, cache);
      return out;
    }
    return value;
  }

  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function uploadSharedAsset(file, section = 'artwork') {
    if (!(file instanceof Blob)) return file;
    if (access?.role !== 'owner' && !access?.permissions?.includes(section)) {
      throw new Error(`This collaborator does not have ${section} permission.`);
    }
    const filename = file.name || 'asset.bin';
    const contentType = file.type || 'application/octet-stream';
    const hash = await sha256(file);
    const prepared = await window.RelicForgeCloud.json(
      `/api/rc47b/collab/projects/${encodeURIComponent(projectId)}/assets/prepare`,
      { method:'POST', body:JSON.stringify({ filename, contentType, size:file.size, sha256:hash, section }) },
      true
    );
    if (!prepared.reused) {
      await window.RelicForgeCloud.uploadBinary(
        `/api/rc47b/collab/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(prepared.asset.id)}/upload`,
        file,
        true
      );
    }
    return {
      __relicforgeAsset:1,
      id:prepared.asset.id,
      name:filename,
      type:contentType,
      size:Number(file.size || prepared.asset.size_bytes || prepared.asset.size || 0),
      lastModified:Number(file.lastModified || Date.now()),
      sha256:hash,
    };
  }

  function assetSection(path) {
    const joined = path.join('.').toLowerCase();
    if (/mintpage|mint_page|banner|showcase/.test(joined)) return 'mint_page';
    if (/placeholderfile/.test(joined)) return 'launch';
    return 'artwork';
  }

  async function encodeShared(value, path = [], cache = new Map()) {
    if (value instanceof Blob) {
      if (!cache.has(value)) cache.set(value, uploadSharedAsset(value, assetSection(path)));
      return cache.get(value);
    }
    if (value?.__relicforgeAsset && value.id) return value;
    if (Array.isArray(value)) return Promise.all(value.map((child, index) => encodeShared(child, [...path, String(index)], cache)));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = await encodeShared(child, [...path, key], cache);
      return out;
    }
    return value;
  }

  function bypassNavigationControl(control) {
    if (!(control instanceof HTMLButtonElement)) return false;
    if (control.matches('.back-btn,[data-back],[data-next]')) return true;
    return ['toLaunchBtn'].includes(control.id);
  }

  function lockRegion(region, allowed) {
    if (!region) return;
    region.classList.toggle('rc47b-readonly', !allowed);
    region.querySelectorAll('input,select,textarea,button').forEach(control => {
      if (bypassNavigationControl(control)) { control.dataset.rc47bAllow = '1'; return; }
      if (!allowed) {
        if (!control.disabled) control.dataset.rc47bDisabled = '1';
        control.disabled = true;
      } else if (control.dataset.rc47bDisabled === '1') {
        control.disabled = false;
        delete control.dataset.rc47bDisabled;
      }
    });
  }

  function has(permission) {
    return access?.role === 'owner' || access?.permissions?.includes(permission);
  }

  function applyPermissions() {
    lockRegion(document.querySelector('[data-panel="1"]'), has('artwork'));
    lockRegion(document.querySelector('[data-panel="2"]'), has('rarity'));
    lockRegion(document.querySelector('[data-panel="3"]'), has('rules'));
    lockRegion(document.querySelector('[data-panel="4"]'), has('curation'));
    lockRegion(document.querySelector('.forge-launch-layout'), has('launch'));
    lockRegion(document.querySelector('.mint-page-builder-card'), has('mint_page'));

    // Collaborators may prepare launch/mint-page data but must never inherit the
    // creator/controller's onchain signing authority. These controls remain disabled
    // even when the collaborator has Launch Setup permission.
    if (access?.role === 'collaborator') {
      [
        'connectForgeWalletBtn','forgeCollectionBtn','forgeArmMintBtn','forgeMintTestBtn',
        'forgeWhitelistMintBtn','forgeCreatorMintBtn','forgeDeferredRevealBtn','forgeProcessRevealBtn'
      ].forEach(id => {
        const control = $(id);
        if (!control) return;
        control.disabled = true;
        control.dataset.rc47bCreatorOnly = '1';
        control.title = 'Creator/controller wallet required. Collaboration never grants onchain signing authority.';
      });
    }

    const save = $('saveProjectBtn');
    const saveLabel = access?.role === 'collaborator' ? 'Save Collaboration Version' : 'Save Shared Version';
    if (save && save.textContent !== saveLabel) save.textContent = saveLabel;
    const managerSave = $('projectManagerSaveBtn');
    if (managerSave && managerSave.textContent !== saveLabel) managerSave.textContent = saveLabel;
    const newProject = $('newProjectBtn');
    if (newProject) {
      newProject.disabled = true;
      newProject.title = 'Exit Shared Studio before starting another project.';
    }
  }

  function schedulePermissionRefresh() {
    if (permissionRefreshQueued || !access) return;
    permissionRefreshQueued = true;
    requestAnimationFrame(() => {
      permissionRefreshQueued = false;
      applyPermissions();
    });
  }

  function installPermissionGuard() {
    if (!permissionObserver) {
      permissionObserver = new MutationObserver(schedulePermissionRefresh);
      permissionObserver.observe($('studioApp') || document.body, { childList:true, subtree:true });
    }
    document.addEventListener('click', event => {
      if (access?.role !== 'collaborator') return;
      const target = event.target?.closest?.('[data-rc47b-creator-only="1"]');
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus('Creator/controller wallet required. Collaboration never grants onchain signing authority.', 'error');
    }, true);
  }

  function noteDialog(required) {
    return new Promise(resolve => {
      const existing = $('rc47bNoteModal');
      existing?.remove();
      const modal = document.createElement('div');
      modal.id = 'rc47bNoteModal';
      modal.className = 'rc47b-note-modal';
      modal.innerHTML = `
        <div class="rc47b-note-backdrop"></div>
        <section class="rc47b-note-card" role="dialog" aria-modal="true" aria-labelledby="rc47bNoteTitle">
          <div class="eyebrow">COLLABORATION VERSION</div>
          <h2 id="rc47bNoteTitle">Describe this change</h2>
          <p>${required ? 'A short note is required so the creator can see what changed.' : 'Add an optional note for the project history.'}</p>
          <textarea id="rc47bChangeNote" maxlength="1000" rows="4" placeholder="What did you change?"></textarea>
          <div class="inline-actions"><button class="ghost-btn" id="rc47bCancelNote" type="button">Cancel</button><button class="primary-btn" id="rc47bSaveNote" type="button">Save Version</button></div>
        </section>`;
      document.body.appendChild(modal);
      const input = $('rc47bChangeNote');
      input.focus();
      const finish = value => { modal.remove(); resolve(value); };
      $('rc47bCancelNote').onclick = () => finish(null);
      modal.querySelector('.rc47b-note-backdrop').onclick = () => finish(null);
      $('rc47bSaveNote').onclick = () => {
        const value = input.value.trim();
        if (required && !value) { input.focus(); input.setCustomValidity('A change note is required.'); input.reportValidity(); input.setCustomValidity(''); return; }
        finish(value);
      };
    });
  }

  async function saveShared() {
    if (!access) throw new Error('Shared project is not loaded.');
    const note = await noteDialog(access.role === 'collaborator');
    if (note === null) return;
    setStatus('Saving shared project version…');
    const studio = window.RelicForgeStudioBridge.getStudioProjectSnapshot();
    const forge = window.RelicForgeForge?.getForgeProjectState?.() || null;
    const snapshot = await encodeShared({ schema:'relic-forge/cloud-project@1', studio, forge }, []);
    const name = String(studio?.ui?.collectionName || $('launchName')?.value || access.project.name || 'Untitled Collection').trim().slice(0, 180);
    const result = await window.RelicForgeCloud.json(
      `/api/rc47b/collab/projects/${encodeURIComponent(projectId)}/versions`,
      { method:'POST', body:JSON.stringify({ name, snapshot, note }) },
      true
    );
    sourceSnapshot = snapshot;
    access.project.snapshot = snapshot;
    access.project.current_version = result.version;
    dirty = false;
    setStatus(`Saved version ${result.version} · ${result.changeSections?.length ? result.changeSections.join(', ') : 'no material section changes'}.`, 'success');
  }

  function captureSharedSave(event) {
    const target = event.target?.closest?.('#saveProjectBtn,#projectManagerSaveBtn,#projectManagerSaveAsBtn');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    saveShared().catch(error => setStatus(`Shared save failed: ${error.message}`, 'error'));
  }

  function trackDirty(event) {
    if (!booted) return;
    if (event.target?.closest?.('#rc47bNoteModal')) return;
    dirty = true;
  }

  function installDirtyGuard() {
    document.addEventListener('input', trackDirty, true);
    document.addEventListener('change', trackDirty, true);
    window.addEventListener('beforeunload', event => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  async function loadSharedProject() {
    await waitForCore();
    await ensureWallet();
    const response = await window.RelicForgeCloud.json(`/api/rc47b/collab/projects/${encodeURIComponent(projectId)}`, {}, true);
    access = response;
    const decoded = await decodeShared(response.project.snapshot);

    window.RelicForgeCollabContext = {
      active:true,
      projectId,
      project:response.project,
      role:response.role,
      permissions:[...(response.permissions || [])],
      uploadAsset:uploadSharedAsset,
      save:saveShared,
    };

    // Founder Support and Collaboration are deliberately independent authority paths.
    if (new URLSearchParams(location.search).has('support')) throw new Error('Founder Support Mode and Collaboration Mode cannot be active at the same time.');

    await window.RelicForgeStudioBridge.restoreStudioProjectSnapshot(decoded.studio);
    await window.RelicForgeForge?.restoreForgeProjectState?.(decoded.forge || null);
    sourceSnapshot = response.project.snapshot;
    applyPermissions();
    installPermissionGuard();

    const permissionText = response.role === 'owner' ? 'Full creator project access' : (response.permissions || []).join(' · ') || 'Read-only';
    setStatus(`SHARED STUDIO · ${response.project.name} · ${response.role === 'owner' ? 'Creator' : 'Collaborator'} · ${permissionText}`, 'success');

    document.addEventListener('click', captureSharedSave, true);
    installDirtyGuard();
    booted = true;
    dirty = false;
  }

  loadSharedProject().catch(error => {
    console.error('RC4.7B Shared Studio failed:', error);
    setStatus(`Shared Studio error: ${error.message}`, 'error');
  });
})();
