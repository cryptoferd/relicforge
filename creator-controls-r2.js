(() => {
  'use strict';

  if (!document.body?.classList.contains('dashboard-page-body')) return;

  const ZERO = '0x0000000000000000000000000000000000000000';
  function activeDashboardChainId(){
    const id=Number(window.RelicForgeForgeNetwork?.selectedChainId?.()??0);
    if(![1,11155111].includes(id))throw new Error('Choose Ethereum Mainnet or Sepolia.');
    return id;
  }
  function expectedAdapter(){
    const id=activeDashboardChainId();
    const address=window.RELICFORGE_V2_ADDRESSES?.[id]?.randomnessAdapter;
    if(!window.ethers?.isAddress(address||''))throw new Error('Verified randomness adapter is unavailable for the selected network.');
    return window.ethers.getAddress(address).toLowerCase();
  }
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const short = value => {
    const s = String(value || '');
    return s.length > 14 ? `${s.slice(0,6)}…${s.slice(-4)}` : s;
  };

  const COLLECTION_ABI = [
    'function controller() view returns(address)',
    'function randomnessProvider() view returns(address)',
    'function mintPhases() view returns(address)',
    'function maxSupply() view returns(uint32)',
    'function totalMinted() view returns(uint32)',
    'function totalCommitted() view returns(uint32)',
    'function pendingSupply() view returns(uint32)',
    'function futureRevealMode() view returns(uint8)',
    'function delayedRevealRequested() view returns(bool)',
    'function delayedRevealPrepared() view returns(bool)',
    'function delayedRevealed() view returns(bool)',
    'function delayedRevealSupply() view returns(uint32)',
    'function delayedRevealRequestId() view returns(uint256)',
    'function pendingDelayedReserveRefundWei() view returns(uint256)',
    'function activeAutoRevealRequests() view returns(uint32)',
    'function prepareDelayedReveal()',
    'function requestDelayedReveal()',
  ];

  const PHASES_ABI = [
    'function controller() view returns(address)',
    'function masterMintEnabled() view returns(bool)',
    'function phaseCount() view returns(uint32)',
  ];

  const state = {
    address: null,
    serial: 0,
    timer: null,
    busy: false,
    lastMode: null,
  };

  function apiBase() {
    return String(window.RelicForgeCloud?.apiBase?.() || window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  }

  async function readProvider() {
    if (!window.ethers) throw new Error('ethers.js is unavailable.');
    if (window.RelicForgeNetworks?.readProvider) {
      const provider = window.RelicForgeNetworks.readProvider(activeDashboardChainId());
      if (window.RelicForgeNetworks.assertProvider) {
        await window.RelicForgeNetworks.assertProvider(provider, activeDashboardChainId());
      }
      return provider;
    }
    const base = apiBase();
    if (base) {
      const provider = new window.ethers.JsonRpcProvider(
        `${base}/api/public/rpc/${activeDashboardChainId()}`,
        activeDashboardChainId(),
        { staticNetwork:true, batchMaxCount:20 }
      );
      await provider.getBlockNumber();
      return provider;
    }
    const injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
    if (injected) return new window.ethers.BrowserProvider(injected);
    throw new Error('No RPC provider is available for the selected dashboard network.');
  }

  function selectedAddress() {
    const detail = $('launchedCollectionDetail');
    if (!detail) return null;
    const text = detail.querySelector('.launched-detail-head p')?.textContent?.trim() || '';
    if (window.ethers?.isAddress(text)) return window.ethers.getAddress(text);
    const selected = document.querySelector('.launched-collection-item.selected')?.dataset?.launchedAddress;
    return window.ethers?.isAddress(selected) ? window.ethers.getAddress(selected) : null;
  }

  async function detectR2(address, provider) {
    try {
      const c = new window.ethers.Contract(address, COLLECTION_ABI, provider);
      const [adapter, pending, phases] = await Promise.all([
        c.randomnessProvider(),
        c.pendingSupply(),
        c.mintPhases(),
      ]);
      return String(adapter).toLowerCase() === expectedAdapter() &&
        Number(pending) === 0 &&
        window.ethers.isAddress(phases) &&
        phases !== ZERO;
    } catch (_) {
      return false;
    }
  }

  async function readState(address, provider) {
    const c = new window.ethers.Contract(address, COLLECTION_ABI, provider);
    const [
      controller, adapter, phasesAddress, maxSupply, totalMinted, totalCommitted,
      pendingSupply, futureRevealMode, delayedRevealRequested, delayedRevealPrepared,
      delayedRevealed, delayedRevealSupply, delayedRevealRequestId,
      pendingDelayedReserveRefundWei, activeAutoRevealRequests
    ] = await Promise.all([
      c.controller(),
      c.randomnessProvider(),
      c.mintPhases(),
      c.maxSupply(),
      c.totalMinted(),
      c.totalCommitted(),
      c.pendingSupply(),
      c.futureRevealMode(),
      c.delayedRevealRequested(),
      c.delayedRevealPrepared(),
      c.delayedRevealed(),
      c.delayedRevealSupply(),
      c.delayedRevealRequestId(),
      c.pendingDelayedReserveRefundWei(),
      c.activeAutoRevealRequests(),
    ]);

    const phases = new window.ethers.Contract(phasesAddress, PHASES_ABI, provider);
    const [phaseController, masterMintEnabled, phaseCount] = await Promise.all([
      phases.controller(),
      phases.masterMintEnabled(),
      phases.phaseCount(),
    ]);

    if (window.ethers.getAddress(controller).toLowerCase() !== window.ethers.getAddress(phaseController).toLowerCase()) {
      throw new Error('Collection and MintPhases controller bindings do not match.');
    }

    return {
      address: window.ethers.getAddress(address),
      controller: window.ethers.getAddress(controller),
      adapter: window.ethers.getAddress(adapter),
      phasesAddress: window.ethers.getAddress(phasesAddress),
      maxSupply: Number(maxSupply),
      totalMinted: Number(totalMinted),
      totalCommitted: Number(totalCommitted),
      pendingSupply: Number(pendingSupply),
      futureRevealMode: Number(futureRevealMode),
      delayedRevealRequested: Boolean(delayedRevealRequested),
      delayedRevealPrepared: Boolean(delayedRevealPrepared),
      delayedRevealed: Boolean(delayedRevealed),
      delayedRevealSupply: Number(delayedRevealSupply),
      delayedRevealRequestId: BigInt(delayedRevealRequestId),
      pendingDelayedReserveRefundWei: BigInt(pendingDelayedReserveRefundWei),
      activeAutoRevealRequests: Number(activeAutoRevealRequests),
      masterMintEnabled: Boolean(masterMintEnabled),
      phaseCount: Number(phaseCount),
    };
  }

  function suppressLegacyControls(detail) {
    const legacyStatus = detail?.querySelector('#rfCompleteCreatorStatus');
    const legacy = legacyStatus?.closest('.launched-section');
    if (legacy) {
      legacy.classList.add('rf-r2-legacy-controls-hidden');
      legacy.setAttribute('aria-hidden', 'true');
    }
  }

  function stateMessage(s) {
    if (s.totalMinted >= s.maxSupply) {
      return 'Minting unavailable — collection maximum supply has already been minted.';
    }
    if (s.delayedRevealed) {
      return 'Delayed reveal is complete. Any remaining unsold NFTs now use Forge automatic reveal with fresh randomness.';
    }
    if (s.futureRevealMode === 1) {
      if (s.activeAutoRevealRequests > 0) {
        return `${s.activeAutoRevealRequests} automatic reveal request${s.activeAutoRevealRequests === 1 ? '' : 's'} currently awaiting completion. No creator action is required.`;
      }
      return 'Forge automatic reveal is active. Collectors own their NFT immediately at mint; the placeholder changes automatically after verified randomness arrives.';
    }
    if (s.delayedRevealRequestId > 0n) {
      return 'Randomness has been requested. The frozen supply will reveal automatically when Chainlink fulfills the request. No third creator transaction is required.';
    }
    if (s.delayedRevealPrepared) {
      return 'Step 1 is complete. Continue with Step 2 to request randomness. This second transaction does not fund the Reserve.';
    }
    if (s.totalMinted === 0) {
      return 'Deferred reveal is configured. Reveal becomes available after at least one NFT has been minted.';
    }
    return `Deferred reveal is ready. Revealing now will freeze exactly ${s.totalMinted.toLocaleString()} currently minted NFT${s.totalMinted === 1 ? '' : 's'}.`;
  }

  function marketplaceRefreshTarget(s) {
    // When Forge automatic reveal has no outstanding requests, every currently
    // minted token is revealed. During a hybrid collection with an outstanding
    // Forge request, the already-completed delayed set is still safe to refresh.
    if (s.futureRevealMode === 1 && s.activeAutoRevealRequests === 0 && s.totalMinted > 0) return s.totalMinted;
    if (s.delayedRevealed && s.delayedRevealSupply > 0) return s.delayedRevealSupply;
    return 0;
  }

  function actionHtml(s) {
    const actions = [];
    if (!s.delayedRevealed && s.futureRevealMode !== 1 && s.totalMinted > 0) {
      if (s.delayedRevealRequestId > 0n) {
        actions.push('<button class="primary-btn" type="button" disabled>WAITING FOR AUTOMATIC REVEAL</button>');
      } else if (s.delayedRevealPrepared) {
        actions.push('<button class="primary-btn" id="rfR2RevealStep2" type="button">CONTINUE REVEAL — STEP 2 OF 2</button>');
      } else if (!s.delayedRevealRequested) {
        actions.push('<button class="primary-btn" id="rfR2RevealStep1" type="button">REVEAL COLLECTION — STEP 1 OF 2</button>');
      } else {
        actions.push('<button class="primary-btn" type="button" disabled>REVEAL PREPARATION IN PROGRESS</button>');
      }
    }

    const refreshThrough = marketplaceRefreshTarget(s);
    if (refreshThrough > 0) {
      actions.push(`<button class="ghost-btn" id="rfR2MarketplaceRefresh" type="button" data-through="${refreshThrough}">REFRESH OPENSEA METADATA</button>`);
    }
    return actions.join('');
  }

  function render(detail, s) {
    suppressLegacyControls(detail);
    detail.querySelector('#rfR2CreatorPanel')?.remove();

    const soldOut = s.totalMinted >= s.maxSupply;
    const mode = s.futureRevealMode === 1 ? 'Forge automatic' : 'Deferred';
    const panel = document.createElement('section');
    panel.id = 'rfR2CreatorPanel';
    panel.className = 'launched-section rf-r2-creator-panel';
    panel.innerHTML = `
      <div class="rf-r2-head">
        <div>
          <span class="eyebrow">LIVE COLLECTION CONTROLS</span>
          <h4>Reveal & Collection State</h4>
          <p>Relic Forge uses immediate NFT ownership, contract-native automatic Forge reveal, and a two-transaction creator delayed reveal.</p>
        </div>
        <span class="rf-r2-badge">VERIFIED</span>
      </div>
      <div class="rf-r2-grid">
        <div><span>Minted</span><strong>${s.totalMinted.toLocaleString()} / ${s.maxSupply.toLocaleString()}</strong></div>
        <div><span>Pending ownership</span><strong>${s.pendingSupply.toLocaleString()}</strong></div>
        <div><span>Reveal mode</span><strong>${esc(mode)}</strong></div>
        <div><span>Mint stages</span><strong>${s.phaseCount.toLocaleString()}</strong></div>
      </div>
      ${soldOut ? '<div class="rf-r2-soldout">Minting unavailable — collection maximum supply has already been minted.</div>' : ''}
      <div class="rf-r2-reveal-box">
        <div>
          <strong>${s.delayedRevealed ? 'COLLECTION REVEALED' : (s.futureRevealMode === 1 ? 'AUTOMATIC REVEAL ACTIVE' : 'DELAYED REVEAL')}</strong>
          <p>${esc(stateMessage(s))}</p>
          ${s.delayedRevealSupply ? `<small>Frozen delayed supply: ${s.delayedRevealSupply.toLocaleString()} NFT${s.delayedRevealSupply === 1 ? '' : 's'}.</small>` : ''}
        </div>
        <div class="rf-r2-actions">${actionHtml(s)}</div>
      </div>
      <div class="rf-r2-note">
        <strong>No keeper or settlement actions</strong>
        <span>Normal creator controls do not expose replay, batch locking, settlement, request IDs, or Reserve recovery. Recovery remains hidden unless it is actually needed.</span>
      </div>
      <div class="forge-inline-status" id="rfR2CreatorStatus">Collection state verified against the live network.</div>
    `;
    detail.appendChild(panel);

    panel.querySelector('#rfR2RevealStep1')?.addEventListener('click', event => executeRevealStep(1, s, event.currentTarget));
    panel.querySelector('#rfR2RevealStep2')?.addEventListener('click', event => executeRevealStep(2, s, event.currentTarget));
    panel.querySelector('#rfR2MarketplaceRefresh')?.addEventListener('click', event => executeMarketplaceRefresh(s, event.currentTarget));
  }

  function setStatus(message, bad = false) {
    const el = $('rfR2CreatorStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('bad', !!bad);
  }

  async function creatorSigner(s) {
    if (window.RF26CreatorGuard?.signer) {
      return window.RF26CreatorGuard.signer(s.address, { controller:s.controller, chainId:activeDashboardChainId() });
    }
    const injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
    if (!injected?.request) throw new Error('Connect the collection controller wallet first.');
    const id=activeDashboardChainId();
    await window.RelicForgeNetworks.ensureWalletChain(injected,id);
    const bp = new window.ethers.BrowserProvider(injected);
    const signer = await bp.getSigner();
    const who = window.ethers.getAddress(await signer.getAddress());
    if (who.toLowerCase() !== s.controller.toLowerCase()) {
      throw new Error(`Connect the collection controller wallet ${short(s.controller)}.`);
    }
    return signer;
  }

  async function delayedRevealRequestOverrides(provider) {
    if (!provider?.send) {
      throw new Error('A live RPC provider is required before requesting Chainlink randomness.');
    }
    const raw = await provider.send('eth_gasPrice', []);
    const gasPrice = BigInt(raw);
    if (gasPrice <= 0n) {
      throw new Error('A live non-zero network gas price is required before requesting Chainlink randomness.');
    }
    // Chainlink direct-funding pricing depends on tx.gasprice. Supplying both
    // fields prevents MetaMask/eth_estimateGas from simulating the zero-price
    // branch that can otherwise make Step 2 revert during estimation.
    return Object.freeze({ gasPrice, gasLimit: 1500000n });
  }
  function setActionBusy(button, busy, label = '') {
    if (!button) return;
    if (window.RelicForgeButtonFeedback?.setBusy) {
      window.RelicForgeButtonFeedback.setBusy(button, busy, label);
      return;
    }
    if (busy) {
      if (!button.dataset.rfBusyOriginalText) button.dataset.rfBusyOriginalText = button.textContent || '';
      button.classList.add('rf-action-busy');
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
      if (label) button.textContent = label;
    } else {
      button.classList.remove('rf-action-busy');
      button.removeAttribute('aria-busy');
      button.disabled = false;
      if (button.dataset.rfBusyOriginalText) {
        button.textContent = button.dataset.rfBusyOriginalText;
        delete button.dataset.rfBusyOriginalText;
      }
    }
  }

  async function executeRevealStep(step, snapshot, button) {
    if (state.busy) return;
    state.busy = true;
    setActionBusy(button, true, step === 1 ? 'PREPARING REVEAL…' : 'REQUESTING RANDOMNESS…');
    try {
      setStatus(step === 1
        ? 'Step 1 of 2: preparing and funding the delayed reveal…'
        : 'Step 2 of 2: requesting verified randomness…');

      const provider = await readProvider();
      const live = await readState(snapshot.address, provider);
      if (live.delayedRevealed || live.futureRevealMode === 1) {
        setStatus('Reveal is already complete.');
        await refresh(true);
        return;
      }

      const signer = await creatorSigner(live);
      const contract = new window.ethers.Contract(live.address, COLLECTION_ABI, signer);

      if (step === 1) {
        if (live.delayedRevealPrepared) {
          setStatus('Step 1 was already confirmed. Continue with Step 2.');
          await refresh(true);
          return;
        }
        const tx = await contract.prepareDelayedReveal();
        setStatus('Step 1 submitted. Waiting for confirmation…');
        await tx.wait();
        setStatus('Step 1 confirmed. Review the updated state, then continue with Step 2.');
      } else {
        if (!live.delayedRevealPrepared) throw new Error('Step 1 must be confirmed before Step 2.');
        if (live.delayedRevealRequestId > 0n) {
          setStatus('Randomness was already requested. Reveal will finish automatically.');
          await refresh(true);
          return;
        }
        const overrides = await delayedRevealRequestOverrides(provider);
        const tx = await contract.requestDelayedReveal(overrides);
        setStatus('Step 2 submitted. Waiting for confirmation…');
        await tx.wait();
        setStatus('Step 2 confirmed. Chainlink randomness is now pending; reveal will finish automatically.');
      }
      await refresh(true);
    } catch (error) {
      console.error('RelicForge R2 reveal action:', error);
      setStatus(error?.shortMessage || error?.reason || error?.message || 'Reveal action failed.', true);
    } finally {
      setActionBusy(button, false);
      state.busy = false;
    }
  }

  async function executeMarketplaceRefresh(snapshot, button) {
    if (state.busy) return;
    state.busy = true;
    setActionBusy(button, true, 'QUEUING OPENSEA REFRESH…');
    try {
      if (!window.RelicForgeCloud?.json || !window.RelicForgeCloud?.ensureSignedIn) {
        throw new Error('Relic Forge Cloud sign-in is unavailable.');
      }

      const provider = await readProvider();
      const live = await readState(snapshot.address, provider);
      const throughTokenId = marketplaceRefreshTarget(live);
      if (throughTokenId < 1) throw new Error('No fully revealed token range is ready for marketplace refresh.');

      const injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
      if (!injected?.request) throw new Error('Connect the collection creator or controller wallet first.');
      const browserProvider = new window.ethers.BrowserProvider(injected);
      const signer = await browserProvider.getSigner();
      const wallet = window.ethers.getAddress(await signer.getAddress());
      await window.RelicForgeCloud.ensureSignedIn(wallet);

      let nextTokenId = 1;
      let queued = 0;
      let failures = 0;
      while (nextTokenId && nextTokenId <= throughTokenId) {
        setStatus(`OpenSea refresh: queuing metadata for token ${nextTokenId.toLocaleString()} through ${throughTokenId.toLocaleString()}…`);
        const result = await window.RelicForgeCloud.json(
          `/api/collections/${activeDashboardChainId()}/${live.address}/marketplace/opensea/refresh`,
          {
            method: 'POST',
            body: JSON.stringify({ fromTokenId: nextTokenId, throughTokenId }),
          },
          true
        );
        queued += Number(result?.queued || 0);
        failures += Array.isArray(result?.failed) ? result.failed.length : 0;
        const candidate = Number(result?.nextTokenId || 0);
        if (!candidate) break;
        if (!Number.isSafeInteger(candidate) || candidate <= nextTokenId) throw new Error('Marketplace refresh cursor did not advance.');
        nextTokenId = candidate;
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      if (failures > 0) {
        setStatus(`OpenSea refresh queued for ${queued.toLocaleString()} NFT${queued === 1 ? '' : 's'}; ${failures.toLocaleString()} item${failures === 1 ? '' : 's'} could not be queued. You can run Refresh OpenSea Metadata again.`, true);
      } else {
        setStatus(`OpenSea metadata refresh queued for ${queued.toLocaleString()} NFT${queued === 1 ? '' : 's'}. OpenSea processes refreshes asynchronously, so marketplace images may take a few minutes to update.`);
      }
    } catch (error) {
      console.error('RelicForge marketplace metadata refresh:', error);
      setStatus(error?.shortMessage || error?.reason || error?.message || 'Marketplace metadata refresh failed.', true);
    } finally {
      setActionBusy(button, false);
      state.busy = false;
    }
  }

  async function refresh(force = false) {
    const address = selectedAddress();
    const detail = $('launchedCollectionDetail');

    if (!address || !detail) {
      state.address = null;
      return;
    }

    const serial = ++state.serial;
    try {
      const provider = await readProvider();
      if (!(await detectR2(address, provider))) {
        if (serial !== state.serial) return;
        detail.querySelector('#rfR2CreatorPanel')?.remove();
        detail.querySelector('.rf-r2-legacy-controls-hidden')?.classList.remove('rf-r2-legacy-controls-hidden');
        state.address = address;
        return;
      }

      const s = await readState(address, provider);
      if (serial !== state.serial) return;
      state.address = address;
      render(detail, s);
    } catch (error) {
      if (serial !== state.serial) return;
      console.warn('RelicForge R2 creator controls refresh:', error);
      if (force) setStatus(error?.message || 'Could not refresh R2 collection state.', true);
    }
  }

  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      await refresh(false);
      schedule();
    }, 2500);
  }

  window.addEventListener('load', () => {
    refresh(false);
    schedule();
  });
})();
