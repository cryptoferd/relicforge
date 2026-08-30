(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const PERMS = [
    ['artwork', 'Artwork & Layers'],
    ['rarity', 'Rarity & Metadata'],
    ['rules', 'Trait Rules'],
    ['curation', 'Curation & Preview'],
    ['launch', 'Launch Setup'],
    ['mint_page', 'Mint Page & Showcase'],
  ];
  const state = { wallet: null, projects: [], selected: null };

  function short(value) { const s = String(value || ''); return s.length > 12 ? `${s.slice(0,6)}…${s.slice(-4)}` : s; }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function status(text, mode='') { $('collabStatus').className = `rc47b-status${mode ? ` ${mode}` : ''}`; $('collabStatus').textContent = text; }

  async function api(path, options = {}) {
    if (!window.RelicForgeCloud?.enabled?.()) throw new Error('RelicForge Cloud API is not configured.');
    return window.RelicForgeCloud.json(path, options, true);
  }

  async function connect({ forceChooser = false } = {}) {
    if (!window.ethers) throw new Error('ethers.js did not load.');
    let address;
    if (window.RelicForgeWallets?.requestAccount) address = await window.RelicForgeWallets.requestAccount({ forceChooser });
    else {
      const accounts = await window.ethereum?.request?.({ method: 'eth_requestAccounts' });
      address = accounts?.[0];
    }
    if (!address) throw new Error('No wallet account selected.');
    state.wallet = window.ethers.getAddress(address);
    await window.RelicForgeCloud.ensureSignedIn(state.wallet);
    $('collabWalletLabel').textContent = `${short(state.wallet)} · signed in`;
    $('collabConnectBtn').textContent = short(state.wallet);
    $('collabRefreshBtn').disabled = false;
    return state.wallet;
  }

  function permissionPicker(selected = []) {
    $('collabPermissionPicker').innerHTML = PERMS.map(([id,label]) => `
      <label class="rc47b-perm"><input type="checkbox" value="${id}" ${selected.includes(id) ? 'checked' : ''}/><span>${label}</span></label>`).join('');
  }

  function selectedPermissions() {
    return [...$('collabPermissionPicker').querySelectorAll('input:checked')].map(input => input.value);
  }

  function renderProjects() {
    const host = $('collabProjectList');
    if (!state.projects.length) { host.innerHTML = '<div class="rc47b-empty">No owned or shared cloud projects found for this wallet.</div>'; return; }
    host.innerHTML = state.projects.map(project => `
      <div class="rc47b-project">
        <div>
          <strong>${esc(project.name)}</strong>
          <span class="rc47b-pill">${esc(project.role)}</span>
          <small>Version ${Number(project.current_version || 0)} · updated ${new Date(project.updated_at).toLocaleString()}</small>
          <code>${esc(project.id)}</code>
        </div>
        <div class="rc47b-actions">
          <button class="rc47b-btn" data-open="${esc(project.id)}" type="button">Open Shared Studio</button>
          <button class="rc47b-btn primary" data-manage="${esc(project.id)}" type="button">Manage</button>
        </div>
      </div>`).join('');
    host.querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', () => window.location.href = `./studio.html?collab=${encodeURIComponent(btn.dataset.open)}`));
    host.querySelectorAll('[data-manage]').forEach(btn => btn.addEventListener('click', () => selectProject(btn.dataset.manage)));
  }

  async function loadProjects() {
    if (!state.wallet) await connect();
    status('Loading owned and shared projects…');
    const payload = await api('/api/rc47b/collab/projects');
    state.projects = payload.projects || [];
    renderProjects();
    status(`Loaded ${state.projects.length} project${state.projects.length === 1 ? '' : 's'}.`, 'good');
    if (state.selected) {
      const still = state.projects.find(p => p.id === state.selected.id);
      if (still) await selectProject(still.id);
    }
  }

  async function selectProject(id) {
    const payload = await api(`/api/rc47b/collab/projects/${encodeURIComponent(id)}`);
    state.selected = { ...payload.project, role: payload.role, permissions: payload.permissions || [] };
    $('collabAccessIntro').textContent = `${state.selected.name} · ${state.selected.role}`;
    const owner = state.selected.role === 'owner';
    $('collabOwnerControls').classList.toggle('hidden', !owner);
    $('collabAccessEmpty').classList.toggle('hidden', owner);
    permissionPicker([]);
    await Promise.all([loadHistory(), owner ? loadCollaborators() : Promise.resolve()]);
  }

  async function loadCollaborators() {
    if (!state.selected || state.selected.role !== 'owner') return;
    const payload = await api(`/api/rc47b/collab/projects/${state.selected.id}/collaborators`);
    const rows = payload.collaborators || [];
    const host = $('collaboratorList');
    host.innerHTML = rows.length ? rows.map(row => `
      <div class="rc47b-row">
        <div><strong>${esc(short(row.wallet))}</strong><small>${esc((row.permissions || []).map(p => PERMS.find(x => x[0] === p)?.[1] || p).join(' · ') || 'No edit permissions')}</small><code>${esc(row.wallet)}</code></div>
        <div class="rc47b-actions"><button class="rc47b-btn" data-edit-wallet="${esc(row.wallet)}" data-edit-perms="${esc(JSON.stringify(row.permissions || []))}" type="button">Edit</button><button class="rc47b-btn danger" data-remove-wallet="${esc(row.wallet)}" type="button">Remove</button></div>
      </div>`).join('') : '<div class="rc47b-empty">No collaborators yet.</div>';
    host.querySelectorAll('[data-edit-wallet]').forEach(btn => btn.addEventListener('click', () => {
      $('collabWalletInput').value = btn.dataset.editWallet;
      permissionPicker(JSON.parse(btn.dataset.editPerms || '[]'));
      $('collabWalletInput').scrollIntoView({ behavior:'smooth', block:'center' });
    }));
    host.querySelectorAll('[data-remove-wallet]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm(`Remove collaboration access for ${short(btn.dataset.removeWallet)}?`)) return;
      await api(`/api/rc47b/collab/projects/${state.selected.id}/collaborators/${encodeURIComponent(btn.dataset.removeWallet)}`, { method:'DELETE' });
      await loadCollaborators();
    }));
  }

  async function saveAccess() {
    if (!state.selected || state.selected.role !== 'owner') return;
    const collaborator = $('collabWalletInput').value.trim();
    if (!window.ethers?.isAddress(collaborator)) throw new Error('Enter a valid EVM collaborator wallet.');
    const permissions = selectedPermissions();
    await api(`/api/rc47b/collab/projects/${state.selected.id}/collaborators/${encodeURIComponent(collaborator)}`, {
      method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({ permissions })
    });
    $('collabWalletInput').value = '';
    permissionPicker([]);
    await loadCollaborators();
    status(`Collaboration access saved for ${short(collaborator)}.`, 'good');
  }

  async function loadHistory() {
    if (!state.selected) return;
    const payload = await api(`/api/rc47b/collab/projects/${state.selected.id}/versions`);
    const rows = payload.versions || [];
    const host = $('collabHistory');
    host.innerHTML = rows.length ? rows.map(row => `
      <div class="rc47b-history-item">
        <strong>v${Number(row.version)}</strong>
        <div><code>${esc(short(row.actor_wallet || state.selected.owner_wallet))}</code><div>${esc(row.action || 'owner_save')} · ${esc((row.change_sections || []).join(', ') || 'no classified changes')}</div>${row.note ? `<div class="rc47b-history-note">${esc(row.note)}</div>` : ''}<small>${new Date(row.created_at).toLocaleString()}</small></div>
        ${state.selected.role === 'owner' && Number(row.version) !== Number(state.selected.current_version) ? `<button class="rc47b-btn" data-restore-version="${Number(row.version)}" type="button">Restore</button>` : ''}
      </div>`).join('') : '<div class="rc47b-empty">No versions recorded.</div>';
    host.querySelectorAll('[data-restore-version]').forEach(btn => btn.addEventListener('click', async () => {
      const version = Number(btn.dataset.restoreVersion);
      if (!confirm(`Restore version ${version}? This creates a NEW version and keeps all later history.`)) return;
      const note = prompt('Rollback note (optional):', `Restore version ${version}`) || `Restore version ${version}`;
      const result = await api(`/api/rc47b/collab/projects/${state.selected.id}/rollback/${version}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ note }) });
      state.selected.current_version = result.version;
      await loadHistory();
      await loadProjects();
      status(`Version ${version} restored as new version ${result.version}.`, 'good');
    }));
  }

  async function init() {
    permissionPicker([]);
    $('collabConnectBtn').addEventListener('click', () => connect({forceChooser:true}).then(loadProjects).catch(error => status(error.message, 'bad')));
    $('collabRefreshBtn').addEventListener('click', () => loadProjects().catch(error => status(error.message, 'bad')));
    $('collabSaveAccessBtn').addEventListener('click', () => saveAccess().catch(error => status(error.message, 'bad')));
    try {
      if (window.RelicForgeWallets?.ready) await window.RelicForgeWallets.ready();
      const injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
      const accounts = await injected?.request?.({ method:'eth_accounts' });
      if (accounts?.[0]) { await connect(); await loadProjects(); }
    } catch (error) { status(error.message, 'bad'); }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
