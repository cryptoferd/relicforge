(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const state = {
    wallet: null,
    profile: null,
    publicUsername: new URLSearchParams(location.search).get('u') || null,
    selectedPfp: undefined,
    owned: [],
    ownedTestnet: [],
    showTestnets: false,
    ownProfile: false,
    usernameTimer: null,
  };

  const apiBase = () => String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const short = value => {
    const s = String(value || '');
    return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
  };

  function setStatus(message, type = '') {
    const node = $('reliquaryStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `reliquary-status ${type}`.trim();
  }

  function setEditStatus(message, type = '') {
    const node = $('reliquaryEditStatus');
    if (!node) return;
    node.textContent = message || '';
    node.className = `reliquary-field-status ${type}`.trim();
  }

  async function publicJson(path, options = {}) {
    const response = await fetch(`${apiBase()}${path}`, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.body != null ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }

  async function authJson(path, options = {}) {
    if (!state.wallet) throw new Error('Connect your wallet first.');
    await window.RelicForgeCloud.ensureSignedIn(state.wallet);
    return window.RelicForgeCloud.json(path, options, true);
  }

  function fmtNative(wei) {
    try {
      if (!window.ethers) return `${wei || 0} wei`;
      const value = Number(window.ethers.formatEther(BigInt(String(wei || 0))));
      if (!Number.isFinite(value)) return '—';
      return `${value.toLocaleString(undefined, { maximumFractionDigits: 5 })} ETH`;
    } catch {
      return '—';
    }
  }

  function fmtDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function networkInfo(value) {
    const chainId = Number(value?.chainId || 0);
    const supplied = value?.network;
    if (supplied?.label) {
      return {
        chainId,
        label: String(supplied.label),
        kind: supplied.kind === 'testnet' ? 'testnet' : 'production',
        testnet: Boolean(supplied.testnet || supplied.kind === 'testnet'),
      };
    }
    try {
      const meta = window.RelicForgeNetworks?.metadata?.(chainId);
      if (meta) return {
        chainId,
        label: meta.name || meta.shortName || `Chain ${chainId}`,
        kind: meta.testnet ? 'testnet' : 'production',
        testnet: Boolean(meta.testnet),
      };
    } catch {}
    return { chainId, label: chainId ? `Chain ${chainId}` : 'Unknown network', kind: 'production', testnet: false };
  }

  function imageFor(nft) {
    return nft?.metadata?.image || './relic-forge-logo.svg';
  }

  function formatStatValue(key, value) {
    if (key === 'firstMintAt') return fmtDate(value);
    if (key === 'nativeValueSpentWei' || key === 'platformFeesGeneratedWei') return fmtNative(value);
    if (key === 'longestCurrentHoldDays' || key === 'averageCurrentHoldDays') return `${Number(value || 0).toLocaleString()} days`;
    if (value == null) return '0';
    if (typeof value === 'number') return value.toLocaleString();
    return String(value);
  }

  function renderStats(stats = {}) {
    document.querySelectorAll('[data-stat]').forEach(node => {
      const key = node.dataset.stat;
      node.textContent = formatStatValue(key, stats[key]);
    });

    const coverage = stats.coverage;
    if ($('reliquaryCoverage')) {
      if (coverage) {
        const chains = Array.isArray(coverage.chains) ? coverage.chains.length : 0;
        $('reliquaryCoverage').textContent =
          `Coverage: ${Number(coverage.canonicalCollections || 0)} canonical collections across ${chains} chain${chains === 1 ? '' : 's'}${coverage.partialFailures ? ` · ${coverage.partialFailures} source${coverage.partialFailures === 1 ? '' : 's'} temporarily unavailable` : ''}.`;
      } else {
        $('reliquaryCoverage').textContent = 'Refresh onchain stats to build this wallet’s verified Relic Forge activity history.';
      }
    }
  }

  function renderTestnetStats(stats = {}) {
    document.querySelectorAll('[data-testnet-stat]').forEach(node => {
      const key = node.dataset.testnetStat;
      node.textContent = formatStatValue(key, stats[key]);
    });
    const coverage = stats.coverage;
    if ($('reliquaryTestnetCoverage')) {
      if (coverage) {
        const chains = Array.isArray(coverage.chains) ? coverage.chains.length : 0;
        $('reliquaryTestnetCoverage').textContent =
          `Testnet coverage: ${Number(coverage.canonicalCollections || 0)} canonical collections across ${chains} testnet chain${chains === 1 ? '' : 's'}${coverage.partialFailures ? ` · ${coverage.partialFailures} source${coverage.partialFailures === 1 ? '' : 's'} temporarily unavailable` : ''}. Excluded from production totals.`;
      } else {
        $('reliquaryTestnetCoverage').textContent = 'Testnet activity is tabulated separately and is never included in production totals.';
      }
    }
  }

  function syncTestnetVisibility() {
    $('reliquaryTestnetStatsSection')?.classList.toggle('hidden', !state.showTestnets);
    $('reliquaryTestnetShowcase')?.classList.toggle('hidden', !state.showTestnets);
    const modalOpen = !$('reliquaryModal')?.classList.contains('hidden');
    $('reliquaryTestnetPfpWrap')?.classList.toggle('hidden', !state.showTestnets || !modalOpen);
  }

  function renderProfile(profile, { own = false } = {}) {
    state.profile = profile;
    state.ownProfile = own;
    const pfpNetwork = profile?.pfp?.valid ? networkInfo(profile.pfp) : null;
    const allowPfp = profile?.pfp?.valid && (!pfpNetwork?.testnet || state.showTestnets);
    const pfpImage = allowPfp && profile.pfp.metadata?.image
      ? profile.pfp.metadata.image
      : './relic-forge-logo.svg';
    const pfp = $('reliquaryPfp');
    if (pfp) pfp.innerHTML = `<img src="${pfpImage}" alt="" />`;

    $('reliquaryUsername').textContent = profile?.username ? `@${profile.username}` : (own ? 'Claim your Reliquary' : 'Unnamed Reliquary');
    $('reliquaryWallet').textContent = profile?.wallet ? `${short(profile.wallet)} · ${profile.wallet}` : '';
    $('reliquaryBio').textContent = profile?.bio || (own
      ? 'Claim a permanent username, choose a Relic Forge NFT as your PFP, and tell the ecosystem a little about yourself.'
      : 'This wallet has not added a bio yet.');

    renderStats(profile?.stats || {});
    renderTestnetStats(profile?.stats?.testnet || {});
    syncTestnetVisibility();
    $('reliquaryEditBtn')?.classList.toggle('hidden', !own);
    $('reliquaryRefreshBtn')?.classList.toggle('hidden', !own);
    $('reliquaryShareBtn')?.classList.toggle('hidden', !profile?.username);
    $('reliquaryConnectBtn')?.classList.toggle('hidden', own && Boolean(state.wallet));

    if (own && profile?.username) {
      // Keep the signed-in Reliquary on its authenticated route. Public profile
      // links still use ?u= via Copy Profile Link, but retaining ?u here causes
      // reloads to enter the public-profile initialization path first.
      const ownUrl = new URL(location.href);
      ownUrl.searchParams.delete('u');
      history.replaceState(null, '', ownUrl.pathname + ownUrl.search + ownUrl.hash);
      state.publicUsername = profile.username;
    }
  }

  function nftCard(nft, selectable = false) {
    const meta = nft.metadata || {};
    const ownedLabel = nft.owned ? 'Owned' : 'Minted · transferred';
    const selected = state.selectedPfp &&
      Number(state.selectedPfp.chainId) === Number(nft.chainId) &&
      String(state.selectedPfp.contract).toLowerCase() === String(nft.contract).toLowerCase() &&
      String(state.selectedPfp.tokenId) === String(nft.tokenId);
    const tag = selectable ? 'button' : 'article';
    const network = networkInfo(nft);
    const networkLabel = network.testnet ? `${network.label} · Testnet` : network.label;
    return `<${tag} class="reliquary-token${selected ? ' selected' : ''}"${selectable ? ` type="button" data-pfp="${nft.chainId}:${nft.contract}:${nft.tokenId}"` : ''}>
      <div class="reliquary-token-badge${nft.owned ? '' : ' not-owned'}">${ownedLabel}</div>
      <div class="reliquary-token-network${network.testnet ? ' testnet' : ''}">${escapeHtml(networkLabel)}</div>
      <div class="reliquary-token-media"><img src="${imageFor(nft)}" alt="" /></div>
      <div class="reliquary-token-copy"><strong>${escapeHtml(meta.name || `Token #${nft.tokenId}`)}</strong><small>${escapeHtml(meta.collectionName || short(nft.contract))}</small></div>
    </${tag}>`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  async function loadShowcase({ own = false } = {}) {
    const grid = $('reliquaryNftGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="reliquary-empty">Loading minted Relics…</div>';
    try {
      const response = own
        ? await authJson('/api/reliquary/me/nfts?mode=minted&network=production&limit=48')
        : await publicJson(`/api/reliquary/u/${encodeURIComponent(state.publicUsername)}/nfts?mode=minted&network=production&limit=48`);
      const nfts = response.nfts || [];
      grid.innerHTML = nfts.length
        ? nfts.map(nft => nftCard(nft, false)).join('')
        : '<div class="reliquary-empty">No indexed Relic Forge mints yet. Refresh the onchain history after minting to populate this showcase.</div>';
    } catch (error) {
      grid.innerHTML = `<div class="reliquary-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function loadTestnetShowcase({ own = state.ownProfile } = {}) {
    const grid = $('reliquaryTestnetNftGrid');
    if (!grid || !state.showTestnets) return;
    grid.innerHTML = '<div class="reliquary-empty">Loading testnet Relics…</div>';
    try {
      const response = own
        ? await authJson('/api/reliquary/me/nfts?mode=minted&network=testnet&limit=48')
        : await publicJson(`/api/reliquary/u/${encodeURIComponent(state.publicUsername)}/nfts?mode=minted&network=testnet&limit=48`);
      const nfts = response.nfts || [];
      grid.innerHTML = nfts.length
        ? nfts.map(nft => nftCard(nft, false)).join('')
        : '<div class="reliquary-empty">No indexed testnet Relic Forge mints for this wallet.</div>';
    } catch (error) {
      grid.innerHTML = `<div class="reliquary-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function connect({ forceChooser = false } = {}) {
    if (!window.RelicForgeWallets?.requestAccount) throw new Error('Relic Forge wallet support did not load.');
    const address = await window.RelicForgeWallets.requestAccount({ forceChooser });
    state.wallet = window.ethers ? window.ethers.getAddress(address) : address;
    window.dispatchEvent(new CustomEvent('relicforge:wallet-connected', { detail: { address: state.wallet } }));
    setStatus('Sign the Relic Forge login message to open your private Reliquary settings.');
    await window.RelicForgeCloud.ensureSignedIn(state.wallet);
    await loadMe();
    return state.wallet;
  }

  async function loadMe() {
    const payload = await authJson('/api/reliquary/me');
    renderProfile(payload.profile, { own: true });
    await loadShowcase({ own: true });

    // Always run the verified activity refresh when My Reliquary opens.
    // The backend owns a short throttle window, so rapid reloads reuse the
    // recent cache instead of repeatedly rescanning every registered collection.
    setStatus('Reliquary opened. Refreshing verified onchain activity…');
    try {
      await refreshStats();
    } catch (error) {
      const refreshedAt = payload.profile?.statsRefreshedAt
        ? new Date(payload.profile.statsRefreshedAt).getTime()
        : 0;
      const cached = refreshedAt
        ? ` Cached stats from ${new Date(refreshedAt).toLocaleString()} remain visible.`
        : '';
      setStatus(`Profile loaded, but automatic onchain refresh could not finish: ${error.message}.${cached}`, 'bad');
    }
  }

  async function loadPublic(username) {
    state.publicUsername = username;
    setStatus(`Opening @${username}…`);
    const payload = await publicJson(`/api/reliquary/u/${encodeURIComponent(username)}`);
    renderProfile(payload.profile, { own: false });
    await loadShowcase({ own: false });
    setStatus(`Public Reliquary · @${payload.profile.username}`, 'good');
  }

  async function refreshStats() {
    if (!state.wallet) throw new Error('Connect the profile wallet to refresh its onchain activity.');
    const button = $('reliquaryRefreshBtn');
    if (button) button.disabled = true;
    setStatus('Scanning registered canonical Relic Forge collections and rebuilding verified activity…');
    try {
      const payload = await authJson('/api/reliquary/me/refresh', { method: 'POST', body: '{}' });
      const current = await authJson('/api/reliquary/me');
      renderProfile(current.profile, { own: true });
      await loadShowcase({ own: true });
      if (state.showTestnets) await loadTestnetShowcase({ own: true });
      const failureText = Number(payload.partialFailures || 0)
        ? ` · ${payload.partialFailures} source${payload.partialFailures === 1 ? '' : 's'} temporarily unavailable`
        : '';
      setStatus(`Onchain stats refreshed${payload.throttled ? ' from recent cache' : ''}${failureText}.`, Number(payload.partialFailures || 0) ? '' : 'good');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadOwnedForPfp() {
    const grid = $('reliquaryPfpGrid');
    grid.innerHTML = '<div class="reliquary-empty">Loading NFTs currently owned by this wallet…</div>';
    const response = await authJson('/api/reliquary/me/nfts?mode=owned&network=production&limit=80');
    state.owned = response.nfts || [];
    grid.innerHTML = state.owned.length
      ? state.owned.map(nft => nftCard(nft, true)).join('')
      : '<div class="reliquary-empty">No currently owned canonical Relic Forge NFTs are indexed yet. Refresh onchain stats first.</div>';
  }

  async function loadOwnedTestnetForPfp() {
    const wrap = $('reliquaryTestnetPfpWrap');
    const grid = $('reliquaryTestnetPfpGrid');
    if (!wrap || !grid || !state.showTestnets) return;
    wrap.classList.remove('hidden');
    grid.innerHTML = '<div class="reliquary-empty">Loading owned testnet Relics…</div>';
    const response = await authJson('/api/reliquary/me/nfts?mode=owned&network=testnet&limit=80');
    state.ownedTestnet = response.nfts || [];
    grid.innerHTML = state.ownedTestnet.length
      ? state.ownedTestnet.map(nft => nftCard(nft, true)).join('')
      : '<div class="reliquary-empty">No currently owned testnet Relic Forge NFTs are indexed.</div>';
  }

  function openEditor() {
    if (!state.profile) return;
    const profile = state.profile;
    $('reliquaryBioInput').value = profile.bio || '';
    $('reliquaryBioCount').textContent = String((profile.bio || '').length);
    setEditStatus('');

    if (profile.username) {
      $('reliquaryUsernameClaim').classList.add('hidden');
      $('reliquaryUsernameLocked').classList.remove('hidden');
      $('reliquaryUsernameLocked').innerHTML = `<strong>@${escapeHtml(profile.username)}</strong><small>Permanently claimed by this wallet.</small>`;
    } else {
      $('reliquaryUsernameClaim').classList.remove('hidden');
      $('reliquaryUsernameLocked').classList.add('hidden');
      $('reliquaryUsernameInput').value = '';
      $('reliquaryUsernameStatus').textContent = '3–24 characters · start with a letter · letters, numbers, underscore.';
      $('reliquaryUsernameStatus').className = 'reliquary-field-status';
    }

    state.selectedPfp = profile?.pfp?.valid
      ? { chainId: profile.pfp.chainId, contract: profile.pfp.contract, tokenId: profile.pfp.tokenId }
      : null;
    $('reliquaryModal').classList.remove('hidden');
    loadOwnedForPfp().catch(error => {
      $('reliquaryPfpGrid').innerHTML = `<div class="reliquary-empty">${escapeHtml(error.message)}</div>`;
    });
    if (state.showTestnets) {
      loadOwnedTestnetForPfp().catch(error => {
        $('reliquaryTestnetPfpGrid').innerHTML = `<div class="reliquary-empty">${escapeHtml(error.message)}</div>`;
      });
    }
    syncTestnetVisibility();
  }

  function closeEditor() {
    $('reliquaryModal').classList.add('hidden');
  }

  async function checkUsername() {
    const value = $('reliquaryUsernameInput').value.trim();
    const status = $('reliquaryUsernameStatus');
    if (!value) {
      status.textContent = '3–24 characters · start with a letter · letters, numbers, underscore.';
      status.className = 'reliquary-field-status';
      return;
    }
    try {
      const result = await publicJson(`/api/reliquary/username/${encodeURIComponent(value)}/available`);
      status.textContent = result.available ? `@${result.username} is available.` : `@${result.username} is not available.`;
      status.className = `reliquary-field-status ${result.available ? 'good' : 'bad'}`;
    } catch (error) {
      status.textContent = error.message;
      status.className = 'reliquary-field-status bad';
    }
  }

  async function claimUsername() {
    const value = $('reliquaryUsernameInput').value.trim();
    if (!value) throw new Error('Choose a username first.');
    const ok = window.confirm(`Claim @${value} permanently?\n\nThis username will be permanently tied to this wallet and cannot be changed later.`);
    if (!ok) return;
    const payload = await authJson('/api/reliquary/me/username', {
      method: 'POST',
      body: JSON.stringify({ username: value }),
    });
    renderProfile(payload.profile, { own: true });
    openEditor();
    setEditStatus(`@${payload.profile.username} is now permanently claimed by this wallet.`, 'good');
  }

  async function saveProfile() {
    const bio = $('reliquaryBioInput').value;
    const payload = await authJson('/api/reliquary/me', {
      method: 'PATCH',
      body: JSON.stringify({ bio, pfp: state.selectedPfp ?? null }),
    });
    renderProfile(payload.profile, { own: true });
    setEditStatus('Profile saved.', 'good');
    await loadShowcase({ own: true });
  }

  function bind() {
    $('reliquaryConnectBtn')?.addEventListener('click', () => connect({ forceChooser: true }).catch(error => setStatus(error.message, 'bad')));
    $('reliquaryRefreshBtn')?.addEventListener('click', () => refreshStats().catch(error => setStatus(error.message, 'bad')));
    $('reliquaryEditBtn')?.addEventListener('click', openEditor);
    $('reliquaryModalClose')?.addEventListener('click', closeEditor);
    $('reliquaryModal')?.addEventListener('click', event => { if (event.target === $('reliquaryModal')) closeEditor(); });
    $('reliquaryBioInput')?.addEventListener('input', event => $('reliquaryBioCount').textContent = String(event.target.value.length));
    $('reliquaryUsernameInput')?.addEventListener('input', () => {
      clearTimeout(state.usernameTimer);
      state.usernameTimer = setTimeout(checkUsername, 300);
    });
    $('reliquaryClaimUsernameBtn')?.addEventListener('click', () => claimUsername().catch(error => setEditStatus(error.message, 'bad')));
    $('reliquarySaveProfileBtn')?.addEventListener('click', () => saveProfile().catch(error => setEditStatus(error.message, 'bad')));
    $('reliquaryClearPfpBtn')?.addEventListener('click', () => {
      state.selectedPfp = null;
      document.querySelectorAll('#reliquaryPfpGrid .reliquary-token,#reliquaryTestnetPfpGrid .reliquary-token').forEach(node => node.classList.remove('selected'));
      setEditStatus('Relic Forge mark selected. Save Profile to apply.');
    });
    const selectPfp = event => {
      const card = event.target.closest('[data-pfp]');
      if (!card) return;
      const [chainId, contract, tokenId] = card.dataset.pfp.split(':');
      state.selectedPfp = { chainId: Number(chainId), contract, tokenId };
      document.querySelectorAll('#reliquaryPfpGrid .reliquary-token,#reliquaryTestnetPfpGrid .reliquary-token')
        .forEach(node => node.classList.toggle('selected', node === card));
      setEditStatus('PFP selected. Save Profile to apply.');
    };
    $('reliquaryPfpGrid')?.addEventListener('click', selectPfp);
    $('reliquaryTestnetPfpGrid')?.addEventListener('click', selectPfp);
    $('reliquaryShowTestnets')?.addEventListener('change', async event => {
      state.showTestnets = Boolean(event.target.checked);
      syncTestnetVisibility();
      if (state.profile) renderProfile(state.profile, { own: state.ownProfile });
      if (!state.showTestnets) return;
      await loadTestnetShowcase({ own: state.ownProfile });
      if (!$('reliquaryModal')?.classList.contains('hidden') && state.wallet) {
        await loadOwnedTestnetForPfp().catch(error => {
          $('reliquaryTestnetPfpGrid').innerHTML = `<div class="reliquary-empty">${escapeHtml(error.message)}</div>`;
        });
      }
    });
    $('reliquaryShareBtn')?.addEventListener('click', async () => {
      if (!state.profile?.username) return;
      const url = new URL('reliquary.html', location.href);
      url.searchParams.set('u', state.profile.username);
      try {
        await navigator.clipboard.writeText(url.href);
        setStatus('Public Reliquary link copied.', 'good');
      } catch {
        window.prompt('Copy your public Reliquary link:', url.href);
      }
    });

    window.addEventListener('relicforge:wallet-connected', event => {
      if (!state.wallet && event.detail?.address) {
        state.wallet = event.detail.address;
        loadMe().catch(() => {});
      }
    });
    window.addEventListener('relicforge:wallet-accounts-changed', event => {
      const address = event.detail?.accounts?.[0];
      if (!address) {
        state.wallet = null;
        return;
      }
      if (String(address).toLowerCase() !== String(state.wallet || '').toLowerCase()) {
        state.wallet = address;
        window.RelicForgeCloud?.clearSession?.();
        loadMe().catch(error => setStatus(error.message, 'bad'));
      }
    });
  }

  async function init() {
    bind();
    if (state.publicUsername) {
      try {
        await loadPublic(state.publicUsername);
        const session = window.RelicForgeCloud?.loadSession?.();
        if (session?.wallet && session.wallet.toLowerCase() === String(state.profile?.wallet || '').toLowerCase()) {
          state.wallet = session.wallet;
          if (window.RelicForgeCloud?.sessionIsUsable?.(session, session.wallet)) {
            // This is the signed-in user's own public URL. Re-enter the
            // authenticated load path so automatic onchain refresh runs.
            await loadMe();
          } else {
            renderProfile(state.profile, { own: true });
            setStatus('Your Reliquary is open from cached public data. Reconnect your wallet to refresh verified onchain activity.');
          }
        }
      } catch (error) {
        setStatus(error.message, 'bad');
      }
      return;
    }

    const session = window.RelicForgeCloud?.loadSession?.();
    if (session?.wallet && window.RelicForgeCloud?.sessionIsUsable?.(session, session.wallet)) {
      state.wallet = session.wallet;
      try {
        await loadMe();
        return;
      } catch {}
    }
    setStatus('Connect your wallet to open My Reliquary.');
  }

  init().catch(error => setStatus(error.message, 'bad'));
})();
