(() => {
  'use strict';

  const byId = id => document.getElementById(id);

  let draftIds = [];
  let draggedId = null;

  function bridge() {
    return window.RelicForgeStudioBridge || null;
  }

  function currentLayers() {
    const state = bridge()?.getState?.();
    return Array.isArray(state?.layers) ? state.layers : [];
  }

  function currentIds() {
    return currentLayers().map(layer => layer.id);
  }

  function sameOrder(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function sameMembers(a, b) {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return set.size === a.length && b.every(value => set.has(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function syncDraft(force = false) {
    const ids = currentIds();
    if (force || !sameMembers(draftIds, ids)) draftIds = [...ids];
  }

  function rowRole(index, total) {
    if (index === 0) return {
      className: 'is-back',
      badge: 'BACK / BOTTOM',
      detail: 'Rendered first'
    };
    if (index === total - 1) return {
      className: 'is-front',
      badge: 'FRONT / TOP',
      detail: 'Rendered last · sits over prior layers'
    };
    return {
      className: '',
      badge: `STACK ${index + 1}`,
      detail: `Rendered ${index + 1} of ${total}`
    };
  }

  function render(options = {}) {
    const list = byId('layerStackOrderList');
    const apply = byId('applyLayerStackOrderBtn');
    const reset = byId('resetLayerStackOrderBtn');
    const status = byId('layerStackOrderStatus');
    if (!list || !apply || !reset || !status) return;

    syncDraft(!!options.resetDraft);

    const layers = currentLayers();
    const ids = layers.map(layer => layer.id);
    const layerMap = new Map(layers.map(layer => [layer.id, layer]));

    if (!layers.length) {
      list.innerHTML = '<div class="layer-stack-empty">Add trait layers in the Artwork tab to build the stack.</div>';
      apply.disabled = true;
      reset.disabled = true;
      status.textContent = 'No trait layers yet.';
      return;
    }

    const dirty = !sameOrder(draftIds, ids);
    apply.disabled = !dirty;
    reset.disabled = !dirty;
    status.textContent = dirty
      ? 'Draft order changed. Click Apply Layer Order to update the collection.'
      : 'Current layer order is applied.';

    list.innerHTML = draftIds.map((layerId, index) => {
      const layer = layerMap.get(layerId);
      if (!layer) return '';
      const role = rowRole(index, draftIds.length);
      const first = index === 0;
      const last = index === draftIds.length - 1;

      return `
        <div class="layer-stack-row ${role.className}" draggable="true" data-layer-stack-id="${escapeHtml(layerId)}">
          <span class="layer-stack-grip" draggable="true" title="Drag to reorder" aria-hidden="true">⠿</span>
          <span class="layer-stack-number">${index + 1}</span>
          <span class="layer-stack-name">
            <strong>${escapeHtml(layer.name || `Layer ${index + 1}`)}</strong>
            <small>${role.detail}</small>
          </span>
          <span class="layer-stack-role">${role.badge}</span>
          <span class="layer-stack-row-actions">
            <button type="button" class="icon-btn" data-layer-stack-move="back" data-layer-id="${escapeHtml(layerId)}" ${first ? 'disabled' : ''} title="Move toward BACK / BOTTOM" aria-label="Move ${escapeHtml(layer.name)} toward back">↑</button>
            <button type="button" class="icon-btn" data-layer-stack-move="front" data-layer-id="${escapeHtml(layerId)}" ${last ? 'disabled' : ''} title="Move toward FRONT / TOP" aria-label="Move ${escapeHtml(layer.name)} toward front">↓</button>
          </span>
        </div>`;
    }).join('');
  }

  function moveDraft(layerId, delta) {
    const index = draftIds.indexOf(layerId);
    if (index < 0) return;
    const next = index + delta;
    if (next < 0 || next >= draftIds.length) return;
    [draftIds[index], draftIds[next]] = [draftIds[next], draftIds[index]];
    render();
  }

  function reorderDraft(sourceId, targetId, placeAfter) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const sourceIndex = draftIds.indexOf(sourceId);
    if (sourceIndex < 0 || !draftIds.includes(targetId)) return;

    draftIds.splice(sourceIndex, 1);
    let targetIndex = draftIds.indexOf(targetId);
    if (targetIndex < 0) targetIndex = draftIds.length;
    if (placeAfter) targetIndex += 1;
    draftIds.splice(targetIndex, 0, sourceId);
    render();
  }

  function clearDragClasses() {
    const list = byId('layerStackOrderList');
    if (!list) return;
    list.querySelectorAll('.dragging,.drag-over-before,.drag-over-after').forEach(node => {
      node.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
    });
  }

  function bind() {
    const list = byId('layerStackOrderList');
    const apply = byId('applyLayerStackOrderBtn');
    const reset = byId('resetLayerStackOrderBtn');
    if (!list || !apply || !reset) return;

    list.addEventListener('click', event => {
      const move = event.target.closest('[data-layer-stack-move]');
      if (!move) return;
      moveDraft(move.dataset.layerId, move.dataset.layerStackMove === 'back' ? -1 : 1);
    });

    list.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-layer-stack-id]');
      if (!row) return;
      draggedId = row.dataset.layerStackId;
      row.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedId);
      }
    });

    list.addEventListener('dragover', event => {
      const row = event.target.closest('[data-layer-stack-id]');
      if (!row || !draggedId || row.dataset.layerStackId === draggedId) return;
      event.preventDefault();
      clearDragClasses();
      const rect = row.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      row.classList.add(after ? 'drag-over-after' : 'drag-over-before');
    });

    list.addEventListener('drop', event => {
      const row = event.target.closest('[data-layer-stack-id]');
      if (!row || !draggedId || row.dataset.layerStackId === draggedId) return;
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      const source = draggedId;
      draggedId = null;
      clearDragClasses();
      reorderDraft(source, row.dataset.layerStackId, after);
    });

    list.addEventListener('dragend', () => {
      draggedId = null;
      clearDragClasses();
    });

    reset.addEventListener('click', () => render({ resetDraft: true }));

    apply.addEventListener('click', () => {
      const api = bridge();
      if (!api?.applyLayerOrder) {
        api?.showStatus?.('Layer ordering controls are not available. Reload Studio.', 'error');
        return;
      }

      try {
        const changed = api.applyLayerOrder([...draftIds]);
        render({ resetDraft: true });
        if (!changed) api.showStatus?.('Layer order is already applied.');
      } catch (error) {
        api.showStatus?.(error.message || 'Could not apply layer order.', 'error');
      }
    });

    document.addEventListener('click', event => {
      const step = event.target.closest('.step[data-step="2"], .next-btn[data-next="2"]');
      if (step) setTimeout(() => render({ resetDraft: true }), 0);
    });

    window.addEventListener('relicforge:layer-order-changed', () => render({ resetDraft: true }));
    window.addEventListener('relicforge:studio-bridge-ready', () => render({ resetDraft: true }));

    render({ resetDraft: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
