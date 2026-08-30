(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = () => String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let rows = [];
  let timer = null;

  function dateParts(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return { date:'Unavailable', time:'Unavailable' };
    return {
      date: date.toLocaleDateString([], { year:'numeric', month:'long', day:'numeric' }),
      time: new Intl.DateTimeFormat(undefined, { hour:'numeric', minute:'2-digit', timeZoneName:'short' }).format(date),
    };
  }

  function countdown(value) {
    const ms = new Date(value).getTime() - Date.now();
    if (!Number.isFinite(ms)) return '';
    if (ms <= 0) return 'Mint has started';
    let seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400); seconds %= 86400;
    const hours = Math.floor(seconds / 3600); seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    if (days) return `Starts in ${days}d ${hours}h ${minutes}m`;
    if (hours) return `Starts in ${hours}h ${minutes}m`;
    return `Starts in ${minutes}m`;
  }

  function formatWei(value) {
    try {
      if (value == null || value === '') return 'Unavailable';
      const wei = BigInt(value);
      if (wei === 0n) return 'FREE';
      const unit = 1000000000000000000n;
      const whole = wei / unit;
      const fraction = String(wei % unit).padStart(18, '0').slice(0, 6).replace(/0+$/, '');
      return `${whole}${fraction ? `.${fraction}` : ''} ETH`;
    } catch (_) { return 'Unavailable'; }
  }

  function sizeLabel(value) {
    const size = Number(value);
    return Number.isSafeInteger(size) && size >= 0 ? `${size.toLocaleString()} items` : 'Unavailable';
  }

  function assetUrl(path) { return path ? `${base()}${path}` : ''; }

  function render() {
    const grid = $('upcomingGrid');
    if (!grid) return;
    grid.innerHTML = rows.length ? rows.map(row => {
      const when = dateParts(row.start);
      return `
        <a class="rc47b-mint-card" href="${esc(row.mintPage)}">
          <div class="rc47b-mint-image">${row.imagePath ? `<img src="${esc(assetUrl(row.imagePath))}" alt="${esc(row.title)}" loading="lazy"/>` : '<span>RF</span>'}</div>
          <div class="rc47b-mint-body">
            <div class="rc47b-kicker">${esc(window.RelicForgeNetworks?.label?.(row.chainId) || `Chain ${Number(row.chainId)}`)}</div>
            <h3>${esc(row.title)}</h3>
            <div class="rc47d-upcoming-meta">
              <div><span>MINT DATE</span><b>${esc(when.date)}</b></div>
              <div><span>MINT TIME</span><b>${esc(when.time)}</b></div>
              <div><span>MINT COST</span><b>${esc(formatWei(row.mintCostWei))}</b></div>
              <div><span>COLLECTION SIZE</span><b>${esc(sizeLabel(row.maxSupply))}</b></div>
            </div>
            <div class="rc47c-upcoming-countdown" data-upcoming-start="${esc(row.start)}">${esc(countdown(row.start))}</div>
            ${row.description ? `<p>${esc(row.description)}</p>` : ''}
          </div>
        </a>`;
    }).join('') : '<div class="rc47b-empty" style="grid-column:1/-1">Nothing is scheduled here yet.</div>';
  }

  function tick() {
    document.querySelectorAll('[data-upcoming-start]').forEach(node => {
      node.textContent = countdown(node.dataset.upcomingStart);
    });
  }

  async function load() {
    $('upcomingStatus').textContent = 'Loading creator-published mints…';
    $('upcomingStatus').className = 'rc47b-status';
    try {
      const response = await fetch(`${base()}/api/rc47b/upcoming`, { headers:{accept:'application/json'}, cache:'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Upcoming Mints request failed (${response.status}).`);
      rows = (payload.mints || []).filter(row => { const network = window.RelicForgeNetworks?.get?.(row.chainId); return !!network && (network.production || window.RelicForgeNetworks?.qaMode); });
      $('upcomingStatus').textContent = rows.length ? `${rows.length} creator-published mint${rows.length === 1 ? '' : 's'} shown.` : 'No creators are showcasing an upcoming mint yet.';
      $('upcomingStatus').className = `rc47b-status${rows.length ? ' good' : ''}`;
      render();
      clearInterval(timer);
      timer = setInterval(tick, 30000);
    } catch (error) {
      rows = [];
      $('upcomingStatus').textContent = error.message;
      $('upcomingStatus').className = 'rc47b-status bad';
      $('upcomingGrid').innerHTML = '<div class="rc47b-empty" style="grid-column:1/-1">Upcoming Mints could not be loaded.</div>';
    }
  }

  $('upcomingRefreshBtn')?.addEventListener('click', load);
  load();
})();
