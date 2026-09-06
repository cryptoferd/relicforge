(() => {
  'use strict';

  const PERMISSIONS = Object.freeze([
    ['artwork', 'Artwork & Layers'],
    ['rarity', 'Rarity & Metadata'],
    ['rules', 'Trait Rules'],
    ['curation', 'Curation & Preview'],
    ['launch', 'Launch Setup'],
    ['mint_page', 'Mint Page & Showcase'],
  ]);
  const ALL_PERMISSIONS = Object.freeze(PERMISSIONS.map(([id]) => id));

  const state = {
    projects: [],
    selectedId: null,
    selectedAccess: null,
    collaborators: [],
    versions: [],
    activeTab: 'mine',
    installed: false,
  };

  const $ = id => document.getElementById(id);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function short(value) {
    const text = String(value || '');
    return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-4)}` : (text || '—');
  }

  function roleFromPermissions(permissions = []) {
    const set = new Set((permissions || []).map(String));
    if (!set.size) return 'viewer';
    if (ALL_PERMISSIONS.every(id => set.has(id)) && set.size === ALL_PERMISSIONS.length) return 'editor';
    return 'custom';
  }

  function roleLabel(role) {
    if (role === 'editor') return 'Editor';
    if (role === 'viewer') return 'Viewer';
    if (role === 'owner') return 'Owner';
    return 'Custom';
  }

  function permissionLabels(permissions = []) {
    const set = new Set((permissions || []).map(String));
    return PERMISSIONS.filter(([id]) => set.has(id)).map(([, label]) => label);
  }

  function cloud() {
    if (!window.RelicForgeCloud?.enabled?.()) throw new Error('RelicForge Cloud is required for collaboration.');
    return window.RelicForgeCloud;
  }

  function currentWallet() {
    return window.RelicForgeProjects?.getWallet?.() || window.RelicForgeCloud?.loadSession?.()?.wallet || null;
  }

  async function ensureSignedIn() {
    let wallet = currentWallet();
    if (!wallet) {
      if (!window.RelicForgeProjects?.connectWallet) throw new Error('Connect a wallet to manage project collaboration.');
      wallet = await window.RelicForgeProjects.connectWallet({ requireCloud: true });
    }
    await cloud().ensureSignedIn(wallet);
    return wallet;
  }

  async function api(path, options = {}) {
    await ensureSignedIn();
    return cloud().json(path, options, true);
  }

  function setStatus(message, tone = '') {
    const node = $('studioCollabStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `studio-collab-status ${tone}`.trim();
  }

  function ownedUiNodes() {
    const panel = document.querySelector('#projectManagerModal .project-modal-panel');
    return [
      panel?.querySelector('.project-local-note'),
      $('projectList'),
      $('projectStorageEstimate'),
      panel?.querySelector('.project-modal-actions'),
    ].filter(Boolean);
  }

  function setTab(tab, { projectId = null, quiet = false } = {}) {
    state.activeTab = tab;
    document.querySelectorAll('[data-studio-project-tab]').forEach(button => {
      const active = button.dataset.studioProjectTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const own = tab === 'mine';
    ownedUiNodes().forEach(node => node.classList.toggle('hidden', !own));
    $('studioSharedProjectsPane')?.classList.toggle('hidden', tab !== 'shared');
    $('studioCollaboratorsPane')?.classList.toggle('hidden', tab !== 'access');

    if (!quiet && tab !== 'mine') {
      loadProjectAccess()
        .then(async () => {
          if (tab === 'access') {
            const wanted = projectId || state.selectedId || state.projects.find(project => project.role === 'owner')?.id || state.projects[0]?.id || null;
            if (wanted) await selectAccessProject(wanted);
          }
        })
        .catch(error => setStatus(error.message, 'error'));
    }
  }

  function buildPermissionPicker() {
    const host = $('studioCollabPermissionPicker');
    if (!host) return;
    host.innerHTML = PERMISSIONS.map(([id, label]) => `
      <label class="studio-collab-permission">
        <input type="checkbox" value="${id}" />
        <span>${esc(label)}</span>
      </label>`).join('');
  }

  function selectedCustomPermissions() {
    return [...($('studioCollabPermissionPicker')?.querySelectorAll('input:checked') || [])].map(input => input.value);
  }

  function setCustomPermissions(permissions = []) {
    const chosen = new Set((permissions || []).map(String));
    $('studioCollabPermissionPicker')?.querySelectorAll('input').forEach(input => {
      input.checked = chosen.has(input.value);
    });
  }

  function syncRolePicker() {
    const role = $('studioCollabRole')?.value || 'editor';
    const wrap = $('studioCollabCustomPermissions');
    wrap?.classList.toggle('hidden', role !== 'custom');
    if (role === 'editor') setCustomPermissions(ALL_PERMISSIONS);
    if (role === 'viewer') setCustomPermissions([]);
  }

  function resetCollaboratorForm() {
    if ($('studioCollabWalletInput')) $('studioCollabWalletInput').value = '';
    if ($('studioCollabRole')) $('studioCollabRole').value = 'editor';
    setCustomPermissions(ALL_PERMISSIONS);
    syncRolePicker();
    if ($('studioCollabSaveAccessBtn')) $('studioCollabSaveAccessBtn').textContent = 'Add Collaborator';
  }

  function renderSharedProjects() {
    const host = $('studioSharedProjectList');
    if (!host) return;
    const rows = state.projects.filter(project => project.role !== 'owner');
    if (!rows.length) {
      host.innerHTML = '<div class="empty-state">No Studio projects have been shared with this wallet yet.</div>';
      return;
    }
    host.innerHTML = rows.map(project => {
      const role = roleFromPermissions(project.permissions || []);
      const labels = permissionLabels(project.permissions || []);
      const updated = project.updated_at ? new Date(project.updated_at).toLocaleString() : 'Unknown';
      return `<article class="studio-shared-project-card">
        <div>
          <div class="studio-shared-title"><strong>${esc(project.name || 'Untitled Project')}</strong><span>${esc(roleLabel(role))}</span></div>
          <code>${esc(project.owner_wallet || '')}</code>
          <small>Version ${Number(project.current_version || 0)} · Updated ${esc(updated)}</small>
          <p>${role === 'viewer' ? 'Read-only project access.' : (labels.length ? esc(labels.join(' · ')) : 'Custom project access.')}</p>
        </div>
        <div class="saved-project-actions">
          <button class="primary-btn" data-open-shared-project="${esc(project.id)}" type="button">Open Shared Studio</button>
          <button class="ghost-btn" data-shared-history-project="${esc(project.id)}" type="button">History</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderProjectSelector() {
    const select = $('studioCollabProjectSelect');
    if (!select) return;
    const previous = state.selectedId || select.value;
    if (!state.projects.length) {
      select.innerHTML = '<option value="">No cloud projects available</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const owned = state.projects.filter(project => project.role === 'owner');
    const shared = state.projects.filter(project => project.role !== 'owner');
    const options = [];
    if (owned.length) {
      options.push(`<optgroup label="Owned projects">${owned.map(project =>
        `<option value="${esc(project.id)}">${esc(project.name || 'Untitled Project')}</option>`).join('')}</optgroup>`);
    }
    if (shared.length) {
      options.push(`<optgroup label="Shared with me">${shared.map(project => {
        const role = roleFromPermissions(project.permissions || []);
        return `<option value="${esc(project.id)}">${esc(project.name || 'Untitled Project')} — ${esc(roleLabel(role))}</option>`;
      }).join('')}</optgroup>`);
    }
    select.innerHTML = options.join('');
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }

  async function loadProjectAccess() {
    setStatus('Loading Studio project access…');
    const payload = await api('/api/rc47b/collab/projects');
    state.projects = payload.projects || [];
    renderSharedProjects();
    renderProjectSelector();
    decorateOwnedProjectCards();
    setStatus(`Loaded ${state.projects.length} cloud project${state.projects.length === 1 ? '' : 's'}.`, 'success');
    return state.projects;
  }

  async function loadCollaborators() {
    const access = state.selectedAccess;
    const host = $('studioCollaboratorList');
    if (!host) return;
    if (!access || access.role !== 'owner') {
      host.innerHTML = '<div class="empty-state">Only the project owner can add, edit, or remove collaborators.</div>';
      return;
    }

    const payload = await api(`/api/rc47b/collab/projects/${encodeURIComponent(access.project.id)}/collaborators`);
    state.collaborators = payload.collaborators || [];
    if (!state.collaborators.length) {
      host.innerHTML = '<div class="empty-state">No collaborators yet. Add an EVM wallet above whenever you are ready.</div>';
      return;
    }

    host.innerHTML = state.collaborators.map((row, index) => {
      const role = roleFromPermissions(row.permissions || []);
      const labels = permissionLabels(row.permissions || []);
      return `<article class="studio-collaborator-row">
        <div>
          <div class="studio-shared-title"><strong>${esc(short(row.wallet))}</strong><span>${esc(roleLabel(role))}</span></div>
          <code>${esc(row.wallet)}</code>
          <small>${role === 'viewer' ? 'Read only' : (role === 'editor' ? 'Can edit all Studio sections' : esc(labels.join(' · ') || 'Custom access'))}</small>
        </div>
        <div class="saved-project-actions">
          <button class="ghost-btn" data-edit-collaborator="${index}" type="button">Edit</button>
          <button class="ghost-btn danger-btn" data-remove-collaborator="${index}" type="button">Remove</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderOwnerControls() {
    const access = state.selectedAccess;
    const owner = access?.role === 'owner';
    $('studioCollabOwnerControls')?.classList.toggle('hidden', !owner);
    const note = $('studioCollabAccessNote');
    if (!note) return;
    if (!access) {
      note.textContent = 'Choose a project to manage its access.';
    } else if (owner) {
      note.textContent = 'Add collaborators now or at any point later. Project access never grants the creator wallet’s onchain signing authority.';
    } else {
      const role = roleFromPermissions(access.permissions || []);
      note.textContent = `This project is shared with you as ${roleLabel(role)}. Only the owner can change collaborator access.`;
    }
  }

  async function loadHistory() {
    const access = state.selectedAccess;
    const host = $('studioCollabHistory');
    if (!host || !access) return;
    const payload = await api(`/api/rc47b/collab/projects/${encodeURIComponent(access.project.id)}/versions`);
    state.versions = payload.versions || [];
    if (!state.versions.length) {
      host.innerHTML = '<div class="empty-state">No collaboration version history is available yet.</div>';
      return;
    }

    host.innerHTML = state.versions.map((row, index) => {
      const when = row.created_at ? new Date(row.created_at).toLocaleString() : '';
      const sections = Array.isArray(row.change_sections) ? row.change_sections : [];
      const current = Number(row.version) === Number(access.project.current_version);
      return `<article class="studio-history-row">
        <div class="studio-history-version">v${Number(row.version)}${current ? '<span>CURRENT</span>' : ''}</div>
        <div>
          <code>${esc(short(row.actor_wallet || access.project.owner_wallet))}</code>
          <strong>${esc(String(row.action || 'save').replaceAll('_', ' '))}</strong>
          <small>${esc(sections.join(' · ') || 'No classified section changes')} · ${esc(when)}</small>
          ${row.note ? `<p>${esc(row.note)}</p>` : ''}
        </div>
        ${access.role === 'owner' && !current ? `<button class="ghost-btn" data-restore-collab-version="${index}" type="button">Restore</button>` : ''}
      </article>`;
    }).join('');
  }

  async function selectAccessProject(id) {
    if (!id) return;
    state.selectedId = id;
    if ($('studioCollabProjectSelect')) $('studioCollabProjectSelect').value = id;
    setStatus('Loading project access…');

    const payload = await api(`/api/rc47b/collab/projects/${encodeURIComponent(id)}`);
    state.selectedAccess = payload;
    if (payload.project) state.selectedAccess.project.id = id;

    const heading = $('studioCollabSelectedProject');
    if (heading) {
      const role = payload.role === 'owner' ? 'Owner' : roleLabel(roleFromPermissions(payload.permissions || []));
      heading.innerHTML = `<strong>${esc(payload.project?.name || 'Untitled Project')}</strong><span>${esc(role)} · v${Number(payload.project?.current_version || 0)}</span>`;
    }

    renderOwnerControls();
    resetCollaboratorForm();
    await Promise.all([
      payload.role === 'owner' ? loadCollaborators() : Promise.resolve(renderOwnerControls()),
      loadHistory(),
    ]);
    if (payload.role !== 'owner' && $('studioCollaboratorList')) {
      $('studioCollaboratorList').innerHTML = '<div class="empty-state">Collaborator management is available only to the project owner.</div>';
    }
    setStatus('Project access loaded.', 'success');
  }

  async function saveCollaborator() {
    const access = state.selectedAccess;
    if (!access || access.role !== 'owner') throw new Error('Choose an owned project first.');
    const collaborator = String($('studioCollabWalletInput')?.value || '').trim();
    if (!window.ethers?.isAddress(collaborator)) throw new Error('Enter a valid EVM collaborator wallet.');

    const role = $('studioCollabRole')?.value || 'editor';
    let permissions = [];
    if (role === 'editor') permissions = [...ALL_PERMISSIONS];
    else if (role === 'custom') permissions = selectedCustomPermissions();

    setStatus(`Saving ${roleLabel(role)} access for ${short(collaborator)}…`);
    await api(`/api/rc47b/collab/projects/${encodeURIComponent(access.project.id)}/collaborators/${encodeURIComponent(collaborator)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permissions }),
    });

    resetCollaboratorForm();
    await Promise.all([loadCollaborators(), loadProjectAccess()]);
    setStatus(`Access saved for ${short(collaborator)}.`, 'success');
  }

  function editCollaborator(index) {
    const row = state.collaborators[index];
    if (!row) return;
    const role = roleFromPermissions(row.permissions || []);
    if ($('studioCollabWalletInput')) $('studioCollabWalletInput').value = row.wallet;
    if ($('studioCollabRole')) $('studioCollabRole').value = role;
    setCustomPermissions(row.permissions || []);
    syncRolePicker();
    if ($('studioCollabSaveAccessBtn')) $('studioCollabSaveAccessBtn').textContent = 'Update Collaborator';
    $('studioCollabWalletInput')?.focus();
  }

  async function removeCollaborator(index) {
    const access = state.selectedAccess;
    const row = state.collaborators[index];
    if (!access || access.role !== 'owner' || !row) return;
    if (!window.confirm(`Remove Studio access for ${short(row.wallet)}? Their next cloud read or save will be rejected.`)) return;
    setStatus(`Removing ${short(row.wallet)}…`);
    await api(`/api/rc47b/collab/projects/${encodeURIComponent(access.project.id)}/collaborators/${encodeURIComponent(row.wallet)}`, { method: 'DELETE' });
    await Promise.all([loadCollaborators(), loadProjectAccess()]);
    setStatus(`Removed ${short(row.wallet)}.`, 'success');
  }

  async function restoreVersion(index) {
    const access = state.selectedAccess;
    const row = state.versions[index];
    if (!access || access.role !== 'owner' || !row) return;
    const version = Number(row.version);
    if (!window.confirm(`Restore version ${version}? Relic Forge will create a new version and keep the later history intact.`)) return;
    const note = window.prompt('Rollback note:', `Restore version ${version}`) || `Restore version ${version}`;
    setStatus(`Restoring version ${version}…`);
    const result = await api(`/api/rc47b/collab/projects/${encodeURIComponent(access.project.id)}/rollback/${version}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    access.project.current_version = result.version;
    await Promise.all([loadHistory(), loadProjectAccess()]);
    setStatus(`Version ${version} restored as new version ${result.version}.`, 'success');
  }

  function decorateOwnedProjectCards() {
    const list = $('projectList');
    if (!list) return;
    list.querySelectorAll('.saved-project-card').forEach(card => {
      if (card.querySelector('[data-studio-collaborators]')) return;
      const load = card.querySelector('[data-load-project]');
      const cloudMarker = card.querySelector('[data-support-project]');
      if (!load || !cloudMarker) return;
      const actions = card.querySelector('.saved-project-actions');
      if (!actions) return;
      const button = document.createElement('button');
      button.className = 'ghost-btn';
      button.type = 'button';
      button.dataset.studioCollaborators = load.dataset.loadProject;
      button.textContent = 'Collaborators';
      actions.insertBefore(button, cloudMarker);
    });
  }

  function installUi() {
    if (state.installed) return true;
    const modal = $('projectManagerModal');
    const panel = modal?.querySelector('.project-modal-panel');
    const walletStrip = panel?.querySelector('.project-wallet-strip');
    const projectList = $('projectList');
    if (!modal || !panel || !walletStrip || !projectList) return false;

    const tabs = document.createElement('div');
    tabs.className = 'studio-project-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = `
      <button class="active" data-studio-project-tab="mine" role="tab" aria-selected="true" type="button">My Projects</button>
      <button data-studio-project-tab="shared" role="tab" aria-selected="false" type="button">Shared With Me</button>
      <button data-studio-project-tab="access" role="tab" aria-selected="false" type="button">Collaborators & History</button>`;
    walletStrip.insertAdjacentElement('afterend', tabs);

    const sharedPane = document.createElement('section');
    sharedPane.id = 'studioSharedProjectsPane';
    sharedPane.className = 'studio-collab-pane hidden';
    sharedPane.innerHTML = `
      <div class="studio-collab-heading">
        <div><strong>Shared With Me</strong><span>Projects another creator has shared with this wallet.</span></div>
        <button class="ghost-btn" id="studioSharedRefreshBtn" type="button">Refresh</button>
      </div>
      <div class="studio-shared-list" id="studioSharedProjectList"><div class="empty-state">Connect and sign in to load shared projects.</div></div>`;
    projectList.insertAdjacentElement('beforebegin', sharedPane);

    const accessPane = document.createElement('section');
    accessPane.id = 'studioCollaboratorsPane';
    accessPane.className = 'studio-collab-pane hidden';
    accessPane.innerHTML = `
      <div class="studio-collab-heading">
        <div><strong>Collaborators & History</strong><span>Add collaborators to any existing cloud-saved Studio project. No advance setup is required.</span></div>
        <button class="ghost-btn" id="studioCollabRefreshBtn" type="button">Refresh</button>
      </div>

      <label class="field studio-collab-project-select"><span>Project</span><select id="studioCollabProjectSelect"><option value="">Loading projects…</option></select></label>
      <div class="studio-collab-selected" id="studioCollabSelectedProject"></div>
      <div class="studio-collab-status" id="studioCollabStatus">Choose a project.</div>
      <div class="studio-collab-access-note" id="studioCollabAccessNote">Choose a project to manage its access.</div>

      <div id="studioCollabOwnerControls" class="studio-collab-owner-controls hidden">
        <div class="studio-collab-section-head"><strong>Add or update a collaborator</strong><span>The wallet does not need to be online or connected when you add it.</span></div>
        <div class="studio-collab-form">
          <label class="field"><span>Collaborator wallet</span><input id="studioCollabWalletInput" type="text" placeholder="0x..." /></label>
          <label class="field"><span>Role</span><select id="studioCollabRole">
            <option value="editor">Editor — all Studio sections</option>
            <option value="viewer">Viewer — read only</option>
            <option value="custom">Custom permissions</option>
          </select></label>
        </div>
        <div id="studioCollabCustomPermissions" class="studio-collab-custom hidden">
          <span>Custom edit permissions</span>
          <div id="studioCollabPermissionPicker" class="studio-collab-permissions"></div>
        </div>
        <div class="inline-actions"><button class="primary-btn" id="studioCollabSaveAccessBtn" type="button">Add Collaborator</button><button class="ghost-btn" id="studioCollabClearAccessBtn" type="button">Clear</button></div>
      </div>

      <div class="studio-collab-columns">
        <section>
          <div class="studio-collab-section-head"><strong>Project collaborators</strong><span>Removal takes effect on the next API read or save.</span></div>
          <div id="studioCollaboratorList" class="studio-collaborator-list"><div class="empty-state">Choose an owned project to manage collaborators.</div></div>
        </section>
        <section>
          <div class="studio-collab-section-head"><strong>Version history</strong><span>Every shared save records the actor, sections changed, note, and version.</span></div>
          <div id="studioCollabHistory" class="studio-history-list"><div class="empty-state">Choose a project to view history.</div></div>
        </section>
      </div>`;

    sharedPane.insertAdjacentElement('afterend', accessPane);

    tabs.addEventListener('click', event => {
      const button = event.target.closest('[data-studio-project-tab]');
      if (button) setTab(button.dataset.studioProjectTab);
    });
    $('studioSharedRefreshBtn')?.addEventListener('click', () => loadProjectAccess().catch(error => setStatus(error.message, 'error')));
    $('studioCollabRefreshBtn')?.addEventListener('click', () => loadProjectAccess().then(() => state.selectedId ? selectAccessProject(state.selectedId) : null).catch(error => setStatus(error.message, 'error')));
    $('studioCollabProjectSelect')?.addEventListener('change', event => selectAccessProject(event.target.value).catch(error => setStatus(error.message, 'error')));
    $('studioCollabRole')?.addEventListener('change', syncRolePicker);
    $('studioCollabSaveAccessBtn')?.addEventListener('click', () => saveCollaborator().catch(error => setStatus(error.message, 'error')));
    $('studioCollabClearAccessBtn')?.addEventListener('click', resetCollaboratorForm);

    $('studioSharedProjectList')?.addEventListener('click', event => {
      const open = event.target.closest('[data-open-shared-project]');
      if (open) {
        location.href = `./studio.html?collab=${encodeURIComponent(open.dataset.openSharedProject)}`;
        return;
      }
      const history = event.target.closest('[data-shared-history-project]');
      if (history) setTab('access', { projectId: history.dataset.sharedHistoryProject });
    });

    $('studioCollaboratorList')?.addEventListener('click', event => {
      const edit = event.target.closest('[data-edit-collaborator]');
      if (edit) { editCollaborator(Number(edit.dataset.editCollaborator)); return; }
      const remove = event.target.closest('[data-remove-collaborator]');
      if (remove) removeCollaborator(Number(remove.dataset.removeCollaborator)).catch(error => setStatus(error.message, 'error'));
    });

    $('studioCollabHistory')?.addEventListener('click', event => {
      const restore = event.target.closest('[data-restore-collab-version]');
      if (restore) restoreVersion(Number(restore.dataset.restoreCollabVersion)).catch(error => setStatus(error.message, 'error'));
    });

    projectList.addEventListener('click', event => {
      const button = event.target.closest('[data-studio-collaborators]');
      if (!button) return;
      event.preventDefault();
      setTab('access', { projectId: button.dataset.studioCollaborators });
    });

    new MutationObserver(decorateOwnedProjectCards).observe(projectList, { childList: true, subtree: true });
    new MutationObserver(() => {
      if (!modal.classList.contains('hidden') && state.activeTab !== 'mine') {
        loadProjectAccess().then(() => state.activeTab === 'access' && state.selectedId ? selectAccessProject(state.selectedId) : null).catch(error => setStatus(error.message, 'error'));
      }
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('relicforge:wallet-connected', () => {
      if (!modal.classList.contains('hidden') && state.activeTab !== 'mine') loadProjectAccess().catch(error => setStatus(error.message, 'error'));
    });
    window.addEventListener('relicforge:wallet-disconnected', () => {
      state.projects = [];
      state.selectedId = null;
      state.selectedAccess = null;
      renderSharedProjects();
      renderProjectSelector();
      setStatus('Connect a wallet to load collaboration.', '');
    });

    buildPermissionPicker();
    resetCollaboratorForm();
    decorateOwnedProjectCards();
    state.installed = true;
    return true;
  }

  async function init() {
    for (let i = 0; i < 200; i++) {
      if (installUi()) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!state.installed) return;

    const params = new URLSearchParams(location.search);
    if (params.get('projects') === 'shared') {
      try {
        if (!currentWallet()) await window.RelicForgeProjects?.connectWallet?.({ requireCloud: true });
      } catch (_) {}
      window.RelicForgeProjects?.openManager?.();
      setTab('shared');
      return;
    }

    $('openProjectsBtn')?.addEventListener('click', () => {
      setTab('mine', { quiet: true });
      setTimeout(decorateOwnedProjectCards, 0);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
