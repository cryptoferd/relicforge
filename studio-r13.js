(() => {
  'use strict';

  if (!document.body?.classList.contains('studio-page-body')) return;

  const $ = id => document.getElementById(id);
  const deepClone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const MINT_PHASES_ABI = [
    'function phaseCount() view returns(uint32)',
    'function createPhase(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled) returns(uint32 phaseId)',
    'function phaseIsOpen(uint32 phaseId) view returns(bool)',
  ];

  const state = {
    installed: false,
    forgeWrapped: false,
    originalGetForgeState: null,
    originalRestoreForgeState: null,
    phases: [],
    activeId: null,
    pendingForge: null,
    forgeObserver: null,
    saveFlashTimer: null,
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function uid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `allowlist-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function markDirty() {
    window.RelicForgeProjects?.markDirty?.();
  }

  function injectStyles() {
    if ($('r13StudioStyles')) return;
    const style = document.createElement('style');
    style.id = 'r13StudioStyles';
    style.textContent = `
      .r13-step-actions{
        display:flex; align-items:center; justify-content:flex-end; gap:10px; flex-wrap:wrap;
        margin:0 0 18px; padding:12px 0; border-top:1px solid rgba(255,255,255,.07);
        border-bottom:1px solid rgba(255,255,255,.07);
      }
      .r13-step-actions .r13-spacer{flex:1 1 auto}
      .panel-footer .r13-save-btn{margin-left:auto}
      .r13-save-btn.r13-saved{border-color:rgba(90,190,120,.55); color:#b9e4c5}
      .r13-allowlist-manager{
        margin:18px 0; padding:16px; border:1px solid rgba(238,153,34,.22);
        border-radius:14px; background:linear-gradient(180deg,rgba(238,153,34,.045),rgba(255,255,255,.01));
      }
      .r13-allowlist-head{
        display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:12px;
      }
      .r13-allowlist-head h4{margin:0 0 4px;color:#f2f2f2}
      .r13-allowlist-head p{margin:0;color:#969696;line-height:1.45;font-size:.88rem}
      .r13-allowlist-list{display:grid;gap:9px}
      .r13-allowlist-empty{
        padding:14px;border:1px dashed rgba(255,255,255,.13);border-radius:10px;color:#8d8d8d;font-size:.88rem
      }
      .r13-allowlist-card{
        display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;
        padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:11px;background:#0d0d0d;
      }
      .r13-allowlist-card.active{border-color:rgba(238,153,34,.5);box-shadow:inset 0 0 0 1px rgba(238,153,34,.12)}
      .r13-allowlist-card-main{display:grid;gap:4px;min-width:0}
      .r13-allowlist-card-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .r13-allowlist-card-title strong{color:#eee}
      .r13-allowlist-badge{
        font-size:.68rem;letter-spacing:.05em;border:1px solid rgba(238,153,34,.35);color:#ee9922;
        border-radius:999px;padding:2px 7px
      }
      .r13-allowlist-card small{color:#8e8e8e;overflow-wrap:anywhere}
      .r13-allowlist-card-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
      .r13-allowlist-editor{
        display:grid;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)
      }
      .r13-allowlist-editor.hidden{display:none}
      .r13-allowlist-editor-row{
        display:grid;grid-template-columns:minmax(220px,.8fr) minmax(0,1.2fr);gap:12px;align-items:end
      }
      .r13-allowlist-note{color:#8f8f8f;font-size:.82rem;line-height:1.45}
      .r13-allowlist-status{
        margin-top:10px;padding:9px 11px;border-left:3px solid #555;background:#0b0b0b;color:#aaa;font-size:.84rem;line-height:1.45
      }
      .r13-allowlist-status.good{border-left-color:#4f9b69;color:#b9dbc4}
      .r13-allowlist-status.warn{border-left-color:#b98133;color:#e4c89f}
      .r13-allowlist-status.bad{border-left-color:#b44d4d;color:#e5b0b0}
      .r13-test-phase{min-width:210px}
      .r13-native-whitelist-label strong::after{content:" (selected phase)"}
      @media(max-width:760px){
        .r13-step-actions{justify-content:stretch}
        .r13-step-actions button{flex:1 1 auto}
        .r13-allowlist-card{grid-template-columns:1fr}
        .r13-allowlist-card-actions{justify-content:flex-start}
        .r13-allowlist-editor-row{grid-template-columns:1fr}
        .panel-footer .r13-save-btn{margin-left:0}
      }
    `;
    document.head.appendChild(style);
  }

  function sourceButtonsForPanel(panel) {
    const footer = panel.querySelector('.panel-footer');
    if (!footer) return [];
    const step = Number(panel.dataset.panel);
    if (step === 1) return [footer.querySelector('[data-next="2"]')].filter(Boolean);
    if (step === 2) return [footer.querySelector('[data-back="1"]'), footer.querySelector('[data-next="3"]')].filter(Boolean);
    if (step === 3) return [footer.querySelector('[data-back="2"]'), footer.querySelector('[data-next="4"]')].filter(Boolean);
    if (step === 4) return [footer.querySelector('[data-back="3"]'), $('compileBtn'), $('toLaunchBtn')].filter(Boolean);
    if (step === 5) return [footer.querySelector('[data-back="4"]'), $('exportLaunchPackageBtn')].filter(Boolean);
    return [];
  }

  function syncProxy(proxy, source) {
    if (!proxy || !source) return;
    proxy.disabled = !!source.disabled;
    proxy.textContent = source.textContent;
    proxy.className = source.className.replace(/\bback-btn\b|\bnext-btn\b/g, '').trim();
    proxy.classList.add('r13-nav-proxy');
  }

  function flashSaveButtons() {
    const buttons = [...document.querySelectorAll('.r13-save-btn')];
    buttons.forEach(button => {
      button.textContent = 'Saved';
      button.classList.add('r13-saved');
    });
    clearTimeout(state.saveFlashTimer);
    state.saveFlashTimer = setTimeout(() => syncSaveButtons(), 1600);
  }

  function syncSaveButtons() {
    const source = $('saveProjectBtn');
    const viewOnly = !!source?.disabled || String(source?.textContent || '').trim().toLowerCase() === 'view only';
    document.querySelectorAll('.r13-save-btn').forEach(button => {
      if (button.classList.contains('r13-saved')) button.classList.remove('r13-saved');
      button.disabled = viewOnly;
      button.textContent = viewOnly ? 'View Only' : 'Save Project';
      button.title = viewOnly ? (source?.title || 'This shared project is read-only.') : 'Save this Studio project';
    });
  }

  function triggerSave(button) {
    const source = $('saveProjectBtn');
    if (!source || source.disabled) return;
    document.querySelectorAll('.r13-save-btn').forEach(node => {
      node.disabled = true;
      node.textContent = 'Saving...';
    });
    source.click();
    window.setTimeout(() => {
      const status = $('projectSaveStatus')?.textContent || '';
      if (/all changes saved|saved globally|saved locally|collaboration version/i.test(status)) flashSaveButtons();
      else syncSaveButtons();
    }, 900);
  }

  function installStepActionBars() {
    document.querySelectorAll('.step-panel[data-panel]').forEach(panel => {
      const footer = panel.querySelector('.panel-footer');
      const heading = panel.querySelector('.panel-heading');
      if (!footer || !heading) return;

      if (!footer.querySelector('.r13-save-btn')) {
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'ghost-btn r13-save-btn';
        save.textContent = 'Save Project';
        save.addEventListener('click', () => triggerSave(save));
        const firstAction = footer.querySelector('button');
        if (firstAction) {
          const back = footer.querySelector('.back-btn,[data-back]');
          if (back?.nextSibling) footer.insertBefore(save, back.nextSibling);
          else footer.insertBefore(save, firstAction);
        } else footer.appendChild(save);
      }

      if (!panel.querySelector(':scope > .r13-step-actions')) {
        const bar = document.createElement('div');
        bar.className = 'r13-step-actions';
        const sources = sourceButtonsForPanel(panel);
        const firstIsBack = !!sources[0]?.matches?.('.back-btn,[data-back]');
        if (!firstIsBack) {
          const spacer = document.createElement('span');
          spacer.className = 'r13-spacer';
          bar.appendChild(spacer);
        }
        sources.forEach(source => {
          const proxy = document.createElement('button');
          proxy.type = 'button';
          proxy.addEventListener('click', () => source.click());
          syncProxy(proxy, source);
          new MutationObserver(() => syncProxy(proxy, source)).observe(source, {
            attributes: true, childList: true, characterData: true, subtree: true
          });
          bar.appendChild(proxy);
          if (source.matches('.back-btn,[data-back]')) {
            const save = document.createElement('button');
            save.type = 'button';
            save.className = 'ghost-btn r13-save-btn';
            save.textContent = 'Save Project';
            save.addEventListener('click', () => triggerSave(save));
            bar.appendChild(save);
          }
        });
        if (!firstIsBack) {
          const save = document.createElement('button');
          save.type = 'button';
          save.className = 'ghost-btn r13-save-btn';
          save.textContent = 'Save Project';
          save.addEventListener('click', () => triggerSave(save));
          const spacer = bar.querySelector('.r13-spacer');
          spacer.insertAdjacentElement('afterend', save);
        }
        heading.insertAdjacentElement('afterend', bar);
      }
    });

    const sourceSave = $('saveProjectBtn');
    if (sourceSave) {
      new MutationObserver(syncSaveButtons).observe(sourceSave, {
        attributes: true, childList: true, characterData: true, subtree: true
      });
    }
    const status = $('projectSaveStatus');
    if (status) {
      new MutationObserver(() => {
        if (/all changes saved|saved globally|saved locally|collaboration version/i.test(status.textContent || '')) flashSaveButtons();
        else syncSaveButtons();
      }).observe(status, { childList: true, characterData: true, subtree: true });
    }
    syncSaveButtons();
  }

  function nativeForgeState() {
    return state.originalGetForgeState ? state.originalGetForgeState() : window.RelicForgeForge?.getForgeProjectState?.();
  }

  function normalizePhase(raw = {}, index = 0) {
    return {
      id: String(raw.id || uid()),
      name: String(raw.name || `Allowlist ${index + 1}`).trim() || `Allowlist ${index + 1}`,
      enabled: raw.enabled !== false,
      mintPrice: String(raw.mintPrice ?? raw.whitelistMintPrice ?? '0.001'),
      start: String(raw.start ?? raw.whitelistMintStart ?? ''),
      end: String(raw.end ?? raw.whitelistMintEnd ?? ''),
      defaultAllowance: String(raw.defaultAllowance ?? raw.whitelistDefaultAllowance ?? '2'),
      sourceMode: String(raw.sourceMode ?? raw.whitelistSourceMode ?? (raw.whitelist?.sourceType === 2 ? 'custom' : 'snapshot')),
      sourceChain: String(raw.sourceChain ?? raw.whitelistSourceChain ?? raw.whitelist?.sourceChainId ?? '1'),
      collectionAddress: String(raw.collectionAddress ?? raw.whitelistCollectionAddress ?? ''),
      snapshotRpc: String(raw.snapshotRpc ?? raw.whitelistSnapshotRpc ?? ''),
      customText: String(raw.customText ?? raw.whitelistCustomText ?? ''),
      whitelist: raw.whitelist ? deepClone(raw.whitelist) : null,
      phaseId: raw.phaseId ? Number(raw.phaseId) : null,
      root: raw.root || null,
    };
  }

  function serializePhase(phase) {
    return {
      id: phase.id,
      name: phase.name,
      enabled: phase.enabled !== false,
      mintPrice: phase.mintPrice,
      start: phase.start,
      end: phase.end,
      defaultAllowance: phase.defaultAllowance,
      sourceMode: phase.sourceMode,
      sourceChain: phase.sourceChain,
      collectionAddress: phase.collectionAddress,
      snapshotRpc: phase.snapshotRpc,
      customText: phase.customText,
      whitelist: phase.whitelist ? deepClone(phase.whitelist) : null,
      phaseId: phase.phaseId || null,
      root: phase.root || null,
    };
  }

  function phaseFromLegacy(saved) {
    return normalizePhase({
      name: 'Allowlist 1',
      enabled: !!saved.whitelistEnabled,
      mintPrice: saved.whitelistMintPrice,
      start: saved.whitelistMintStart,
      end: saved.whitelistMintEnd,
      defaultAllowance: saved.whitelistDefaultAllowance,
      sourceMode: saved.whitelistSourceMode,
      sourceChain: saved.whitelistSourceChain,
      collectionAddress: saved.whitelistCollectionAddress,
      snapshotRpc: saved.whitelistSnapshotRpc,
      customText: saved.whitelistCustomText,
      whitelist: saved.whitelist || null,
      phaseId: saved.whitelistPhaseId || null,
    }, 0);
  }

  function activePhase() {
    return state.phases.find(phase => phase.id === state.activeId) || null;
  }

  function setAllowlistStatus(message, tone = '') {
    const node = $('r13AllowlistStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `r13-allowlist-status ${tone}`.trim();
  }

  function captureActivePhase() {
    const phase = activePhase();
    if (!phase || !state.originalGetForgeState) return phase;
    const snap = state.originalGetForgeState();
    phase.name = String($('r13AllowlistName')?.value || phase.name || 'Allowlist').trim() || 'Allowlist';
    phase.enabled = !!snap.whitelistEnabled;
    phase.mintPrice = String(snap.whitelistMintPrice ?? phase.mintPrice ?? '0.001');
    phase.start = String(snap.whitelistMintStart ?? '');
    phase.end = String(snap.whitelistMintEnd ?? '');
    phase.defaultAllowance = String(snap.whitelistDefaultAllowance ?? '2');
    phase.sourceMode = String(snap.whitelistSourceMode || (snap.whitelist?.sourceType === 2 ? 'custom' : 'snapshot'));
    phase.sourceChain = String(snap.whitelistSourceChain || snap.whitelist?.sourceChainId || '1');
    phase.collectionAddress = String(snap.whitelistCollectionAddress || '');
    phase.snapshotRpc = String(snap.whitelistSnapshotRpc || '');
    phase.customText = String(snap.whitelistCustomText || '');
    phase.whitelist = snap.whitelist ? deepClone(snap.whitelist) : null;
    if (snap.whitelistPhaseId && (!phase.phaseId || Number(snap.whitelistPhaseId) === Number(phase.phaseId))) {
      phase.phaseId = Number(snap.whitelistPhaseId);
    }
    return phase;
  }

  function forgeStateWithPhase(base, phase) {
    return {
      ...base,
      schema: 'relic-forge/forge-settings@6',
      whitelistEnabled: phase ? phase.enabled !== false : false,
      whitelistMintPrice: phase?.mintPrice ?? '0.001',
      whitelistMintStart: phase?.start ?? '',
      whitelistMintEnd: phase?.end ?? '',
      whitelistDefaultAllowance: phase?.defaultAllowance ?? '2',
      whitelistSourceMode: phase?.sourceMode ?? 'custom',
      whitelistSourceChain: phase?.sourceChain ?? '1',
      whitelistCollectionAddress: phase?.collectionAddress ?? '',
      whitelistSnapshotRpc: phase?.snapshotRpc ?? '',
      whitelistCustomText: phase?.customText ?? '',
      whitelist: phase?.whitelist ? deepClone(phase.whitelist) : null,
      whitelistPhaseId: phase?.phaseId || null,
    };
  }

  function loadPhase(phase) {
    if (!state.originalGetForgeState || !state.originalRestoreForgeState) return;
    const current = state.originalGetForgeState();
    state.originalRestoreForgeState(forgeStateWithPhase(current, phase), { preserveCompiled: true });
    if ($('r13AllowlistName')) $('r13AllowlistName').value = phase?.name || '';
    renderAllowlistManager();
  }

  function selectPhase(id, { saveCurrent = true } = {}) {
    if (saveCurrent) captureActivePhase();
    const phase = state.phases.find(item => item.id === id);
    if (!phase) return;
    state.activeId = phase.id;
    loadPhase(phase);
    setAllowlistStatus(`Editing ${phase.name}. Build or paste this phase's wallet list with the controls below.`, '');
  }

  function addPhase() {
    captureActivePhase();
    const phase = normalizePhase({
      name: `Allowlist ${state.phases.length + 1}`,
      enabled: true,
      sourceMode: 'custom',
      whitelist: null,
    }, state.phases.length);
    state.phases.push(phase);
    state.activeId = phase.id;
    loadPhase(phase);
    markDirty();
    setAllowlistStatus(`${phase.name} added. Configure its price, schedule, allowance, and wallet source below.`, 'good');
  }

  function duplicatePhase(id) {
    captureActivePhase();
    const source = state.phases.find(item => item.id === id);
    if (!source) return;
    const copy = normalizePhase({
      ...serializePhase(source),
      id: uid(),
      name: `${source.name} Copy`,
      phaseId: null,
      root: null,
    }, state.phases.length);
    state.phases.push(copy);
    state.activeId = copy.id;
    loadPhase(copy);
    markDirty();
    setAllowlistStatus(`${copy.name} duplicated. It will become a separate MintPhases Merkle phase.`, 'good');
  }

  function removePhase(id) {
    captureActivePhase();
    const index = state.phases.findIndex(item => item.id === id);
    if (index < 0) return;
    const phase = state.phases[index];
    if (phase.phaseId && !window.confirm(`${phase.name} is already bound to onchain phase ${phase.phaseId}. Removing it from Studio will not delete the immutable onchain phase. Remove it from this project view anyway?`)) return;
    if (!phase.phaseId && !window.confirm(`Remove ${phase.name} from this Studio project?`)) return;
    state.phases.splice(index, 1);
    const next = state.phases[Math.min(index, state.phases.length - 1)] || null;
    state.activeId = next?.id || null;
    if (next) loadPhase(next);
    else {
      const base = state.originalGetForgeState();
      state.originalRestoreForgeState(forgeStateWithPhase(base, null), { preserveCompiled: true });
      renderAllowlistManager();
    }
    markDirty();
    setAllowlistStatus(next ? `Removed ${phase.name}.` : 'No allowlist phases configured.', next ? 'good' : '');
  }

  function renderAllowlistManager() {
    const list = $('r13AllowlistList');
    const editor = $('r13AllowlistEditor');
    if (!list || !editor) return;
    const current = activePhase();

    if (!state.phases.length) {
      list.innerHTML = '<div class="r13-allowlist-empty">No allowlist phases configured. Add one when you need gated mint access; public mint remains separate.</div>';
      editor.classList.add('hidden');
    } else {
      list.innerHTML = state.phases.map((phase, index) => {
        const active = phase.id === state.activeId;
        const wallets = phase.whitelist?.entries?.length || 0;
        const bound = phase.phaseId ? `Onchain phase ${phase.phaseId}` : 'Not forged yet';
        const schedule = phase.start ? `${phase.start}${phase.end ? ` to ${phase.end}` : ''}` : 'No scheduled start';
        return `<article class="r13-allowlist-card ${active ? 'active' : ''}" data-r13-phase="${esc(phase.id)}">
          <div class="r13-allowlist-card-main">
            <div class="r13-allowlist-card-title">
              <strong>${esc(phase.name)}</strong>
              <span class="r13-allowlist-badge">${phase.enabled === false ? 'DISABLED' : 'ENABLED'}</span>
              ${phase.phaseId ? `<span class="r13-allowlist-badge">PHASE ${Number(phase.phaseId)}</span>` : ''}
            </div>
            <small>${esc(phase.mintPrice || '0')} ETH · ${wallets.toLocaleString()} wallet${wallets === 1 ? '' : 's'} · ${esc(schedule)} · ${esc(bound)}</small>
          </div>
          <div class="r13-allowlist-card-actions">
            <button class="ghost-btn" data-r13-select="${esc(phase.id)}" type="button">${active ? 'Editing' : 'Edit'}</button>
            <button class="ghost-btn" data-r13-duplicate="${esc(phase.id)}" type="button">Duplicate</button>
            <button class="ghost-btn danger-btn" data-r13-remove="${esc(phase.id)}" type="button">Remove</button>
          </div>
        </article>`;
      }).join('');
      editor.classList.toggle('hidden', !current);
      if (current && $('r13AllowlistName') && document.activeElement !== $('r13AllowlistName')) {
        $('r13AllowlistName').value = current.name;
      }
    }
    renderTestPhaseSelector();
  }

  function installAllowlistManager() {
    const nativeToggle = $('whitelistEnabled')?.closest('.project-toggle-row');
    if (!nativeToggle || $('r13AllowlistManager')) return;

    nativeToggle.classList.add('r13-native-whitelist-label');
    const strong = nativeToggle.querySelector('strong');
    const small = nativeToggle.querySelector('small');
    if (strong) strong.textContent = 'Enable selected allowlist phase';
    if (small) small.textContent = 'This switch applies only to the allowlist phase currently selected above.';

    const section = document.createElement('section');
    section.id = 'r13AllowlistManager';
    section.className = 'r13-allowlist-manager';
    section.innerHTML = `
      <div class="r13-allowlist-head">
        <div>
          <h4>Allowlist Phases</h4>
          <p>Create multiple independent allowlists. Each enabled list is forged as its own R12-v2 MintPhases Merkle phase with its own price, schedule, and wallet allowances.</p>
        </div>
        <button class="primary-btn" id="r13AddAllowlistBtn" type="button">+ Add Allowlist</button>
      </div>
      <div class="r13-allowlist-list" id="r13AllowlistList"></div>
      <div class="r13-allowlist-editor hidden" id="r13AllowlistEditor">
        <div class="r13-allowlist-editor-row">
          <label class="field"><span>Allowlist phase name</span><input id="r13AllowlistName" maxlength="80" placeholder="e.g. Early Supporters" /></label>
          <div class="r13-allowlist-note">The existing controls directly below edit the selected phase. Build a collection snapshot or custom list, then switch to another phase or save the project.</div>
        </div>
        <div class="inline-actions">
          <button class="ghost-btn" id="r13SaveAllowlistBtn" type="button">Save Phase Settings</button>
        </div>
      </div>
      <div class="r13-allowlist-status" id="r13AllowlistStatus">No allowlist phases configured.</div>`;
    nativeToggle.insertAdjacentElement('beforebegin', section);

    $('r13AddAllowlistBtn')?.addEventListener('click', addPhase);
    $('r13SaveAllowlistBtn')?.addEventListener('click', () => {
      const phase = captureActivePhase();
      if (!phase) return;
      renderAllowlistManager();
      markDirty();
      setAllowlistStatus(`${phase.name} settings captured in this Studio project.`, 'good');
    });
    $('r13AllowlistName')?.addEventListener('input', () => {
      const phase = activePhase();
      if (!phase) return;
      phase.name = String($('r13AllowlistName').value || '').trim() || phase.name;
      renderAllowlistManager();
      markDirty();
    });
    $('r13AllowlistList')?.addEventListener('click', event => {
      const select = event.target.closest('[data-r13-select]');
      if (select) { selectPhase(select.dataset.r13Select); return; }
      const duplicate = event.target.closest('[data-r13-duplicate]');
      if (duplicate) { duplicatePhase(duplicate.dataset.r13Duplicate); return; }
      const remove = event.target.closest('[data-r13-remove]');
      if (remove) removePhase(remove.dataset.r13Remove);
    });

    $('whitelistEnabled')?.addEventListener('change', () => {
      if (!state.phases.length && $('whitelistEnabled').checked) addPhase();
      else {
        captureActivePhase();
        renderAllowlistManager();
      }
    });

    renderAllowlistManager();
  }

  function wrapForgePersistence() {
    const api = window.RelicForgeForge;
    if (!api?.getForgeProjectState || !api?.restoreForgeProjectState || state.forgeWrapped) return false;

    state.originalGetForgeState = api.getForgeProjectState.bind(api);
    state.originalRestoreForgeState = api.restoreForgeProjectState.bind(api);

    api.getForgeProjectState = () => {
      if (!state.phases.length) {
        const legacy = state.originalGetForgeState();
        if (legacy.whitelistEnabled || legacy.whitelist?.entries?.length) {
          const phase = phaseFromLegacy(legacy);
          state.phases = [phase];
          state.activeId = phase.id;
        }
      }
      captureActivePhase();
      const base = state.originalGetForgeState();
      return {
        ...base,
        allowlistPhases: state.phases.map(serializePhase),
        activeAllowlistId: state.activeId || null,
      };
    };

    api.restoreForgeProjectState = saved => {
      if (!saved) return state.originalRestoreForgeState(saved);
      if (Array.isArray(saved.allowlistPhases)) {
        state.phases = saved.allowlistPhases.map((phase, index) => normalizePhase(phase, index));
        state.activeId = state.phases.some(phase => phase.id === saved.activeAllowlistId)
          ? saved.activeAllowlistId
          : (state.phases[0]?.id || null);
      } else if (saved.whitelistEnabled || saved.whitelist?.entries?.length) {
        const phase = phaseFromLegacy(saved);
        state.phases = [phase];
        state.activeId = phase.id;
      } else {
        state.phases = [];
        state.activeId = null;
      }

      const selected = activePhase();
      const migrated = selected ? forgeStateWithPhase(saved, selected) : saved;
      state.originalRestoreForgeState(migrated);
      window.setTimeout(() => {
        if ($('r13AllowlistName')) $('r13AllowlistName').value = selected?.name || '';
        renderAllowlistManager();
      }, 0);
    };

    state.forgeWrapped = true;
    return true;
  }

  function parseSchedule(value, field, phaseName) {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) throw new Error(`${phaseName} ${field} is invalid.`);
    const seconds = Math.floor(date.getTime() / 1000);
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error(`${phaseName} ${field} is outside the supported range.`);
    return seconds;
  }

  function validatePhaseForForge(phase) {
    if (!phase || phase.enabled === false) return null;
    if (!phase.whitelist?.entries?.length) throw new Error(`${phase.name} has no built allowlist. Build its snapshot or custom wallet list before forging.`);
    const price = window.ethers.parseEther(String(Math.max(0, Number(phase.mintPrice || 0))));
    const startTime = parseSchedule(phase.start, 'start', phase.name);
    const endTime = parseSchedule(phase.end, 'end', phase.name);
    if (endTime && endTime <= startTime) throw new Error(`${phase.name} end must be later than its start.`);
    const entries = phase.whitelist.entries.map(row => {
      const address = window.ethers.getAddress(row.address);
      const allowance = Number(row.allowance);
      if (!Number.isInteger(allowance) || allowance < 1 || allowance > 4294967295) {
        throw new Error(`${phase.name} contains an invalid allowance for ${address}.`);
      }
      return { address, allowance };
    });
    return { phase, price, startTime, endTime, entries };
  }

  function hashPair(a, b) {
    if (!b) return a;
    return BigInt(a) <= BigInt(b)
      ? window.ethers.keccak256(window.ethers.concat([a, b]))
      : window.ethers.keccak256(window.ethers.concat([b, a]));
  }

  function buildBoundMerkle(entries, collectionAddress, phaseId) {
    const leaves = entries.map(entry => {
      const encoded = window.ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256','address','uint32','address','uint32'],
        [11155111n, collectionAddress, Number(phaseId), entry.address, entry.allowance]
      );
      return window.ethers.keccak256(encoded);
    });
    if (!leaves.length) throw new Error('Allowlist contains no eligible wallets.');
    const layers = [leaves];
    while (layers[layers.length - 1].length > 1) {
      const current = layers[layers.length - 1];
      const next = [];
      for (let i = 0; i < current.length; i += 2) {
        next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
      }
      layers.push(next);
    }
    const proofForIndex = index => {
      const proof = [];
      let cursor = index;
      for (let level = 0; level < layers.length - 1; level++) {
        const layer = layers[level];
        const sibling = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
        if (sibling < layer.length) proof.push(layer[sibling]);
        cursor = Math.floor(cursor / 2);
      }
      return proof;
    };
    const proofByAddress = {};
    entries.forEach((entry, index) => {
      proofByAddress[entry.address.toLowerCase()] = {
        allowance: entry.allowance,
        proof: proofForIndex(index),
      };
    });
    return { root: layers[layers.length - 1][0], entries, proofByAddress };
  }


  function publicationDetail() {
    if (!state.originalGetForgeState) return null;
    const snap = state.originalGetForgeState();
    if (!window.ethers?.isAddress(snap.collectionAddress || '') || !window.ethers?.isAddress(snap.mintPhasesAddress || '')) return null;
    captureActivePhase();
    const allowlists = [];
    for (const phase of state.phases.filter(row => row.enabled !== false && row.phaseId && row.whitelist?.entries?.length)) {
      const checked = validatePhaseForForge(phase);
      const tree = buildBoundMerkle(checked.entries, snap.collectionAddress, phase.phaseId);
      phase.root = tree.root;
      allowlists.push({
        phaseId: Number(phase.phaseId),
        name: phase.name,
        root: tree.root,
        sourceType: Number(phase.whitelist?.sourceType || 0),
        sourceChainId: Number(phase.whitelist?.sourceChainId || phase.sourceChain || 0),
        sourceContract: phase.whitelist?.sourceContract || phase.collectionAddress || null,
        snapshotBlock: Number(phase.whitelist?.snapshotBlock || 0),
        entries: tree.entries.map(entry => ({
          address: entry.address,
          allowance: Number(entry.allowance),
          proof: tree.proofByAddress[String(entry.address).toLowerCase()]?.proof || [],
        })),
      });
    }
    return {
      chainId: 11155111,
      collectionAddress: snap.collectionAddress,
      mintPhasesAddress: snap.mintPhasesAddress,
      publicPhaseId: snap.publicPhaseId ? Number(snap.publicPhaseId) : null,
      allowlists,
    };
  }

  async function eip1193Provider() {
    if (window.RelicForgeWallets?.getProviderAsync) {
      const provider = await window.RelicForgeWallets.getProviderAsync({ allowChooser: false });
      if (provider?.request) return provider;
    }
    if (window.ethereum?.request) return window.ethereum;
    throw new Error('No connected EVM wallet provider is available.');
  }

  async function creatorSigner() {
    const raw = await eip1193Provider();
    const provider = new window.ethers.BrowserProvider(raw);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== 11155111) throw new Error('Switch the creator wallet to Ethereum Sepolia.');
    return provider.getSigner();
  }

  function prepareMultiAllowlistForge(event) {
    if (!window.ethers || !state.originalGetForgeState || !state.originalRestoreForgeState) return;
    try {
      if (!state.phases.length) {
        const current = state.originalGetForgeState();
        if (current.whitelistEnabled || current.whitelist?.entries?.length) {
          const phase = phaseFromLegacy(current);
          state.phases = [phase];
          state.activeId = phase.id;
        }
      }
      captureActivePhase();
      const enabled = state.phases.filter(phase => phase.enabled !== false).map(validatePhaseForForge).filter(Boolean);
      if (!enabled.length) {
        const base = state.originalGetForgeState();
        state.originalRestoreForgeState(forgeStateWithPhase(base, null), { preserveCompiled: true });
        state.pendingForge = { primary: null, extras: [] };
        watchForgeCompletion();
        return;
      }

      const primary = enabled[0].phase;
      state.activeId = primary.id;
      loadPhase(primary);
      const primaryAfterLoad = activePhase();
      if (primaryAfterLoad) primaryAfterLoad.enabled = true;

      state.pendingForge = {
        primaryId: primary.id,
        extraIds: enabled.slice(1).map(row => row.phase.id),
      };
      setAllowlistStatus(
        `Forge prepared with ${enabled.length} allowlist phase${enabled.length === 1 ? '' : 's'}. ${primary.name} will be created by the base launch flow; ${Math.max(0, enabled.length - 1)} additional phase${enabled.length === 2 ? '' : 's'} will be appended automatically.`,
        enabled.length > 1 ? 'warn' : 'good'
      );
      watchForgeCompletion();
    } catch (error) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setAllowlistStatus(`Cannot forge: ${error.message}`, 'bad');
      window.RelicForgeStudioBridge?.showStatus?.(`Allowlist configuration error: ${error.message}`, 'error');
    }
  }

  function watchForgeCompletion() {
    state.forgeObserver?.disconnect();
    const status = $('forgeTestStatus');
    if (!status) return;
    const baseline = status.textContent || '';
    const inspect = () => {
      const text = status.textContent || '';
      if (text === baseline) return;
      if (/FORGE ERROR:/i.test(text)) {
        state.forgeObserver?.disconnect();
        state.forgeObserver = null;
        state.pendingForge = null;
        setAllowlistStatus('Forge stopped before all configured allowlist phases were created. Keep the displayed collection address for troubleshooting; do not forge a duplicate.', 'bad');
        return;
      }
      if (/R12-v2 collection forged\./i.test(text) && state.pendingForge) {
        state.forgeObserver?.disconnect();
        state.forgeObserver = null;
        const pending = state.pendingForge;
        state.pendingForge = null;
        finalizeAllowlistPhases(pending).catch(error => {
          setAllowlistStatus(`Collection exists, but additional allowlist phase creation stopped: ${error.message}. Do not forge a duplicate.`, 'bad');
          window.RelicForgeStudioBridge?.showStatus?.(`Additional allowlist phase error: ${error.message}. The collection already exists; do not reforge it.`, 'error');
        });
      }
    };
    state.forgeObserver = new MutationObserver(inspect);
    state.forgeObserver.observe(status, { childList: true, characterData: true, subtree: true });
  }

  async function finalizeAllowlistPhases(pending) {
    const snap = state.originalGetForgeState();
    const collectionAddress = snap.collectionAddress;
    const mintPhasesAddress = snap.mintPhasesAddress;
    if (!window.ethers?.isAddress(collectionAddress) || !window.ethers?.isAddress(mintPhasesAddress)) {
      throw new Error('The forged collection or MintPhases address is unavailable.');
    }

    const primary = state.phases.find(phase => phase.id === pending.primaryId) || null;
    if (primary && snap.whitelistPhaseId) {
      primary.phaseId = Number(snap.whitelistPhaseId);
      const checked = validatePhaseForForge(primary);
      const tree = buildBoundMerkle(checked.entries, collectionAddress, primary.phaseId);
      primary.root = tree.root;
    }

    const extras = (pending.extraIds || []).map(id => state.phases.find(phase => phase.id === id)).filter(Boolean);
    if (extras.length) {
      const signer = await creatorSigner();
      const contract = new window.ethers.Contract(mintPhasesAddress, MINT_PHASES_ABI, signer);
      setAllowlistStatus(`Base collection forged. Creating ${extras.length} additional allowlist phase${extras.length === 1 ? '' : 's'}...`, 'warn');

      for (let index = 0; index < extras.length; index++) {
        const phase = extras[index];
        const checked = validatePhaseForForge(phase);
        const phaseCount = Number(await contract.phaseCount());
        const phaseId = phaseCount + 1;
        const tree = buildBoundMerkle(checked.entries, collectionAddress, phaseId);
        const priority = Math.min(65535, 201 + index);
        setAllowlistStatus(`Creating ${phase.name} as MintPhases phase ${phaseId} (${index + 1}/${extras.length})...`, 'warn');
        const tx = await contract.createPhase(
          checked.price,
          checked.startTime,
          checked.endTime,
          0,
          0,
          tree.root,
          1,
          priority,
          true
        );
        const receipt = await tx.wait();
        if (receipt.status !== 1) throw new Error(`${phase.name} transaction failed.`);
        phase.phaseId = phaseId;
        phase.root = tree.root;
      }
    }

    renderAllowlistManager();
    renderTestPhaseSelector();
    markDirty();
    setAllowlistStatus(
      `${state.phases.filter(phase => phase.enabled !== false && phase.phaseId).length} allowlist phase${state.phases.filter(phase => phase.enabled !== false && phase.phaseId).length === 1 ? '' : 's'} are now bound to this R12-v2 collection. Save the Studio project to preserve the phase IDs.`,
      'good'
    );
    window.RelicForgeStudioBridge?.showStatus?.('R12-v2 collection and configured allowlist phases forged. Save the project to preserve launch phase IDs.', 'success');
    const launchDetail = publicationDetail();
    if (launchDetail) window.dispatchEvent(new CustomEvent('relicforge:v2-launch-complete', { detail: launchDetail }));
  }

  function renderTestPhaseSelector() {
    const select = $('r13AllowlistTestPhase');
    if (!select) return;
    const bound = state.phases.filter(phase => phase.phaseId);
    if (!bound.length) {
      select.innerHTML = '<option value="">No bound allowlist phases</option>';
      select.disabled = true;
      return;
    }
    const prior = select.value;
    select.disabled = false;
    select.innerHTML = bound.map(phase => `<option value="${Number(phase.phaseId)}">${esc(phase.name)} - phase ${Number(phase.phaseId)}</option>`).join('');
    if ([...select.options].some(option => option.value === prior)) select.value = prior;
  }

  function installTestPhaseSelector() {
    const button = $('forgeWhitelistMintBtn');
    if (!button || $('r13AllowlistTestPhase')) return;
    const group = document.createElement('div');
    group.className = 'r2-allowlist-test-group';
    button.insertAdjacentElement('beforebegin', group);
    const label = document.createElement('label');
    label.className = 'field r13-test-phase';
    label.innerHTML = '<span>Approved Wallet stage</span><select id="r13AllowlistTestPhase"><option value="">No bound Approved Wallet stages</option></select>';
    group.appendChild(label);
    group.appendChild(button);
    $('r13AllowlistTestPhase')?.addEventListener('change', event => {
      const phaseId = Number(event.target.value || 0);
      const phase = state.phases.find(item => Number(item.phaseId) === phaseId);
      if (!phase || !state.originalGetForgeState || !state.originalRestoreForgeState) return;
      captureActivePhase();
      state.activeId = phase.id;
      const base = state.originalGetForgeState();
      state.originalRestoreForgeState(forgeStateWithPhase({
        ...base,
        whitelistPhaseId: phase.phaseId,
      }, phase), { preserveCompiled: true });
      if ($('forgeWhitelistMintBtn')) $('forgeWhitelistMintBtn').disabled = false;
      if ($('r13AllowlistName')) $('r13AllowlistName').value = phase.name;
      renderAllowlistManager();
      setAllowlistStatus(`${phase.name} selected for the Approved Wallet test mint.`, 'good');
    });
    renderTestPhaseSelector();
  }

  function bindForgeGuard() {
    const forge = $('forgeCollectionBtn');
    if (!forge || forge.dataset.r13MultiAllowlistBound === '1') return;
    forge.dataset.r13MultiAllowlistBound = '1';
    forge.addEventListener('click', prepareMultiAllowlistForge, true);
  }

  function install() {
    if (state.installed) return;
    if (!window.RelicForgeForge?.getForgeProjectState || !window.RelicForgeProjects) {
      window.setTimeout(install, 50);
      return;
    }

    injectStyles();
    wrapForgePersistence();
    installStepActionBars();
    installAllowlistManager();
    installTestPhaseSelector();
    bindForgeGuard();

    const initial = state.originalGetForgeState();
    if (initial.whitelistEnabled || initial.whitelist?.entries?.length) {
      const phase = phaseFromLegacy(initial);
      state.phases = [phase];
      state.activeId = phase.id;
      if ($('r13AllowlistName')) $('r13AllowlistName').value = phase.name;
      renderAllowlistManager();
    }

    document.addEventListener('change', event => {
      if (!activePhase()) return;
      if (event.target.closest('#whitelistSettings') || event.target.id === 'whitelistEnabled') {
        window.setTimeout(() => {
          captureActivePhase();
          renderAllowlistManager();
        }, 0);
      }
    });
    document.addEventListener('input', event => {
      if (!activePhase()) return;
      if (event.target.closest('#whitelistSettings')) {
        window.clearTimeout(event.target._r13CaptureTimer);
        event.target._r13CaptureTimer = window.setTimeout(() => {
          captureActivePhase();
          renderAllowlistManager();
        }, 250);
      }
    });

    const whitelistStatus = $('whitelistStatus');
    if (whitelistStatus) {
      new MutationObserver(() => {
        if (!activePhase()) return;
        captureActivePhase();
        renderAllowlistManager();
      }).observe(whitelistStatus, { childList: true, characterData: true, subtree: true });
    }

    state.installed = true;
    document.body.dataset.r13Studio = 'multi-allowlist-nav';
  }

  window.RelicForgeStudioR13 = Object.freeze({
    getPublicationDetail: publicationDetail,
    getAllowlistPhases: () => state.phases.map(serializePhase),
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
