(() => {
  'use strict';
  const host = document.getElementById('landingUpcomingCarousel');
  if (!host) return;
  const apiBase = String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let index = 0;
  let timer = null;

  async function init() {
    try {
      const response = await fetch(`${apiBase}/api/rc47b/upcoming`, { headers:{accept:'application/json'} });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Upcoming Mints unavailable.');
      const rows = (payload.mints || []).slice(0, 10);
      if (!rows.length) { host.innerHTML = '<div class="site-upcoming-empty">Nothing is scheduled for the forge yet.</div>'; return; }
      host.innerHTML = `<div class="site-upcoming-track">${rows.map(row => {
        const image = row.imagePath ? `${apiBase}${row.imagePath}` : './relic-forge-logo.svg';
        return `<a class="site-upcoming-slide" href="${esc(row.mintPage)}"><img src="${esc(image)}" alt="${esc(row.title)}" loading="lazy"/><strong>${esc(row.title)}</strong></a>`;
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
