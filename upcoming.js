(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = () => String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function dateLabel(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Start time unavailable';
    const delta = date.getTime() - Date.now();
    const prefix = delta > 0 ? 'Starts' : 'Started';
    return `${prefix} ${date.toLocaleString([], { dateStyle:'medium', timeStyle:'short' })}`;
  }

  function assetUrl(path) { return path ? `${base()}${path}` : ''; }

  async function load() {
    $('upcomingStatus').textContent = 'Loading creator-published mints…';
    $('upcomingStatus').className = 'rc47b-status';
    try {
      const response = await fetch(`${base()}/api/rc47b/upcoming`, { headers:{accept:'application/json'} });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Upcoming Mints request failed (${response.status}).`);
      const rows = payload.mints || [];
      $('upcomingStatus').textContent = rows.length ? `${rows.length} creator-published mint${rows.length === 1 ? '' : 's'} shown.` : 'No creators are showcasing an upcoming mint yet.';
      $('upcomingStatus').className = `rc47b-status${rows.length ? ' good' : ''}`;
      $('upcomingGrid').innerHTML = rows.length ? rows.map(row => `
        <a class="rc47b-mint-card" href="${esc(row.mintPage)}">
          <div class="rc47b-mint-image">${row.imagePath ? `<img src="${esc(assetUrl(row.imagePath))}" alt="${esc(row.title)}" loading="lazy"/>` : `<span>RF</span>`}</div>
          <div class="rc47b-mint-body"><div class="rc47b-kicker">CHAIN ${Number(row.chainId)}</div><h3>${esc(row.title)}</h3><div class="rc47b-mint-time">${esc(dateLabel(row.start))}</div>${row.description ? `<p>${esc(row.description)}</p>` : ''}</div>
        </a>`).join('') : '<div class="rc47b-empty" style="grid-column:1/-1">Nothing is scheduled here yet.</div>';
    } catch (error) {
      $('upcomingStatus').textContent = error.message;
      $('upcomingStatus').className = 'rc47b-status bad';
      $('upcomingGrid').innerHTML = '<div class="rc47b-empty" style="grid-column:1/-1">Upcoming Mints could not be loaded.</div>';
    }
  }

  $('upcomingRefreshBtn')?.addEventListener('click', load);
  load();
})();
