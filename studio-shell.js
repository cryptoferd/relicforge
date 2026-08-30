(() => {
  'use strict';

  const body = document.body;
  if (!body || !body.matches('.studio-page-body,.dashboard-page-body,.rc47b-page')) return;

  const current = (location.pathname.split('/').pop() || 'studio.html').toLowerCase();
  const header = document.querySelector('.topbar,.rc47b-nav');
  if (!header) return;

  const routes = [
    ['studio.html', 'Studio', 'Build and edit collections'],
    ['dashboard.html', 'Creator Dashboard', 'Manage launched collections'],
    ['collab.html', 'Collaboration', 'Shared projects and history'],
    ['upcoming.html', 'Upcoming Mints', 'Creator-published launches'],
    ['how-to.html', 'How-To', 'Relic Forge guide'],
  ];

  header.classList.add('rf-shell-header');
  const brand = header.querySelector('.brand,.rc47b-brand');
  if (brand) brand.classList.add('rf-shell-brand');

  function iconMarkup() {
    return '<span></span><span></span><span></span>';
  }

  let toggle = document.getElementById('studioMenuBtn');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'studioMenuBtn';
    toggle.innerHTML = iconMarkup();
  } else {
    const fresh = toggle.cloneNode(true);
    toggle.replaceWith(fresh);
    toggle = fresh;
    if (!toggle.querySelector('span')) toggle.innerHTML = iconMarkup();
  }
  toggle.classList.add('rf-shell-menu-btn');
  toggle.setAttribute('aria-label', 'Open Relic Forge menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'rfStudioDrawer');
  header.insertBefore(toggle, header.firstChild);

  const backdrop = document.createElement('div');
  backdrop.className = 'rf-shell-backdrop';
  backdrop.id = 'rfStudioBackdrop';
  backdrop.hidden = true;

  const drawer = document.createElement('aside');
  drawer.className = 'rf-shell-drawer';
  drawer.id = 'rfStudioDrawer';
  drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = `
    <div class="rf-shell-drawer-head">
      <a class="rf-shell-drawer-brand" href="./studio.html">
        <img src="./relic-forge-logo.svg" alt="" />
        <div><strong>RELIC FORGE</strong><span>Studio Menu</span></div>
      </a>
      <button class="rf-shell-close" id="rfStudioClose" type="button" aria-label="Close menu">×</button>
    </div>
    <nav class="rf-shell-nav" aria-label="Relic Forge Studio navigation">
      ${routes.map(([href, label, note]) => {
        const active = current === href;
        return `<a href="./${href}"${active ? ' class="active" aria-current="page"' : ''}><strong>${label}</strong><span>${note}</span></a>`;
      }).join('')}
    </nav>
    <div class="rf-shell-context" id="rfStudioContext"></div>
    <div class="rf-shell-drawer-foot"><a href="./index.html">Exit to Relic Forge Home</a></div>`;

  body.append(backdrop, drawer);
  const context = drawer.querySelector('#rfStudioContext');

  const projectActions = document.getElementById('studioProjectActions');
  if (projectActions) {
    projectActions.classList.add('rf-shell-action-stack');
    projectActions.querySelector('.studio-dashboard-link')?.remove();
    const section = document.createElement('section');
    section.className = 'rf-shell-section';
    section.innerHTML = '<div class="rf-shell-section-title">Project</div>';
    section.appendChild(projectActions);
    context.appendChild(section);
    const emptyShell = document.querySelector('.studio-action-shell');
    if (emptyShell && !emptyShell.children.length) emptyShell.remove();
  }

  const dashboardActions = document.querySelector('.dashboard-nav-actions');
  if (dashboardActions) {
    const buttons = ['launchedConnectBtn','launchedChangeWalletBtn','launchedDisconnectBtn']
      .map(id => document.getElementById(id)).filter(Boolean);
    if (buttons.length) {
      const section = document.createElement('section');
      section.className = 'rf-shell-section';
      section.innerHTML = '<div class="rf-shell-section-title">Creator Wallet</div>';
      const stack = document.createElement('div');
      stack.className = 'rf-shell-action-stack';
      buttons.forEach(button => stack.appendChild(button));
      section.appendChild(stack);
      context.appendChild(section);
    }
    dashboardActions.remove();
  }

  document.querySelector('.rc47b-nav-links')?.remove();

  function open() {
    backdrop.hidden = false;
    requestAnimationFrame(() => body.classList.add('rf-shell-open'));
    toggle.setAttribute('aria-expanded', 'true');
    drawer.setAttribute('aria-hidden', 'false');
    drawer.querySelector('a,button')?.focus({ preventScroll: true });
  }

  function close({ returnFocus = false } = {}) {
    body.classList.remove('rf-shell-open');
    toggle.setAttribute('aria-expanded', 'false');
    drawer.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => { if (!body.classList.contains('rf-shell-open')) backdrop.hidden = true; }, 220);
    if (returnFocus) toggle.focus({ preventScroll: true });
  }

  toggle.addEventListener('click', () => body.classList.contains('rf-shell-open') ? close({ returnFocus: true }) : open());
  drawer.querySelector('#rfStudioClose')?.addEventListener('click', () => close({ returnFocus: true }));
  backdrop.addEventListener('click', () => close({ returnFocus: true }));
  drawer.querySelectorAll('a').forEach(link => link.addEventListener('click', () => close()));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && body.classList.contains('rf-shell-open')) close({ returnFocus: true });
  });

  body.classList.add('rf-shell-ready');
})();
