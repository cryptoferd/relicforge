/* RelicForge Studio: shared 1/1 metadata categories. No blockchain dependencies. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RF26OneOfOneMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_NAME = 80;
  const MAX_VALUE = 120;
  function label(value) { return String(value == null ? '' : value).normalize('NFKC').trim().replace(/\s+/gu, ' '); }
  function key(value) { return label(value).toLowerCase(); }
  function add(map, value) {
    const name = label(value);
    if (name && !map.has(key(name))) map.set(key(name), name);
  }
  function catalog(layers = [], oneOfOnes = [], saved = []) {
    const names = new Map();
    for (const layer of layers || []) if (layer && !layer.metadataHidden) add(names, layer.name);
    for (const name of saved || []) add(names, typeof name === 'string' ? name : name && name.name);
    for (const item of oneOfOnes || []) for (const row of item.metadata || []) add(names, row.traitType);
    return [...names.values()];
  }
  function resolve(value, names) {
    const wanted = key(value);
    return (names || []).find(name => key(name) === wanted) || label(value);
  }
  function register(saved, value, layers = [], oneOfOnes = []) {
    const name = label(value);
    if (!name || name.length > MAX_NAME) throw new Error('Category names must be 1–80 characters.');
    if (name === '__rf26_new_category__') throw new Error('This category name is reserved.');
    const names = catalog(layers, oneOfOnes, saved);
    const remembered = catalog([], oneOfOnes, saved);
    const existing = names.find(item => key(item) === key(name));
    if (existing) return {name: existing, reused: true, categories: remembered};
    return {name, reused: false, categories: [...remembered, name]};
  }
  function draftRows(rows, names) {
    return (rows || []).map(row => ({...row, traitType: resolve(row.traitType || '', names), value: String(row.value == null ? '' : row.value)}));
  }
  function validateRows(rows, names, defaultAttribute = null) {
    const errors = [], seen = new Map();
    function check(row, index, implicit = false) {
      const type = resolve(row.traitType || '', names);
      const value = String(row.value == null ? '' : row.value).trim();
      if (!type && !value) return;
      if (!type || !value) { errors.push({index, message: 'Enter both a category and a value, or remove the unfinished field.'}); return; }
      if (type.length > MAX_NAME || value.length > MAX_VALUE) { errors.push({index, message: 'Category or value exceeds its length limit.'}); return; }
      const pair = JSON.stringify([key(type), key(value)]);
      if (seen.has(pair)) errors.push({index, message: implicit ? 'The default 1/1 attribute duplicates a custom field.' : 'This category/value pair already exists on this 1/1.'});
      else seen.set(pair, index);
    }
    (rows || []).forEach((row, index) => check(row, index));
    if (defaultAttribute) check(defaultAttribute, -1, true);
    return errors;
  }
  function serializeRows(rows, names, defaultAttribute = null) {
    const errors = validateRows(rows, names, defaultAttribute);
    if (errors.length) throw new Error(errors.map(error => `Metadata field ${error.index + 1}: ${error.message}`).join(' '));
    return draftRows(rows, names).filter(row => label(row.traitType) && String(row.value).trim()).map(row => ({traitType: row.traitType, value: row.value.trim()}));
  }
  function validateProject(layers, oneOfOnes, saved) {
    const names = catalog(layers, oneOfOnes, saved), errors = [];
    for (const item of oneOfOnes || []) {
      const implicit = item.includeDefaultAttribute !== false ? {traitType: '1/1', value: item.name || ''} : null;
      for (const error of validateRows(item.metadata, names, implicit)) errors.push({oneOfOneId: item.id, name: item.name, ...error});
    }
    return errors;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function renderErrors(item, names) {
    const implicit = item.includeDefaultAttribute !== false ? {traitType:'1/1',value:item.name || ''} : null;
    return validateRows(item.metadata, names, implicit).map(error => `<span data-meta-error="${error.index}">${escapeHtml(error.message)}</span>`).join('');
  }
  function renderRows(item, names) {
    return (item.metadata || []).map((row, index) => {
      const selected = resolve(row.traitType || '', names);
      return `<div class="oneofone-metadata-row" data-meta-index="${index}">
        <div class="rf26-meta-category-field">
          <select class="oneofone-meta-category" aria-label="Metadata category" data-meta-index="${index}">
            <option value="" ${!selected ? 'selected' : ''}>Choose category</option>
            ${names.map(name => `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
            <option value="__rf26_new_category__">+ Create New Category</option>
          </select>
          <div class="rf26-meta-create hidden">
            <input class="oneofone-meta-new-category" maxlength="80" placeholder="New category name" aria-label="New metadata category name"/>
            <button class="ghost-btn small-btn" type="button" data-create-oneofone-category="${index}">Create</button>
            <button class="ghost-btn small-btn" type="button" data-cancel-oneofone-category="${index}">Cancel</button>
          </div>
        </div>
        <input class="oneofone-meta-value" value="${escapeHtml(row.value || '')}" maxlength="120" placeholder="Value" aria-label="Metadata value"/>
        <button type="button" class="icon-btn" data-remove-oneofone-meta="${index}" title="Remove metadata field">×</button>
      </div>`;
    }).join('');
  }
  return Object.freeze({label, key, catalog, resolve, register, draftRows, validateRows, serializeRows, validateProject, escapeHtml, renderRows, renderErrors});
});
