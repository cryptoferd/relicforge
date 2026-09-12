(() => {
  'use strict';

  if (!document.body?.classList.contains('dashboard-page-body')) return;

  const CHAIN_ID = 11155111;
  const ZERO = '0x0000000000000000000000000000000000000000';
  const EXPECTED_ADAPTER = '0xFd048cc2636c6def06a10BF35EC53Eb6ACB7Dc40'.toLowerCase();
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
      const provider = window.RelicForgeNetworks.readProvider(CHAIN_ID);
      if (window.RelicForgeNetworks.assertProvider) {
        await window.RelicForgeNetworks.assertProvider(provider, CHAIN_ID);
      }
      return provider;
    }
    const base = apiBase();
    if (base) {
      const provider = new window.ethers.JsonRpcProvider(
        `${base}/api/public/rpc/${CHAIN_ID}`,
        CHAIN_ID,
        { staticNetwork:true, batchMaxCount:20 }
      );
      await provider.getBlockNumber();
      return provider;
    }
    const injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
    if (injected) return new window.ethers.BrowserProvider(injected);
    throw new Error('No Sepolia RPC provider is available.');
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
      return String(adapter).toLowerCase() === EXPECTED_ADAPTER &&
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

  function actionHtml(s) {
    if (s.delayedRevealed || s.futureRevealMode === 1 || s.totalMinted === 0) return '';
    if (s.delayedRevealRequestId > 0n) {
      return '<button class="primary-btn" type="button" disabled>WAITING FOR AUTOMATIC REVEAL</button>';
    }
    if (s.delayedRevealPrepared) {
      return '<button class="primary-btn" id="rfR2RevealStep2" type="button">CONTINUE REVEAL — STEP 2 OF 2</button>';
    }
    if (!s.delayedRevealRequested) {
      return '<button class="primary-btn" id="rfR2RevealStep1" type="button">REVEAL COLLECTION — STEP 1 OF 2</button>';
    }
    return '<button class="primary-btn" type="button" disabled>REVEAL PREPARATION IN PROGRESS</button>';
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
          <span class="eyebrow">R2 LIVE CONTROLS</span>
          <h4>Reveal & Collection State</h4>
          <p>R2 uses immediate NFT ownership, contract-native automatic Forge reveal, and a two-transaction creator delayed reveal.</p>
        </div>
        <span class="rf-r2-badge">SEP R2</span>
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
      <div class="forge-inline-status" id="rfR2CreatorStatus">R2 state verified against the live Sepolia collection.</div>
    `;
    detail.appendChild(panel);

    panel.querySelector('#rfR2RevealStep1')?.addEventListener('click', () => executeRevealStep(1, s));
    panel.querySelector('#rfR2RevealStep2')?.addEventListener('click', () => executeRevealStep(2, s));
  }

  function setStatus(message, bad = false) {
    const el = $('rfR2CreatorStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('bad', !!bad);
  }

  async function creatorSigner(s) {
    if (window.RF26CreatorGuard?.signer) {
      return window.RF26CreatorGuard.signer(s.address, { controller:s.controller, chainId:CHAIN_ID });
    }
    const injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
    if (!injected?.request) throw new Error('Connect the collection controller wallet first.');
    const chainHex = await injected.request({ method:'eth_chainId' });
    if (Number(BigInt(chainHex)) !== CHAIN_ID) {
      await injected.request({ method:'wallet_switchEthereumChain', params:[{ chainId:'0xaa36a7' }] });
    }
    const bp = new window.ethers.BrowserProvider(injected);
    const signer = await bp.getSigner();
    const who = window.ethers.getAddress(await signer.getAddress());
    if (who.toLowerCase() !== s.controller.toLowerCase()) {
      throw new Error(`Connect the collection controller wallet ${short(s.controller)}.`);
    }
    return signer;
  }

  async function executeRevealStep(step, snapshot) {
    if (state.busy) return;
    state.busy = true;
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
        const tx = await contract.requestDelayedReveal();
        setStatus('Step 2 submitted. Waiting for confirmation…');
        await tx.wait();
        setStatus('Step 2 confirmed. Chainlink randomness is now pending; reveal will finish automatically.');
      }
      await refresh(true);
    } catch (error) {
      console.error('RelicForge R2 reveal action:', error);
      setStatus(error?.shortMessage || error?.reason || error?.message || 'Reveal action failed.', true);
    } finally {
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
