/* RelicForge: DOM controller for the standalone artwork metadata editor. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RF26OneOfOneMetadataUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const NEW = '__rf26_new_category__';
  function bind(list, options) {
    const core = options.core;
    if (!list || !core) throw new Error('Shared 1/1 metadata editor is unavailable.');
    const itemFor = target => options.getItem(target.closest('[data-oneofone-id]')?.dataset.oneofoneId);
    const rowFor = target => {
      const node = target.closest('.oneofone-metadata-row[data-meta-index]');
      const item = itemFor(target);
      const index = Number(node?.dataset.metaIndex);
      if (!item || !node || !Number.isSafeInteger(index) || index < 0 || index >= (item.metadata || []).length) return null;
      return {item, index, row: item.metadata[index], node};
    };
    function errors(item) {
      const card = [...list.querySelectorAll('[data-oneofone-id]')].find(node => node.dataset.oneofoneId === item.id);
      const host = card?.querySelector('.oneofone-meta-errors');
      if (!host) return;
      host.innerHTML = core.renderErrors(item, options.catalog());
    }
    function invalidate(item) { options.invalidate(); if (item) errors(item); }
    function create(target) {
      const found = rowFor(target);
      if (!found) return;
      const {item,index,node} = found;
      const input = node.querySelector('.oneofone-meta-new-category');
      try {
        const next = core.register(options.saved(), input?.value || '', options.layers(), options.items());
        options.setSaved(next.categories);
        item.metadata[index].traitType = next.name;
        invalidate(item);
        options.render();
        options.status(next.reused ? `Reused existing category “${next.name}”.` : `Created metadata category “${next.name}”.`, 'success');
      } catch (error) {
        options.status(error.message, 'error');
        input?.focus();
      }
    }
    function cancel(target) {
      const found = rowFor(target);
      if (!found) return;
      options.render();
    }
    list.addEventListener('input', event => {
      const target = event.target;
      const item = itemFor(target);
      if (!item) return;
      if (target.classList.contains('oneofone-name')) item.name = target.value.trim() || item.name;
      if (target.classList.contains('oneofone-token-name')) item.tokenName = target.value;
      if (target.classList.contains('oneofone-description')) item.description = target.value;
      if (target.classList.contains('oneofone-default-attribute')) item.includeDefaultAttribute = target.checked;
      const found = rowFor(target);
      if (found && target.classList.contains('oneofone-meta-value')) found.row.value = target.value;
      if (target.classList.contains('oneofone-meta-new-category') || target.classList.contains('oneofone-meta-category')) return;
      invalidate(item);
    });
    list.addEventListener('change', event => {
      const target = event.target;
      if (target.classList.contains('oneofone-meta-category')) {
        const found = rowFor(target);
        if (!found) return;
        if (target.value === NEW) {
          found.node.querySelector('.rf26-meta-create')?.classList.remove('hidden');
          found.node.querySelector('.oneofone-meta-new-category')?.focus();
          return;
        }
        found.row.traitType = target.value ? core.resolve(target.value, options.catalog()) : '';
        invalidate(found.item);
        options.render();
      } else if (target.classList.contains('oneofone-default-attribute')) {
        const item = itemFor(target);
        if (item) { item.includeDefaultAttribute = target.checked; invalidate(item); }
      }
    });
    list.addEventListener('click', event => {
      const target = event.target;
      const remove = target.closest('[data-remove-oneofone]');
      if (remove) { options.remove(remove.dataset.removeOneofone); return; }
      if (target.closest('[data-create-oneofone-category]')) { create(target); return; }
      if (target.closest('[data-cancel-oneofone-category]')) { cancel(target); return; }
      const item = itemFor(target);
      if (!item) return;
      if (target.closest('[data-add-oneofone-meta]')) {
        if (!item.metadata) item.metadata = [];
        item.metadata.push({traitType:'',value:''});
        invalidate(item); options.render(); return;
      }
      const removeMeta = target.closest('[data-remove-oneofone-meta]');
      if (removeMeta) {
        const found = rowFor(target);
        if (found) { found.item.metadata.splice(found.index,1); invalidate(item); options.render(); }
      }
    });
    list.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.classList.contains('oneofone-meta-new-category')) {
        event.preventDefault(); create(event.target);
      }
    });
    return {refreshErrors: item => errors(item)};
  }
  return Object.freeze({bind});
});
