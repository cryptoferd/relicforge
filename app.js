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
    draggedTrait: null,
    draggedLayer: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const el = {
    landingPage: $('#landingPage'),
    studioApp: $('#studioApp'),
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
    rulePreflight: $('#rulePreflight'),
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
      svgFragment: '',
      svgStats: { rectangles: 0, colors: 0, bytes: 0 },
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


  function updatePercentTotalUI(layerId) {
    const layer = getLayer(layerId);
    if (!layer) return;
    const total = percentTotal(layer);
    const diff = Number((total - 100).toFixed(2));
    const valid = Math.abs(diff) <= 0.01;
    const node = $(`.trait-config-layer[data-layer-id="${CSS.escape(layerId)}"] .percent-total`, el.traitSetup);
    if (!node) return;
    node.classList.remove('valid', 'over', 'under');
    node.classList.add(valid ? 'valid' : total > 100 ? 'over' : 'under');
    node.textContent = `Total ${formatPercent(total)}% ${valid ? '✓' : total > 100 ? `· Over by ${formatPercent(Math.abs(diff))}%` : `· Add ${formatPercent(Math.abs(diff))}%`}`;
  }

  function equalizeLayerPercentages(layerId) {
    const layer = getLayer(layerId);
    if (!layer || !layer.traits.length) return;
    const totalHundredths = 10000;
    const base = Math.floor(totalHundredths / layer.traits.length);
    let remainder = totalHundredths - (base * layer.traits.length);
    layer.traits.forEach(trait => {
      const hundredths = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      trait.percentage = hundredths / 100;
    });
    renderTraitSetup();
    if (state.step === 3) { updateRuleSentence(); renderRulesList(); }
    showStatus(`${layer.name} split as evenly as possible across ${layer.traits.length} traits.`, 'success');
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
    const mostCommonFirst = layer.rarityOrder !== 'least_to_most';
    const weights = layer.traits.map((_, index) => {
      const rank = mostCommonFirst ? (layer.traits.length - index) : (index + 1);
      return Math.pow(rank, power);
    });
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


  function updateBuildContinueState() {
    const button = $('.next-btn[data-next="3"]');
    if (!button) return;
    const errors = validatePercentageLayers();
    button.disabled = errors.length > 0;
    button.title = errors.length ? errors[0] : '';
  }

  function reorderTrait(layerId, traitId, targetTraitId, placeAfter = false) {
    const layer = getLayer(layerId);
    if (!layer || traitId === targetTraitId) return;
    const fromIndex = layer.traits.findIndex(trait => trait.id === traitId);
    const targetIndexBeforeRemoval = layer.traits.findIndex(trait => trait.id === targetTraitId);
    if (fromIndex < 0 || targetIndexBeforeRemoval < 0) return;
    const [moved] = layer.traits.splice(fromIndex, 1);
    let targetIndex = layer.traits.findIndex(trait => trait.id === targetTraitId);
    if (targetIndex < 0) targetIndex = layer.traits.length;
    if (placeAfter) targetIndex += 1;
    layer.traits.splice(targetIndex, 0, moved);
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
        rarityOrder: 'most_to_least',
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
            svgFragment: null,
            svgStats: null,
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
      <span class="summary-pill"><strong>Drag & drop</strong> reorder layers</span>
    `;
    el.artworkSummary.classList.remove('hidden');

    el.layerList.innerHTML = state.layers.map((layer, index) => `
      <article class="layer-card layer-sortable" data-layer-id="${escapeHtml(layer.id)}" draggable="true">
        <div class="layer-card-header">
          <div class="layer-title">
            <span class="layer-index">${index + 1}</span>
            <div class="layer-title-edit">
              <label>Trait category<input class="layer-name-input" data-layer-id="${escapeHtml(layer.id)}" type="text" value="${escapeHtml(layer.name)}" maxlength="80" aria-label="Rename trait category ${escapeHtml(layer.name)}" /></label>
              <small>${layer.traits.length} traits · rendered ${index === 0 ? 'first / back' : index === state.layers.length - 1 ? 'last / front' : `after layer ${index}`}</small>
            </div>
          </div>
          <div class="layer-actions">
            <span class="drag-handle layer-drag-handle" draggable="true" data-layer-id="${escapeHtml(layer.id)}" role="button" aria-label="Drag ${escapeHtml(layer.name)} to change layer order" title="Drag to change layer order">⠿</span>
            <button class="icon-btn move-layer" data-dir="up" title="Move layer backward" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn move-layer" data-dir="down" title="Move layer forward" ${index === state.layers.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
        </div>
        <div class="trait-thumbs">
          ${layer.traits.slice(0, 24).map(trait => `
            <div class="trait-thumb" data-trait-id="${escapeHtml(trait.id)}">
              ${traitPreviewMarkup(trait)}
              <input class="trait-name-input" data-trait-id="${escapeHtml(trait.id)}" type="text" value="${escapeHtml(trait.name)}" maxlength="80" aria-label="Rename trait ${escapeHtml(trait.name)}" ${trait.isNone ? 'disabled title="None is a system trait"' : ''} />
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
    refreshAfterLayerOrderChange();
  }


  function refreshAfterLayerOrderChange() {
    renderArtwork();
    renderTraitSetup();
    if (state.buildMode === 'manual') renderManualBuilder();
    if (state.compiledTokens.length) renderPreviewGrid();
    if (state.step === 5) updateLaunchSummary();
  }

  function reorderLayer(draggedLayerId, targetLayerId, placeAfter) {
    if (!draggedLayerId || !targetLayerId || draggedLayerId === targetLayerId) return;
    const fromIndex = state.layers.findIndex(layer => layer.id === draggedLayerId);
    const targetIndex = state.layers.findIndex(layer => layer.id === targetLayerId);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [dragged] = state.layers.splice(fromIndex, 1);
    const adjustedTargetIndex = state.layers.findIndex(layer => layer.id === targetLayerId);
    const insertIndex = placeAfter ? adjustedTargetIndex + 1 : adjustedTargetIndex;
    state.layers.splice(insertIndex, 0, dragged);
    refreshAfterLayerOrderChange();
  }

  function renderTraitSetup() {
    if (!state.layers.length) {
      el.traitSetup.innerHTML = '';
      return;
    }

    const showExact = state.buildMode === 'exact';
    const showTraitControls = state.buildMode !== 'manifest';
    const autoMode = state.buildMode === 'auto';
    if (!showTraitControls) {
      el.traitSetup.innerHTML = `
        <div class="validation-box">
          Your uploaded collection list will choose the layers for defined token IDs. Any missing traits or token IDs will be filled using the current rarity settings.
        </div>`;
      updateBuildContinueState();
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
              <label class="mini-select">Rarity order
                <select class="layer-rarity-order" data-layer-id="${escapeHtml(layer.id)}">
                  <option value="most_to_least" ${layer.rarityOrder !== 'least_to_most' ? 'selected' : ''}>Descending — common first</option>
                  <option value="least_to_most" ${layer.rarityOrder === 'least_to_most' ? 'selected' : ''}>Ascending — rarest first</option>
                </select>
              </label>
              <button type="button" class="ghost-btn small-btn autofill-btn" data-layer-id="${escapeHtml(layer.id)}">Auto Fill</button>
              <button type="button" class="ghost-btn small-btn equalize-btn" data-layer-id="${escapeHtml(layer.id)}">Equal Split</button>
              <div class="percent-total ${pctClass}" aria-live="polite">Total ${formatPercent(pctTotal)}% ${pctValid ? '✓' : pctTotal > 100 ? `· Over by ${formatPercent(Math.abs(pctDiff))}%` : `· Add ${formatPercent(Math.abs(pctDiff))}%`}</div>
            ` : ''}
          </div>
        </div>
        ${autoMode && layer.rarityMode === 'percentage' ? `<div class="rarity-order-hint"><span class="drag-handle mini">⠿</span> Drag traits into rarity order. Auto Fill follows the selected ascending/descending direction.</div>` : ''}
        <div class="trait-config-grid ${autoMode && layer.rarityMode === 'percentage' ? 'sortable-grid' : ''}">
          ${layer.traits.map((trait, traitIndex) => `
            <div class="trait-config ${autoMode && layer.rarityMode === 'percentage' ? 'trait-sortable' : ''}" data-trait-id="${escapeHtml(trait.id)}" data-layer-id="${escapeHtml(layer.id)}">
              ${trait.isNone
                ? '<div class="trait-config-placeholder">None</div>'
                : `<img src="${trait.url}" alt="${escapeHtml(trait.name)}" />`}
              <div>
                <div class="trait-config-topline">
                  <div class="trait-config-name" title="${escapeHtml(trait.name)}">${escapeHtml(trait.name)}</div>
                  ${autoMode && layer.rarityMode === 'percentage' ? `<span class="drag-handle" draggable="true" data-layer-id="${escapeHtml(layer.id)}" data-trait-id="${escapeHtml(trait.id)}" role="button" aria-label="Drag ${escapeHtml(trait.name)} to change rarity order" title="Drag to change rarity order">⠿</span>` : ''}
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
    updateBuildContinueState();
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
    await renderTokenToSvgHost(token, el.manualPreviewCanvas);
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

  function gotoStep(step) {
    state.step = step;
    $$('.step-panel').forEach(panel => panel.classList.toggle('active', Number(panel.dataset.panel) === step));
    $$('.step').forEach(btn => {
      const n = Number(btn.dataset.step);
      btn.classList.toggle('active', n === step);
      btn.classList.toggle('complete', n < step);
    });
    if (step === 2) renderTraitSetup();
    if (step === 3) { renderRulePickers(); renderRulesList(); updateRuleSentence(); }
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
    renderDraftRulePreflight();
  }

  function humanList(items, max = 5) {
    const clipped = items.slice(0, max);
    const suffix = items.length > max ? ` + ${items.length - max} more` : '';
    if (clipped.length === 1) return clipped[0] + suffix;
    if (clipped.length === 2) return `${clipped[0]} and ${clipped[1]}${suffix}`;
    return `${clipped.slice(0, -1).join(', ')}, and ${clipped.at(-1)}${suffix}`;
  }


  function groupTraitIdsByLayer(traitIds) {
    const groups = new Map();
    for (const traitId of traitIds) {
      const trait = getTrait(traitId);
      if (!trait) continue;
      if (!groups.has(trait.layerId)) groups.set(trait.layerId, []);
      groups.get(trait.layerId).push(traitId);
    }
    return groups;
  }

  function estimatedLayerCounts(layer) {
    const supply = getSupply();
    const counts = new Map(layer.traits.map(trait => [trait.id, 0]));
    const notes = [];

    if (state.buildMode === 'auto' && layer.rarityMode === 'percentage') {
      const total = percentTotal(layer);
      if (Math.abs(total - 100) > 0.01) notes.push(`${layer.name} percentages currently total ${formatPercent(total)}%, not 100%.`);
      for (const trait of layer.traits) {
        counts.set(trait.id, Math.max(0, Math.round(supply * (Number.parseFloat(trait.percentage || '0') || 0) / 100)));
      }
      return { counts, notes, precise: Math.abs(total - 100) <= 0.01 };
    }

    let exactTotal = 0;
    const weighted = [];
    for (const trait of layer.traits) {
      if (trait.distribution === 'exact') {
        const count = Math.max(0, Number.parseInt(trait.exactCount || '0', 10) || 0);
        counts.set(trait.id, count);
        exactTotal += count;
      } else {
        weighted.push({ id: trait.id, weight: rarityWeights[trait.rarity] || 1 });
      }
    }

    const remaining = Math.max(0, supply - exactTotal);
    if (exactTotal > supply) notes.push(`${layer.name} exact counts exceed the ${supply.toLocaleString()} token supply.`);
    if (weighted.length && remaining > 0) {
      const alloc = largestRemainder(remaining, weighted);
      for (const item of weighted) counts.set(item.id, alloc.get(item.id) || 0);
    }
    return { counts, notes, precise: state.buildMode === 'exact' };
  }

  function currentCountEstimates() {
    return new Map(state.layers.map(layer => [layer.id, estimatedLayerCounts(layer)]));
  }

  function traitCountFromEstimates(traitId, estimates) {
    const trait = getTrait(traitId);
    if (!trait) return 0;
    return estimates.get(trait.layerId)?.counts.get(traitId) || 0;
  }

  function selectedCountInLayer(traitIds, layerId, estimates) {
    return traitIds.reduce((sum, traitId) => {
      const trait = getTrait(traitId);
      return sum + (trait?.layerId === layerId ? traitCountFromEstimates(traitId, estimates) : 0);
    }, 0);
  }

  function lockedRuleConflicts(rule) {
    const conflicts = [];
    const targetGroups = targetsByLayer(rule);
    for (const [tokenId, recipe] of state.manifestTokens.entries()) {
      if (tokenId < 1 || tokenId > getSupply()) continue;
      const selected = Object.values(recipe);
      if (!rule.sources.some(id => selected.includes(id))) continue;
      let conflict = false;
      if (rule.type === 'excludes') {
        conflict = rule.targets.some(id => selected.includes(id));
      } else {
        for (const [layerId, allowed] of targetGroups) {
          if (recipe[layerId] && !allowed.includes(recipe[layerId])) {
            conflict = true;
            break;
          }
        }
      }
      if (conflict) conflicts.push(tokenId);
    }
    return conflicts;
  }

  function rulePreflightAnalysis(rule) {
    const supply = getSupply();
    const estimates = currentCountEstimates();
    const sourceGroups = groupTraitIdsByLayer(rule.sources);
    const targetGroups = groupTraitIdsByLayer(rule.targets);
    const sourceLayerCounts = [...sourceGroups.entries()].map(([layerId, ids]) => ({
      layerId,
      count: ids.reduce((sum, id) => sum + traitCountFromEstimates(id, estimates), 0),
    }));
    const sourceMin = sourceLayerCounts.length ? Math.max(...sourceLayerCounts.map(item => item.count)) : 0;
    const sourceMax = Math.min(supply, sourceLayerCounts.reduce((sum, item) => sum + item.count, 0));
    const messages = [];
    const hardReasons = [];
    const warningReasons = [];
    const relevantLayers = new Set([...sourceGroups.keys(), ...targetGroups.keys()]);

    for (const layerId of relevantLayers) {
      const layerNotes = estimates.get(layerId)?.notes || [];
      warningReasons.push(...layerNotes);
    }

    const lockedConflicts = lockedRuleConflicts(rule);
    if (lockedConflicts.length) {
      hardReasons.push(`${lockedConflicts.length} manually/imported token${lockedConflicts.length === 1 ? '' : 's'} already lock an invalid combination (${lockedConflicts.slice(0, 5).map(id => `#${id}`).join(', ')}${lockedConflicts.length > 5 ? '…' : ''}).`);
    }

    if (rule.type === 'excludes') {
      const overlapIds = rule.sources.filter(id => rule.targets.includes(id));
      const overlapCount = overlapIds.reduce((sum, id) => sum + traitCountFromEstimates(id, estimates), 0);
      if (overlapCount > 0) {
        hardReasons.push(`${humanList(overlapIds.map(traitLabel), 3)} is on both sides of this exclusion, so those occurrences would always violate the rule.`);
      }

      for (const [sourceLayerId, sourceIds] of sourceGroups) {
        const sourceCount = selectedCountInLayer(sourceIds, sourceLayerId, estimates);
        for (const [targetLayerId, targetIds] of targetGroups) {
          if (sourceLayerId === targetLayerId) continue;
          const targetCount = selectedCountInLayer(targetIds, targetLayerId, estimates);
          const unavoidable = Math.max(0, sourceCount + targetCount - supply);
          if (unavoidable > 0) {
            hardReasons.push(`Current counts force at least ${unavoidable.toLocaleString()} overlap${unavoidable === 1 ? '' : 's'} between ${getLayer(sourceLayerId)?.name || 'the source layer'} and ${getLayer(targetLayerId)?.name || 'the excluded layer'}.`);
          } else if (sourceCount + targetCount > supply * 0.9) {
            warningReasons.push(`${getLayer(sourceLayerId)?.name || 'Source'} + ${getLayer(targetLayerId)?.name || 'excluded traits'} use about ${Math.round((sourceCount + targetCount) / supply * 100)}% of available slots, so the generator has little room to keep them apart.`);
          }
        }
      }
      messages.push(`Estimated source coverage: ${sourceMin === sourceMax ? sourceMax.toLocaleString() : `${sourceMin.toLocaleString()}–${sourceMax.toLocaleString()}`} of ${supply.toLocaleString()} NFTs.`);
    } else {
      for (const [targetLayerId, allowedIds] of targetGroups) {
        const sameLayerBadSources = (sourceGroups.get(targetLayerId) || []).filter(id => !allowedIds.includes(id) && traitCountFromEstimates(id, estimates) > 0);
        if (sameLayerBadSources.length) {
          hardReasons.push(`${humanList(sameLayerBadSources.map(traitLabel), 3)} cannot require a different ${getLayer(targetLayerId)?.name || 'trait'} at the same time because an NFT can only use one trait from that layer.`);
        }

        const capacity = allowedIds.reduce((sum, id) => sum + traitCountFromEstimates(id, estimates), 0);
        const targetName = getLayer(targetLayerId)?.name || 'matching layer';
        messages.push(`${targetName} provides about ${capacity.toLocaleString()} compatible slot${capacity === 1 ? '' : 's'}.`);
        if (capacity < sourceMin) {
          hardReasons.push(`This rule needs at least ${sourceMin.toLocaleString()} compatible ${targetName} slots, but your current rarity/count settings provide only about ${capacity.toLocaleString()}.`);
        } else if (capacity < sourceMax) {
          warningReasons.push(`This can work only if source traits overlap efficiently. The source may cover up to ${sourceMax.toLocaleString()} NFTs, while ${targetName} has about ${capacity.toLocaleString()} compatible slots.`);
        } else if (capacity - sourceMax < Math.max(5, Math.round(supply * 0.02))) {
          warningReasons.push(`${targetName} has very little headroom above the estimated source demand. Small manual changes could make the rule impossible.`);
        }
      }
      messages.unshift(`Estimated source demand: ${sourceMin === sourceMax ? sourceMax.toLocaleString() : `${sourceMin.toLocaleString()}–${sourceMax.toLocaleString()}`} NFT${sourceMax === 1 ? '' : 's'}.`);
    }

    let status = 'good';
    let title = 'Looks compatible';
    if (hardReasons.length) {
      status = 'danger';
      title = 'Conflict likely with current settings';
    } else if (warningReasons.length) {
      status = 'warning';
      title = 'Possible, but this rule is tight';
    }

    return {
      status,
      title,
      messages,
      hardReasons,
      warningReasons,
      sourceMin,
      sourceMax,
      lockedConflicts,
    };
  }

  function preflightMarkup(analysis, compact = false) {
    const detail = [...analysis.hardReasons, ...analysis.warningReasons, ...analysis.messages];
    const icon = analysis.status === 'good' ? '✓' : analysis.status === 'warning' ? '!' : '×';
    return `<div class="preflight-status-row"><span class="preflight-icon">${icon}</span><strong>${escapeHtml(analysis.title)}</strong></div>${detail.length ? `<div class="preflight-details">${detail.slice(0, compact ? 2 : 5).map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}`;
  }

  function renderDraftRulePreflight() {
    if (!el.rulePreflight) return;
    if (!state.sourceSelected.size || !state.targetSelected.size) {
      el.rulePreflight.className = 'rule-preflight draft neutral';
      el.rulePreflight.textContent = 'Choose the traits above and Relic Forge will check the rule against your current rarity/count settings before you add it.';
      return;
    }
    const draft = { id: 'draft-rule', type: state.ruleType, sources: [...state.sourceSelected], targets: [...state.targetSelected] };
    const analysis = rulePreflightAnalysis(draft);
    el.rulePreflight.className = `rule-preflight draft ${analysis.status}`;
    el.rulePreflight.innerHTML = preflightMarkup(analysis, true);
  }

  function estimateWeightForTrait(trait, estimates) {
    const count = traitCountFromEstimates(trait.id, estimates);
    return Math.max(0.001, count || (rarityWeights[trait.rarity] || 1));
  }

  function weightedExamplePick(candidates, estimates, rng) {
    if (!candidates.length) return null;
    const weighted = candidates.map(trait => ({ trait, weight: estimateWeightForTrait(trait, estimates) }));
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let cursor = rng() * total;
    for (const item of weighted) {
      cursor -= item.weight;
      if (cursor <= 0) return item.trait;
    }
    return weighted[weighted.length - 1].trait;
  }

  function forceRuleForExample(token, rule, estimates, rng) {
    if (!tokenHas(token, rule.sources)) return true;
    if (rule.type === 'excludes') {
      for (const [layerId, forbiddenIds] of groupTraitIdsByLayer(rule.targets)) {
        if (!forbiddenIds.includes(token.traits[layerId])) continue;
        const currentIsSource = rule.sources.includes(token.traits[layerId]);
        if (currentIsSource) return false;
        const layer = getLayer(layerId);
        const candidates = (layer?.traits || []).filter(trait => !forbiddenIds.includes(trait.id));
        const replacement = weightedExamplePick(candidates, estimates, rng);
        if (!replacement) return false;
        token.traits[layerId] = replacement.id;
      }
      return !ruleViolationCount(token, rule);
    }

    for (const [layerId, allowedIds] of groupTraitIdsByLayer(rule.targets)) {
      if (allowedIds.includes(token.traits[layerId])) continue;
      const currentIsSource = rule.sources.includes(token.traits[layerId]);
      if (currentIsSource) return false;
      const allowedTraits = allowedIds.map(getTrait).filter(Boolean);
      const replacement = weightedExamplePick(allowedTraits, estimates, rng);
      if (!replacement) return false;
      token.traits[layerId] = replacement.id;
    }
    return !ruleViolationCount(token, rule);
  }

  function buildRuleExampleTokens(rule, desired = 3) {
    const estimates = currentCountEstimates();
    const rng = createRng(`RULE-EXAMPLE-${rule.id}-${getSupply()}`);
    const examples = [];
    const directImpossibleSources = new Set();
    const targetGroups = groupTraitIdsByLayer(rule.targets);
    for (const sourceId of rule.sources) {
      const source = getTrait(sourceId);
      if (!source) continue;
      const targetSameLayer = targetGroups.get(source.layerId);
      if (rule.type !== 'excludes' && targetSameLayer && !targetSameLayer.includes(sourceId)) directImpossibleSources.add(sourceId);
      if (rule.type === 'excludes' && rule.targets.includes(sourceId)) directImpossibleSources.add(sourceId);
    }
    const usableSources = rule.sources.filter(id => !directImpossibleSources.has(id) && getTrait(id));
    if (!usableSources.length) return [];

    for (let attempt = 0; attempt < 40 && examples.length < desired; attempt++) {
      const token = { tokenId: `rule-${examples.length + 1}`, traits: {} };
      for (const layer of state.layers) {
        const candidate = weightedExamplePick(layer.traits, estimates, rng);
        if (candidate) token.traits[layer.id] = candidate.id;
      }
      const sourceId = usableSources[attempt % usableSources.length];
      const source = getTrait(sourceId);
      token.traits[source.layerId] = sourceId;
      if (!forceRuleForExample(token, rule, estimates, rng)) continue;

      // Try to make the sample compatible with the rest of the saved rule set too,
      // so an example does not visually demonstrate one rule while obviously breaking another.
      let valid = true;
      for (let pass = 0; pass < 5; pass++) {
        let changed = false;
        for (const otherRule of state.rules) {
          if (!tokenHas(token, otherRule.sources) || !ruleViolationCount(token, otherRule)) continue;
          const before = JSON.stringify(token.traits);
          if (!forceRuleForExample(token, otherRule, estimates, rng)) { valid = false; break; }
          if (JSON.stringify(token.traits) !== before) changed = true;
        }
        if (!valid || !changed) break;
      }
      if (!valid || !tokenHas(token, rule.sources) || ruleViolationCount(token, rule)) continue;
      if (state.rules.some(otherRule => ruleViolationCount(token, otherRule))) continue;

      const sourceTrait = getTrait(sourceId);
      const emphasized = [sourceTrait?.name];
      if (rule.type !== 'excludes') {
        for (const [layerId, allowed] of targetGroups) {
          const chosen = getTrait(token.traits[layerId]);
          if (chosen && allowed.includes(chosen.id) && chosen.id !== sourceId) emphasized.push(chosen.name);
        }
      }
      token.exampleLabel = emphasized.filter(Boolean).join(' + ');
      examples.push(token);
    }
    return examples;
  }

  async function renderRuleExamples(rule) {
    const container = $(`[data-rule-examples="${rule.id}"]`, el.rulesList);
    if (!container) return;
    const examples = buildRuleExampleTokens(rule, 3);
    if (!examples.length) {
      container.innerHTML = '<div class="rule-example-empty">No valid example can be built from this rule as currently written.</div>';
      return;
    }
    container.innerHTML = examples.map((token, index) => `
      <div class="rule-example-card" data-rule-example-index="${index}">
        <div class="rule-example-svg svg-preview-host" role="img" aria-label="Example NFT generated under this rule"></div>
        <span>${escapeHtml(token.exampleLabel || 'Valid example')}</span>
      </div>`).join('');
    await Promise.all(examples.map(async (token, index) => {
      const host = $(`[data-rule-example-index="${index}"] .rule-example-svg`, container);
      await renderTokenToSvgHost(token, host);
    }));
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
      const analysis = rulePreflightAnalysis(rule);
      const badgeText = analysis.status === 'good' ? 'Looks good' : analysis.status === 'warning' ? 'Tight' : 'Needs changes';
      return `<article class="saved-rule saved-rule-expanded ${analysis.status}" data-rule-card="${escapeHtml(rule.id)}">
        <div class="saved-rule-main">
          <div class="saved-rule-copy">
            <div class="saved-rule-title-row"><span class="rule-health-badge ${analysis.status}">${badgeText}</span><strong>${escapeHtml(ruleSentence(rule))}</strong></div>
            <small>${rule.sources.length} source trait(s) across ${layerCount} layer(s)</small>
          </div>
          <button class="rule-remove" data-rule-id="${escapeHtml(rule.id)}" type="button">Remove</button>
        </div>
        <div class="rule-preflight ${analysis.status}">${preflightMarkup(analysis)}${analysis.status !== 'good' ? `<div class="rule-preflight-actions"><button type="button" class="ghost-btn rule-adjust-settings">Adjust Percentages / Counts</button></div>` : ''}</div>
        <div class="rule-examples-section">
          <div class="rule-examples-heading"><strong>Example outcomes</strong><span>Small samples using your current rarity/count settings and this rule.</span></div>
          <div class="rule-examples-grid" data-rule-examples="${escapeHtml(rule.id)}"><div class="rule-example-loading">Rendering examples…</div></div>
        </div>
      </article>`;
    }).join('');
    state.rules.forEach(rule => { renderRuleExamples(rule); });
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
      if (!trait) continue;
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


  function lockedMasksForSupply(supply) {
    const masks = {};
    for (const layer of state.layers) masks[layer.id] = new Array(supply).fill(false);
    for (const [tokenId, recipe] of state.manifestTokens.entries()) {
      if (tokenId < 1 || tokenId > supply) continue;
      for (const layerId of Object.keys(recipe)) {
        if (masks[layerId]) masks[layerId][tokenId - 1] = true;
      }
    }
    return masks;
  }

  function ruleConflictAnalysis(tokens, details) {
    const grouped = new Map();
    for (const item of details) {
      if (!grouped.has(item.rule.id)) grouped.set(item.rule.id, { rule: item.rule, items: [], conflicts: 0 });
      const group = grouped.get(item.rule.id);
      group.items.push(item);
      group.conflicts += item.count;
    }
    const supply = tokens.length;
    const lockedMasks = lockedMasksForSupply(supply);

    return [...grouped.values()].map(group => {
      const rule = group.rule;
      const sourceTokens = tokens.filter(token => tokenHas(token, rule.sources)).length;
      const capacityNotes = [];
      let mathematicallyImpossible = false;

      if (rule.type === 'excludes') {
        for (const [layerId, forbidden] of targetsByLayer(rule)) {
          const forbiddenCount = tokens.filter(token => forbidden.includes(token.traits[layerId])).length;
          const minimumOverlap = Math.max(0, sourceTokens + forbiddenCount - supply);
          if (minimumOverlap > 0) {
            mathematicallyImpossible = true;
            capacityNotes.push(`At least ${minimumOverlap} conflict(s) are unavoidable with the current counts because ${sourceTokens} token(s) use the source group and ${forbiddenCount} token(s) use the excluded ${getLayer(layerId)?.name || 'target'} trait group.`);
          }
        }
      } else {
        for (const [layerId, allowed] of targetsByLayer(rule)) {
          const allowedCount = tokens.filter(token => allowed.includes(token.traits[layerId])).length;
          if (allowedCount < sourceTokens) {
            mathematicallyImpossible = true;
            capacityNotes.push(`This rule needs ${sourceTokens} compatible ${getLayer(layerId)?.name || 'target'} slot(s), but only ${allowedCount} currently exist. Increase the compatible trait rarity/count or reduce the source trait rarity/count.`);
          }
        }
      }

      const lockedTokenIds = [];
      for (const item of group.items) {
        const token = tokens[item.tokenIndex];
        let locked = false;
        if (rule.type === 'excludes') {
          for (const targetId of rule.targets) {
            const target = getTrait(targetId);
            if (target && token.traits[target.layerId] === targetId && lockedMasks[target.layerId]?.[item.tokenIndex]) locked = true;
          }
        } else {
          for (const [layerId, allowed] of targetsByLayer(rule)) {
            if (!allowed.includes(token.traits[layerId]) && lockedMasks[layerId]?.[item.tokenIndex]) locked = true;
          }
        }
        for (const sourceId of rule.sources) {
          const source = getTrait(sourceId);
          if (source && token.traits[source.layerId] === sourceId && lockedMasks[source.layerId]?.[item.tokenIndex]) locked = true;
        }
        if (locked) lockedTokenIds.push(token.tokenId);
      }

      return {
        rule,
        conflicts: group.conflicts,
        affectedTokenIds: group.items.map(item => tokens[item.tokenIndex].tokenId),
        lockedTokenIds: [...new Set(lockedTokenIds)],
        sourceTokens,
        mathematicallyImpossible,
        capacityNotes,
      };
    });
  }

  function bestSwapForLayer(tokens, lockedMasks, layerId, tokenIndex, candidateFilter) {
    if (lockedMasks[layerId]?.[tokenIndex]) return false;
    let bestIndex = -1;
    let bestPairScore = Infinity;
    for (let j = 0; j < tokens.length; j++) {
      if (j === tokenIndex || lockedMasks[layerId]?.[j]) continue;
      if (candidateFilter && !candidateFilter(tokens[j], j)) continue;
      const pairBefore = localViolation(tokens, [tokenIndex, j]);
      const temp = tokens[tokenIndex].traits[layerId];
      tokens[tokenIndex].traits[layerId] = tokens[j].traits[layerId];
      tokens[j].traits[layerId] = temp;
      const pairAfter = localViolation(tokens, [tokenIndex, j]);
      tokens[j].traits[layerId] = tokens[tokenIndex].traits[layerId];
      tokens[tokenIndex].traits[layerId] = temp;
      if (pairAfter < pairBefore && pairAfter < bestPairScore) {
        bestIndex = j;
        bestPairScore = pairAfter;
        if (pairAfter === 0) break;
      }
    }
    if (bestIndex < 0) return false;
    const temp = tokens[tokenIndex].traits[layerId];
    tokens[tokenIndex].traits[layerId] = tokens[bestIndex].traits[layerId];
    tokens[bestIndex].traits[layerId] = temp;
    return true;
  }

  function deepRepairRules(tokens, lockedMasks) {
    if (!state.rulesEnabled || !state.rules.length) return { remaining: 0, passes: 0 };
    let passes = 0;
    const maxPasses = 40;
    let details = getViolationDetails(tokens);

    while (details.length && passes < maxPasses) {
      passes++;
      let changes = 0;
      for (const violation of details) {
        const i = violation.tokenIndex;
        const rule = violation.rule;
        if (!tokenHas(tokens[i], rule.sources)) continue;

        if (rule.type === 'excludes') {
          const offendingTargets = rule.targets.filter(id => Object.values(tokens[i].traits).includes(id));
          for (const targetId of offendingTargets) {
            const target = getTrait(targetId);
            if (!target) continue;
            const fixed = bestSwapForLayer(tokens, lockedMasks, target.layerId, i, candidate => !rule.targets.includes(candidate.traits[target.layerId]));
            if (fixed) changes++;
          }
        } else {
          for (const [targetLayerId, allowed] of targetsByLayer(rule)) {
            if (allowed.includes(tokens[i].traits[targetLayerId])) continue;
            const fixed = bestSwapForLayer(tokens, lockedMasks, targetLayerId, i, candidate => allowed.includes(candidate.traits[targetLayerId]));
            if (fixed) changes++;
          }
        }
      }
      const next = getViolationDetails(tokens);
      if (!changes || next.length >= details.length) {
        details = next;
        break;
      }
      details = next;
    }
    return { remaining: details.reduce((sum, item) => sum + item.count, 0), passes };
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
    const deepRepair = deepRepairRules(tokens, lockedMasks);
    const ruleViolationDetails = getViolationDetails(tokens);
    const ruleConflictGroups = ruleConflictAnalysis(tokens, ruleViolationDetails);
    const exactIssues = exactCountValidation(tokens);
    const duplicates = duplicateCount(tokens);

    return {
      tokens,
      report: {
        supply,
        seed,
        manualTokens: lockedByToken.size,
        rules: state.rulesEnabled ? state.rules.length : 0,
        ruleViolations: ruleViolationDetails.reduce((sum, item) => sum + item.count, 0),
        ruleViolationDetails,
        ruleConflictGroups,
        exactIssues,
        duplicates,
        repairPasses: repair.passes + deepRepair.passes,
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

    const conflictUi = r.ruleConflictGroups?.length ? `
      <div class="rule-fixer">
        <div class="rule-fixer-heading">
          <div>
            <strong>Rule Fixer</strong>
            <span>Relic Forge preserved your locked tokens and trait totals. These are the conflicts it could not safely rearrange.</span>
          </div>
          <button type="button" class="secondary-btn" data-fix-action="adjust-counts">Adjust Rarities / Counts</button>
        </div>
        ${r.ruleConflictGroups.map((group, index) => {
          const examples = group.affectedTokenIds.slice(0, 8).map(id => `#${id}`).join(', ');
          const locked = group.lockedTokenIds.length ? `Locked token${group.lockedTokenIds.length === 1 ? '' : 's'} involved: ${group.lockedTokenIds.slice(0, 8).map(id => `#${id}`).join(', ')}${group.lockedTokenIds.length > 8 ? '…' : ''}` : '';
          const diagnosis = group.capacityNotes.length
            ? group.capacityNotes.join(' ')
            : group.lockedTokenIds.length
              ? 'At least one affected combination is manually/import locked, so Relic Forge will not silently change it.'
              : 'The current count-preserving arrangement could not satisfy this rule. You can let Relic Forge relax the affected rarity targets, or edit the rule.';
          return `
            <article class="rule-fix-card">
              <div class="rule-fix-topline">
                <span class="rule-conflict-count">${group.conflicts} conflict${group.conflicts === 1 ? '' : 's'}</span>
                <strong>${escapeHtml(ruleSentence(group.rule))}</strong>
              </div>
              <p>${escapeHtml(diagnosis)}</p>
              <div class="rule-fix-meta"><span>Affected examples: ${escapeHtml(examples || '—')}</span>${locked ? `<span class="locked-warning">${escapeHtml(locked)}</span>` : ''}</div>
              <div class="rule-fix-actions">
                <button type="button" class="ghost-btn" data-fix-action="adjust-counts">Adjust Rarities / Counts</button>
                <button type="button" class="ghost-btn" data-fix-action="edit-rule" data-rule-id="${escapeHtml(group.rule.id)}">Edit This Rule</button>
                ${group.lockedTokenIds.length ? `<button type="button" class="ghost-btn" data-fix-action="edit-token" data-token-id="${group.lockedTokenIds[0]}">Edit Locked Token #${group.lockedTokenIds[0]}</button>` : ''}
                <button type="button" class="primary-btn" data-fix-action="relax" data-rule-id="${escapeHtml(group.rule.id)}">Auto Fix — Prioritize Rule</button>
              </div>
              <small class="rule-fix-note">“Prioritize Rule” may slightly change non-exact rarity percentages for unlocked traits, but it will never alter exact-count traits or manually locked token choices.</small>
            </article>`;
        }).join('')}
      </div>` : '';

    el.compilerStatus.innerHTML = `<div class="compiler-box ${hardProblems ? 'error' : 'success'}"><strong>${hardProblems ? 'A few things still need attention.' : 'Collection recipe is valid.'}</strong><ul>${messages.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul></div>${conflictUi}`;

    el.collectionStats.innerHTML = `
      <div class="stat"><span>Supply</span><strong>${r.supply.toLocaleString()}</strong></div>
      <div class="stat"><span>Layers</span><strong>${state.layers.length}</strong></div>
      <div class="stat"><span>Rules</span><strong>${r.rules}</strong></div>
      <div class="stat"><span>Manual</span><strong>${r.manualTokens}</strong></div>
      <div class="stat"><span>Duplicates</span><strong>${r.duplicates}</strong></div>
    `;
  }

  function relevantRuleLayers(rule) {
    return new Set([...rule.sources, ...rule.targets].map(id => getTrait(id)?.layerId).filter(Boolean));
  }

  function relaxRuleConflicts(ruleId) {
    if (!state.compiledTokens.length) return;
    const rule = state.rules.find(item => item.id === ruleId);
    if (!rule) return;
    const lockedMasks = lockedMasksForSupply(state.compiledTokens.length);
    let changed = 0;

    // Rule-priority mode is allowed to replace an unlocked, non-exact trait rather than preserve its percentage target.
    for (let pass = 0; pass < 20; pass++) {
      let passChanges = 0;
      for (let i = 0; i < state.compiledTokens.length; i++) {
        const token = state.compiledTokens[i];
        if (!ruleViolationCount(token, rule)) continue;

        if (rule.type === 'excludes') {
          for (const targetId of rule.targets) {
            const target = getTrait(targetId);
            if (!target || token.traits[target.layerId] !== targetId || lockedMasks[target.layerId]?.[i] || target.distribution === 'exact') continue;
            const layer = getLayer(target.layerId);
            const replacement = layer?.traits.find(trait => !rule.targets.includes(trait.id) && trait.distribution !== 'exact' && !trait.isNone)
              || layer?.traits.find(trait => !rule.targets.includes(trait.id) && trait.distribution !== 'exact');
            if (replacement) { token.traits[target.layerId] = replacement.id; passChanges++; changed++; }
          }
        } else {
          for (const [layerId, allowed] of targetsByLayer(rule)) {
            if (allowed.includes(token.traits[layerId]) || lockedMasks[layerId]?.[i]) continue;
            const currentTrait = getTrait(token.traits[layerId]);
            if (currentTrait?.distribution === 'exact') continue;
            const replacementId = allowed.find(id => getTrait(id)?.distribution !== 'exact');
            if (replacementId) { token.traits[layerId] = replacementId; passChanges++; changed++; }
          }
        }
      }
      if (!passChanges) break;
    }

    const details = getViolationDetails(state.compiledTokens);
    state.compilerReport.ruleViolationDetails = details;
    state.compilerReport.ruleViolations = details.reduce((sum, item) => sum + item.count, 0);
    state.compilerReport.ruleConflictGroups = ruleConflictAnalysis(state.compiledTokens, details);
    state.compilerReport.exactIssues = exactCountValidation(state.compiledTokens);
    state.compilerReport.duplicates = duplicateCount(state.compiledTokens);
    renderCompilerReport();
    renderPreviewGrid();
    el.toLaunchBtn.disabled = state.compilerReport.ruleViolations > 0 || state.compilerReport.exactIssues.length > 0;
    showStatus(changed ? `Applied ${changed} rule-priority adjustment(s).` : 'No safe automatic adjustment was available for this rule.', changed ? 'success' : 'warn');
  }

  function hexByte(value) {
    return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
  }

  function compactOpacity(alpha) {
    if (alpha >= 255) return '';
    const value = Math.round((alpha / 255) * 1000) / 1000;
    return ` fill-opacity="${String(value).replace(/^0\./, '.') }"`;
  }

  async function traitToSvgFragment(trait) {
    if (!trait || trait.isNone) return '';
    if (trait.svgFragment != null) return trait.svgFragment;

    const bitmap = await createImageBitmap(trait.file);
    const width = bitmap.width;
    const height = bitmap.height;
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext('2d', { alpha: true, willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, width, height).data;

    // Build horizontal same-color runs, then merge identical runs vertically.
    // This preserves every source pixel exactly while producing much smaller SVG
    // geometry than emitting one <rect> per pixel.
    const rectangles = [];
    let active = new Map();

    for (let y = 0; y < height; y++) {
      const rowRuns = [];
      let x = 0;
      while (x < width) {
        const offset = (y * width + x) * 4;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];
        const a = pixels[offset + 3];
        if (a === 0) { x++; continue; }

        let end = x + 1;
        while (end < width) {
          const next = (y * width + end) * 4;
          if (pixels[next] !== r || pixels[next + 1] !== g || pixels[next + 2] !== b || pixels[next + 3] !== a) break;
          end++;
        }
        rowRuns.push({ x, w: end - x, r, g, b, a });
        x = end;
      }

      const nextActive = new Map();
      const seen = new Set();
      for (const run of rowRuns) {
        const key = `${run.x}:${run.w}:${run.r}:${run.g}:${run.b}:${run.a}`;
        seen.add(key);
        const existing = active.get(key);
        if (existing) {
          existing.h += 1;
          nextActive.set(key, existing);
        } else {
          nextActive.set(key, { ...run, y, h: 1 });
        }
      }
      for (const [key, rect] of active.entries()) {
        if (!seen.has(key)) rectangles.push(rect);
      }
      active = nextActive;
    }
    rectangles.push(...active.values());

    const byColor = new Map();
    for (const rect of rectangles) {
      const key = `${rect.r}:${rect.g}:${rect.b}:${rect.a}`;
      if (!byColor.has(key)) byColor.set(key, { ...rect, commands: [] });
      byColor.get(key).commands.push(`M${rect.x} ${rect.y}h${rect.w}v${rect.h}h-${rect.w}Z`);
    }

    const fragments = [];
    for (const group of byColor.values()) {
      const fill = `#${hexByte(group.r)}${hexByte(group.g)}${hexByte(group.b)}`;
      fragments.push(`<path fill="${fill}"${compactOpacity(group.a)} d="${group.commands.join('')}"/>`);
    }
    trait.svgFragment = fragments.join('');
    trait.svgStats = {
      rectangles: rectangles.length,
      colors: byColor.size,
      bytes: new Blob([trait.svgFragment]).size,
    };
    return trait.svgFragment;
  }

  async function tokenToSvg(token) {
    const width = state.imageWidth || 1000;
    const height = state.imageHeight || 1000;
    const parts = [];
    for (const layer of state.layers) {
      const trait = getTrait(token.traits[layer.id]);
      if (!trait || trait.isNone) continue;
      try {
        parts.push(await traitToSvgFragment(trait));
      } catch (error) {
        console.warn(`Could not vectorize ${trait.name}`, error);
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
  }

  async function renderTokenToSvgHost(token, host) {
    if (!host) return;
    host.innerHTML = await tokenToSvg(token);
    const svg = host.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.display = 'block';
    }
  }

  async function downloadManualSvg() {
    if (!state.layers.length) return;
    const tokenId = Number.parseInt(el.manualTokenId.value || '1', 10) || 1;
    const token = { tokenId, traits: currentManualSelection() };
    const svg = await tokenToSvg(token);
    downloadText(`relic-forge-token-${tokenId}.svg`, svg, 'image/svg+xml');
    showStatus(`SVG preview for token #${tokenId} downloaded.`, 'success');
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
        <div class="preview-canvas-wrap"><div class="svg-preview-host preview-svg-host" role="img" aria-label="SVG token preview"></div></div>
        <div class="preview-card-body">
          <strong>#${token.tokenId}</strong>
          <div class="preview-traits">${state.layers.map(layer => `<span>${escapeHtml(getTrait(token.traits[layer.id])?.name || '—')}</span>`).join('')}</div>
        </div>
      </article>
    `).join('');
    await Promise.all(picks.map(async token => {
      const card = $(`.preview-card[data-token-id="${token.tokenId}"]`, el.previewGrid);
      const host = $('.preview-svg-host', card);
      await renderTokenToSvgHost(token, host);
    }));
  }

  function manifestObject() {
    return {
      schema: 'relic-forge/collection-manifest@0.1',
      collection: {
        name: el.collectionName.value.trim() || 'Untitled Collection',
        supply: state.compiledTokens.length || getSupply(),
        seed: el.seedInput.value.trim() || 'RELIC-001',
        renderFormat: 'compact-svg-pixel-vector',
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
        rarityOrder: layer.rarityOrder,
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

  function studioProjectSnapshot() {
    return {
      schema: 'relic-forge/studio-save@1',
      savedAt: new Date().toISOString(),
      ui: {
        step: state.step,
        collectionName: el.collectionName.value,
        collectionSize: getSupply(),
        seed: el.seedInput.value,
      },
      state: {
        buildMode: state.buildMode,
        rulesEnabled: state.rulesEnabled,
        ruleType: state.ruleType,
        imageWidth: state.imageWidth,
        imageHeight: state.imageHeight,
        manifestSourceName: state.manifestSourceName,
        layers: state.layers.map(layer => ({
          id: layer.id,
          name: layer.name,
          allowNone: layer.allowNone,
          rarityMode: layer.rarityMode,
          autoFillStyle: layer.autoFillStyle,
          rarityOrder: layer.rarityOrder,
          traits: layer.traits.map(trait => ({
            id: trait.id,
            layerId: trait.layerId,
            name: trait.name,
            filename: trait.filename,
            file: trait.file || null,
            width: trait.width,
            height: trait.height,
            rarity: trait.rarity,
            distribution: trait.distribution,
            exactCount: trait.exactCount,
            percentage: trait.percentage,
            isNone: !!trait.isNone,
          })),
        })),
        rules: state.rules.map(rule => ({
          id: rule.id,
          type: rule.type,
          sources: [...rule.sources],
          targets: [...rule.targets],
        })),
        sourceSelected: [...state.sourceSelected],
        targetSelected: [...state.targetSelected],
        manifestTokens: [...state.manifestTokens.entries()].map(([tokenId, recipe]) => [tokenId, { ...recipe }]),
        compiledTokens: state.compiledTokens.map(token => ({ tokenId: token.tokenId, traits: { ...token.traits } })),
        compilerReport: state.compilerReport ? JSON.parse(JSON.stringify(state.compilerReport)) : null,
      },
    };
  }

  async function restoreStudioProjectSnapshot(snapshot) {
    if (!snapshot || snapshot.schema !== 'relic-forge/studio-save@1' || !snapshot.state) {
      throw new Error('This is not a supported Relic Forge Studio save.');
    }

    revokeArtworkUrls();
    const saved = snapshot.state;
    state.layers = (saved.layers || []).map(layer => ({
      id: layer.id,
      name: layer.name,
      allowNone: !!layer.allowNone,
      rarityMode: layer.rarityMode || 'tier',
      autoFillStyle: layer.autoFillStyle || 'gradual',
      rarityOrder: layer.rarityOrder || 'most_to_least',
      traits: (layer.traits || []).map(trait => {
        const file = trait.file || null;
        return {
          id: trait.id,
          layerId: trait.layerId || layer.id,
          name: trait.name,
          filename: trait.filename,
          file,
          url: file ? URL.createObjectURL(file) : '',
          width: Number(trait.width || saved.imageWidth || 0),
          height: Number(trait.height || saved.imageHeight || 0),
          rarity: trait.rarity || 'common',
          distribution: trait.distribution || 'weighted',
          exactCount: trait.exactCount ?? null,
          percentage: Number(trait.percentage || 0),
          image: null,
          svgFragment: trait.isNone ? '' : null,
          svgStats: trait.isNone ? { rectangles: 0, colors: 0, bytes: 0 } : null,
          isNone: !!trait.isNone,
        };
      }),
    }));
    state.rulesEnabled = !!saved.rulesEnabled;
    state.rules = (saved.rules || []).map(rule => ({ id: rule.id, type: rule.type, sources: [...(rule.sources || [])], targets: [...(rule.targets || [])] }));
    state.ruleType = saved.ruleType || 'only_with';
    state.sourceSelected = new Set(saved.sourceSelected || []);
    state.targetSelected = new Set(saved.targetSelected || []);
    state.manifestTokens = new Map((saved.manifestTokens || []).map(([tokenId, recipe]) => [Number(tokenId), { ...recipe }]));
    state.manifestSourceName = saved.manifestSourceName || '';
    state.compiledTokens = (saved.compiledTokens || []).map(token => ({ tokenId: Number(token.tokenId), traits: { ...(token.traits || {}) } }));
    state.compilerReport = saved.compilerReport || null;
    state.imageWidth = Number(saved.imageWidth || state.layers[0]?.traits[0]?.width || 1000);
    state.imageHeight = Number(saved.imageHeight || state.layers[0]?.traits[0]?.height || 1000);

    const ui = snapshot.ui || {};
    el.collectionName.value = ui.collectionName || 'Untitled Collection';
    el.collectionSize.value = Number(ui.collectionSize || Math.max(1, state.compiledTokens.length) || 1);
    el.seedInput.value = ui.seed || 'RELIC-001';

    renderArtwork();
    setBuildMode(saved.buildMode || 'auto');
    setRulesEnabled(!!saved.rulesEnabled);
    renderTraitSetup();
    renderManualBuilder();
    renderRulePickers();
    renderRulesList();
    updateStep1State();
    if (state.compilerReport) renderCompilerReport();
    if (state.compiledTokens.length) await renderPreviewGrid();
    gotoStep(Math.max(1, Math.min(5, Number(ui.step || 1))));
    updateLaunchSummary();
    showStatus(`Project “${el.collectionName.value || 'Untitled Collection'}” restored.`, 'success');
  }

  function updateLaunchSummary() {
    const name = el.collectionName.value.trim() || 'Untitled Collection';
    if (el.launchName && document.activeElement !== el.launchName) el.launchName.value = name;
    el.launchSummaryTitle.textContent = el.launchName?.value?.trim() || name;
    const chain = $('#chainSelect')?.value || 'Ethereum Sepolia';
    const price = $('#mintPrice')?.value || '0';
    const royalty = $('#royalty')?.value || '0';
    const maxPerWallet = $('#maxPerWallet')?.value || '0';
    const reveal = $('input[name="revealMode"]:checked')?.value === '1' ? 'Creator Reveal' : 'Forge Reveal';
    const report = state.compilerReport;
    el.launchSummaryDetails.innerHTML = `
      <div class="launch-summary-details">
        <div class="launch-summary-row"><span>Supply</span><strong>${(report?.supply || getSupply()).toLocaleString()}</strong></div>
        <div class="launch-summary-row"><span>Network</span><strong>${escapeHtml(chain)}</strong></div>
        <div class="launch-summary-row"><span>Reveal</span><strong>${escapeHtml(reveal)}</strong></div>
        <div class="launch-summary-row"><span>Mint price</span><strong>${escapeHtml(price)} ETH</strong></div>
        <div class="launch-summary-row"><span>Wallet limit</span><strong>${Number(maxPerWallet) === 0 ? 'Unlimited' : escapeHtml(maxPerWallet)}</strong></div>
        <div class="launch-summary-row"><span>Mint access</span><strong>${$('#whitelistEnabled')?.checked ? `Whitelist${$('#publicMintEnabled')?.checked ? ' + public' : ' only'}` : 'Public'}</strong></div>
        <div class="launch-summary-row"><span>Royalty</span><strong>${escapeHtml(royalty)}%</strong></div>
        <div class="launch-summary-row"><span>Studio compiler</span><strong>${report && !report.ruleViolations && !report.exactIssues.length ? 'Valid ✓' : 'Needs review'}</strong></div>
      </div>`;
  }

  function exportLaunchPackage() {
    const packageData = {
      schema: 'relic-forge/launch-package@0.2',
      launch: {
        name: el.launchName.value,
        symbol: $('#launchSymbol').value,
        description: $('#launchDescription')?.value || '',
        chain: $('#chainSelect').value,
        chainId: 11155111,
        mintPrice: $('#mintPrice').value,
        maxPerWallet: $('#maxPerWallet')?.value || '0',
        royaltyPercent: $('#royalty').value,
        royaltyWallet: $('#royaltyWallet')?.value || '',
        revealMode: $('input[name="revealMode"]:checked')?.value === '1' ? 'creator' : 'forge',
      },
      manifest: manifestObject(),
      onchainCompile: window.RelicForgeForge?.getCompiledSummary?.() || null,
      mintAccess: window.RelicForgeForge?.getWhitelistSummary?.() || null,
      note: 'GitHub-ready Sepolia test package. Creator wallet deploys/owns the collection. Test randomness is not production VRF.',
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

  function openStudio() {
    el.landingPage?.classList.add('hidden');
    el.studioApp?.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function openLanding() {
    el.studioApp?.classList.add('hidden');
    el.landingPage?.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Public Studio bridge. Define this before UI event binding so project saves and
  // Forge tooling remain available even if a later optional UI binding fails.
  window.RelicForgeStudioBridge = {
    version: '10.5.2',
    getState: () => state,
    getManifest: manifestObject,
    getProjectConfig: projectConfig,
    getStudioProjectSnapshot: studioProjectSnapshot,
    restoreStudioProjectSnapshot,
    getSupply,
    getTrait,
    getLayer,
    traitToSvgFragment,
    updateLaunchSummary,
    showStatus,
  };
  window.dispatchEvent(new CustomEvent('relicforge:studio-bridge-ready', { detail: { version: '10.5.2' } }));

  ['enterStudioBtn', 'enterStudioTopBtn', 'enterStudioBottomBtn'].forEach(id => {
    const button = $(`#${id}`);
    if (button) button.addEventListener('click', openStudio);
  });
  $('#studioHomeBtn')?.addEventListener('click', openLanding);

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

  el.layerList.addEventListener('dragstart', e => {
    const card = e.target.closest('.layer-sortable[draggable="true"]');
    if (!card) return;
    state.draggedLayer = { layerId: card.dataset.layerId };
    card.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.layerId);
    }
  });
  el.layerList.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.layer-sortable');
    if (!card || !state.draggedLayer || card.dataset.layerId === state.draggedLayer.layerId) return;
    const rect = card.getBoundingClientRect();
    const placeAfter = (e.clientY - rect.top) > rect.height / 2;
    $$('.layer-sortable.drag-over-before, .layer-sortable.drag-over-after', el.layerList).forEach(item => item.classList.remove('drag-over-before', 'drag-over-after'));
    card.classList.add(placeAfter ? 'drag-over-after' : 'drag-over-before');
  });
  el.layerList.addEventListener('drop', e => {
    e.preventDefault();
    const card = e.target.closest('.layer-sortable');
    if (!card || !state.draggedLayer || card.dataset.layerId === state.draggedLayer.layerId) return;
    const rect = card.getBoundingClientRect();
    const placeAfter = (e.clientY - rect.top) > rect.height / 2;
    const dragged = state.draggedLayer;
    state.draggedLayer = null;
    reorderLayer(dragged.layerId, card.dataset.layerId, placeAfter);
  });
  el.layerList.addEventListener('dragend', () => {
    state.draggedLayer = null;
    $$('.layer-sortable.dragging, .layer-sortable.drag-over-before, .layer-sortable.drag-over-after', el.layerList).forEach(item => item.classList.remove('dragging', 'drag-over-before', 'drag-over-after'));
  });

  el.layerList.addEventListener('change', e => {
    if (e.target.classList.contains('layer-name-input')) {
      const layer = getLayer(e.target.dataset.layerId);
      const nextName = e.target.value.trim();
      if (!layer || !nextName) { if (layer) e.target.value = layer.name; return; }
      layer.name = nextName;
      renderTraitSetup();
      renderManualBuilder();
      renderRulePickers();
      renderRulesList();
      showStatus(`Category renamed to ${nextName}.`, 'success');
      return;
    }
    if (e.target.classList.contains('trait-name-input')) {
      const trait = getTrait(e.target.dataset.traitId);
      const nextName = e.target.value.trim();
      if (!trait || trait.isNone || !nextName) { if (trait) e.target.value = trait.name; return; }
      trait.name = nextName;
      renderTraitSetup();
      renderManualBuilder();
      renderRulePickers();
      renderRulesList();
      showStatus(`Trait renamed to ${nextName}.`, 'success');
    }
  });

  // Navigation and mode
  $$('.step').forEach(btn => btn.addEventListener('click', () => {
    const target = Number(btn.dataset.step);
    if (target === 1 || state.layers.length) gotoStep(target);
  }));
  $$('.next-btn').forEach(btn => btn.addEventListener('click', () => gotoStep(Number(btn.dataset.next))));
  $$('.back-btn').forEach(btn => btn.addEventListener('click', () => gotoStep(Number(btn.dataset.back))));

  // Build mode + trait controls
  $$('.build-card').forEach(card => card.addEventListener('click', () => setBuildMode(card.dataset.buildMode)));
  el.traitSetup.addEventListener('input', e => {
    if (!e.target.classList.contains('percent-input')) return;
    const config = e.target.closest('[data-trait-id]');
    if (!config) return;
    const trait = getTrait(config.dataset.traitId);
    const layerId = config.dataset.layerId;
    if (!trait || !layerId) return;
    trait.percentage = Math.max(0, Math.min(100, Number.parseFloat(e.target.value || '0') || 0));
    updatePercentTotalUI(layerId);
    updateBuildContinueState();
    if (state.step === 3) { updateRuleSentence(); renderRulesList(); }
  });
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
    if (e.target.classList.contains('layer-rarity-order')) {
      const layer = getLayer(e.target.dataset.layerId);
      if (!layer) return;
      layer.rarityOrder = e.target.value;
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
    if (e.target.classList.contains('percent-input')) { updatePercentTotalUI(layerId); updateBuildContinueState(); }
  });
  el.traitSetup.addEventListener('click', e => {
    const autoFillBtn = e.target.closest('.autofill-btn');
    if (autoFillBtn) {
      autoFillLayerPercentages(autoFillBtn.dataset.layerId);
      return;
    }
    const equalizeBtn = e.target.closest('.equalize-btn');
    if (equalizeBtn) {
      equalizeLayerPercentages(equalizeBtn.dataset.layerId);
    }
  });

  // Drag-and-drop rarity ordering in Generate For Me percentage mode.
  el.traitSetup.addEventListener('dragstart', e => {
    const handle = e.target.closest('.drag-handle[draggable="true"]');
    if (!handle) return;
    const card = handle.closest('.trait-sortable');
    if (!card) return;
    state.draggedTrait = { layerId: card.dataset.layerId, traitId: card.dataset.traitId };
    card.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.traitId);
    }
  });
  el.traitSetup.addEventListener('dragover', e => {
    const card = e.target.closest('.trait-sortable');
    if (!card || !state.draggedTrait || card.dataset.layerId !== state.draggedTrait.layerId || card.dataset.traitId === state.draggedTrait.traitId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    $$('.trait-sortable.drag-over-before, .trait-sortable.drag-over-after', el.traitSetup).forEach(item => item.classList.remove('drag-over-before', 'drag-over-after'));
    const rect = card.getBoundingClientRect();
    const horizontal = rect.width > rect.height * 1.35;
    const placeAfter = horizontal ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2;
    card.classList.add(placeAfter ? 'drag-over-after' : 'drag-over-before');
  });
  el.traitSetup.addEventListener('drop', e => {
    const card = e.target.closest('.trait-sortable');
    if (!card || !state.draggedTrait || card.dataset.layerId !== state.draggedTrait.layerId) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const horizontal = rect.width > rect.height * 1.35;
    const placeAfter = horizontal ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2;
    const dragged = state.draggedTrait;
    state.draggedTrait = null;
    reorderTrait(dragged.layerId, dragged.traitId, card.dataset.traitId, placeAfter);
  });
  el.traitSetup.addEventListener('dragend', () => {
    state.draggedTrait = null;
    $$('.trait-sortable.dragging, .trait-sortable.drag-over-before, .trait-sortable.drag-over-after', el.traitSetup).forEach(item => item.classList.remove('dragging', 'drag-over-before', 'drag-over-after'));
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
  $('#downloadManualSvgBtn').addEventListener('click', downloadManualSvg);
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
    const adjustBtn = e.target.closest('.rule-adjust-settings');
    if (adjustBtn) {
      gotoStep(2);
      el.traitSetup?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showStatus('Adjust the percentages, rarity tiers, or exact counts, then return to Rules. The rule check will refresh automatically.');
      return;
    }
    const btn = e.target.closest('.rule-remove');
    if (!btn) return;
    state.rules = state.rules.filter(rule => rule.id !== btn.dataset.ruleId);
    renderRulesList();
  });

  // Compiler / preview
  el.compilerStatus.addEventListener('click', e => {
    const btn = e.target.closest('[data-fix-action]');
    if (!btn) return;
    const action = btn.dataset.fixAction;
    if (action === 'adjust-counts') {
      gotoStep(2);
      el.traitSetup?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showStatus('Adjust the rarity/percentage or exact count for the traits involved, then rebuild the preview.');
      return;
    }
    if (action === 'edit-rule') {
      gotoStep(3);
      const ruleEl = $(`[data-rule-id="${btn.dataset.ruleId}"]`, el.rulesList)?.closest('.saved-rule');
      ruleEl?.classList.add('attention-pulse');
      ruleEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (action === 'edit-token') {
      setBuildMode('manual');
      gotoStep(2);
      el.manualTokenId.value = btn.dataset.tokenId;
      renderManualBuilder(Number(btn.dataset.tokenId));
      el.manualPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (action === 'relax') {
      relaxRuleConflicts(btn.dataset.ruleId);
    }
  });
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
  ['chainSelect', 'mintPrice', 'royalty', 'launchName'].forEach(id => $(`#${id}`)?.addEventListener('input', updateLaunchSummary));
  $$('input[name="revealMode"]').forEach(input => input.addEventListener('change', updateLaunchSummary));
  el.collectionName.addEventListener('input', () => { if (state.step === 5) updateLaunchSummary(); });
  el.collectionSize.addEventListener('change', () => { renderTraitSetup(); if (state.buildMode === 'manual') renderManualBuilder(); });

  // Initial state
  setBuildMode('auto');
  setRulesEnabled(false);
})();
