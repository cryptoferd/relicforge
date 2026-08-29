(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const CHAIN_ID = 11155111;
  const FEE_MODE_SPONSORED = 1;
  const FEE_MODE_MINTER_SUPPORTED = 2;

  const COLLECTION_FEE_ABI = [
    'function name() view returns(string)',
    'function symbol() view returns(string)',
    'function creator() view returns(address)',
    'function factory() view returns(address)',
    'function feePolicy() view returns(address)',
    'function platformFeeMode() view returns(uint8)',
    'function lockedPlatformFeeCents() view returns(uint32)',
    'function maxSupply() view returns(uint32)',
    'function totalMinted() view returns(uint32)'
  ];

  const FEE_POLICY_ABI = [
    'function platformAdmin() view returns(address)',
    'function treasury() view returns(address)',
    'function sponsoredFeeCents() view returns(uint32)',
    'function minterFeeCents() view returns(uint32)',
    'function MAX_DEFAULT_FEE_CENTS() view returns(uint32)',
    'function MAX_COLLECTION_FEE_CENTS() view returns(uint32)',
    'function accruedFees() view returns(uint256)',
    'function collectionFeesEnabled(address collection) view returns(bool)',
    'function collectionFeeWaived(address collection) view returns(bool)',
    'function collectionFeeOverrideSet(address collection) view returns(bool)',
    'function currentCollectionFeeCents(address collection,uint32 lockedFeeCents) view returns(uint32)',
    'function setCollectionFeesEnabled(address collection,bool enabled)',
    'function setCollectionFeeCents(address collection,uint32 feeCents)',
    'function clearCollectionFeeOverride(address collection)',
    'function waiveCollection(address collection)',
    'function setDefaultFeeCents(uint32 sponsoredCents,uint32 minterCents)',
    'function setTreasury(address treasury)',
    'function withdrawFees()'
  ];

  let founderIdentity = null;
  let supportState = null;
  let originalAssetMarkers = new WeakMap();
  let founderAssetCache = new Map();
  let feeCollectionState = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function shortAddress(value) {
    const text = String(value || '');
    return text.length > 14 ? `${text.slice(0, 8)}...${text.slice(-6)}` : (text || '-');
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function dollars(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function parseDollarInput(id, capCents) {
    const raw = Number($(id)?.value || 0);
    if (!Number.isFinite(raw) || raw < 0) throw new Error('Fee must be a valid non-negative dollar amount.');
    const cents = Math.round(raw * 100);
    if (cents > Number(capCents)) throw new Error(`V1 fee ceiling is ${dollars(capCents)}.`);
    return cents;
  }

  function cloud() {
    if (!window.RelicForgeCloud?.enabled?.()) throw new Error('RelicForge Cloud is not available.');
    return window.RelicForgeCloud;
  }

  function canonicalConfig() {
    const cfg = window.RELICFORGE_V1_ADDRESSES?.[CHAIN_ID];
    if (!cfg || !window.ethers?.isAddress(cfg.factory) || !window.ethers?.isAddress(cfg.feePolicy)) {
      throw new Error('Canonical V1 Sepolia configuration is unavailable.');
    }
    return cfg;
  }

  function founderStatus(message, type = '') {
    const node = $('founderConsoleStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `founder-console-status ${type}`.trim();
  }

  function supportStatus(message, type = '') {
    const node = $('founderSupportStatus');
    if (!node) return;
    node.textContent = message;
    node.className = `founder-support-status ${type}`.trim();
  }

  async function identifyFounder({ signIn = true } = {}) {
    const projects = window.RelicForgeProjects;
    const wallet = projects?.getWallet?.();
    const button = $('founderConsoleBtn');
    if (!wallet || !cloud().enabled()) {
      founderIdentity = null;
      button?.classList.add('hidden');
      return null;
    }

    try {
      if (signIn) await cloud().ensureSignedIn(wallet);
      const session = cloud().loadSession?.();
      if (!session?.token || session.wallet?.toLowerCase() !== String(wallet).toLowerCase()) {
        founderIdentity = null;
        button?.classList.add('hidden');
        return null;
      }
      const me = await cloud().json('/api/auth/me', {}, true);
      founderIdentity = me?.isFounder ? me : null;
      button?.classList.toggle('hidden', !founderIdentity);
      if (founderIdentity) {
        button.textContent = 'Founder Console';
        button.title = `Founder access: ${me.wallet}`;
      }
      return founderIdentity;
    } catch (error) {
      founderIdentity = null;
      button?.classList.add('hidden');
      return null;
    }
  }

  async function requireFounder() {
    const identity = founderIdentity || await identifyFounder({ signIn: true });
    if (!identity?.isFounder) throw new Error('Founder authorization is required.');
    return identity;
  }

  function openFounderModal(tab = 'projects') {
    const modal = $('founderConsoleModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    selectFounderTab(tab);
    if (tab === 'projects') loadFounderProjects().catch(error => founderStatus(error.message, 'error'));
    else refreshFeePolicySummary().catch(error => founderStatus(error.message, 'error'));
  }

  function closeFounderModal() {
    $('founderConsoleModal')?.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  function selectFounderTab(tab) {
    document.querySelectorAll('[data-founder-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.founderTab === tab);
    });
    $('founderProjectsPanel')?.classList.toggle('hidden', tab !== 'projects');
    $('founderFeesPanel')?.classList.toggle('hidden', tab !== 'fees');
  }

  async function loadFounderProjects() {
    await requireFounder();
    const q = String($('founderProjectSearch')?.value || '').trim();
    founderStatus('Loading creator projects...');
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    const result = await cloud().json(`/api/founder/projects${query}`, {}, true);
    const rows = result.projects || [];
    const host = $('founderProjectList');
    if (!host) return;

    if (!rows.length) {
      host.innerHTML = '<div class="empty-state">No creator projects matched this search.</div>';
      founderStatus('No projects found.');
      return;
    }

    host.innerHTML = rows.map(project => {
      const active = supportState &&
        String(supportState.projectId) === String(project.id) &&
        String(supportState.owner).toLowerCase() === String(project.owner_wallet).toLowerCase();
      const updated = project.updated_at ? new Date(project.updated_at).toLocaleString() : 'Unknown';
      return `<article class="founder-project-card ${active ? 'active' : ''}">
        <div class="founder-project-copy">
          <div class="founder-project-title"><strong>${esc(project.name || 'Untitled Project')}</strong>${active ? '<span>OPEN IN SUPPORT</span>' : ''}</div>
          <code>${esc(project.owner_wallet)}</code>
          <small>Version ${esc(project.current_version)} | Updated ${esc(updated)} | ${esc(formatBytes(project.storage_bytes))}</small>
        </div>
        <button class="primary-btn" data-founder-open-project="${esc(project.id)}" data-founder-owner="${esc(project.owner_wallet)}" type="button">Open Support Mode</button>
      </article>`;
    }).join('');

    founderStatus(`Loaded ${rows.length} creator project${rows.length === 1 ? '' : 's'}.`, 'success');
  }

  async function founderAssetToFile(marker, owner, projectId) {
    const key = `${owner}:${projectId}:${marker.id}`;
    if (founderAssetCache.has(key)) return founderAssetCache.get(key);

    const promise = (async () => {
      const blob = await cloud().fetchBlob(
        `/api/founder/projects/${encodeURIComponent(owner)}/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(marker.id)}/download`,
        true
      );
      const file = new File([blob], marker.name || 'asset', {
        type: marker.type || blob.type || 'application/octet-stream',
        lastModified: Number(marker.lastModified || Date.now())
      });
      originalAssetMarkers.set(file, { ...marker });
      return file;
    })();

    founderAssetCache.set(key, promise);
    return promise;
  }

  async function founderDecodeValue(value, owner, projectId) {
    if (value?.__relicforgeAsset && value.id) return founderAssetToFile(value, owner, projectId);
    if (Array.isArray(value)) return Promise.all(value.map(child => founderDecodeValue(child, owner, projectId)));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = await founderDecodeValue(child, owner, projectId);
      }
      return out;
    }
    return value;
  }

  async function sha256Blob(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  async function founderUploadAsset(file, owner, projectId) {
    const existing = originalAssetMarkers.get(file);
    if (existing) return existing;

    const filename = file.name || 'asset.bin';
    const contentType = file.type || 'application/octet-stream';
    const sha256 = await sha256Blob(file);
    const prepared = await cloud().json(
      `/api/founder/projects/${encodeURIComponent(owner)}/${encodeURIComponent(projectId)}/assets/presign`,
      {
        method: 'POST',
        body: JSON.stringify({ filename, contentType, size: file.size, sha256 })
      },
      true
    );

    if (!prepared.reused) {
      const put = await fetch(prepared.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file
      });
      if (!put.ok) throw new Error(`Troubleshooting asset upload failed (${put.status}).`);
      await cloud().json(
        `/api/founder/projects/${encodeURIComponent(owner)}/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(prepared.asset.id)}/complete`,
        { method: 'POST', body: '{}' },
        true
      );
    }

    const marker = {
      __relicforgeAsset: 1,
      id: prepared.asset.id,
      name: filename,
      type: contentType,
      size: Number(file.size || prepared.asset.size_bytes || prepared.asset.size || 0),
      lastModified: Number(file.lastModified || Date.now()),
      sha256
    };
    originalAssetMarkers.set(file, marker);
    return marker;
  }

  async function founderEncodeValue(value, owner, projectId, cache = new Map()) {
    if (value instanceof Blob) {
      if (!cache.has(value)) cache.set(value, founderUploadAsset(value, owner, projectId));
      return cache.get(value);
    }
    if (Array.isArray(value)) return Promise.all(value.map(child => founderEncodeValue(child, owner, projectId, cache)));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = await founderEncodeValue(child, owner, projectId, cache);
      }
      return out;
    }
    return value;
  }

  function setNormalProjectControlsDisabled(disabled) {
    ['saveProjectBtn','openProjectsBtn','importProjectBtn','exportProjectBtn'].forEach(id => {
      const node = $(id);
      if (!node) return;
      node.disabled = !!disabled;
      if (disabled) node.title = 'Disabled while Founder Support Mode is open. Use Save Troubleshooting Version.';
      else node.removeAttribute('title');
    });
  }

  function renderSupportBanner() {
    const banner = $('founderSupportBanner');
    if (!banner) return;
    if (!supportState) {
      banner.classList.add('hidden');
      return;
    }
    banner.classList.remove('hidden');
    if ($('founderSupportProjectName')) $('founderSupportProjectName').textContent = supportState.name || 'Creator Project';
    if ($('founderSupportProjectOwner')) $('founderSupportProjectOwner').textContent = supportState.owner;
    if ($('founderSupportProjectVersion')) $('founderSupportProjectVersion').textContent = `Version ${supportState.version}`;
  }

  async function loadSupportAudit() {
    if (!supportState) return;
    const result = await cloud().json(
      `/api/founder/support-audit?owner=${encodeURIComponent(supportState.owner)}&projectId=${encodeURIComponent(supportState.projectId)}`,
      {},
      true
    );
    const rows = result.entries || [];
    const host = $('founderAuditList');
    if (!host) return;
    host.innerHTML = rows.length ? rows.slice(0, 50).map(row => {
      const when = row.created_at ? new Date(row.created_at).toLocaleString() : '';
      return `<div class="founder-audit-row">
        <div><strong>${esc(String(row.action || '').toUpperCase())}</strong><span>${esc(when)}</span></div>
        <p>${esc(row.note || 'No note')}</p>
      </div>`;
    }).join('') : '<div class="empty-state">No founder support events recorded for this project yet.</div>';
  }

  async function openSupportProject(owner, projectId) {
    await requireFounder();
    founderStatus('Opening creator project and restoring cloud artwork...');
    const response = await cloud().json(
      `/api/founder/projects/${encodeURIComponent(owner)}/${encodeURIComponent(projectId)}`,
      {},
      true
    );

    originalAssetMarkers = new WeakMap();
    founderAssetCache = new Map();

    const decoded = await founderDecodeValue(response.project.snapshot, owner, projectId);
    if (!decoded?.studio) throw new Error('Creator project Studio snapshot is missing.');

    await window.RelicForgeStudioBridge.restoreStudioProjectSnapshot(decoded.studio);
    window.RelicForgeForge?.restoreForgeProjectState?.(decoded.forge || null);

    supportState = {
      owner: response.project.owner_wallet,
      projectId: response.project.id,
      name: response.project.name,
      version: Number(response.project.current_version || 0)
    };
    window.RelicForgeFounderSupportActive = { ...supportState };
    setNormalProjectControlsDisabled(true);
    renderSupportBanner();
    window.RelicForgeProjects?.markSaved?.(new Date());
    supportStatus('Founder Support Mode loaded. Creator signing authority remains unavailable.', 'success');
    closeFounderModal();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await loadSupportAudit();
  }

  async function saveSupportVersion() {
    if (!supportState) throw new Error('No creator project is open in Support Mode.');
    await requireFounder();
    const note = String($('founderSupportNote')?.value || '').trim();
    if (!note) throw new Error('Enter a troubleshooting note before saving.');

    supportStatus('Encoding troubleshooting changes and creator artwork...');
    const studio = window.RelicForgeStudioBridge?.getStudioProjectSnapshot?.();
    const forge = window.RelicForgeForge?.getForgeProjectState?.() || null;
    if (!studio) throw new Error('Studio snapshot is unavailable.');

    const snapshot = await founderEncodeValue(
      { schema: 'relic-forge/cloud-project@1', studio, forge },
      supportState.owner,
      supportState.projectId
    );

    supportStatus('Saving a new audited troubleshooting version...');
    const result = await cloud().json(
      `/api/founder/projects/${encodeURIComponent(supportState.owner)}/${encodeURIComponent(supportState.projectId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          name: String(studio?.ui?.collectionName || supportState.name || 'Untitled Collection'),
          snapshot,
          note
        })
      },
      true
    );

    supportState.name = result.project?.name || supportState.name;
    supportState.version = Number(result.project?.current_version || supportState.version + 1);
    window.RelicForgeFounderSupportActive = { ...supportState };
    if ($('founderSupportNote')) $('founderSupportNote').value = '';
    renderSupportBanner();
    window.RelicForgeProjects?.markSaved?.(new Date());
    supportStatus(`Saved troubleshooting version ${supportState.version}. The creator will see it as their latest cloud project version.`, 'success');
    await loadSupportAudit();
  }

  function exitSupportMode() {
    if (!supportState) return;
    const dirty = window.RelicForgeProjects?.hasUnsavedChanges?.();
    if (dirty && !window.confirm('Exit Founder Support Mode with unsaved troubleshooting changes?')) return;
    window.RelicForgeFounderSupportActive = null;
    location.reload();
  }

  function readProvider() {
    const apiBase = String(window.RelicForgeCloud?.apiBase?.() || window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
    if (apiBase) return new window.ethers.JsonRpcProvider(`${apiBase}/api/public/rpc/${CHAIN_ID}`, CHAIN_ID, { staticNetwork: true });
    const injected = window.RelicForgeWalletSession?.getProvider?.() || window.ethereum;
    if (injected) return new window.ethers.BrowserProvider(injected);
    throw new Error('No Sepolia read provider is available.');
  }

  async function platformAdminSigner() {
    await requireFounder();
    const sessionHelper = window.RelicForgeWalletSession;
    if (!sessionHelper?.getProvider?.()) await sessionHelper?.requestAccount?.();
    const injected = sessionHelper?.getProvider?.() || window.ethereum;
    if (!injected?.request) throw new Error('Connect the platform admin wallet first.');

    const chainHex = await injected.request({ method: 'eth_chainId' });
    if (Number(BigInt(chainHex)) !== CHAIN_ID) {
      await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
    }

    const provider = new window.ethers.BrowserProvider(injected);
    const signer = await provider.getSigner();
    const signerAddress = window.ethers.getAddress(await signer.getAddress());
    const cfg = canonicalConfig();
    const policy = new window.ethers.Contract(cfg.feePolicy, FEE_POLICY_ABI, signer);
    const admin = window.ethers.getAddress(await policy.platformAdmin());
    if (signerAddress.toLowerCase() !== admin.toLowerCase()) {
      throw new Error(`Connected wallet is not the onchain platformAdmin. Required: ${admin}`);
    }
    return { signer, signerAddress, policy };
  }

  async function refreshFeePolicySummary() {
    await requireFounder();
    const cfg = canonicalConfig();
    const provider = readProvider();
    const policy = new window.ethers.Contract(cfg.feePolicy, FEE_POLICY_ABI, provider);
    const [admin, treasury, sponsored, minter, defaultCap, collectionCap, accrued] = await Promise.all([
      policy.platformAdmin(),
      policy.treasury(),
      policy.sponsoredFeeCents(),
      policy.minterFeeCents(),
      policy.MAX_DEFAULT_FEE_CENTS(),
      policy.MAX_COLLECTION_FEE_CENTS(),
      policy.accruedFees()
    ]);

    if ($('founderPolicyAddress')) $('founderPolicyAddress').textContent = cfg.feePolicy;
    if ($('founderPlatformAdmin')) $('founderPlatformAdmin').textContent = admin;
    if ($('founderTreasuryCurrent')) $('founderTreasuryCurrent').textContent = treasury;
    if ($('founderAccruedFees')) $('founderAccruedFees').textContent = `${Number(window.ethers.formatEther(accrued)).toFixed(6)} ETH`;
    if ($('founderDefaultSponsored')) $('founderDefaultSponsored').value = (Number(sponsored) / 100).toFixed(2);
    if ($('founderDefaultMinter')) $('founderDefaultMinter').value = (Number(minter) / 100).toFixed(2);
    if ($('founderTreasuryInput')) $('founderTreasuryInput').value = treasury;
    if ($('founderFeeCap')) $('founderFeeCap').textContent = `${dollars(collectionCap)} / NFT`;
    if ($('founderWithdrawFeesBtn')) $('founderWithdrawFeesBtn').disabled = accrued === 0n;

    const wallet = window.RelicForgeProjects?.getWallet?.();
    const isAdmin = wallet && String(wallet).toLowerCase() === String(admin).toLowerCase();
    const status = $('founderFeeAdminStatus');
    if (status) {
      status.textContent = isAdmin
        ? 'Connected founder wallet is also the onchain platformAdmin.'
        : `Fee changes require platformAdmin ${admin}. Current founder session is read-only for onchain fee writes.`;
      status.className = `forge-inline-status ${isAdmin ? 'success' : 'warning'}`;
    }

    return { admin, treasury, sponsored: Number(sponsored), minter: Number(minter), defaultCap: Number(defaultCap), collectionCap: Number(collectionCap), accrued };
  }

  async function loadFeeCollection() {
    await requireFounder();
    const address = String($('founderCollectionAddress')?.value || '').trim();
    if (!window.ethers?.isAddress(address)) throw new Error('Enter a valid V1 collection address.');

    founderStatus('Reading collection fee configuration...');
    const cfg = canonicalConfig();
    const provider = readProvider();
    const collection = new window.ethers.Contract(address, COLLECTION_FEE_ABI, provider);
    const [name, symbol, creator, factory, feePolicy, mode, lockedCents, maxSupply, totalMinted] = await Promise.all([
      collection.name(),
      collection.symbol(),
      collection.creator(),
      collection.factory(),
      collection.feePolicy(),
      collection.platformFeeMode(),
      collection.lockedPlatformFeeCents(),
      collection.maxSupply(),
      collection.totalMinted()
    ]);

    if (String(factory).toLowerCase() !== String(cfg.factory).toLowerCase() ||
        String(feePolicy).toLowerCase() !== String(cfg.feePolicy).toLowerCase()) {
      throw new Error('This is not a collection from the canonical Relic Forge V1 Sepolia stack.');
    }

    const policy = new window.ethers.Contract(cfg.feePolicy, FEE_POLICY_ABI, provider);
    let enabled = false;
    let waived = false;
    let overrideSet = false;
    let currentCents = Number(lockedCents);

    if (Number(mode) === FEE_MODE_MINTER_SUPPORTED) {
      [enabled, waived, overrideSet, currentCents] = await Promise.all([
        policy.collectionFeesEnabled(address),
        policy.collectionFeeWaived(address),
        policy.collectionFeeOverrideSet(address),
        policy.currentCollectionFeeCents(address, lockedCents)
      ]);
      currentCents = Number(currentCents);
    }

    feeCollectionState = {
      address: window.ethers.getAddress(address),
      name, symbol, creator,
      mode: Number(mode),
      lockedCents: Number(lockedCents),
      currentCents,
      enabled: Boolean(enabled),
      waived: Boolean(waived),
      overrideSet: Boolean(overrideSet),
      maxSupply: Number(maxSupply),
      totalMinted: Number(totalMinted)
    };
    renderFeeCollection();
    founderStatus(`Loaded ${name} fee policy.`, 'success');
  }

  function renderFeeCollection() {
    const host = $('founderFeeCollectionDetail');
    if (!host || !feeCollectionState) return;
    const s = feeCollectionState;
    const sponsored = s.mode === FEE_MODE_SPONSORED;
    host.classList.remove('hidden');
    host.innerHTML = `<div class="founder-fee-summary">
      <div><span>Collection</span><strong>${esc(s.name)} (${esc(s.symbol)})</strong></div>
      <div><span>Creator</span><code>${esc(s.creator)}</code></div>
      <div><span>Mode</span><strong>${sponsored ? 'Sponsored - settled at launch' : 'Minter Supported'}</strong></div>
      <div><span>Supply</span><strong>${s.totalMinted.toLocaleString()} / ${s.maxSupply.toLocaleString()}</strong></div>
      <div><span>Locked base</span><strong>${dollars(s.lockedCents)} / NFT</strong></div>
      <div><span>Current fee</span><strong>${sponsored ? '$0.00 minter fee' : `${dollars(s.currentCents)} / NFT`}</strong></div>
      <div><span>Status</span><strong>${sponsored ? 'Sponsored' : (s.waived ? 'PERMANENTLY WAIVED' : (s.enabled ? 'ENABLED' : 'DISABLED'))}</strong></div>
      <div><span>Override</span><strong>${sponsored ? 'N/A' : (s.overrideSet ? 'Yes' : 'No - using locked base')}</strong></div>
    </div>
    <a class="ghost-btn link-btn" target="_blank" rel="noreferrer" href="https://sepolia.etherscan.io/address/${esc(s.address)}">View on Etherscan</a>`;

    const controls = $('founderMinterFeeControls');
    controls?.classList.toggle('hidden', sponsored);
    if (!sponsored) {
      if ($('founderCollectionFeeRate')) $('founderCollectionFeeRate').value = (s.currentCents / 100).toFixed(2);
      if ($('founderToggleFeeBtn')) {
        $('founderToggleFeeBtn').textContent = s.enabled ? 'Disable Fee' : 'Enable Fee';
        $('founderToggleFeeBtn').disabled = s.waived;
      }
      if ($('founderSetFeeBtn')) $('founderSetFeeBtn').disabled = s.waived;
      if ($('founderResetFeeBtn')) $('founderResetFeeBtn').disabled = s.waived || !s.overrideSet;
      if ($('founderWaiveFeeBtn')) $('founderWaiveFeeBtn').disabled = s.waived;
    }
  }

  async function reloadFeeCollectionAfter(txPromise, pendingMessage) {
    founderStatus(pendingMessage);
    const tx = await txPromise;
    founderStatus(`Transaction submitted: ${tx.hash.slice(0, 12)}...`);
    await tx.wait();
    await loadFeeCollection();
  }

  async function toggleCollectionFee() {
    if (!feeCollectionState || feeCollectionState.mode !== FEE_MODE_MINTER_SUPPORTED) throw new Error('Load a Minter Supported collection first.');
    if (feeCollectionState.waived) throw new Error('This collection is permanently waived.');
    const { policy } = await platformAdminSigner();
    await reloadFeeCollectionAfter(
      policy.setCollectionFeesEnabled(feeCollectionState.address, !feeCollectionState.enabled),
      `${feeCollectionState.enabled ? 'Disabling' : 'Enabling'} this collection fee...`
    );
  }

  async function setCollectionFee() {
    if (!feeCollectionState || feeCollectionState.mode !== FEE_MODE_MINTER_SUPPORTED) throw new Error('Load a Minter Supported collection first.');
    if (feeCollectionState.waived) throw new Error('This collection is permanently waived.');
    const summary = await refreshFeePolicySummary();
    const cents = parseDollarInput('founderCollectionFeeRate', summary.collectionCap);
    const { policy } = await platformAdminSigner();
    await reloadFeeCollectionAfter(
      policy.setCollectionFeeCents(feeCollectionState.address, cents),
      `Setting this collection fee to ${dollars(cents)} / NFT...`
    );
  }

  async function resetCollectionFee() {
    if (!feeCollectionState || feeCollectionState.mode !== FEE_MODE_MINTER_SUPPORTED) throw new Error('Load a Minter Supported collection first.');
    if (feeCollectionState.waived) throw new Error('This collection is permanently waived.');
    const { policy } = await platformAdminSigner();
    await reloadFeeCollectionAfter(
      policy.clearCollectionFeeOverride(feeCollectionState.address),
      'Returning this collection to its locked base fee...'
    );
  }

  async function waiveCollectionFee() {
    if (!feeCollectionState || feeCollectionState.mode !== FEE_MODE_MINTER_SUPPORTED) throw new Error('Load a Minter Supported collection first.');
    if (feeCollectionState.waived) throw new Error('This collection is already permanently waived.');
    const confirmText = window.prompt(`Permanent action. Type WAIVE to permanently remove Relic Forge minter fees from ${feeCollectionState.name}.`);
    if (confirmText !== 'WAIVE') throw new Error('Permanent waiver cancelled.');
    const { policy } = await platformAdminSigner();
    await reloadFeeCollectionAfter(
      policy.waiveCollection(feeCollectionState.address),
      'Permanently waiving this collection fee...'
    );
  }

  async function saveDefaultFees() {
    const summary = await refreshFeePolicySummary();
    const sponsored = parseDollarInput('founderDefaultSponsored', summary.defaultCap);
    const minter = parseDollarInput('founderDefaultMinter', summary.defaultCap);
    if (!window.confirm(`Update future collection defaults to Sponsored ${dollars(sponsored)} per max-supply NFT and Minter Supported ${dollars(minter)} per minted NFT? Existing collection locked bases are unchanged.`)) return;
    const { policy } = await platformAdminSigner();
    founderStatus('Updating future collection fee defaults...');
    const tx = await policy.setDefaultFeeCents(sponsored, minter);
    await tx.wait();
    await refreshFeePolicySummary();
    founderStatus('Future collection defaults updated.', 'success');
  }

  async function saveTreasury() {
    const treasury = String($('founderTreasuryInput')?.value || '').trim();
    if (!window.ethers.isAddress(treasury)) throw new Error('Treasury address is invalid.');
    if (!window.confirm(`Change the Relic Forge platform treasury to ${treasury}?`)) return;
    const { policy } = await platformAdminSigner();
    founderStatus('Updating platform treasury...');
    const tx = await policy.setTreasury(treasury);
    await tx.wait();
    await refreshFeePolicySummary();
    founderStatus('Platform treasury updated.', 'success');
  }

  async function withdrawAccruedFees() {
    const summary = await refreshFeePolicySummary();
    if (summary.accrued === 0n) throw new Error('There are no accrued platform fees to forward.');
    const { policy } = await platformAdminSigner();
    founderStatus('Forwarding accrued platform fees to the configured treasury...');
    const tx = await policy.withdrawFees();
    await tx.wait();
    await refreshFeePolicySummary();
    founderStatus('Accrued platform fees forwarded to treasury.', 'success');
  }

  function bind() {
    $('founderConsoleBtn')?.addEventListener('click', () => openFounderModal('projects'));
    $('founderConsoleCloseBtn')?.addEventListener('click', closeFounderModal);
    $('founderConsoleBackdrop')?.addEventListener('click', closeFounderModal);
    document.querySelectorAll('[data-founder-tab]').forEach(button => {
      button.addEventListener('click', () => {
        selectFounderTab(button.dataset.founderTab);
        if (button.dataset.founderTab === 'fees') refreshFeePolicySummary().catch(error => founderStatus(error.message, 'error'));
      });
    });

    $('founderProjectSearchBtn')?.addEventListener('click', () => loadFounderProjects().catch(error => founderStatus(error.message, 'error')));
    $('founderProjectRefreshBtn')?.addEventListener('click', () => loadFounderProjects().catch(error => founderStatus(error.message, 'error')));
    $('founderProjectSearch')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') loadFounderProjects().catch(error => founderStatus(error.message, 'error'));
    });
    $('founderProjectList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-founder-open-project]');
      if (!button) return;
      openSupportProject(button.dataset.founderOwner, button.dataset.founderOpenProject)
        .catch(error => founderStatus(error.message, 'error'));
    });

    $('founderSupportSaveBtn')?.addEventListener('click', () => saveSupportVersion().catch(error => supportStatus(error.message, 'error')));
    $('founderSupportConsoleBtn')?.addEventListener('click', () => openFounderModal('projects'));
    $('founderSupportExitBtn')?.addEventListener('click', exitSupportMode);

    $('founderCollectionLoadBtn')?.addEventListener('click', () => loadFeeCollection().catch(error => founderStatus(error.message, 'error')));
    $('founderCollectionAddress')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') loadFeeCollection().catch(error => founderStatus(error.message, 'error'));
    });
    $('founderToggleFeeBtn')?.addEventListener('click', () => toggleCollectionFee().catch(error => founderStatus(error.shortMessage || error.message, 'error')));
    $('founderSetFeeBtn')?.addEventListener('click', () => setCollectionFee().catch(error => founderStatus(error.shortMessage || error.message, 'error')));
    $('founderResetFeeBtn')?.addEventListener('click', () => resetCollectionFee().catch(error => founderStatus(error.shortMessage || error.message, 'error')));
    $('founderWaiveFeeBtn')?.addEventListener('click', () => waiveCollectionFee().catch(error => founderStatus(error.shortMessage || error.message, 'error')));
    $('founderSaveDefaultsBtn')?.addEventListener('click', () => saveDefaultFees().catch(error => founderStatus(error.shortMessage || error.message, 'error')));
    $('founderSaveTreasuryBtn')?.addEventListener('click', () => saveTreasury().catch(error => founderStatus(error.shortMessage || error.message, 'error')));
    $('founderWithdrawFeesBtn')?.addEventListener('click', () => withdrawAccruedFees().catch(error => founderStatus(error.shortMessage || error.message, 'error')));

    window.addEventListener('relicforge:wallet-connected', () => {
      setTimeout(() => identifyFounder({ signIn: true }).then(identity => {
        if (identity && !$('founderConsoleModal')?.classList.contains('hidden')) {
          refreshFeePolicySummary().catch(() => {});
        }
      }).catch(() => {}), 100);
    });
    window.addEventListener('relicforge:wallet-disconnected', () => {
      founderIdentity = null;
      $('founderConsoleBtn')?.classList.add('hidden');
      closeFounderModal();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('founderConsoleModal')?.classList.contains('hidden')) closeFounderModal();
    });

    setTimeout(() => identifyFounder({ signIn: false }).catch(() => {}), 300);
    setTimeout(() => identifyFounder({ signIn: true }).catch(() => {}), 1200);
  }

  window.RelicForgeFounderConsole = {
    open: openFounderModal,
    refreshIdentity: identifyFounder,
    loadProjects: loadFounderProjects,
    loadFeeCollection
  };

  bind();
})();
