(() => {
  'use strict';
  const host = document.getElementById('landingUpcomingCarousel');
  if (!host) return;
  const apiBase = String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let index = 0;
  let timer = null;

  function dateParts(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return { date:'Unavailable', time:'Unavailable' };
    return {
      date: date.toLocaleDateString([], { year:'numeric', month:'short', day:'numeric' }),
      time: new Intl.DateTimeFormat(undefined, { hour:'numeric', minute:'2-digit', timeZoneName:'short' }).format(date),
    };
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

  async function init() {
    try {
      const response = await fetch(`${apiBase}/api/rc47b/upcoming`, { headers:{accept:'application/json'}, cache:'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Upcoming Mints unavailable.');
      const rows = (payload.mints || []).slice(0, 10);
      if (!rows.length) { host.innerHTML = '<div class="site-upcoming-empty">Nothing is scheduled for the forge yet.</div>'; return; }
      host.innerHTML = `<div class="site-upcoming-track">${rows.map(row => {
        const image = row.imagePath ? `${apiBase}${row.imagePath}` : './relic-forge-logo.svg';
        const when = dateParts(row.start);
        return `<a class="site-upcoming-slide" href="${esc(row.mintPage)}">
          <img src="${esc(image)}" alt="${esc(row.title)}" loading="lazy"/>
          <div class="site-upcoming-copy">
            <strong>${esc(row.title)}</strong>
            <div class="site-upcoming-meta">
              <div><span>MINT DATE</span><b>${esc(when.date)}</b></div>
              <div><span>MINT TIME</span><b>${esc(when.time)}</b></div>
              <div><span>MINT COST</span><b>${esc(formatWei(row.mintCostWei))}</b></div>
              <div><span>COLLECTION SIZE</span><b>${esc(sizeLabel(row.maxSupply))}</b></div>
            </div>
          </div>
        </a>`;
      }).join('')}</div><div class="site-upcoming-dots">${rows.map((_,i) => `<button type="button" data-slide="${i}" aria-label="Show mint ${i+1}"${i===0?' class="active"':''}></button>`).join('')}</div>`;
      const track = host.querySelector('.site-upcoming-track');
      const dots = [...host.querySelectorAll('[data-slide]')];
      const show = next => {
        index = (Number(next) + rows.length) % rows.length;
        track.style.transform = `translateX(-${index * 100}%)`;
        dots.forEach((dot,i) => dot.classList.toggle('active', i === index));
      };
      dots.forEach(dot => dot.addEventListener('click', () => { show(dot.dataset.slide); restart(); }));
      function restart() { clearInterval(timer); if (rows.length > 1) timer = setInterval(() => show(index + 1), 6000); }
      restart();
    } catch (error) {
      host.innerHTML = '<div class="site-upcoming-empty">Upcoming Mints are temporarily unavailable.</div>';
    }
  }
  init();
})();
