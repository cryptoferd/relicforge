(() => {
  'use strict';

  const rarityWeights = {
    common: 100,
    uncommon: 45,
    rare: 15,
    very_rare: 4,
    legendary: 1,
  };

  const rarityLabels = {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    very_rare: 'Very Rare',
    legendary: 'Legendary',
  };

  const state = {
    mode: 'simple',
    step: 1,
    buildMode: 'auto',
    layers: [],
    rulesEnabled: false,
    rules: [],
    ruleType: 'only_with',
    sourceSelected: new Set(),
    targetSelected: new Set(),
    manifestTokens: new Map(),
    manifestSourceName: '',
    compiledTokens: [],
    compilerReport: null,
    imageWidth: 1000,
    imageHeight: 1000,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const el = {
    folderInput: $('#folderInput'),
    uploadZone: $('#uploadZone'),
    layerList: $('#layerList'),
    artworkSummary: $('#artworkSummary'),
    step1Hint: $('#step1Hint'),
    statusBanner: $('#statusBanner'),
    collectionName: $('#collectionName'),
    collectionSize: $('#collectionSize'),
    traitSetup: $('#traitSetup'),
    manifestPanel: $('#manifestPanel'),
    manifestInput: $('#manifestInput'),
    manifestFileName: $('#manifestFileName'),
    manifestResult: $('#manifestResult'),
    manualPanel: $('#manualPanel'),
    manualTokenId: $('#manualTokenId'),
    manualTraitFields: $('#manualTraitFields'),
    manualPreviewCanvas: $('#manualPreviewCanvas'),
    manualTokenCount: $('#manualTokenCount'),
    manualSavedList: $('#manualSavedList'),
    noRulesBtn: $('#noRulesBtn'),
    yesRulesBtn: $('#yesRulesBtn'),
    rulesWorkspace: $('#rulesWorkspace'),
    sourceLayerSelect: $('#sourceLayerSelect'),
    targetLayerSelect: $('#targetLayerSelect'),
    sourceTraitPicker: $('#sourceTraitPicker'),
    targetTraitPicker: $('#targetTraitPicker'),
    ruleSentence: $('#ruleSentence'),
    addRuleBtn: $('#addRuleBtn'),
    rulesList: $('#rulesList'),
    seedInput: $('#seedInput'),
    compilerStatus: $('#compilerStatus'),
    previewControls: $('#previewControls'),
    collectionStats: $('#collectionStats'),
    previewGrid: $('#previewGrid'),
    toLaunchBtn: $('#toLaunchBtn'),
    launchName: $('#launchName'),
    launchSummaryTitle: $('#launchSummaryTitle'),
    launchSummaryDetails: $('#launchSummaryDetails'),
  };

  function normalizeName(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[\s_-]+/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
  }

  function displayName(filename) {
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function slug(value) {
    return normalizeName(value).replace(/\s+/g, '-') || 'item';
  }

  function showStatus(message, type = '') {
    el.statusBanner.textContent = message;
    el.statusBanner.className = `status-banner ${type}`.trim();
    el.statusBanner.classList.remove('hidden');
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => el.statusBanner.classList.add('hidden'), 5500);
  }

  function getSupply() {
    return Math.max(1, Math.min(25000, Number.parseInt(el.collectionSize.value || '1', 10) || 1));
  }

  function getTrait(traitId) {
    for (const layer of state.layers) {
      const trait = layer.traits.find(t => t.id === traitId);
      if (trait) return trait;
    }
    return null;
  }

  function getLayer(layerId) {
    return state.layers.find(layer => layer.id === layerId) || null;
  }

  function allTraits() {
    return state.layers.flatMap(layer => layer.traits);
  }

  function traitLabel(traitId) {
    const trait = getTrait(traitId);
    if (!trait) return traitId;
    const layer = getLayer(trait.layerId);
    return `${trait.name} (${layer?.name || 'Layer'})`;
  }

  function revokeArtworkUrls() {
    for (const trait of allTraits()) {
      if (trait.url) URL.revokeObjectURL(trait.url);
    }
  }

  async function imageMeta(file) {
    try {
      const bitmap = await createImageBitmap(file);
      const meta = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return meta;
    } catch {
      return { width: 0, height: 0 };
    }
  }

  function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }


  function createNoneTrait(layer) {
    return {
      id: `${layer.id}::trait-none`,
      layerId: layer.id,
      name: 'None',
      filename: '__NONE__',
      file: null,
      url: '',
      width: state.imageWidth,
      height: state.imageHeight,
      rarity: 'common',
      distribution: 'weighted',
      exactCount: null,
      percentage: 0,
      image: null,
      isNone: true,
    };
  }

  function traitPreviewMarkup(trait) {
    if (trait.isNone) {
      return '<div class="thumb-box thumb-box-none"><span>None</span></div>';
    }
    return `<div class="thumb-box"><img src="${trait.url}" alt="${escapeHtml(trait.name)}" /></div>`;
  }

  function syncNoneTrait(layer) {
    const existingIndex = layer.traits.findIndex(t => t.isNone);
    if (layer.allowNone && existingIndex === -1) {
      layer.traits.push(createNoneTrait(layer));
    }
    if (!layer.allowNone && existingIndex >= 0) {
      const noneTraitId = layer.traits[existingIndex].id;
      layer.traits.splice(existingIndex, 1);
      for (const recipe of state.manifestTokens.values()) {
        if (recipe[layer.id] === noneTraitId) delete recipe[layer.id];
      }
      state.sourceSelected.delete(noneTraitId);
      state.targetSelected.delete(noneTraitId);
      state.rules = state.rules
        .map(rule => ({ ...rule, sources: rule.sources.filter(id => id !== noneTraitId), targets: rule.targets.filter(id => id !== noneTraitId) }))
        .filter(rule => rule.sources.length && rule.targets.length);
    }
  }

  function formatPercent(value) {
    const num = Number.parseFloat(value || '0') || 0;
    return Number.isInteger(num) ? `${num}` : `${num.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}`;
  }

  function percentTotal(layer) {
    return layer.traits.reduce((sum, trait) => sum + (Number.parseFloat(trait.percentage || '0') || 0), 0);
  }

  function autoFillLayerPercentages(layerId) {
    const layer = getLayer(layerId);
    if (!layer) return;
    const powers = {
      balanced: 1,
      gradual: 1.35,
      steep: 1.9,
      very_steep: 2.6,
    };
    const power = powers[layer.autoFillStyle] || 1.35;
    const weights = layer.traits.map((_, index) => Math.pow(layer.traits.length - index, power));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
    const raw = layer.traits.map((trait, index) => ({ id: trait.id, value: (weights[index] / totalWeight) * 100 }));
    const floors = raw.map(item => ({ ...item, floor: Math.floor(item.value * 100) / 100, remainder: item.value - Math.floor(item.value * 100) / 100 }));
    let allocated = floors.reduce((sum, item) => sum + item.floor, 0);
    floors.sort((a, b) => b.remainder - a.remainder);
    let i = 0;
    while (allocated < 99.999) {
      floors[i % floors.length].floor = Number((floors[i % floors.length].floor + 0.01).toFixed(2));
      allocated = Number((allocated + 0.01).toFixed(2));
      i++;
    }
    if (allocated > 100) {
      let j = floors.length - 1;
      while (allocated > 100 && floors.length) {
        if (floors[j].floor >= 0.01) {
          floors[j].floor = Number((floors[j].floor - 0.01).toFixed(2));
          allocated = Number((allocated - 0.01).toFixed(2));
        }
        j = (j - 1 + floors.length) % floors.length;
      }
    }
    const pctMap = new Map(floors.map(item => [item.id, item.floor]));
    layer.traits.forEach(trait => { trait.percentage = pctMap.get(trait.id) || 0; });
    renderTraitSetup();
  }

  function validatePercentageLayers() {
    const errors = [];
    if (state.buildMode !== 'auto') return errors;
    for (const layer of state.layers) {
      if (layer.rarityMode !== 'percentage') continue;
      const total = percentTotal(layer);
      if (Math.abs(total - 100) > 0.01) {
        errors.push(`${layer.name}: percentages must add up to 100% (currently ${formatPercent(total)}%).`);
      }
    }
    return errors;
  }

  function moveTrait(layerId, traitId, dir) {
    const layer = getLayer(layerId);
    if (!layer) return;
    const index = layer.traits.findIndex(trait => trait.id === traitId);
    if (index < 0) return;
    const nextIndex = dir === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= layer.traits.length) return;
    [layer.traits[index], layer.traits[nextIndex]] = [layer.traits[nextIndex], layer.traits[index]];
    renderTraitSetup();
  }

  async function loadArtwork(files) {
    const imageFiles = [...files].filter(file => /^image\/(png|webp|jpeg)$/i.test(file.type) || /\.(png|webp|jpe?g)$/i.test(file.name));
    if (!imageFiles.length) {
      showStatus('No PNG, WEBP, or JPG artwork was found in that folder.', 'error');
      return;
    }

    revokeArtworkUrls();
    state.layers = [];
    state.rules = [];
    state.sourceSelected.clear();
    state.targetSelected.clear();
    state.manifestTokens.clear();
    state.compiledTokens = [];

    const grouped = new Map();
    for (const file of imageFiles) {
      const path = file.webkitRelativePath || file.__relativePath || file.name;
      const parts = path.split('/').filter(Boolean);
      const layerName = parts.length >= 2 ? parts[parts.length - 2] : 'Artwork';
      if (!grouped.has(layerName)) grouped.set(layerName, []);
      grouped.get(layerName).push(file);
    }

    const entries = [...grouped.entries()];
    const metas = await Promise.all(imageFiles.map(imageMeta));
    const metaMap = new Map(imageFiles.map((file, index) => [file, metas[index]]));

    state.layers = entries.map(([layerName, layerFiles], layerIndex) => {
      layerFiles.sort((a, b) => naturalSort(a.name, b.name));
      const layerId = `layer-${layerIndex}-${slug(layerName)}`;
      return {
        id: layerId,
        name: layerName,
        allowNone: false,
        rarityMode: 'tier',
        autoFillStyle: 'gradual',
        traits: layerFiles.map((file, traitIndex) => {
          const meta = metaMap.get(file) || { width: 0, height: 0 };
          return {
            id: `${layerId}::trait-${traitIndex}-${slug(file.name)}`,
            layerId,
            name: displayName(file.name),
            filename: file.name,
            file,
            url: URL.createObjectURL(file),
            width: meta.width,
            height: meta.height,
            rarity: 'common',
            distribution: 'weighted',
            exactCount: null,
            percentage: 0,
            image: null,
            isNone: false,
          };
        }),
      };
    });

    const firstMeta = state.layers[0]?.traits[0];
    if (firstMeta?.width && firstMeta?.height) {
      state.imageWidth = firstMeta.width;
      state.imageHeight = firstMeta.height;
    }

    renderArtwork();
    renderTraitSetup();
    renderManualBuilder();
    renderRulePickers();
    renderRulesList();
    updateStep1State();
    showStatus(`Loaded ${imageFiles.length} artwork files across ${state.layers.length} layers.`, 'success');
  }

  function renderArtwork() {
    if (!state.layers.length) {
      el.artworkSummary.classList.add('hidden');
      el.layerList.innerHTML = '';
      return;
    }

    const traits = allTraits();
    const mismatchCount = traits.filter(t => t.width !== state.imageWidth || t.height !== state.imageHeight).length;
    el.artworkSummary.innerHTML = `
      <span class="summary-pill"><strong>${state.layers.length}</strong> layers</span>
      <span class="summary-pill"><strong>${traits.length}</strong> traits</span>
      <span class="summary-pill"><strong>${state.imageWidth}×${state.imageHeight}</strong> canvas</span>
      <span class="summary-pill"><strong>${mismatchCount}</strong> size mismatch${mismatchCount === 1 ? '' : 'es'}</span>
    `;
    el.artworkSummary.classList.remove('hidden');

    el.layerList.innerHTML = state.layers.map((layer, index) => `
      <article class="layer-card" data-layer-id="${escapeHtml(layer.id)}">
        <div class="layer-card-header">
          <div class="layer-title">
            <span class="layer-index">${index + 1}</span>
            <div><strong>${escapeHtml(layer.name)}</strong><small>${layer.traits.length} traits · rendered ${index === 0 ? 'first / back' : index === state.layers.length - 1 ? 'last / front' : `after layer ${index}`}</small></div>
          </div>
          <div class="layer-actions">
            <button class="icon-btn move-layer" data-dir="up" title="Move layer backward" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn move-layer" data-dir="down" title="Move layer forward" ${index === state.layers.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
        </div>
        <div class="trait-thumbs">
          ${layer.traits.slice(0, 24).map(trait => `
            <div class="trait-thumb">
              ${traitPreviewMarkup(trait)}
              <span title="${escapeHtml(trait.name)}">${escapeHtml(trait.name)}</span>
            </div>
          `).join('')}
          ${layer.traits.length > 24 ? `<div class="trait-thumb"><div class="thumb-box">+${layer.traits.length - 24}</div><span>more traits</span></div>` : ''}
        </div>
      </article>
    `).join('');
  }

  function updateStep1State() {
    const next = $('.next-btn[data-next="2"]');
    const hasArtwork = state.layers.length > 0;
    next.disabled = !hasArtwork;
    if (!hasArtwork) {
      el.step1Hint.textContent = 'Upload artwork to continue.';
      return;
    }
    const mismatchCount = allTraits().filter(t => t.width !== state.imageWidth || t.height !== state.imageHeight).length;
    el.step1Hint.textContent = mismatchCount
      ? `${mismatchCount} file(s) use a different canvas size. You can continue, but check alignment in Preview.`
      : 'Artwork looks ready.';
  }

  function moveLayer(layerId, dir) {
    const index = state.layers.findIndex(layer => layer.id === layerId);
    if (index < 0) return;
    const nextIndex = dir === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= state.layers.length) return;
    [state.layers[index], state.layers[nextIndex]] = [state.layers[nextIndex], state.layers[index]];
    renderArtwork();
    renderTraitSetup();
  }

  function renderTraitSetup() {
    if (!state.layers.length) {
      el.traitSetup.innerHTML = '';
      return;
    }

    const showExact = state.buildMode === 'exact';
    const showTraitControls = state.buildMode !== 'manifest' || state.mode === 'advanced';
    const autoMode = state.buildMode === 'auto';
    if (!showTraitControls) {
      el.traitSetup.innerHTML = `
        <div class="validation-box">
          Your uploaded collection list will choose the layers for defined token IDs. Any missing traits or token IDs will be filled using the current rarity settings.
        </div>`;
      return;
    }

    el.traitSetup.innerHTML = state.layers.map(layer => {
      const pctTotal = percentTotal(layer);
      const pctDiff = Number((pctTotal - 100).toFixed(2));
      const pctValid = Math.abs(pctDiff) <= 0.01;
      const pctClass = pctValid ? 'valid' : (pctTotal > 100 ? 'over' : 'under');
      return `
      <section class="trait-config-layer" data-layer-id="${escapeHtml(layer.id)}">
        <div class="trait-config-header trait-config-header-rich">
          <div>
            <strong>${escapeHtml(layer.name)}</strong>
            <span>${layer.traits.length} traits${layer.allowNone ? ' · None enabled' : ''}</span>
          </div>
          <div class="trait-header-controls">
            <label class="inline-check"><input class="none-layer-toggle" type="checkbox" data-layer-id="${escapeHtml(layer.id)}" ${layer.allowNone ? 'checked' : ''} /> Allow None</label>
            ${autoMode ? `
              <label class="mini-select">Rarity input
                <select class="layer-rarity-mode" data-layer-id="${escapeHtml(layer.id)}">
                  <option value="tier" ${layer.rarityMode === 'tier' ? 'selected' : ''}>Rarity tiers</option>
                  <option value="percentage" ${layer.rarityMode === 'percentage' ? 'selected' : ''}>Percentages</option>
                </select>
              </label>
            ` : ''}
            ${autoMode && layer.rarityMode === 'percentage' ? `
              <label class="mini-select">Auto fill
                <select class="layer-autofill-style" data-layer-id="${escapeHtml(layer.id)}">
                  <option value="balanced" ${layer.autoFillStyle === 'balanced' ? 'selected' : ''}>Balanced</option>
                  <option value="gradual" ${layer.autoFillStyle === 'gradual' ? 'selected' : ''}>Gradual</option>
                  <option value="steep" ${layer.autoFillStyle === 'steep' ? 'selected' : ''}>Steep</option>
                  <option value="very_steep" ${layer.autoFillStyle === 'very_steep' ? 'selected' : ''}>Very steep</option>
                </select>
              </label>
              <button type="button" class="ghost-btn small-btn autofill-btn" data-layer-id="${escapeHtml(layer.id)}">Auto Fill</button>
              <div class="percent-total ${pctClass}">Total ${formatPercent(pctTotal)}% ${pctValid ? '✓' : pctTotal > 100 ? `· Over by ${formatPercent(Math.abs(pctDiff))}%` : `· Add ${formatPercent(Math.abs(pctDiff))}%`}</div>
            ` : ''}
          </div>
        </div>
        <div class="trait-config-grid">
          ${layer.traits.map((trait, traitIndex) => `
            <div class="trait-config" data-trait-id="${escapeHtml(trait.id)}">
              ${trait.isNone
                ? '<div class="trait-config-placeholder">None</div>'
                : `<img src="${trait.url}" alt="${escapeHtml(trait.name)}" />`}
              <div>
                <div class="trait-config-topline">
                  <div class="trait-config-name" title="${escapeHtml(trait.name)}">${escapeHtml(trait.name)}</div>
                  ${autoMode && layer.rarityMode === 'percentage' ? `
                    <div class="order-controls">
                      <button type="button" class="icon-btn move-trait" data-layer-id="${escapeHtml(layer.id)}" data-trait-id="${escapeHtml(trait.id)}" data-dir="up" ${traitIndex === 0 ? 'disabled' : ''}>↑</button>
                      <button type="button" class="icon-btn move-trait" data-layer-id="${escapeHtml(layer.id)}" data-trait-id="${escapeHtml(trait.id)}" data-dir="down" ${traitIndex === layer.traits.length - 1 ? 'disabled' : ''}>↓</button>
                    </div>` : ''}
                </div>
                <div class="trait-config-controls ${autoMode && layer.rarityMode === 'percentage' ? 'percent-mode' : ''}">
                  ${autoMode && layer.rarityMode === 'percentage'
                    ? `<input class="percent-input" type="number" min="0" max="100" step="0.01" value="${formatPercent(trait.percentage)}" aria-label="Percentage for ${escapeHtml(trait.name)}" /><span class="input-tag">%</span>`
                    : `<select class="rarity-select" aria-label="Rarity for ${escapeHtml(trait.name)}" ${trait.distribution === 'exact' ? 'disabled' : ''}>
                        ${Object.entries(rarityLabels).map(([key, label]) => `<option value="${key}" ${trait.rarity === key ? 'selected' : ''}>${label}</option>`).join('')}
                      </select>`}
                  ${showExact ? `<input class="exact-count" type="number" min="0" max="${getSupply()}" placeholder="Exact #" value="${trait.distribution === 'exact' && trait.exactCount != null ? trait.exactCount : ''}" ${trait.distribution !== 'exact' ? 'disabled' : ''} />` : `<span></span>`}
                </div>
                ${showExact ? `<label class="exact-toggle"><input class="exact-check" type="checkbox" ${trait.distribution === 'exact' ? 'checked' : ''} /> Use exact amount</label>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </section>`;
    }).join('');
  }

  function setBuildMode(mode) {
    state.buildMode = mode;
    $$('.build-card').forEach(card => card.classList.toggle('selected', card.dataset.buildMode === mode));
    el.manifestPanel.classList.toggle('hidden', mode !== 'manifest');
    el.manualPanel.classList.toggle('hidden', mode !== 'manual');
    if (mode === 'manual') renderManualBuilder();
    renderTraitSetup();
  }


  function renderManualBuilder(tokenId = null) {
    if (!state.layers.length) {
      el.manualTraitFields.innerHTML = '';
      el.manualSavedList.innerHTML = '';
      return;
    }
    const supply = getSupply();
    el.manualTokenId.max = supply;
    const id = tokenId ?? Math.max(1, Math.min(supply, Number.parseInt(el.manualTokenId.value || '1', 10) || 1));
    el.manualTokenId.value = id;
    const saved = state.manifestTokens.get(id) || {};

    el.manualTraitFields.innerHTML = state.layers.map(layer => `
      <label class="field">
        <span>${escapeHtml(layer.name)}</span>
        <select class="manual-trait-select" data-layer-id="${escapeHtml(layer.id)}">
          <option value="">Generate automatically</option>
          ${layer.traits.map(trait => `<option value="${escapeHtml(trait.id)}" ${saved[layer.id] === trait.id ? 'selected' : ''}>${escapeHtml(trait.name)}</option>`).join('')}
        </select>
      </label>
    `).join('');
    renderManualSavedList();
    renderManualPreview();
  }

  function currentManualSelection() {
    const recipe = {};
    $$('.manual-trait-select', el.manualTraitFields).forEach(select => {
      if (select.value) recipe[select.dataset.layerId] = select.value;
    });
    return recipe;
  }

  async function renderManualPreview() {
    if (!state.layers.length || !el.manualPreviewCanvas) return;
    const token = { tokenId: Number.parseInt(el.manualTokenId.value || '1', 10), traits: currentManualSelection() };
    await renderTokenToCanvas(token, el.manualPreviewCanvas);
  }

  function saveManualToken() {
    const supply = getSupply();
    const tokenId = Number.parseInt(el.manualTokenId.value || '0', 10);
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > supply) {
      showStatus(`Choose a token number between 1 and ${supply}.`, 'error');
      return;
    }
    const recipe = currentManualSelection();
    if (!Object.keys(recipe).length) {
      showStatus('Choose at least one trait to lock for this token.', 'warn');
      return;
    }
    state.manifestTokens.set(tokenId, recipe);
    state.manifestSourceName = 'Manual curator';
    renderManualSavedList();
    showStatus(`Token #${tokenId} saved with ${Object.keys(recipe).length} locked layer choice(s).`, 'success');
  }

  function clearManualToken() {
    const tokenId = Number.parseInt(el.manualTokenId.value || '0', 10);
    if (state.manifestTokens.has(tokenId)) state.manifestTokens.delete(tokenId);
    renderManualBuilder(tokenId);
    showStatus(`Token #${tokenId} is no longer manually locked.`);
  }

  function renderManualSavedList() {
    const entries = [...state.manifestTokens.entries()]
      .filter(([tokenId]) => tokenId >= 1 && tokenId <= getSupply())
      .sort((a, b) => a[0] - b[0]);
    el.manualTokenCount.textContent = entries.length;
    if (!entries.length) {
      el.manualSavedList.innerHTML = '<div class="empty-state">No curated tokens yet.</div>';
      return;
    }
    el.manualSavedList.innerHTML = entries.slice(0, 100).map(([tokenId, recipe]) => {
      const labels = state.layers
        .filter(layer => recipe[layer.id])
        .map(layer => `${layer.name}: ${getTrait(recipe[layer.id])?.name || 'Unknown'}`);
      return `<div class="manual-saved-token"><span><strong>#${tokenId}</strong> · ${escapeHtml(labels.join(' · '))}</span><button type="button" data-load-manual="${tokenId}">Edit</button></div>`;
    }).join('') + (entries.length > 100 ? `<div class="empty-state">+ ${entries.length - 100} more curated tokens</div>` : '');
  }

  function setMode(mode) {
    state.mode = mode;
    document.body.dataset.mode = mode;
    $$('.mode-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    renderTraitSetup();
    showStatus(mode === 'simple' ? 'Simple Mode: only the controls you need.' : 'Advanced Mode: exact counts and deeper controls are now visible.');
  }

  function gotoStep(step) {
    state.step = step;
    $$('.step-panel').forEach(panel => panel.classList.toggle('active', Number(panel.dataset.panel) === step));
    $$('.step').forEach(btn => {
      const n = Number(btn.dataset.step);
      btn.classList.toggle('active', n === step);
      btn.classList.toggle('complete', n < step);
    });
    if (step === 2) renderTraitSetup();
    if (step === 3) renderRulePickers();
    if (step === 4 && !state.compiledTokens.length) buildCollection();
    if (step === 5) updateLaunchSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        row.push(cell); cell = '';
      } else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some(v => v.trim() !== '')) rows.push(row);
    return rows;
  }

  function coerceManifest(data) {
    let rawTokens;
    if (Array.isArray(data)) rawTokens = data;
    else if (Array.isArray(data?.tokens)) rawTokens = data.tokens;
    else if (data?.tokens && typeof data.tokens === 'object') {
      rawTokens = Object.entries(data.tokens).map(([tokenId, value]) => ({ tokenId, ...(value?.traits ? value : { traits: value }) }));
    } else throw new Error('JSON must contain a tokens array/object, or be an array of token recipes.');

    return rawTokens.map((entry, index) => {
      const tokenId = Number.parseInt(entry.tokenId ?? entry.token ?? entry.id ?? index + 1, 10);
      const traits = entry.traits && typeof entry.traits === 'object'
        ? entry.traits
        : Object.fromEntries(Object.entries(entry).filter(([key]) => !['tokenId', 'token', 'id', 'name'].includes(key)));
      return { tokenId, traits };
    });
  }

  function csvToManifest(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('CSV needs a header row and at least one token row.');
    const headers = rows[0].map(v => v.trim());
    const tokenIndex = headers.findIndex(h => ['token', 'tokenid', 'token id', 'id', '#'].includes(normalizeName(h)));
    if (tokenIndex < 0) throw new Error('CSV needs a Token or Token ID column.');
    return rows.slice(1).map(row => {
      const tokenId = Number.parseInt(row[tokenIndex], 10);
      const traits = {};
      headers.forEach((header, index) => {
        if (index === tokenIndex || !header || !row[index]?.trim()) return;
        traits[header] = row[index].trim();
      });
      return { tokenId, traits };
    });
  }

  function resolveManifest(recipes) {
    const layerLookup = new Map(state.layers.map(layer => [normalizeName(layer.name), layer]));
    const resolved = new Map();
    const errors = [];
    const warnings = [];
    const supply = getSupply();

    for (const recipe of recipes) {
      if (!Number.isInteger(recipe.tokenId) || recipe.tokenId < 1) {
        errors.push(`Invalid token ID: ${recipe.tokenId}`);
        continue;
      }
      if (recipe.tokenId > supply) warnings.push(`Token #${recipe.tokenId} is above the current collection size (${supply}).`);
      if (resolved.has(recipe.tokenId)) {
        errors.push(`Token #${recipe.tokenId} appears more than once.`);
        continue;
      }
      const tokenTraits = {};
      for (const [layerName, traitName] of Object.entries(recipe.traits || {})) {
        const layer = layerLookup.get(normalizeName(layerName));
        if (!layer) {
          errors.push(`Token #${recipe.tokenId}: layer “${layerName}” was not found.`);
          continue;
        }
        const wantedName = normalizeName(traitName);
        const trait = layer.traits.find(t => normalizeName(t.name) === wantedName || normalizeName(t.filename) === wantedName);
        if (!trait) {
          if (wantedName === 'none') {
            errors.push(`Token #${recipe.tokenId}: ${layer.name} is set to “None”, but None is not enabled for that layer yet.`);
            continue;
          }
          const possibilities = layer.traits.slice(0, 4).map(t => t.name).join(', ');
          errors.push(`Token #${recipe.tokenId}: “${traitName}” was not found in ${layer.name}${possibilities ? ` (examples: ${possibilities})` : ''}.`);
          continue;
        }
        tokenTraits[layer.id] = trait.id;
      }
      resolved.set(recipe.tokenId, tokenTraits);
    }

    return { resolved, errors, warnings };
  }

  async function importManifest(file) {
    if (!state.layers.length) {
      showStatus('Upload your artwork layers first.', 'error');
      return;
    }
    try {
      const text = await file.text();
      const recipes = file.name.toLowerCase().endsWith('.csv') ? csvToManifest(text) : coerceManifest(JSON.parse(text));
      const result = resolveManifest(recipes);
      el.manifestFileName.textContent = file.name;
      state.manifestSourceName = file.name;
      if (result.errors.length) {
        el.manifestResult.className = 'validation-box error';
        el.manifestResult.innerHTML = `<strong>We found ${result.errors.length} thing(s) to fix.</strong><br>${result.errors.slice(0, 10).map(escapeHtml).join('<br>')}${result.errors.length > 10 ? '<br>…and more.' : ''}`;
        el.manifestResult.classList.remove('hidden');
        return;
      }
      state.manifestTokens = result.resolved;
      el.manifestResult.className = 'validation-box success';
      const fullyDefined = [...result.resolved.values()].filter(t => Object.keys(t).length === state.layers.length).length;
      el.manifestResult.innerHTML = `<strong>✓ ${result.resolved.size} token recipe(s) loaded</strong><br>✓ ${fullyDefined} fully defined · ${result.resolved.size - fullyDefined} partially defined${result.warnings.length ? `<br>⚠ ${result.warnings.map(escapeHtml).join('<br>⚠ ')}` : ''}`;
      el.manifestResult.classList.remove('hidden');
      showStatus('Collection list matched to your uploaded layers.', 'success');
    } catch (error) {
      el.manifestResult.className = 'validation-box error';
      el.manifestResult.textContent = error.message;
      el.manifestResult.classList.remove('hidden');
    }
  }

  function templateCsv() {
    const headers = ['Token', ...state.layers.map(layer => layer.name)];
    const sample = ['1', ...state.layers.map(layer => layer.traits[0]?.name || '')];
    return `${headers.map(csvEscape).join(',')}\n${sample.map(csvEscape).join(',')}\n`;
  }

  function templateJson() {
    const sampleTraits = Object.fromEntries(state.layers.map(layer => [layer.name, layer.traits[0]?.name || '']));
    return JSON.stringify({
      collection: { name: el.collectionName.value, supply: getSupply() },
      tokens: [
        { tokenId: 1, traits: sampleTraits },
        { tokenId: 2, traits: { [state.layers[0]?.name || 'Background']: state.layers[0]?.traits[0]?.name || '' } }
      ]
    }, null, 2);
  }

  function csvEscape(value) {
    const str = String(value ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function downloadText(filename, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderRulePickers() {
    const layerOptions = [`<option value="all">All layers</option>`, ...state.layers.map(layer => `<option value="${escapeHtml(layer.id)}">${escapeHtml(layer.name)}</option>`)];
    el.sourceLayerSelect.innerHTML = layerOptions.join('');
    el.targetLayerSelect.innerHTML = layerOptions.join('');
    renderTraitPicker('source');
    renderTraitPicker('target');
    updateRuleSentence();
  }

  function renderTraitPicker(kind) {
    const select = kind === 'source' ? el.sourceLayerSelect : el.targetLayerSelect;
    const picker = kind === 'source' ? el.sourceTraitPicker : el.targetTraitPicker;
    const selected = kind === 'source' ? state.sourceSelected : state.targetSelected;
    const filterLayer = select.value || 'all';
    const traits = allTraits().filter(t => filterLayer === 'all' || t.layerId === filterLayer);
    picker.innerHTML = traits.map(trait => {
      const layer = getLayer(trait.layerId);
      return `<button class="pick-trait ${selected.has(trait.id) ? 'selected' : ''}" data-kind="${kind}" data-trait-id="${escapeHtml(trait.id)}" type="button">
        ${trait.isNone ? '<div class="pick-trait-none">None</div>' : `<img src="${trait.url}" alt="${escapeHtml(trait.name)}" />`}
        <strong>${escapeHtml(trait.name)}</strong>
        <small>${escapeHtml(layer?.name || '')}</small>
      </button>`;
    }).join('') || '<div class="empty-state">No traits in this layer.</div>';
  }

  function setRulesEnabled(enabled) {
    state.rulesEnabled = enabled;
    el.noRulesBtn.classList.toggle('selected', !enabled);
    el.yesRulesBtn.classList.toggle('selected', enabled);
    el.rulesWorkspace.classList.toggle('hidden', !enabled);
    if (enabled) renderRulePickers();
  }

  function updateRuleSentence() {
    const sources = [...state.sourceSelected].map(traitLabel);
    const targets = [...state.targetSelected].map(traitLabel);
    let sentence = 'Choose traits above to build a rule.';
    if (sources.length && targets.length) {
      const sourceText = humanList(sources, 4);
      const targetText = humanList(targets, 4);
      if (state.ruleType === 'only_with') sentence = `${sourceText} can only appear when ${targetText} is also present.`;
      if (state.ruleType === 'excludes') sentence = `${sourceText} cannot appear with ${targetText}.`;
      if (state.ruleType === 'always_with') sentence = `${sourceText} must always be paired with ${targetText}.`;
    }
    el.ruleSentence.textContent = sentence;
    el.addRuleBtn.disabled = !(sources.length && targets.length);
  }

  function humanList(items, max = 5) {
    const clipped = items.slice(0, max);
    const suffix = items.length > max ? ` + ${items.length - max} more` : '';
    if (clipped.length === 1) return clipped[0] + suffix;
    if (clipped.length === 2) return `${clipped[0]} and ${clipped[1]}${suffix}`;
    return `${clipped.slice(0, -1).join(', ')}, and ${clipped.at(-1)}${suffix}`;
  }

  function addRule() {
    if (!state.sourceSelected.size || !state.targetSelected.size) return;
    const rule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: state.ruleType,
      sources: [...state.sourceSelected],
      targets: [...state.targetSelected],
    };
    state.rules.push(rule);
    state.sourceSelected.clear();
    state.targetSelected.clear();
    renderTraitPicker('source');
    renderTraitPicker('target');
    updateRuleSentence();
    renderRulesList();
  }

  function ruleSentence(rule) {
    const sources = rule.sources.map(traitLabel);
    const targets = rule.targets.map(traitLabel);
    if (rule.type === 'only_with') return `${humanList(sources)} can only appear when ${humanList(targets)} is also present.`;
    if (rule.type === 'excludes') return `${humanList(sources)} cannot appear with ${humanList(targets)}.`;
    return `${humanList(sources)} must always be paired with ${humanList(targets)}.`;
  }

  function renderRulesList() {
    if (!state.rules.length) {
      el.rulesList.innerHTML = '<div class="empty-state">No rules yet.</div>';
      return;
    }
    el.rulesList.innerHTML = state.rules.map(rule => {
      const layerCount = new Set(rule.sources.map(id => getTrait(id)?.layerId).filter(Boolean)).size;
      return `<div class="saved-rule">
        <div><strong>${escapeHtml(ruleSentence(rule))}</strong><small>${rule.sources.length} source trait(s) across ${layerCount} layer(s)</small></div>
        <button class="rule-remove" data-rule-id="${escapeHtml(rule.id)}" type="button">Remove</button>
      </div>`;
    }).join('');
  }

  function selectedLayerTraits(kind) {
    const select = kind === 'source' ? el.sourceLayerSelect : el.targetLayerSelect;
    const layerId = select.value;
    if (layerId === 'all') return allTraits().map(t => t.id);
    return getLayer(layerId)?.traits.map(t => t.id) || [];
  }

  function seedHash(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function createRng(seed) {
    const hash = seedHash(seed || 'RELIC');
    return mulberry32(hash());
  }

  function shuffle(array, rng) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function largestRemainder(total, weightedItems) {
    if (total <= 0) return new Map(weightedItems.map(item => [item.id, 0]));
    const weightSum = weightedItems.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (weightSum <= 0) throw new Error('At least one non-exact trait needs a rarity weight in each layer.');
    const raw = weightedItems.map(item => {
      const value = total * Math.max(0, item.weight) / weightSum;
      return { id: item.id, floor: Math.floor(value), remainder: value - Math.floor(value) };
    });
    let allocated = raw.reduce((sum, item) => sum + item.floor, 0);
    raw.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; allocated < total; i++, allocated++) raw[i % raw.length].floor += 1;
    return new Map(raw.map(item => [item.id, item.floor]));
  }

  function buildLayerAssignments(layer, supply, rng, lockedByToken) {
    const lockedCounts = new Map(layer.traits.map(t => [t.id, 0]));
    const slots = new Array(supply).fill(null);
    const lockedMask = new Array(supply).fill(false);

    for (const [tokenId, recipe] of lockedByToken.entries()) {
      const traitId = recipe[layer.id];
      if (!traitId || tokenId < 1 || tokenId > supply) continue;
      slots[tokenId - 1] = traitId;
      lockedMask[tokenId - 1] = true;
      lockedCounts.set(traitId, (lockedCounts.get(traitId) || 0) + 1);
    }

    let exactTargetSum = 0;
    const targetCounts = new Map();
    const weighted = [];
    const percentageTraits = [];
    let lockedWeightedCount = 0;

    for (const trait of layer.traits) {
      const locked = lockedCounts.get(trait.id) || 0;
      if (trait.distribution === 'exact') {
        const exact = Math.max(0, Number.parseInt(trait.exactCount ?? '0', 10) || 0);
        if (exact < locked) throw new Error(`${layer.name} → ${trait.name}: exact amount ${exact} is lower than ${locked} manually assigned token(s).`);
        targetCounts.set(trait.id, exact);
        exactTargetSum += exact;
      } else if (state.buildMode === 'auto' && layer.rarityMode === 'percentage') {
        const pct = Number.parseFloat(trait.percentage || '0') || 0;
        percentageTraits.push({ id: trait.id, weight: pct });
      } else {
        weighted.push({ id: trait.id, weight: rarityWeights[trait.rarity] || 1 });
        lockedWeightedCount += locked;
      }
    }

    if (exactTargetSum + lockedWeightedCount > supply) {
      throw new Error(`${layer.name}: exact amounts plus manually assigned traits exceed the collection size.`);
    }

    if (state.buildMode === 'auto' && layer.rarityMode === 'percentage') {
      const totalPct = percentageTraits.reduce((sum, item) => sum + item.weight, 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        throw new Error(`${layer.name}: percentages must add up to 100% before generating.`);
      }
      const pctAlloc = largestRemainder(supply - exactTargetSum, percentageTraits);
      for (const trait of layer.traits) {
        if (trait.distribution === 'exact') continue;
        const allocated = pctAlloc.get(trait.id) || 0;
        const locked = lockedCounts.get(trait.id) || 0;
        if (allocated < locked) {
          throw new Error(`${layer.name} → ${trait.name}: ${formatPercent(trait.percentage)}% is too low for the manual/imported tokens already locked to this trait.`);
        }
        targetCounts.set(trait.id, allocated);
      }
    } else {
      const weightedRemaining = supply - exactTargetSum - lockedWeightedCount;
      if (weightedRemaining > 0 && !weighted.length) {
        throw new Error(`${layer.name}: exact amounts only account for ${exactTargetSum + lockedWeightedCount}/${supply} tokens and there are no weighted traits left to fill the layer.`);
      }
      const weightedAlloc = largestRemainder(weightedRemaining, weighted);
      for (const trait of layer.traits) {
        if (trait.distribution !== 'exact') {
          targetCounts.set(trait.id, (lockedCounts.get(trait.id) || 0) + (weightedAlloc.get(trait.id) || 0));
        }
      }
    }

    const bag = [];
    for (const trait of layer.traits) {
      const need = (targetCounts.get(trait.id) || 0) - (lockedCounts.get(trait.id) || 0);
      if (need < 0) throw new Error(`${layer.name} → ${trait.name}: manual assignments exceed its target amount.`);
      for (let i = 0; i < need; i++) bag.push(trait.id);
    }
    shuffle(bag, rng);

    let cursor = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] == null) slots[i] = bag[cursor++];
    }
    if (cursor !== bag.length || slots.some(v => !v)) throw new Error(`${layer.name}: could not fill all token slots.`);

    return { slots, lockedMask, targetCounts };
  }

  function tokenHas(token, traitIds) {
    const values = Object.values(token.traits);
    return traitIds.some(id => values.includes(id));
  }

  function targetsByLayer(rule) {
    const map = new Map();
    for (const traitId of rule.targets) {
      const trait = getTrait(traitId);
      if (!trait || trait.isNone) continue;
      if (!map.has(trait.layerId)) map.set(trait.layerId, []);
      map.get(trait.layerId).push(traitId);
    }
    return map;
  }

  function ruleViolationCount(token, rule) {
    if (!tokenHas(token, rule.sources)) return 0;
    if (rule.type === 'excludes') return tokenHas(token, rule.targets) ? 1 : 0;
    let violations = 0;
    for (const [layerId, allowedTraits] of targetsByLayer(rule)) {
      if (!allowedTraits.includes(token.traits[layerId])) violations++;
    }
    return violations;
  }

  function tokenViolationCount(token) {
    if (!state.rulesEnabled || !state.rules.length) return 0;
    return state.rules.reduce((sum, rule) => sum + ruleViolationCount(token, rule), 0);
  }

  function getViolationDetails(tokens) {
    const details = [];
    tokens.forEach((token, tokenIndex) => {
      state.rules.forEach(rule => {
        const count = ruleViolationCount(token, rule);
        if (count) details.push({ tokenIndex, rule, count });
      });
    });
    return details;
  }

  function localViolation(tokens, indices) {
    const unique = [...new Set(indices)];
    return unique.reduce((sum, index) => sum + tokenViolationCount(tokens[index]), 0);
  }

  function trySwap(tokens, layerId, a, b, lockedMasks, acceptEqual = false) {
    if (a === b || lockedMasks[layerId][a] || lockedMasks[layerId][b]) return false;
    const before = localViolation(tokens, [a, b]);
    const tmp = tokens[a].traits[layerId];
    tokens[a].traits[layerId] = tokens[b].traits[layerId];
    tokens[b].traits[layerId] = tmp;
    const after = localViolation(tokens, [a, b]);
    if (after < before || (acceptEqual && after === before)) return true;
    tokens[b].traits[layerId] = tokens[a].traits[layerId];
    tokens[a].traits[layerId] = tmp;
    return false;
  }

  function repairRules(tokens, lockedMasks, rng) {
    if (!state.rulesEnabled || !state.rules.length) return { remaining: 0, passes: 0 };
    let passes = 0;
    let details = getViolationDetails(tokens);
    const maxPasses = Math.min(30, 5 + state.rules.length * 4);

    while (details.length && passes < maxPasses) {
      passes++;
      let changes = 0;
      shuffle(details, rng);
      for (const violation of details) {
        const i = violation.tokenIndex;
        const rule = violation.rule;
        if (!tokenHas(tokens[i], rule.sources)) continue;

        if (rule.type === 'excludes') {
          const offendingTargets = rule.targets.filter(id => Object.values(tokens[i].traits).includes(id));
          for (const targetId of offendingTargets) {
            const target = getTrait(targetId);
            if (!target || lockedMasks[target.layerId][i]) continue;
            const candidates = [];
            for (let attempt = 0; attempt < Math.min(tokens.length, 180); attempt++) {
              const j = Math.floor(rng() * tokens.length);
              if (j === i || lockedMasks[target.layerId][j]) continue;
              if (rule.targets.includes(tokens[j].traits[target.layerId])) continue;
              candidates.push(j);
            }
            for (const j of candidates) {
              if (trySwap(tokens, target.layerId, i, j, lockedMasks)) { changes++; break; }
            }
          }
        } else {
          for (const [targetLayerId, allowed] of targetsByLayer(rule)) {
            if (allowed.includes(tokens[i].traits[targetLayerId]) || lockedMasks[targetLayerId][i]) continue;
            const candidates = [];
            for (let attempt = 0; attempt < Math.min(tokens.length, 300); attempt++) {
              const j = Math.floor(rng() * tokens.length);
              if (j === i || lockedMasks[targetLayerId][j]) continue;
              if (!allowed.includes(tokens[j].traits[targetLayerId])) continue;
              candidates.push(j);
            }
            for (const j of candidates) {
              if (trySwap(tokens, targetLayerId, i, j, lockedMasks)) { changes++; break; }
            }
          }
        }
      }

      if (!changes) {
        // General local search can repair cases where moving the source is easier than moving the target.
        const layerIds = state.layers.map(l => l.id);
        const attempts = Math.min(35000, Math.max(2000, tokens.length * 8));
        for (let k = 0; k < attempts; k++) {
          const layerId = layerIds[Math.floor(rng() * layerIds.length)];
          const a = Math.floor(rng() * tokens.length);
          const b = Math.floor(rng() * tokens.length);
          if (trySwap(tokens, layerId, a, b, lockedMasks)) changes++;
        }
      }
      details = getViolationDetails(tokens);
      if (!changes) break;
    }
    return { remaining: details.reduce((sum, d) => sum + d.count, 0), passes };
  }

  function duplicateCount(tokens) {
    const seen = new Map();
    let duplicates = 0;
    for (const token of tokens) {
      const key = state.layers.map(layer => token.traits[layer.id]).join('|');
      const count = seen.get(key) || 0;
      if (count >= 1) duplicates++;
      seen.set(key, count + 1);
    }
    return duplicates;
  }

  function exactCountValidation(tokens) {
    const issues = [];
    for (const layer of state.layers) {
      for (const trait of layer.traits.filter(t => t.distribution === 'exact')) {
        const actual = tokens.reduce((count, token) => count + (token.traits[layer.id] === trait.id ? 1 : 0), 0);
        const expected = Number.parseInt(trait.exactCount || '0', 10) || 0;
        if (actual !== expected) issues.push(`${layer.name} → ${trait.name}: expected exactly ${expected}, generated ${actual}.`);
      }
    }
    return issues;
  }

  function compileCollection() {
    if (!state.layers.length) throw new Error('Upload artwork first.');
    const supply = getSupply();
    const seed = el.seedInput.value.trim() || 'RELIC-001';
    const rng = createRng(seed);
    const lockedByToken = new Map([...state.manifestTokens.entries()].filter(([tokenId]) => tokenId >= 1 && tokenId <= supply));

    const tokens = Array.from({ length: supply }, (_, i) => ({ tokenId: i + 1, traits: {} }));
    const lockedMasks = {};
    const targetCounts = {};

    for (const layer of state.layers) {
      const assignment = buildLayerAssignments(layer, supply, rng, lockedByToken);
      lockedMasks[layer.id] = assignment.lockedMask;
      targetCounts[layer.id] = assignment.targetCounts;
      assignment.slots.forEach((traitId, i) => { tokens[i].traits[layer.id] = traitId; });
    }

    const repair = repairRules(tokens, lockedMasks, rng);
    const ruleViolations = getViolationDetails(tokens);
    const exactIssues = exactCountValidation(tokens);
    const duplicates = duplicateCount(tokens);

    return {
      tokens,
      report: {
        supply,
        seed,
        manualTokens: lockedByToken.size,
        rules: state.rulesEnabled ? state.rules.length : 0,
        ruleViolations: ruleViolations.reduce((sum, item) => sum + item.count, 0),
        exactIssues,
        duplicates,
        repairPasses: repair.passes,
      }
    };
  }

  async function buildCollection() {
    el.compilerStatus.innerHTML = `<div class="compiler-box"><strong>Forging collection…</strong><ul><li>Allocating exact trait amounts</li><li>Applying manual token recipes</li><li>Resolving shared trait rules</li><li>Checking duplicates</li></ul></div>`;
    el.previewGrid.innerHTML = '';
    el.previewControls.classList.add('hidden');
    el.toLaunchBtn.disabled = true;

    await new Promise(resolve => setTimeout(resolve, 35));
    try {
      const percentErrors = validatePercentageLayers();
      if (percentErrors.length) throw new Error(percentErrors[0]);
      const result = compileCollection();
      state.compiledTokens = result.tokens;
      state.compilerReport = result.report;
      renderCompilerReport();
      await renderPreviewGrid();
      el.previewControls.classList.remove('hidden');
      el.toLaunchBtn.disabled = result.report.ruleViolations > 0 || result.report.exactIssues.length > 0;
      if (!el.toLaunchBtn.disabled) showStatus('Collection compiled successfully.', 'success');
    } catch (error) {
      state.compiledTokens = [];
      state.compilerReport = null;
      el.compilerStatus.innerHTML = `<div class="compiler-box error"><strong>We couldn’t build the collection yet.</strong><ul><li>${escapeHtml(error.message)}</li></ul></div>`;
      showStatus(error.message, 'error');
    }
  }

  function renderCompilerReport() {
    const r = state.compilerReport;
    if (!r) return;
    const hardProblems = r.ruleViolations + r.exactIssues.length;
    const messages = [
      `${r.supply.toLocaleString()} token recipes created`,
      `${r.manualTokens.toLocaleString()} token(s) use imported/manual layer choices`,
      `${r.rules} shared rule(s) checked`,
      r.ruleViolations ? `${r.ruleViolations} rule conflict(s) remain` : 'All active trait rules are satisfied',
      r.exactIssues.length ? `${r.exactIssues.length} exact-count issue(s) remain` : 'All exact trait counts are satisfied',
      r.duplicates ? `${r.duplicates} duplicate combination(s) found — regenerate or adjust artwork/rarities if uniqueness is required` : 'No duplicate combinations found',
    ];
    el.compilerStatus.innerHTML = `<div class="compiler-box ${hardProblems ? 'error' : 'success'}"><strong>${hardProblems ? 'A few things still need attention.' : 'Collection recipe is valid.'}</strong><ul>${messages.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul></div>`;

    el.collectionStats.innerHTML = `
      <div class="stat"><span>Supply</span><strong>${r.supply.toLocaleString()}</strong></div>
      <div class="stat"><span>Layers</span><strong>${state.layers.length}</strong></div>
      <div class="stat"><span>Rules</span><strong>${r.rules}</strong></div>
      <div class="stat"><span>Manual</span><strong>${r.manualTokens}</strong></div>
      <div class="stat"><span>Duplicates</span><strong>${r.duplicates}</strong></div>
    `;
  }

  async function ensureTraitImage(trait) {
    if (trait.isNone) return null;
    if (trait.image?.complete) return trait.image;
    trait.image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = trait.url;
    });
    return trait.image;
  }

  async function renderTokenToCanvas(token, canvas) {
    const width = state.imageWidth || 1000;
    const height = state.imageHeight || 1000;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    for (const layer of state.layers) {
      const trait = getTrait(token.traits[layer.id]);
      if (!trait || trait.isNone) continue;
      try {
        const img = await ensureTraitImage(trait);
        ctx.drawImage(img, 0, 0, width, height);
      } catch {
        // Keep rendering other layers if one image fails.
      }
    }
  }

  async function renderPreviewGrid() {
    const tokens = state.compiledTokens;
    if (!tokens.length) return;
    const picks = [];
    const max = Math.min(12, tokens.length);
    for (let i = 0; i < max; i++) {
      const index = max === 1 ? 0 : Math.floor(i * (tokens.length - 1) / (max - 1));
      picks.push(tokens[index]);
    }
    el.previewGrid.innerHTML = picks.map(token => `
      <article class="preview-card" data-token-id="${token.tokenId}">
        <div class="preview-canvas-wrap"><canvas></canvas></div>
        <div class="preview-card-body">
          <strong>#${token.tokenId}</strong>
          <div class="preview-traits">${state.layers.map(layer => `<span>${escapeHtml(getTrait(token.traits[layer.id])?.name || '—')}</span>`).join('')}</div>
        </div>
      </article>
    `).join('');
    await Promise.all(picks.map(async token => {
      const card = $(`.preview-card[data-token-id="${token.tokenId}"]`, el.previewGrid);
      const canvas = $('canvas', card);
      await renderTokenToCanvas(token, canvas);
    }));
  }

  function manifestObject() {
    return {
      schema: 'relic-forge/collection-manifest@0.1',
      collection: {
        name: el.collectionName.value.trim() || 'Untitled Collection',
        supply: state.compiledTokens.length || getSupply(),
        seed: el.seedInput.value.trim() || 'RELIC-001',
      },
      layers: state.layers.map((layer, index) => ({
        name: layer.name,
        order: index,
        allowNone: layer.allowNone,
        rarityMode: layer.rarityMode,
        traits: layer.traits.map(trait => ({
          name: trait.name,
          file: trait.filename,
          rarity: trait.rarity,
          percentage: layer.rarityMode === 'percentage' ? Number(trait.percentage || 0) : null,
          distribution: trait.distribution,
          exactCount: trait.distribution === 'exact' ? Number(trait.exactCount || 0) : null,
        })),
      })),
      rules: state.rulesEnabled ? state.rules.map(rule => ({
        type: rule.type,
        sources: rule.sources.map(id => ({ layer: getLayer(getTrait(id)?.layerId)?.name, trait: getTrait(id)?.name })),
        targets: rule.targets.map(id => ({ layer: getLayer(getTrait(id)?.layerId)?.name, trait: getTrait(id)?.name })),
      })) : [],
      tokens: state.compiledTokens.map(token => ({
        tokenId: token.tokenId,
        traits: Object.fromEntries(state.layers.map(layer => [layer.name, getTrait(token.traits[layer.id])?.name || null])),
      })),
    };
  }

  function manifestCsv() {
    const headers = ['Token', ...state.layers.map(l => l.name)];
    const rows = state.compiledTokens.map(token => [token.tokenId, ...state.layers.map(layer => getTrait(token.traits[layer.id])?.name || '')]);
    return [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  }

  function projectConfig() {
    return {
      schema: 'relic-forge/project@0.1',
      collection: { name: el.collectionName.value, supply: getSupply(), buildMode: state.buildMode },
      artwork: state.layers.map((layer, order) => ({
        name: layer.name,
        order,
        allowNone: layer.allowNone,
        rarityMode: layer.rarityMode,
        autoFillStyle: layer.autoFillStyle,
        traits: layer.traits.map(trait => ({
          name: trait.name,
          file: trait.filename,
          rarity: trait.rarity,
          percentage: trait.percentage,
          distribution: trait.distribution,
          exactCount: trait.exactCount,
        }))
      })),
      rules: state.rules.map(rule => ({
        type: rule.type,
        sources: rule.sources.map(traitLabel),
        targets: rule.targets.map(traitLabel),
      })),
      note: 'Artwork binaries are not embedded. Re-upload the original layer folder when reopening this prototype project.',
    };
  }

  function updateLaunchSummary() {
    const name = el.collectionName.value.trim() || 'Untitled Collection';
    el.launchName.value = name;
    el.launchSummaryTitle.textContent = name;
    const chain = $('#chainSelect').value;
    const price = $('#mintPrice').value || '0';
    const royalty = $('#royalty').value || '0';
    const report = state.compilerReport;
    el.launchSummaryDetails.innerHTML = `
      <div class="launch-summary-details">
        <div class="launch-summary-row"><span>Supply</span><strong>${(report?.supply || getSupply()).toLocaleString()}</strong></div>
        <div class="launch-summary-row"><span>Network</span><strong>${escapeHtml(chain)}</strong></div>
        <div class="launch-summary-row"><span>Mint price</span><strong>${escapeHtml(price)} ETH</strong></div>
        <div class="launch-summary-row"><span>Royalty</span><strong>${escapeHtml(royalty)}%</strong></div>
        <div class="launch-summary-row"><span>Compiler</span><strong>${report && !report.ruleViolations && !report.exactIssues.length ? 'Valid ✓' : 'Needs review'}</strong></div>
      </div>`;
  }

  function exportLaunchPackage() {
    const packageData = {
      schema: 'relic-forge/launch-package@0.1',
      launch: {
        name: el.launchName.value,
        symbol: $('#launchSymbol').value,
        chain: $('#chainSelect').value,
        mintPrice: $('#mintPrice').value,
        royaltyPercent: $('#royalty').value,
      },
      manifest: manifestObject(),
      note: 'Prototype package. Smart-contract deployment is intentionally not included in this build.',
    };
    downloadText(`${slug(el.launchName.value || 'relic-collection')}-launch-package.json`, JSON.stringify(packageData, null, 2));
  }

  async function filesFromDrop(dataTransfer) {
    const items = [...dataTransfer.items];
    const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return [...dataTransfer.files];
    const files = [];

    async function walk(entry, path = '') {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        Object.defineProperty(file, '__relativePath', { value: `${path}${file.name}`, configurable: true });
        files.push(file);
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          for (const child of batch) await walk(child, `${path}${entry.name}/`);
        } while (batch.length);
      }
    }

    for (const entry of entries) await walk(entry, '');
    return files;
  }

  // Artwork upload
  el.folderInput.addEventListener('change', e => loadArtwork(e.target.files));
  el.uploadZone.addEventListener('dragover', e => { e.preventDefault(); el.uploadZone.classList.add('dragover'); });
  el.uploadZone.addEventListener('dragleave', () => el.uploadZone.classList.remove('dragover'));
  el.uploadZone.addEventListener('drop', async e => {
    e.preventDefault();
    el.uploadZone.classList.remove('dragover');
    const files = await filesFromDrop(e.dataTransfer);
    await loadArtwork(files);
  });
  el.layerList.addEventListener('click', e => {
    const btn = e.target.closest('.move-layer');
    if (!btn) return;
    const card = btn.closest('[data-layer-id]');
    moveLayer(card.dataset.layerId, btn.dataset.dir);
  });

  // Navigation and mode
  $$('.mode-btn').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  $$('.step').forEach(btn => btn.addEventListener('click', () => {
    const target = Number(btn.dataset.step);
    if (target === 1 || state.layers.length) gotoStep(target);
  }));
  $$('.next-btn').forEach(btn => btn.addEventListener('click', () => gotoStep(Number(btn.dataset.next))));
  $$('.back-btn').forEach(btn => btn.addEventListener('click', () => gotoStep(Number(btn.dataset.back))));

  // Build mode + trait controls
  $$('.build-card').forEach(card => card.addEventListener('click', () => setBuildMode(card.dataset.buildMode)));
  el.traitSetup.addEventListener('change', e => {
    const layerId = e.target.dataset.layerId || e.target.closest('[data-layer-id]')?.dataset.layerId;
    if (e.target.classList.contains('none-layer-toggle')) {
      const layer = getLayer(e.target.dataset.layerId);
      if (!layer) return;
      layer.allowNone = e.target.checked;
      syncNoneTrait(layer);
      if (layer.allowNone && layer.rarityMode === 'percentage' && !layer.traits.some(t => Number.parseFloat(t.percentage || '0') > 0)) autoFillLayerPercentages(layer.id);
      renderArtwork();
      renderTraitSetup();
      renderManualBuilder();
      renderRulePickers();
      renderRulesList();
      return;
    }
    if (e.target.classList.contains('layer-rarity-mode')) {
      const layer = getLayer(e.target.dataset.layerId);
      if (!layer) return;
      layer.rarityMode = e.target.value;
      if (layer.rarityMode === 'percentage') autoFillLayerPercentages(layer.id);
      else renderTraitSetup();
      return;
    }
    if (e.target.classList.contains('layer-autofill-style')) {
      const layer = getLayer(e.target.dataset.layerId);
      if (!layer) return;
      layer.autoFillStyle = e.target.value;
      return;
    }

    const config = e.target.closest('[data-trait-id]');
    if (!config) return;
    const trait = getTrait(config.dataset.traitId);
    if (!trait) return;
    if (e.target.classList.contains('rarity-select')) trait.rarity = e.target.value;
    if (e.target.classList.contains('percent-input')) trait.percentage = Math.max(0, Math.min(100, Number.parseFloat(e.target.value || '0') || 0));
    if (e.target.classList.contains('exact-check')) {
      trait.distribution = e.target.checked ? 'exact' : 'weighted';
      if (e.target.checked && trait.exactCount == null) trait.exactCount = 0;
      renderTraitSetup();
    }
    if (e.target.classList.contains('exact-count')) trait.exactCount = Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0);
    if (e.target.classList.contains('percent-input')) {
      const layer = getLayer(layerId);
      if (layer && state.buildMode === 'auto' && layer.rarityMode === 'percentage') {
        const total = percentTotal(layer);
        const section = e.target.closest('.trait-config-layer');
      }
    }
  });
  el.traitSetup.addEventListener('click', e => {
    const autoFillBtn = e.target.closest('.autofill-btn');
    if (autoFillBtn) {
      autoFillLayerPercentages(autoFillBtn.dataset.layerId);
      return;
    }
    const moveBtn = e.target.closest('.move-trait');
    if (moveBtn) {
      moveTrait(moveBtn.dataset.layerId, moveBtn.dataset.traitId, moveBtn.dataset.dir);
      return;
    }
  });

  // Manifest imports / templates
  el.manifestInput.addEventListener('change', e => { if (e.target.files[0]) importManifest(e.target.files[0]); });
  $('#downloadCsvTemplate').addEventListener('click', () => downloadText('relic-forge-collection-template.csv', templateCsv(), 'text/csv'));
  $('#downloadJsonTemplate').addEventListener('click', () => downloadText('relic-forge-collection-template.json', templateJson()));

  // Manual token curator
  el.manualTraitFields.addEventListener('change', renderManualPreview);
  el.manualTokenId.addEventListener('change', () => renderManualBuilder());
  $('#loadManualTokenBtn').addEventListener('click', () => renderManualBuilder());
  $('#clearManualTokenBtn').addEventListener('click', clearManualToken);
  $('#saveManualTokenBtn').addEventListener('click', saveManualToken);
  el.manualSavedList.addEventListener('click', e => {
    const btn = e.target.closest('[data-load-manual]');
    if (!btn) return;
    el.manualTokenId.value = btn.dataset.loadManual;
    renderManualBuilder(Number(btn.dataset.loadManual));
  });

  // Rules
  el.noRulesBtn.addEventListener('click', () => setRulesEnabled(false));
  el.yesRulesBtn.addEventListener('click', () => setRulesEnabled(true));
  el.sourceLayerSelect.addEventListener('change', () => renderTraitPicker('source'));
  el.targetLayerSelect.addEventListener('change', () => renderTraitPicker('target'));
  [el.sourceTraitPicker, el.targetTraitPicker].forEach(picker => picker.addEventListener('click', e => {
    const btn = e.target.closest('.pick-trait');
    if (!btn) return;
    const selected = btn.dataset.kind === 'source' ? state.sourceSelected : state.targetSelected;
    selected.has(btn.dataset.traitId) ? selected.delete(btn.dataset.traitId) : selected.add(btn.dataset.traitId);
    btn.classList.toggle('selected', selected.has(btn.dataset.traitId));
    updateRuleSentence();
  }));
  $('#selectSourceLayerBtn').addEventListener('click', () => {
    selectedLayerTraits('source').forEach(id => state.sourceSelected.add(id));
    renderTraitPicker('source'); updateRuleSentence();
  });
  $('#selectTargetLayerBtn').addEventListener('click', () => {
    selectedLayerTraits('target').forEach(id => state.targetSelected.add(id));
    renderTraitPicker('target'); updateRuleSentence();
  });
  $('#clearSourceBtn').addEventListener('click', () => { state.sourceSelected.clear(); renderTraitPicker('source'); updateRuleSentence(); });
  $('#clearTargetBtn').addEventListener('click', () => { state.targetSelected.clear(); renderTraitPicker('target'); updateRuleSentence(); });
  $$('.rule-type').forEach(btn => btn.addEventListener('click', () => {
    state.ruleType = btn.dataset.ruleType;
    $$('.rule-type').forEach(b => b.classList.toggle('selected', b === btn));
    updateRuleSentence();
  }));
  el.addRuleBtn.addEventListener('click', addRule);
  el.rulesList.addEventListener('click', e => {
    const btn = e.target.closest('.rule-remove');
    if (!btn) return;
    state.rules = state.rules.filter(rule => rule.id !== btn.dataset.ruleId);
    renderRulesList();
  });

  // Compiler / preview
  $('#compileBtn').addEventListener('click', buildCollection);
  $('#regenerateBtn').addEventListener('click', buildCollection);
  el.toLaunchBtn.addEventListener('click', () => gotoStep(5));
  $('#exportManifestBtn').addEventListener('click', () => {
    if (!state.compiledTokens.length) return;
    downloadText(`${slug(el.collectionName.value)}-manifest.json`, JSON.stringify(manifestObject(), null, 2));
  });
  $('#exportCsvBtn').addEventListener('click', () => {
    if (!state.compiledTokens.length) return;
    downloadText(`${slug(el.collectionName.value)}-manifest.csv`, manifestCsv(), 'text/csv');
  });

  // Project + launch exports
  $('#exportProjectBtn').addEventListener('click', () => downloadText(`${slug(el.collectionName.value)}-project.json`, JSON.stringify(projectConfig(), null, 2)));
  $('#exportLaunchPackageBtn').addEventListener('click', exportLaunchPackage);
  ['chainSelect', 'mintPrice', 'royalty', 'launchName'].forEach(id => $(`#${id}`).addEventListener('input', updateLaunchSummary));
  el.collectionName.addEventListener('input', () => { if (state.step === 5) updateLaunchSummary(); });
  el.collectionSize.addEventListener('change', () => { renderTraitSetup(); if (state.buildMode === 'manual') renderManualBuilder(); });

  // Initial state
  document.body.dataset.mode = state.mode;
  setBuildMode('auto');
  setRulesEnabled(false);
})();
