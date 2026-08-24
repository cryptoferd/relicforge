(() => {
  'use strict';

  const STORAGE_KEY = 'relicforge_wallet_provider_v1';
  const DISCOVERY_MS = 220;
  const entries = [];
  let selected = null;
  let readyPromise = null;
  let chooserFlight = null;
  let selectedHandlers = null;

  function unsupportedPermission(error) {
    return [-32601, 4200, -32004].includes(Number(error?.code));
  }

  function legacyInfo(provider) {
    let name = 'Browser Wallet';
    let rdns = 'legacy.browser.wallet';
    if (provider?.isRabby) { name = 'Rabby Wallet'; rdns = 'io.rabby'; }
    else if (provider?.isCoinbaseWallet) { name = 'Coinbase Wallet'; rdns = 'com.coinbase.wallet'; }
    else if (provider?.isBraveWallet) { name = 'Brave Wallet'; rdns = 'com.brave.wallet'; }
    else if (provider?.isPhantom) { name = 'Phantom'; rdns = 'app.phantom'; }
    else if (provider?.isTrust || provider?.isTrustWallet) { name = 'Trust Wallet'; rdns = 'com.trustwallet'; }
    else if (provider?.isOkxWallet || provider?.isOKExWallet) { name = 'OKX Wallet'; rdns = 'com.okex.wallet'; }
    else if (provider?.isZerion) { name = 'Zerion'; rdns = 'io.zerion.wallet'; }
    else if (provider?.isRainbow) { name = 'Rainbow'; rdns = 'me.rainbow'; }
    else if (provider?.isFrame) { name = 'Frame'; rdns = 'sh.frame'; }
    else if (provider?.isMetaMask) { name = 'MetaMask'; rdns = 'io.metamask'; }
    return { uuid: `legacy-${rdns}`, name, icon: '', rdns };
  }

  function normalizedInfo(info, provider) {
    const fallback = legacyInfo(provider);
    return {
      uuid: String(info?.uuid || fallback.uuid || ''),
      name: String(info?.name || fallback.name || 'Browser Wallet'),
      icon: String(info?.icon || ''),
      rdns: String(info?.rdns || fallback.rdns || '')
    };
  }

  function entryKey(info) {
    if (info.rdns) return `rdns:${info.rdns.toLowerCase()}`;
    if (info.uuid) return `uuid:${info.uuid.toLowerCase()}`;
    return `name:${info.name.toLowerCase()}`;
  }

  function register(provider, info = null) {
    if (!provider?.request) return null;
    const normalized = normalizedInfo(info, provider);
    let existing = entries.find(item => item.provider === provider);
    if (!existing && normalized.rdns && normalized.rdns !== 'legacy.browser.wallet') {
      existing = entries.find(item => item.info.rdns && item.info.rdns.toLowerCase() === normalized.rdns.toLowerCase());
    }
    if (existing) {
      if (info) {
        const providerChanged = existing.provider !== provider;
        existing.provider = provider;
        existing.info = normalized;
        existing.key = entryKey(existing.info);
        if (providerChanged && selected === existing) attachSelectedListeners(existing);
      }
      return existing;
    }
    const entry = { provider, info: normalized, key: entryKey(normalized) };
    entries.push(entry);
    return entry;
  }

  function storedPreference() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  }

  function savePreference(entry) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        key: entry.key,
        rdns: entry.info.rdns || null,
        name: entry.info.name || null
      }));
    } catch {}
  }

  function clearPreference() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function detachSelectedListeners() {
    if (!selectedHandlers) return;
    const { provider, accountsChanged, chainChanged } = selectedHandlers;
    try { provider.removeListener?.('accountsChanged', accountsChanged); } catch {}
    try { provider.removeListener?.('chainChanged', chainChanged); } catch {}
    selectedHandlers = null;
  }

  function attachSelectedListeners(entry) {
    detachSelectedListeners();
    if (!entry?.provider?.on) return;
    const accountsChanged = accounts => {
      window.dispatchEvent(new CustomEvent('relicforge:wallet-accounts-changed', {
        detail: { accounts: Array.isArray(accounts) ? accounts : [], provider: entry.provider, info: entry.info }
      }));
    };
    const chainChanged = chainId => {
      window.dispatchEvent(new CustomEvent('relicforge:wallet-chain-changed', {
        detail: { chainId, provider: entry.provider, info: entry.info }
      }));
    };
    entry.provider.on('accountsChanged', accountsChanged);
    entry.provider.on('chainChanged', chainChanged);
    selectedHandlers = { provider: entry.provider, accountsChanged, chainChanged };
  }

  function selectEntry(entry, { persist = true } = {}) {
    if (!entry) return null;
    const changed = selected?.provider !== entry.provider;
    selected = entry;
    attachSelectedListeners(entry);
    if (persist) savePreference(entry);
    if (changed) {
      window.dispatchEvent(new CustomEvent('relicforge:wallet-provider-changed', {
        detail: { provider: entry.provider, info: entry.info }
      }));
    }
    return entry;
  }

  function restorePreferredSelection() {
    if (selected) return selected;
    const pref = storedPreference();
    if (pref) {
      const match = entries.find(entry =>
        (pref.rdns && entry.info.rdns && pref.rdns.toLowerCase() === entry.info.rdns.toLowerCase()) ||
        (pref.key && pref.key === entry.key) ||
        (pref.name && pref.name === entry.info.name)
      );
      if (match) return selectEntry(match, { persist: false });
    }
    if (entries.length === 1) return selectEntry(entries[0], { persist: false });
    return null;
  }

  function beginDiscovery() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise(resolve => {
      const onAnnounce = event => {
        const detail = event?.detail;
        if (detail?.provider) register(detail.provider, detail.info);
      };
      window.addEventListener('eip6963:announceProvider', onAnnounce);

      const legacyProviders = Array.isArray(window.ethereum?.providers) && window.ethereum.providers.length
        ? window.ethereum.providers
        : (window.ethereum ? [window.ethereum] : []);
      legacyProviders.forEach(provider => register(provider));

      try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {}

      window.setTimeout(() => {
        restorePreferredSelection();
        resolve(entries.slice());
      }, DISCOVERY_MS);
    });
    return readyPromise;
  }

  function ensureChooserUi() {
    let overlay = document.getElementById('rfWalletChooser');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'rfWalletChooser';
    overlay.className = 'rf-wallet-chooser hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'rfWalletChooserTitle');
    overlay.innerHTML = `
      <div class="rf-wallet-chooser-panel" role="document">
        <div class="rf-wallet-chooser-head">
          <div>
            <div class="rf-wallet-chooser-kicker">RELIC FORGE</div>
            <h2 id="rfWalletChooserTitle">Choose a wallet</h2>
            <p>Select which installed wallet Relic Forge should use.</p>
          </div>
          <button type="button" class="rf-wallet-chooser-close" aria-label="Close wallet chooser">×</button>
        </div>
        <div class="rf-wallet-chooser-list"></div>
        <div class="rf-wallet-chooser-note">Relic Forge stays connected to the wallet provider you choose until you disconnect or choose another wallet.</div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function showChooser(list) {
    if (chooserFlight) return chooserFlight;
    chooserFlight = new Promise((resolve, reject) => {
      const overlay = ensureChooserUi();
      const listNode = overlay.querySelector('.rf-wallet-chooser-list');
      const closeBtn = overlay.querySelector('.rf-wallet-chooser-close');
      listNode.innerHTML = '';

      const cleanup = () => {
        overlay.classList.add('hidden');
        overlay.removeEventListener('click', onBackdrop);
        closeBtn.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        chooserFlight = null;
      };
      const onCancel = () => { cleanup(); reject(Object.assign(new Error('Wallet selection cancelled.'), { code: 4001 })); };
      const onBackdrop = event => { if (event.target === overlay) onCancel(); };
      const onKey = event => { if (event.key === 'Escape') onCancel(); };

      list.forEach(entry => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rf-wallet-choice';
        if (selected?.provider === entry.provider) button.classList.add('is-current');

        const iconWrap = document.createElement('span');
        iconWrap.className = 'rf-wallet-choice-icon';
        if (/^data:image\//i.test(entry.info.icon)) {
          const img = document.createElement('img');
          img.src = entry.info.icon;
          img.alt = '';
          iconWrap.appendChild(img);
        } else {
          iconWrap.textContent = String(entry.info.name || 'W').slice(0, 1).toUpperCase();
        }

        const text = document.createElement('span');
        text.className = 'rf-wallet-choice-text';
        const name = document.createElement('strong');
        name.textContent = entry.info.name || 'Browser Wallet';
        const detail = document.createElement('small');
        detail.textContent = selected?.provider === entry.provider
          ? 'Currently selected'
          : (entry.info.rdns || 'Installed browser wallet');
        text.append(name, detail);

        const arrow = document.createElement('span');
        arrow.className = 'rf-wallet-choice-arrow';
        arrow.textContent = '→';
        button.append(iconWrap, text, arrow);
        button.addEventListener('click', () => {
          selectEntry(entry);
          cleanup();
          resolve(entry);
        });
        listNode.appendChild(button);
      });

      overlay.addEventListener('click', onBackdrop);
      closeBtn.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
      overlay.classList.remove('hidden');
    });
    return chooserFlight;
  }

  async function chooseProvider({ force = false } = {}) {
    await beginDiscovery();
    restorePreferredSelection();
    if (!entries.length) throw new Error('No injected EVM wallet found. Install a wallet extension and reload.');
    if (!force && selected) return selected;
    if (entries.length === 1) return selectEntry(entries[0]);
    return showChooser(entries.slice());
  }

  async function requestAccount({ forceChooser = false } = {}) {
    await beginDiscovery();
    const before = selected;
    const entry = await chooseProvider({ force: forceChooser && entries.length > 1 });
    const provider = entry.provider;

    // If the user deliberately chooses the already-selected extension while changing
    // wallets, ask that extension for a fresh account permission screen when supported.
    if (forceChooser && before?.provider === provider) {
      let revoked = false;
      try {
        await provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
        revoked = true;
      } catch (error) {
        if (Number(error?.code) === 4001) throw error;
        if (!unsupportedPermission(error)) console.debug('Wallet permission revoke unavailable:', error);
      }
      try {
        await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
      } catch (error) {
        if (Number(error?.code) === 4001) throw error;
        if (!unsupportedPermission(error) && !revoked) console.debug('Wallet account chooser unavailable:', error);
      }
    }

    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error(`${entry.info.name || 'Wallet'} did not return an account.`);
    return accounts[0];
  }

  async function disconnect({ revoke = true, clearSelection = true } = {}) {
    await beginDiscovery();
    const entry = selected;
    if (entry?.provider && revoke) {
      try {
        await entry.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
      } catch (error) {
        if (!unsupportedPermission(error) && Number(error?.code) !== 4001) console.debug('Wallet provider does not support permission revocation:', error);
      }
    }
    if (clearSelection) {
      detachSelectedListeners();
      selected = null;
      clearPreference();
      window.dispatchEvent(new CustomEvent('relicforge:wallet-provider-changed', { detail: { provider: null, info: null } }));
    }
  }

  async function getProviderAsync({ allowChooser = false } = {}) {
    await beginDiscovery();
    restorePreferredSelection();
    if (!selected && allowChooser) await chooseProvider();
    return selected?.provider || null;
  }

  function getProvider() { return selected?.provider || null; }
  function getInfo() { return selected?.info || null; }
  async function list() { await beginDiscovery(); return entries.map(({ info }) => ({ ...info })); }

  window.RelicForgeWallets = {
    version: '11.1.5',
    ready: beginDiscovery,
    list,
    chooseProvider,
    requestAccount,
    disconnect,
    getProvider,
    getProviderAsync,
    getInfo,
    hasSelectedProvider: () => !!selected
  };

  // Start discovery early so EIP-6963 providers are known before the user clicks Connect.
  beginDiscovery().catch(() => {});
})();
