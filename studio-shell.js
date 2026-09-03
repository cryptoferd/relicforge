(() => {
  'use strict';

  const body = document.body;
  if (!body || !body.matches('.studio-page-body,.dashboard-page-body,.rc47b-page')) return;

  const current = (location.pathname.split('/').pop() || 'studio.html').toLowerCase();
  const header = document.querySelector('.topbar,.rc47b-nav');
  if (!header) return;

  const routes = [
    ['studio.html', 'Studio', 'Build and edit collections'],
    ['reliquary.html', 'My Reliquary', 'Profile, stats and NFT showcase'],
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

  function shortAddress(address) {
    const value = String(address || '');
    return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
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
        <div><strong>RELIC FORGE</strong><span>Platform Menu</span></div>
      </a>
      <button class="rf-shell-close" id="rfStudioClose" type="button" aria-label="Close menu">×</button>
    </div>
    <section class="rf-shell-wallet-slot" aria-label="Connected wallet">
      <div class="rf-shell-section-title">Wallet</div>
      <div class="rf-shell-wallet-mount" id="rfShellWalletMount"></div>
    </section>
    <nav class="rf-shell-nav" aria-label="Relic Forge navigation">
      ${routes.map(([href, label, note]) => {
        const active = current === href;
        return `<a href="./${href}"${active ? ' class="active" aria-current="page"' : ''}><strong>${label}</strong><span>${note}</span></a>`;
      }).join('')}
    </nav>
    <div class="rf-shell-context" id="rfStudioContext"></div>
    <div class="rf-shell-drawer-foot"><a href="./index.html">Exit to Relic Forge Home</a></div>`;

  body.append(backdrop, drawer);
  const context = drawer.querySelector('#rfStudioContext');
  const walletMount = drawer.querySelector('#rfShellWalletMount');

  const projectActions = document.getElementById('studioProjectActions');
  if (projectActions) {
    projectActions.classList.add('rf-shell-action-stack');
    projectActions.querySelector('.studio-dashboard-link')?.remove();

    const studioWallet = projectActions.querySelector('.wallet-session-control');
    if (studioWallet) walletMount.appendChild(studioWallet);

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
      const stack = document.createElement('div');
      stack.className = 'rf-shell-action-stack rf-shell-wallet-native-actions';
      buttons.forEach(button => stack.appendChild(button));
      walletMount.appendChild(stack);
    }
    dashboardActions.remove();
  }

  async function genericProvider() {
    if (window.RelicForgeWallets?.getProviderAsync) {
      return window.RelicForgeWallets.getProviderAsync({ allowChooser: false });
    }
    return window.ethereum || null;
  }

  async function readGenericAccount() {
    try {
      const provider = await genericProvider();
      if (!provider?.request) return null;
      const accounts = await provider.request({ method: 'eth_accounts' });
      return accounts?.[0] || null;
    } catch {
      return null;
    }
  }

  function setGenericWalletState(button, address) {
    button.dataset.wallet = address || '';
    button.innerHTML = address
      ? `<span class="rf-shell-wallet-dot"></span><span><strong>${shortAddress(address)}</strong><small>Connected · open My Reliquary</small></span>`
      : `<span class="rf-shell-wallet-dot"></span><span><strong>Connect Wallet</strong><small>Connect to open your Reliquary</small></span>`;
    button.classList.toggle('connected', Boolean(address));
  }

  async function installGenericWallet() {
    if (walletMount.children.length) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rf-shell-generic-wallet';
    setGenericWalletState(button, await readGenericAccount());
    button.addEventListener('click', async () => {
      try {
        let address;
        if (window.RelicForgeWallets?.requestAccount) {
          address = await window.RelicForgeWallets.requestAccount({ forceChooser: true });
        } else {
          const provider = window.ethereum;
          if (!provider?.request) throw new Error('No EVM wallet provider found.');
          address = (await provider.request({ method: 'eth_requestAccounts' }))?.[0];
        }
        if (!address) return;
        setGenericWalletState(button, address);
        window.dispatchEvent(new CustomEvent('relicforge:wallet-connected', { detail: { address } }));
      } catch (error) {
        button.title = error.message || 'Wallet connection was not completed.';
      }
    });
    walletMount.appendChild(button);

    const sync = async () => setGenericWalletState(button, await readGenericAccount());
    window.addEventListener('relicforge:wallet-connected', event => setGenericWalletState(button, event.detail?.address || null));
    window.addEventListener('relicforge:wallet-disconnected', () => setGenericWalletState(button, null));
    window.addEventListener('relicforge:wallet-accounts-changed', sync);
    window.addEventListener('relicforge:wallet-provider-changed', sync);
  }

  installGenericWallet().catch(() => {});

  document.querySelector('.rc47b-nav-links')?.remove();

  function open() {
    backdrop.hidden = false;
    requestAnimationFrame(() => body.classList.add('rf-shell-open'));
    toggle.setAttribute('aria-expanded', 'true');
    drawer.setAttribute('aria-hidden', 'false');
    drawer.querySelector('#rfStudioClose')?.focus({ preventScroll: true });
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
