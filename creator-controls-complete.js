(() => {
  'use strict';

  const CHAIN_ID = 11155111;
  const ZERO = '0x0000000000000000000000000000000000000000';
  const ZERO_HASH = '0x' + '00'.repeat(32);
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short = value => { const s=String(value||''); return s.length > 14 ? `${s.slice(0,6)}Ã¢â‚¬Â¦${s.slice(-4)}` : s; };

  const COLLECTION_ABI = [
    'function creator() view returns(address)',
    'function controller() view returns(address)',
    'function dataContract() view returns(address)',
    'function payoutReceiver() view returns(address)',
    'function royaltyReceiver() view returns(address)',
    'function royaltyBps() view returns(uint96)',
    'function randomnessProvider() view returns(address)',
    'function maxSupply() view returns(uint32)',
    'function totalMinted() view returns(uint32)',
    'function masterMintEnabled() view returns(bool)',
    'function futureRevealMode() view returns(uint8)',
    'function deferredPendingCount() view returns(uint32)',
    'function nextRequestSequence() view returns(uint64)',
    'function nextProcessSequence() view returns(uint64)',
    'function nextEpochStartToken() view returns(uint64)',
    'function revealRequests(uint64 sequence) view returns(uint8 kind,uint64 startTokenId,uint64 endTokenId,uint64 cursor,uint32 assignmentNonce,bool fulfilled,uint256 seed)',
    'function phaseCount() view returns(uint32)',
    'function phases(uint32) view returns(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 minted,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled)',
    'function phaseIsOpen(uint32 phaseId) view returns(bool)',
    'function holderRenderModeEnabled() view returns(bool)',
    'function defaultRenderMode() view returns(uint8)',
    'function flattenedRenderBaseURI() view returns(string)',
    'function accruedPlatformFees() view returns(uint256)',
    'function setMasterMintEnabled(bool enabled)',
    'function createPhase(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled) returns(uint32)',
    'function updatePhase(uint32 phaseId,uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority)',
    'function setPhaseEnabled(uint32 phaseId,bool enabled)',
    'function setFutureRevealMode(uint8 mode)',
    'function setPayoutReceiver(address receiver)',
    'function setRoyalty(address receiver,uint96 bps)',
    'function setRenderConfig(string baseURI,bool holderEnabled,uint8 defaultMode)',
    'function renounceControl()',
    'function creatorMint(address to,uint32 quantity) returns(uint256)',
    'function requestRevealEpoch() returns(uint64,uint256)',
    'function processReveal(uint32 maxSteps)',
    'function withdrawPlatformFees()',
    'function withdraw()',
    'event PhaseCreated(uint32 indexed phaseId,uint8 accessType,uint96 price,uint16 priority)',
  ];

  const DATA_ABI = [
    'function contentSealed() view returns(bool)',
    'function provenanceHash() view returns(bytes32)',
  ];

  const RANDOMNESS_ABI = [
    'function quoteRequestPrice() view returns(uint256)',
    'function nativeCredit(address consumer) view returns(uint256)',
    'function fundConsumer(address consumer) payable',
    'function withdrawConsumerCredit(address consumer,uint256 amount)',
  ];

  let currentAddress = null;
  let renderSerial = 0;
  let busy = false;

  const apiBase = () => String(window.RelicForgeCloud?.apiBase?.() || window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');

  function status(message, bad=false) {
    const el = $('rfCompleteCreatorStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('bad', !!bad);
  }

  function provider() {
    if (!window.ethers) throw new Error('ethers.js is unavailable.');
    const base = apiBase();
    if (base) return new window.ethers.JsonRpcProvider(`${base}/api/public/rpc/${CHAIN_ID}`, CHAIN_ID, {staticNetwork:true, batchMaxCount:20});
    const injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
    if (injected) return new window.ethers.BrowserProvider(injected);
    throw new Error('No network connection is available.');
  }

  async function signer() {
    if (!window.ethers) throw new Error('ethers.js is unavailable.');
    let injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
    if (!injected?.request) throw new Error('Connect an EVM wallet first.');
    const chainHex = await injected.request({method:'eth_chainId'});
    if (Number(BigInt(chainHex)) !== CHAIN_ID) {
      await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xaa36a7'}]});
    }
    const bp = new window.ethers.BrowserProvider(injected);
    return bp.getSigner();
  }

  function parseAddressFromDetail(detail) {
    const candidates = [
      detail?.querySelector('.launched-detail-head p')?.textContent,
      document.querySelector('.launched-collection-item.selected')?.dataset?.launchedAddress,
    ];
    for (const value of candidates) {
      const text = String(value || '').trim();
      if (window.ethers?.isAddress(text)) return window.ethers.getAddress(text);
    }
    return null;
  }

  function dtValue(seconds) {
    if (!Number(seconds)) return '';
    const d = new Date(Number(seconds) * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }

  function parseDt(value, label) {
    if (!String(value||'').trim()) return 0;
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) throw new Error(`${label} is invalid.`);
    return Math.floor(d.getTime()/1000);
  }

  function fmtEth(value, max=6) {
    try { return Number(window.ethers.formatEther(BigInt(value))).toLocaleString(undefined,{maximumFractionDigits:max}); }
    catch (_) { return '0'; }
  }

  function safeInt(value, min, max, label) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    return n;
  }

  function hashPair(a, b) {
    return BigInt(a) <= BigInt(b)
      ? window.ethers.keccak256(window.ethers.concat([a, b]))
      : window.ethers.keccak256(window.ethers.concat([b, a]));
  }

  function approvedWalletLeaf(entry, collectionAddress, stageId) {
    const encoded = window.ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256','address','uint32','address','uint32'],
      [BigInt(CHAIN_ID), collectionAddress, Number(stageId), entry.address, entry.allowance]
    );
    return window.ethers.keccak256(encoded);
  }

  function buildApprovedWalletTree(entries, collectionAddress, stageId) {
    if (!entries.length) throw new Error('Add at least one approved wallet.');
    const leaves = entries.map(entry => approvedWalletLeaf(entry, collectionAddress, stageId));
    const layers = [leaves];
    while (layers[layers.length - 1].length > 1) {
      const current = layers[layers.length - 1];
      const next = [];
      for (let i = 0; i < current.length; i += 2) next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
      layers.push(next);
    }
    const proofForIndex = index => {
      const proof = [];
      let cursor = index;
      for (let level = 0; level < layers.length - 1; level++) {
        const layer = layers[level];
        const sibling = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
        if (sibling < layer.length) proof.push(layer[sibling]);
        cursor = Math.floor(cursor / 2);
      }
      return proof;
    };
    return {
      root: layers[layers.length - 1][0],
      entries: entries.map((entry, i) => ({ ...entry, proof: proofForIndex(i) })),
    };
  }

  function parseApprovedWalletText(text) {
    const rows = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    const byAddress = new Map();
    for (const row of rows) {
      const parts = row.split(/[\s,;]+/).filter(Boolean);
      const address = parts[0];
      if (!window.ethers.isAddress(address)) throw new Error(`Invalid wallet address: ${address || row}`);
      const allowance = parts[1] == null || parts[1] === '' ? 1 : safeInt(parts[1], 1, 4294967295, `Allowance for ${short(address)}`);
      const normalized = window.ethers.getAddress(address);
      const key = normalized.toLowerCase();
      if (byAddress.has(key) && byAddress.get(key).allowance !== allowance) throw new Error(`${short(normalized)} appears more than once with different allowances.`);
      byAddress.set(key, { address: normalized, allowance });
    }
    return [...byAddress.values()].sort((a,b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  }

  function approvedWalletText(entries) {
    return (entries || []).map(row => `${row.address},${row.allowance}`).join('\n');
  }

  async function ensureCloudCreator(state) {
    if (!window.RelicForgeCloud?.enabled?.()) throw new Error('Relic Forge Cloud must be connected to manage approved-wallet proofs from the dashboard.');
    const sg = await signer();
    const who = window.ethers.getAddress(await sg.getAddress());
    if (who.toLowerCase() !== state.creator.toLowerCase()) throw new Error('Connect the collection creator wallet.');
    await window.RelicForgeCloud.ensureSignedIn(who);
    return { sg, who };
  }

  async function loadApprovedWallets(state, stageId) {
    await ensureCloudCreator(state);
    const result = await window.RelicForgeCloud.json(`/api/rc47b/collections/${CHAIN_ID}/${encodeURIComponent(state.address)}/whitelist/${Number(stageId)}`, {}, true);
    const textarea = $(`rfccApprovedWallets${Number(stageId)}`);
    if (textarea) textarea.value = approvedWalletText(result?.entries || []);
    const note = $(`rfccApprovedWalletStatus${Number(stageId)}`);
    if (note) {
      const count = Number(result?.entries?.length || 0);
      const matches = result?.matchesOnchain !== false;
      note.textContent = `${count.toLocaleString()} approved wallet${count===1?'':'s'} loaded.${matches ? '' : ' The stored proof list does not match the current onchain list; saving will rebuild and synchronize it.'}`;
      note.classList.toggle('warn', !matches);
    }
    return result;
  }

  async function publishApprovedWallets(state, stageId, tree) {
    await window.RelicForgeCloud.json(
      `/api/rc47b/collections/${CHAIN_ID}/${encodeURIComponent(state.address)}/whitelist/${Number(stageId)}`,
      { method:'PUT', body:JSON.stringify({ projectId:null, merkleRoot:tree.root, entries:tree.entries, sourceType:2, sourceChainId:0, sourceContract:null, snapshotBlock:0 }) },
      true
    );
  }

  async function readState(address, snapshot = null) {
    const rp = provider();

    // The legacy dashboard already fetched the expensive V1 collection snapshot.
    // Reuse it on first render and query only the finance/randomness fields that
    // are not part of that snapshot. This avoids rereading every phase twice.
    if (
      snapshot &&
      String(snapshot.address || '').toLowerCase() === String(address || '').toLowerCase()
    ) {
      const c = new window.ethers.Contract(address, COLLECTION_ABI, rp);
      const [randomnessProviderRaw, accruedPlatformFees, balance] = await Promise.all([
        c.randomnessProvider().catch(() => ZERO),
        c.accruedPlatformFees().catch(() => 0n),
        rp.getBalance(address),
      ]);

      const randomnessProvider = window.ethers.isAddress(randomnessProviderRaw)
        ? window.ethers.getAddress(randomnessProviderRaw)
        : ZERO;

      let revealCredit = 0n;
      let revealRequestPrice = 0n;
      if (randomnessProvider !== ZERO) {
        try {
          const r = new window.ethers.Contract(randomnessProvider, RANDOMNESS_ABI, rp);
          [revealCredit, revealRequestPrice] = await Promise.all([
            r.nativeCredit(address),
            r.quoteRequestPrice(),
          ]);
        } catch (_) {}
      }

      const reserved = BigInt(accruedPlatformFees);
      const contractBalance = BigInt(balance);
      const creatorBalance = contractBalance > reserved ? contractBalance - reserved : 0n;
      const nextRaw = snapshot.nextReveal || null;
      const nextReveal = nextRaw ? {
        sequence: Number(nextRaw.sequence || 0),
        kind: Number(nextRaw.kind || 0),
        start: Number(nextRaw.startTokenId ?? nextRaw.start ?? 0),
        end: Number(nextRaw.endTokenId ?? nextRaw.end ?? 0),
        cursor: Number(nextRaw.cursor ?? nextRaw.startTokenId ?? nextRaw.start ?? 0),
        fulfilled: Boolean(nextRaw.fulfilled),
      } : null;

      const creator = window.ethers.getAddress(snapshot.creator || snapshot.owner);
      const controller = window.ethers.getAddress(snapshot.controller || ZERO);
      const payoutReceiver = window.ethers.getAddress(snapshot.payoutReceiver);
      const royaltyReceiver = window.ethers.getAddress(snapshot.royaltyReceiver);
      const deferred = Number(snapshot.deferredPendingCount || 0);

      return {
        address: window.ethers.getAddress(address),
        creator,
        controller,
        controllerActive: snapshot.controllerActive != null
          ? Boolean(snapshot.controllerActive)
          : controller.toLowerCase() !== ZERO.toLowerCase(),
        dataAddress: window.ethers.getAddress(snapshot.dataAddress),
        payoutReceiver,
        royaltyReceiver,
        royaltyBps: Number(snapshot.royaltyBps || 0),
        randomnessProvider,
        maxSupply: Number(snapshot.maxSupply || 0),
        totalMinted: Number(snapshot.totalMinted || 0),
        mintEnabled: Boolean(snapshot.masterMintEnabled),
        futureRevealMode: Number(snapshot.futureRevealMode || 0),
        deferredPendingCount: deferred,
        nextRequestSequence: Number(snapshot.nextRequestSequence || 0),
        nextProcessSequence: Number(snapshot.nextProcessSequence || 0),
        nextEpochStartToken: Number(snapshot.nextEpochStartToken || 0),
        nextReveal,
        revealQueue: Number(snapshot.revealQueuePending || 0),
        phases: Array.isArray(snapshot.phases) ? snapshot.phases : [],
        holderRenderEnabled: Boolean(snapshot.holderRenderEnabled),
        defaultRenderMode: Number(snapshot.defaultRenderMode || 0),
        flattenedRenderBaseURI: String(snapshot.flattenedRenderBaseURI || ''),
        accruedPlatformFees: reserved,
        contractBalance,
        creatorBalance,
        contentSealed: Boolean(snapshot.contentSealed ?? snapshot.sealed),
        provenanceHash: String(snapshot.provenance || ZERO_HASH),
        revealCredit: BigInt(revealCredit),
        revealRequestPrice: BigInt(revealRequestPrice),
        deferredRequestable: snapshot.deferredRequestable != null
          ? Boolean(snapshot.deferredRequestable)
          : deferred > 0 && Number(snapshot.nextEpochStartToken || 0) <= Number(snapshot.totalMinted || 0),
      };
    }
    const c = new window.ethers.Contract(address, COLLECTION_ABI, rp);
    const [
      creator, controller, dataAddress, payoutReceiver, royaltyReceiver, royaltyBps, randomnessProvider,
      maxSupply, totalMinted, mintEnabled, futureRevealMode, deferredPendingCount,
      nextRequestSequence, nextProcessSequence, nextEpochStartToken, phaseCount,
      holderRenderEnabled, defaultRenderMode, flattenedRenderBaseURI, accruedPlatformFees, balance,
    ] = await Promise.all([
      c.creator(), c.controller(), c.dataContract(), c.payoutReceiver(), c.royaltyReceiver(), c.royaltyBps(), c.randomnessProvider(),
      c.maxSupply(), c.totalMinted(), c.masterMintEnabled(), c.futureRevealMode(), c.deferredPendingCount(),
      c.nextRequestSequence(), c.nextProcessSequence(), c.nextEpochStartToken(), c.phaseCount(),
      c.holderRenderModeEnabled().catch(()=>false), c.defaultRenderMode().catch(()=>0n), c.flattenedRenderBaseURI().catch(()=>''), c.accruedPlatformFees().catch(()=>0n), rp.getBalance(address),
    ]);

    const count = Number(phaseCount);
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000) throw new Error('Unexpected mint-stage count returned by collection.');
    const phases = [];
    for (let start=1; start<=count; start+=25) {
      const ids = Array.from({length:Math.min(25,count-start+1)},(_,i)=>start+i);
      phases.push(...await Promise.all(ids.map(async id => {
        const raw = await c.phases(id);
        const open = await c.phaseIsOpen(id).catch(()=>false);
        return {
          id,
          price: BigInt(raw.price ?? raw[0]),
          startTime:Number(raw.startTime ?? raw[1]),
          endTime:Number(raw.endTime ?? raw[2]),
          phaseSupply:Number(raw.phaseSupply ?? raw[3]),
          minted:Number(raw.minted ?? raw[4]),
          maxPerWallet:Number(raw.maxPerWallet ?? raw[5]),
          merkleRoot:String(raw.merkleRoot ?? raw[6]),
          accessType:Number(raw.accessType ?? raw[7]),
          priority:Number(raw.priority ?? raw[8]),
          enabled:Boolean(raw.enabled ?? raw[9]),
          open:Boolean(open),
        };
      })));
    }

    const nextReq = Number(nextRequestSequence), nextProc = Number(nextProcessSequence);
    let nextReveal = null;
    if (nextProc < nextReq) {
      try {
        const raw = await c.revealRequests(nextProc);
        nextReveal = {
          sequence:nextProc,
          kind:Number(raw.kind ?? raw[0]),
          start:Number(raw.startTokenId ?? raw[1]),
          end:Number(raw.endTokenId ?? raw[2]),
          cursor:Number(raw.cursor ?? raw[3]),
          fulfilled:Boolean(raw.fulfilled ?? raw[5]),
        };
      } catch (_) {}
    }

    let contentSealed = true, provenanceHash = ZERO_HASH;
    try {
      const d = new window.ethers.Contract(dataAddress, DATA_ABI, rp);
      [contentSealed, provenanceHash] = await Promise.all([d.contentSealed(), d.provenanceHash()]);
    } catch (_) {}

    let revealCredit = 0n, revealRequestPrice = 0n;
    if (window.ethers.isAddress(randomnessProvider) && randomnessProvider !== ZERO) {
      try {
        const r = new window.ethers.Contract(randomnessProvider, RANDOMNESS_ABI, rp);
        [revealCredit, revealRequestPrice] = await Promise.all([r.nativeCredit(address), r.quoteRequestPrice()]);
      } catch (_) {}
    }

    const reserved = BigInt(accruedPlatformFees);
    const creatorBalance = BigInt(balance) > reserved ? BigInt(balance)-reserved : 0n;
    const deferred = Number(deferredPendingCount);
    return {
      address, creator:window.ethers.getAddress(creator), controller:window.ethers.getAddress(controller),
      controllerActive:String(controller).toLowerCase() !== ZERO.toLowerCase(),
      dataAddress:window.ethers.getAddress(dataAddress), payoutReceiver:window.ethers.getAddress(payoutReceiver),
      royaltyReceiver:window.ethers.getAddress(royaltyReceiver), royaltyBps:Number(royaltyBps),
      randomnessProvider:window.ethers.getAddress(randomnessProvider), maxSupply:Number(maxSupply), totalMinted:Number(totalMinted),
      mintEnabled:Boolean(mintEnabled), futureRevealMode:Number(futureRevealMode), deferredPendingCount:deferred,
      nextRequestSequence:nextReq, nextProcessSequence:nextProc, nextEpochStartToken:Number(nextEpochStartToken), nextReveal,
      revealQueue:Math.max(0,nextReq-nextProc), phases, holderRenderEnabled:Boolean(holderRenderEnabled),
      defaultRenderMode:Number(defaultRenderMode), flattenedRenderBaseURI:String(flattenedRenderBaseURI||''),
      accruedPlatformFees:reserved, contractBalance:BigInt(balance), creatorBalance,
      contentSealed:Boolean(contentSealed), provenanceHash:String(provenanceHash), revealCredit:BigInt(revealCredit), revealRequestPrice:BigInt(revealRequestPrice),
      deferredRequestable:deferred > 0 && Number(nextEpochStartToken) <= Number(totalMinted),
    };
  }

  function stageCard(p, canControl) {
    const statusText = p.open ? 'OPEN NOW' : p.enabled ? 'ENABLED' : 'PAUSED';
    const allowlist = `<details class="rfcc-advanced rfcc-allowlist"><summary>Approved Wallets</summary>
      <p class="rfcc-help">Add or remove wallets here. Use one wallet per line. Add an optional mint allowance after a comma; for example <code>0x1234...,2</code>. Relic Forge rebuilds the verification data and publishes the matching wallet proofs automatically.</p>
      <textarea id="rfccApprovedWallets${p.id}" rows="8" placeholder="0xWalletAddress,1\n0xAnotherWallet,2" ${canControl?'':'disabled'}></textarea>
      <div class="rfcc-note" id="rfccApprovedWalletStatus${p.id}">Use Load Current List to retrieve the currently published wallets for this stage.</div>
      <div class="rfcc-actions"><button data-rfcc-action="load-allowlist" data-id="${p.id}" ${canControl?'':'disabled'}>Load Current List</button><button data-rfcc-action="save-allowlist" data-id="${p.id}" ${canControl?'':'disabled'}>Save Approved Wallets</button></div>
      <details class="rfcc-technical"><summary>Technical verification</summary><div class="rfcc-tech-grid"><span>Current root</span><code>${esc(p.merkleRoot)}</code></div></details>
    </details>`;
    return `<article class="rfcc-stage" data-rfcc-stage="${p.id}">
      <div class="rfcc-stage-head"><div><strong>Mint Stage ${p.id}</strong><small>${p.accessType===1?'Approved Wallets':'Everyone'} Ã‚Â· ${p.minted.toLocaleString()} minted</small></div><span>${statusText}</span></div>
      <div class="rfcc-grid rfcc-grid-4">
        <label><span>Who can mint</span><select data-k="access" ${canControl?'':'disabled'}><option value="0" ${p.accessType===0?'selected':''}>Everyone</option><option value="1" ${p.accessType===1?'selected':''}>Approved wallets only</option></select><small>Choose Approved wallets only, then save the wallet list below.</small></label>
        <label><span>Price</span><div class="rfcc-suffix"><input data-k="price" type="number" min="0" step="0.0001" value="${esc(window.ethers.formatEther(p.price))}" ${canControl?'':'disabled'}/><b>ETH</b></div></label>
        <label><span>Stage supply limit</span><input data-k="supply" type="number" min="${p.minted}" max="4294967295" value="${p.phaseSupply}" ${canControl?'':'disabled'}/><small>0 = no stage-specific cap</small></label>
        <label><span>Max per wallet</span><input data-k="wallet" type="number" min="0" max="4294967295" value="${p.maxPerWallet}" ${canControl?'':'disabled'}/><small>0 = unlimited</small></label>
        <label><span>Starts</span><input data-k="start" type="datetime-local" value="${esc(dtValue(p.startTime))}" ${canControl?'':'disabled'}/></label>
        <label><span>Ends</span><input data-k="end" type="datetime-local" value="${esc(dtValue(p.endTime))}" ${canControl?'':'disabled'}/><small>Blank = no automatic end</small></label>
        <label><span>Priority</span><input data-k="priority" type="number" min="0" max="65535" value="${p.priority}" ${canControl?'':'disabled'}/><small>Higher priority wins when stages overlap</small></label>
      </div>
      ${allowlist}
      <div class="rfcc-actions"><button data-rfcc-action="save-stage" data-id="${p.id}" ${canControl?'':'disabled'}>Save Stage</button><button class="${p.enabled?'danger':''}" data-rfcc-action="toggle-stage" data-id="${p.id}" ${canControl?'':'disabled'}>${p.enabled?'Pause Stage':'Enable Stage'}</button></div>
    </article>`;
  }

  function renderPanel(s, wallet) {
    const canControl = !!wallet && wallet.toLowerCase() === s.creator.toLowerCase() && s.controllerActive;
    const payoutWalletConnected = !!wallet && wallet.toLowerCase() === s.payoutReceiver.toLowerCase();
    const revealRequestsRemaining = s.revealRequestPrice > 0n ? Number(s.revealCredit / s.revealRequestPrice) : null;
    const renounceSafe = s.contentSealed && s.deferredPendingCount === 0 && (!s.mintEnabled || s.totalMinted >= s.maxSupply || s.futureRevealMode === 1);
    const nextRevealText = !s.nextReveal ? 'No reveal request is waiting.' : s.nextReveal.fulfilled
      ? `Verified randomness received for NFTs #${s.nextReveal.cursor}Ã¢â‚¬â€œ#${s.nextReveal.end}.`
      : `Waiting for verified randomness for NFTs #${s.nextReveal.start}Ã¢â‚¬â€œ#${s.nextReveal.end}.`;

    return `<section class="rfcc-panel" id="rfCompleteCreatorControls">
      <div class="rfcc-title"><div><span class="eyebrow">COMPLETE CREATOR CONTROLS</span><h3>Manage your launched collection</h3><p>Every creator-facing control available in the collection contracts is surfaced here, including post-launch approved-wallet management. Permanent actions are kept in a separate danger area.</p></div><button class="ghost-btn" data-rfcc-action="refresh">Refresh</button></div>
      <div class="rfcc-status" id="rfCompleteCreatorStatus">Ready.</div>

      <section class="rfcc-section"><div class="rfcc-section-head"><div><h4>Minting</h4><p>Pause the entire mint, or make creator copies to any wallet.</p></div><span class="rfcc-pill ${s.mintEnabled?'live':'paused'}">${s.mintEnabled?'MINTING LIVE':'MINTING PAUSED'}</span></div>
        <div class="rfcc-actions"><button class="${s.mintEnabled?'danger':''}" data-rfcc-action="toggle-mint" ${canControl?'':'disabled'}>${s.mintEnabled?'Pause Mint':'Resume Mint'}</button></div>
        <div class="rfcc-grid rfcc-grid-3"><label><span>Creator mint recipient</span><input id="rfccCreatorRecipient" type="text" value="${esc(wallet || s.creator)}" ${canControl?'':'disabled'}/></label><label><span>Quantity</span><input id="rfccCreatorQty" type="number" min="1" max="50" value="1" ${canControl && s.totalMinted<s.maxSupply?'':'disabled'}/></label><div class="rfcc-field-action"><button data-rfcc-action="creator-mint" ${canControl && s.totalMinted<s.maxSupply?'':'disabled'}>Mint Creator Copies</button></div></div>
      </section>

      <section class="rfcc-section"><div class="rfcc-section-head"><div><h4>Mint Stages</h4><p>Create, edit, pause, or enable each stage independently. Stage dates, price, supply and wallet limits can all be changed while creator control remains active.</p></div></div>
        <div class="rfcc-stage-list">${s.phases.length?s.phases.map(p=>stageCard(p,canControl)).join(''):'<div class="rfcc-empty">No mint stages exist yet.</div>'}</div>
        <details class="rfcc-add"><summary>Add another mint stage</summary>
          <div class="rfcc-grid rfcc-grid-4">
            <label><span>Who can mint</span><select id="rfccNewAccess" ${canControl?'':'disabled'}><option value="0">Everyone</option><option value="1">Approved wallets only</option></select></label>
            <label><span>Price</span><div class="rfcc-suffix"><input id="rfccNewPrice" type="number" min="0" step="0.0001" value="0" ${canControl?'':'disabled'}/><b>ETH</b></div></label>
            <label><span>Stage supply limit</span><input id="rfccNewSupply" type="number" min="0" value="0" ${canControl?'':'disabled'}/><small>0 = no stage-specific cap</small></label>
            <label><span>Max per wallet</span><input id="rfccNewWallet" type="number" min="0" value="0" ${canControl?'':'disabled'}/></label>
            <label><span>Starts</span><input id="rfccNewStart" type="datetime-local" ${canControl?'':'disabled'}/></label>
            <label><span>Ends</span><input id="rfccNewEnd" type="datetime-local" ${canControl?'':'disabled'}/></label>
            <label><span>Priority</span><input id="rfccNewPriority" type="number" min="0" max="65535" value="0" ${canControl?'':'disabled'}/></label>
            <label class="rfcc-check"><input id="rfccNewEnabled" type="checkbox" checked ${canControl?'':'disabled'}/> Enable this stage immediately</label>
          </div>
          <label><span>Approved wallets</span><textarea id="rfccNewApprovedWallets" rows="7" placeholder="Only needed when Who can mint is Approved wallets only.
0xWalletAddress,1
0xAnotherWallet,2" ${canControl?'':'disabled'}></textarea><small>One wallet per line. Optional number after a comma sets that wallet's mint allowance.</small></label>
          <div class="rfcc-actions"><button data-rfcc-action="create-stage" ${canControl?'':'disabled'}>Create Mint Stage</button></div>
        </details>
      </section>

      <section class="rfcc-section"><div class="rfcc-section-head"><div><h4>Reveal</h4><p>Choose how NFTs minted from this point forward reveal. Changing this does not change NFTs that are already waiting to reveal.</p></div></div>
        <div class="rfcc-grid rfcc-grid-3">
          <label><span>Future reveal choice</span><select id="rfccRevealMode" ${canControl?'':'disabled'}><option value="1" ${s.futureRevealMode===1?'selected':''}>Forge Reveal Ã¢â‚¬â€ start reveal after each mint</option><option value="0" ${s.futureRevealMode===0?'selected':''}>Reveal Later Ã¢â‚¬â€ I choose when to reveal</option></select></label>
          <div class="rfcc-field-action"><button data-rfcc-action="save-reveal-mode" ${canControl?'':'disabled'}>Save Future Reveal Choice</button></div>
          <div class="rfcc-readout"><span>NFTs waiting to reveal</span><strong>${s.deferredPendingCount.toLocaleString()}</strong></div>
        </div>
        <div class="rfcc-note">${esc(nextRevealText)}</div>
        <div class="rfcc-actions"><button data-rfcc-action="request-reveal" ${canControl && s.deferredRequestable?'':'disabled'}>Reveal Pending NFTs</button><label class="rfcc-inline"><span>NFTs to complete per transaction</span><input id="rfccRevealSteps" type="number" min="1" max="500" value="50" ${s.nextReveal?.fulfilled?'':'disabled'}/></label><button data-rfcc-action="process-reveal" ${s.nextReveal?.fulfilled?'':'disabled'}>Complete Reveal</button></div>
      </section>

      <section class="rfcc-section"><div class="rfcc-section-head"><div><h4>Reveal Balance</h4><p>Verified randomness is paid from a balance dedicated to this collection. Anyone can add funds; only the current payout wallet can withdraw unused funds.</p></div></div>
        <div class="rfcc-stats"><div><span>Available</span><strong>${fmtEth(s.revealCredit)} ETH</strong></div><div><span>Estimated request</span><strong>${fmtEth(s.revealRequestPrice)} ETH</strong></div><div><span>Estimated requests remaining</span><strong>${revealRequestsRemaining==null?'Ã¢â‚¬â€':revealRequestsRemaining.toLocaleString()}</strong></div></div>
        <div class="rfcc-grid rfcc-grid-3"><label><span>Add reveal balance</span><div class="rfcc-suffix"><input id="rfccFundReveal" type="number" min="0" step="0.001" placeholder="0.01"/><b>ETH</b></div></label><div class="rfcc-field-action"><button data-rfcc-action="fund-reveal">Add Balance</button></div><div></div><label><span>Withdraw unused balance</span><div class="rfcc-suffix"><input id="rfccWithdrawReveal" type="number" min="0" step="0.001" placeholder="0.01" ${payoutWalletConnected?'':'disabled'}/><b>ETH</b></div><small>${payoutWalletConnected?'Sent to the payout wallet.':'Connect the current payout wallet to withdraw.'}</small></label><div class="rfcc-field-action"><button data-rfcc-action="withdraw-reveal" ${payoutWalletConnected?'':'disabled'}>Withdraw Reveal Balance</button></div></div>
      </section>

      <section class="rfcc-section"><div class="rfcc-section-head"><div><h4>Payouts & Royalties</h4><p>Choose where collection earnings are sent and where secondary-sale royalties are directed.</p></div></div>
        <div class="rfcc-grid rfcc-grid-3"><label><span>Payout wallet</span><input id="rfccPayout" type="text" value="${esc(s.payoutReceiver)}" ${canControl?'':'disabled'}/></label><label><span>Royalty wallet</span><input id="rfccRoyaltyWallet" type="text" value="${esc(s.royaltyReceiver)}" ${canControl?'':'disabled'}/></label><label><span>Royalty</span><div class="rfcc-suffix"><input id="rfccRoyaltyPct" type="number" min="0" max="10" step="0.01" value="${esc(String(s.royaltyBps/100))}" ${canControl?'':'disabled'}/><b>%</b></div></label></div>
        <div class="rfcc-actions"><button data-rfcc-action="save-money" ${canControl?'':'disabled'}>Save Payout & Royalty Settings</button></div>
        <div class="rfcc-stats"><div><span>Creator earnings ready</span><strong>${fmtEth(s.creatorBalance)} ETH</strong></div><div><span>Platform fees waiting to forward</span><strong>${fmtEth(s.accruedPlatformFees)} ETH</strong></div><div><span>Contract balance</span><strong>${fmtEth(s.contractBalance)} ETH</strong></div></div>
        <div class="rfcc-actions"><button data-rfcc-action="withdraw-creator" ${s.creatorBalance>0n?'':'disabled'}>Send Creator Earnings to Payout Wallet</button><button class="ghost-btn" data-rfcc-action="forward-fees" ${s.accruedPlatformFees>0n?'':'disabled'}>Forward Reserved Platform Fees</button></div>
      </section>

      <section class="rfcc-section"><div class="rfcc-section-head"><div><h4>Display Settings</h4><p>${s.contentSealed?'These settings are locked because the collection artwork and metadata have already been finalized.':'Choose the collection default display and whether token owners may switch display mode.'}</p></div><span class="rfcc-pill ${s.contentSealed?'paused':'live'}">${s.contentSealed?'LOCKED':'EDITABLE'}</span></div>
        <div class="rfcc-grid rfcc-grid-3"><label><span>Default display</span><select id="rfccDisplayMode" ${canControl&&!s.contentSealed?'':'disabled'}><option value="0" ${s.defaultRenderMode===0?'selected':''}>Fully Onchain Artwork</option><option value="1" ${s.defaultRenderMode===1?'selected':''}>Cached Display</option></select></label><label><span>Display cache address</span><input id="rfccDisplayUri" type="url" value="${esc(s.flattenedRenderBaseURI)}" ${canControl&&!s.contentSealed?'':'disabled'}/></label><label class="rfcc-check"><input id="rfccHolderDisplay" type="checkbox" ${s.holderRenderEnabled?'checked':''} ${canControl&&!s.contentSealed?'':'disabled'}/> Allow token owners to choose their display</label></div>
        <div class="rfcc-actions"><button data-rfcc-action="save-display" ${canControl&&!s.contentSealed?'':'disabled'}>Save Display Settings</button></div>
      </section>

      <section class="rfcc-section rfcc-danger-zone"><div class="rfcc-section-head"><div><h4>Permanent Creator Control</h4><p>Surrendering creator control is irreversible. It removes your ability to pause minting, edit mint stages, change future reveal behavior, change payout/royalty settings, or creator-mint. Permissionless reveal completion and payout forwarding still work.</p></div></div>
        <div class="rfcc-note ${renounceSafe?'good':'warn'}">${renounceSafe?'Contract safety checks currently allow creator control to be surrendered.':'Not ready: artwork must be locked, no Reveal-Later NFTs may remain pending, and an unsold live mint must use Forge Reveal.'}</div>
        <label><span>Type SURRENDER to confirm</span><input id="rfccSurrenderConfirm" type="text" autocomplete="off" ${canControl&&renounceSafe?'':'disabled'}/></label>
        <div class="rfcc-actions"><button class="danger" data-rfcc-action="renounce" ${canControl&&renounceSafe?'':'disabled'}>Permanently Surrender Creator Control</button></div>
      </section>

      <details class="rfcc-technical"><summary>Technical collection details</summary><div class="rfcc-tech-grid"><span>Collection</span><code>${esc(s.address)}</code><span>Artwork data</span><code>${esc(s.dataAddress)}</code><span>Reveal service</span><code>${esc(s.randomnessProvider)}</code><span>Creator control</span><code>${esc(s.controllerActive?s.controller:'SURRENDERED')}</code><span>Content fingerprint</span><code>${esc(s.provenanceHash)}</code></div></details>
    </section>`;
  }

  function hideLegacySections(detail) {
    const hide = new Set(['mint & creator controls','reveal controls','mint phases','mint stages','collection integrity']);
    detail.querySelectorAll('.launched-section').forEach(section => {
      const h = section.querySelector('h4')?.textContent?.trim().toLowerCase();
      if (hide.has(h)) section.classList.add('rfcc-legacy-hidden');
    });
  }

  async function walletAddress() {
    try {
      const injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
      const accounts = await injected?.request?.({method:'eth_accounts'});
      return accounts?.[0] && window.ethers?.isAddress(accounts[0]) ? window.ethers.getAddress(accounts[0]) : null;
    } catch (_) { return null; }
  }


  function updateLegacySummary(detail, s) {
    const stats = [...detail.children].find(el => el.classList?.contains('launched-stats'));
    if (!stats) return;
    stats.innerHTML = `<div><span>Supply</span><strong>${s.totalMinted.toLocaleString()} / ${s.maxSupply.toLocaleString()}</strong></div><div><span>Minting</span><strong>${s.mintEnabled ? 'LIVE' : 'PAUSED'}</strong></div><div><span>Future reveal</span><strong>${s.futureRevealMode === 1 ? 'Forge Reveal' : 'Reveal Later'}</strong></div><div><span>Mint stages</span><strong>${s.phases.length.toLocaleString()}</strong></div>`;
  }

  async function renderForDetail(detail, snapshot = null) {
    if (!detail || !detail.querySelector('[data-v1-dashboard-action]')) return;
    const address = parseAddressFromDetail(detail);
    if (!address) return;
    const serial = ++renderSerial;
    currentAddress = address;
    hideLegacySections(detail);
    let host = $('rfCompleteCreatorControls') || $('rfCompleteCreatorControlsLoading');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rfCompleteCreatorControlsLoading';
      host.className = 'rfcc-loading';
      host.textContent = 'Loading complete creator controlsÃ¢â‚¬Â¦';
      const firstSection = detail.querySelector('.launched-section');
      if (firstSection) detail.insertBefore(host, firstSection); else detail.appendChild(host);
    }
    try {
      const [state, wallet] = await Promise.all([readState(address, snapshot), walletAddress()]);
      if (serial !== renderSerial || currentAddress?.toLowerCase() !== address.toLowerCase()) return;
      updateLegacySummary(detail, state);
      window.__RFCC_CURRENT_STATE__ = state;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderPanel(state, wallet);
      const next = wrapper.firstElementChild;
      const old = $('rfCompleteCreatorControls') || $('rfCompleteCreatorControlsLoading');
      old?.replaceWith(next);
      bindActions(next, state, wallet);
      hideLegacySections(detail);
    } catch (error) {
      const loading = $('rfCompleteCreatorControlsLoading');
      if (loading) loading.textContent = `Unable to load complete creator controls: ${error.message}`;
    }
  }

  async function writeCollection(state, fn, pending, done) {
    if (busy) return;
    busy = true;
    try {
      status(pending);
      const sg = await signer();
      const address = window.ethers.getAddress(await sg.getAddress());
      if (address.toLowerCase() !== state.creator.toLowerCase()) throw new Error('Connect the collection creator wallet for this action.');
      if (!state.controllerActive) throw new Error('Creator control has already been permanently surrendered.');
      const c = new window.ethers.Contract(state.address, COLLECTION_ABI, sg);
      const tx = await fn(c, sg);
      status(`Transaction submitted Ã‚Â· ${short(tx.hash)}. Waiting for confirmationÃ¢â‚¬Â¦`);
      await tx.wait();
      await refreshCurrent();
      status(done);
    } catch (error) { status(error.shortMessage || error.message, true); }
    finally { busy = false; }
  }

  async function permissionlessWrite(state, fn, pending, done) {
    if (busy) return;
    busy = true;
    try {
      status(pending);
      const sg = await signer();
      const c = new window.ethers.Contract(state.address, COLLECTION_ABI, sg);
      const tx = await fn(c, sg);
      status(`Transaction submitted Ã‚Â· ${short(tx.hash)}. Waiting for confirmationÃ¢â‚¬Â¦`);
      await tx.wait(); await refreshCurrent(); status(done);
    } catch (error) { status(error.shortMessage || error.message, true); }
    finally { busy = false; }
  }

  function readStageElement(id) {
    const card = document.querySelector(`[data-rfcc-stage="${id}"]`);
    if (!card) throw new Error('Mint stage editor is unavailable.');
    const get = key => card.querySelector(`[data-k="${key}"]`);
    const access = safeInt(get('access').value,0,1,'Who can mint');
    const price = window.ethers.parseEther(String(Math.max(0,Number(get('price').value||0))));
    const start = parseDt(get('start').value,'Start date');
    const end = parseDt(get('end').value,'End date');
    if (end && end <= start) throw new Error('End must be later than start.');
    const supply = safeInt(get('supply').value,0,4294967295,'Stage supply limit');
    const wallet = safeInt(get('wallet').value,0,4294967295,'Wallet limit');
    const priority = safeInt(get('priority').value,0,65535,'Priority');
    const stageId = Number(card.dataset.rfccStage);
    const currentStage = window.__RFCC_CURRENT_STATE__?.phases?.find(row => row.id === stageId);
    let root = access===0 ? ZERO_HASH : String(currentStage?.merkleRoot || ZERO_HASH);
    if (access===1 && root===ZERO_HASH) throw new Error('Add approved wallets and use Save Approved Wallets before saving this stage as restricted.');
    return {access,price,start,end,supply,wallet,priority,root};
  }

  async function refreshCurrent() {
    if (currentAddress && window.RelicForgeForge?.refreshLaunchedCollection) {
      await window.RelicForgeForge.refreshLaunchedCollection(currentAddress);
      return;
    }
    const detail = $('launchedCollectionDetail');
    if (detail) await renderForDetail(detail, null);
  }

  function bindActions(host, state, wallet) {
    host.addEventListener('click', async event => {
      try {
      const btn = event.target.closest('[data-rfcc-action]');
      if (!btn || btn.disabled) return;
      const action = btn.dataset.rfccAction;
      if (action==='refresh') { await refreshCurrent(); return; }
      if (action==='toggle-mint') return writeCollection(state,c=>c.setMasterMintEnabled(!state.mintEnabled),state.mintEnabled?'Pausing mintÃ¢â‚¬Â¦':'Resuming mintÃ¢â‚¬Â¦',state.mintEnabled?'Mint paused.':'Mint resumed.');
      if (action==='creator-mint') {
        const to=String($('rfccCreatorRecipient')?.value||'').trim(); if(!window.ethers.isAddress(to)) return status('Creator mint recipient is not a valid wallet address.',true);
        const qty=safeInt($('rfccCreatorQty')?.value,1,50,'Quantity');
        return writeCollection(state,c=>c.creatorMint(to,qty),`Minting ${qty} creator cop${qty===1?'y':'ies'}Ã¢â‚¬Â¦`,'Creator mint confirmed.');
      }
      if (action==='load-allowlist') {
        const id=Number(btn.dataset.id);
        if (busy) return; busy=true;
        try { status(`Loading approved wallets for Mint Stage ${id}Ã¢â‚¬Â¦`); await loadApprovedWallets(state,id); status(`Approved wallets loaded for Mint Stage ${id}.`); }
        catch(e){status(e.shortMessage||e.message,true)} finally{busy=false}
        return;
      }
      if (action==='save-allowlist') {
        const id=Number(btn.dataset.id), old=state.phases.find(p=>p.id===id); if(!old)return status('Mint stage was not found.',true);
        const card=document.querySelector(`[data-rfcc-stage="${id}"]`); if(!card)return status('Mint stage editor is unavailable.',true);
        const entries=parseApprovedWalletText($(`rfccApprovedWallets${id}`)?.value||'');
        const tree=buildApprovedWalletTree(entries,state.address,id);
        if (busy) return; busy=true;
        try {
          await ensureCloudCreator(state);
          const get=k=>card.querySelector(`[data-k="${k}"]`);
          const price=window.ethers.parseEther(String(Math.max(0,Number(get('price').value||0))));
          const start=parseDt(get('start').value,'Start date'), end=parseDt(get('end').value,'End date'); if(end&&end<=start)throw new Error('End must be later than start.');
          const supply=safeInt(get('supply').value,0,4294967295,'Stage supply limit'); if(supply!==0&&supply<old.minted)throw new Error(`Stage supply cannot be lower than ${old.minted}, which are already minted.`);
          const walletLimit=safeInt(get('wallet').value,0,4294967295,'Wallet limit'), priority=safeInt(get('priority').value,0,65535,'Priority');
          const sg=await signer(), c=new window.ethers.Contract(state.address,COLLECTION_ABI,sg);
          status(`Updating Mint Stage ${id} with ${entries.length.toLocaleString()} approved wallet${entries.length===1?'':'s'}Ã¢â‚¬Â¦`);
          const tx=await c.updatePhase(id,price,start,end,supply,walletLimit,tree.root,1,priority); await tx.wait();
          status('Onchain wallet verification updated. Publishing matching mint proofsÃ¢â‚¬Â¦');
          await publishApprovedWallets(state,id,tree);
          await refreshCurrent();
          status(`Mint Stage ${id} approved-wallet list updated and published.`);
        } catch(e){status(e.shortMessage||e.message,true)} finally{busy=false}
        return;
      }
      if (action==='save-stage') {
        const id=Number(btn.dataset.id), old=state.phases.find(p=>p.id===id), v=readStageElement(id);
        if (!old) return status('Mint stage was not found.',true);
        if (v.supply!==0 && v.supply<old.minted) return status(`Stage supply cannot be lower than ${old.minted}, which are already minted.`,true);
        return writeCollection(state,c=>c.updatePhase(id,v.price,v.start,v.end,v.supply,v.wallet,v.root,v.access,v.priority),`Saving Mint Stage ${id}Ã¢â‚¬Â¦`,`Mint Stage ${id} updated.`);
      }
      if (action==='toggle-stage') {
        const id=Number(btn.dataset.id), old=state.phases.find(p=>p.id===id); if(!old)return;
        return writeCollection(state,c=>c.setPhaseEnabled(id,!old.enabled),`${old.enabled?'Pausing':'Enabling'} Mint Stage ${id}Ã¢â‚¬Â¦`,`Mint Stage ${id} ${old.enabled?'paused':'enabled'}.`);
      }
      if (action==='create-stage') {
        const access=safeInt($('rfccNewAccess')?.value,0,1,'Who can mint');
        const price=window.ethers.parseEther(String(Math.max(0,Number($('rfccNewPrice')?.value||0))));
        const start=parseDt($('rfccNewStart')?.value,'Start date'), end=parseDt($('rfccNewEnd')?.value,'End date'); if(end&&end<=start)return status('End must be later than start.',true);
        const supply=safeInt($('rfccNewSupply')?.value,0,4294967295,'Stage supply limit'), maxWallet=safeInt($('rfccNewWallet')?.value,0,4294967295,'Wallet limit'), priority=safeInt($('rfccNewPriority')?.value,0,65535,'Priority');
        const enabled=!!$('rfccNewEnabled')?.checked;
        if (busy)return; busy=true;
        try {
          let sg;
          if (access===1) { ({sg}=await ensureCloudCreator(state)); }
          else { sg=await signer(); const who=window.ethers.getAddress(await sg.getAddress()); if(who.toLowerCase()!==state.creator.toLowerCase())throw new Error('Connect the collection creator wallet.'); }
          const c=new window.ethers.Contract(state.address,COLLECTION_ABI,sg);
          const liveCount=Number(await c.phaseCount());
          let predictedId=liveCount+1, tree=null, root=ZERO_HASH;
          if(access===1){ const entries=parseApprovedWalletText($('rfccNewApprovedWallets')?.value||''); tree=buildApprovedWalletTree(entries,state.address,predictedId); root=tree.root; }
          status('Creating mint stageÃ¢â‚¬Â¦');
          const tx=await c.createPhase(price,start,end,supply,maxWallet,root,access,priority,enabled); const receipt=await tx.wait();
          let actualId=predictedId;
          for(const log of receipt.logs||[]){ try{const parsed=c.interface.parseLog(log); if(parsed?.name==='PhaseCreated'){actualId=Number(parsed.args.phaseId);break;}}catch(_){} }
          if(access===1){
            if(actualId!==predictedId){ tree=buildApprovedWalletTree(parseApprovedWalletText($('rfccNewApprovedWallets')?.value||''),state.address,actualId); status('Stage number changed while the transaction was pending. Correcting approved-wallet verificationÃ¢â‚¬Â¦'); const fix=await c.updatePhase(actualId,price,start,end,supply,maxWallet,tree.root,1,priority); await fix.wait(); }
            status('Mint stage created. Publishing approved-wallet proofsÃ¢â‚¬Â¦'); await publishApprovedWallets(state,actualId,tree);
          }
          await refreshCurrent(); status(`Mint Stage ${actualId} created${access===1?' with approved wallets published':''}.`);
        } catch(e){status(e.shortMessage||e.message,true)} finally{busy=false}
        return;
      }
      if (action==='save-reveal-mode') {
        const mode=safeInt($('rfccRevealMode')?.value,0,1,'Reveal choice');
        return writeCollection(state,c=>c.setFutureRevealMode(mode),'Saving future reveal choiceÃ¢â‚¬Â¦',`Future mints will use ${mode===1?'Forge Reveal':'Reveal Later'}.`);
      }
      if (action==='request-reveal') return writeCollection(state,c=>c.requestRevealEpoch(),'Starting reveal for pending NFTsÃ¢â‚¬Â¦','Reveal request created. Waiting for verified randomness.');
      if (action==='process-reveal') {
        const steps=safeInt($('rfccRevealSteps')?.value,1,500,'NFTs per transaction');
        return permissionlessWrite(state,c=>c.processReveal(steps),'Completing revealed NFTsÃ¢â‚¬Â¦','Reveal processing confirmed.');
      }
      if (action==='fund-reveal') {
        const amount=String($('rfccFundReveal')?.value||'').trim(); if(!amount||Number(amount)<=0)return status('Enter an amount to add to the reveal balance.',true);
        if (busy) return; busy=true;
        try { status('Adding reveal balanceÃ¢â‚¬Â¦'); const sg=await signer(); const r=new window.ethers.Contract(state.randomnessProvider,RANDOMNESS_ABI,sg); const tx=await r.fundConsumer(state.address,{value:window.ethers.parseEther(amount)}); status(`Transaction submitted Ã‚Â· ${short(tx.hash)}Ã¢â‚¬Â¦`); await tx.wait(); await refreshCurrent(); status('Reveal balance added.'); } catch(e){status(e.shortMessage||e.message,true)} finally{busy=false}
        return;
      }
      if (action==='withdraw-reveal') {
        const amount=String($('rfccWithdrawReveal')?.value||'').trim(); if(!amount||Number(amount)<=0)return status('Enter an amount to withdraw.',true);
        if (busy)return; busy=true;
        try { status('Withdrawing unused reveal balanceÃ¢â‚¬Â¦'); const sg=await signer(); const who=window.ethers.getAddress(await sg.getAddress()); if(who.toLowerCase()!==state.payoutReceiver.toLowerCase())throw new Error('Only the current payout wallet can withdraw unused reveal balance.'); const r=new window.ethers.Contract(state.randomnessProvider,RANDOMNESS_ABI,sg); const tx=await r.withdrawConsumerCredit(state.address,window.ethers.parseEther(amount)); status(`Transaction submitted Ã‚Â· ${short(tx.hash)}Ã¢â‚¬Â¦`); await tx.wait(); await refreshCurrent(); status('Unused reveal balance withdrawn to the payout wallet.'); } catch(e){status(e.shortMessage||e.message,true)} finally{busy=false}
        return;
      }
      if (action==='save-money') {
        const payout=String($('rfccPayout')?.value||'').trim(), royaltyWallet=String($('rfccRoyaltyWallet')?.value||'').trim();
        if(!window.ethers.isAddress(payout)||!window.ethers.isAddress(royaltyWallet))return status('Payout and royalty wallets must be valid addresses.',true);
        const pct=Number($('rfccRoyaltyPct')?.value||0); if(!Number.isFinite(pct)||pct<0||pct>10)return status('Royalty must be between 0% and 10% in Relic Forge Studio.',true); const bps=Math.round(pct*100);
        if (busy)return; busy=true;
        try { const sg=await signer(), who=window.ethers.getAddress(await sg.getAddress()); if(who.toLowerCase()!==state.creator.toLowerCase())throw new Error('Connect the collection creator wallet.'); const c=new window.ethers.Contract(state.address,COLLECTION_ABI,sg); const calls=[]; if(window.ethers.getAddress(payout)!==state.payoutReceiver)calls.push(['payout wallet',()=>c.setPayoutReceiver(payout)]); if(window.ethers.getAddress(royaltyWallet)!==state.royaltyReceiver||bps!==state.royaltyBps)calls.push(['royalties',()=>c.setRoyalty(royaltyWallet,bps)]); if(!calls.length){status('No payout or royalty settings changed.');return;} for(let i=0;i<calls.length;i++){status(`Updating ${calls[i][0]} Ã‚Â· ${i+1}/${calls.length}Ã¢â‚¬Â¦`); const tx=await calls[i][1](); await tx.wait();} await refreshCurrent(); status('Payout and royalty settings updated.'); } catch(e){status(e.shortMessage||e.message,true)} finally{busy=false}
        return;
      }
      if (action==='withdraw-creator') return permissionlessWrite(state,c=>c.withdraw(),'Sending creator earnings to the payout walletÃ¢â‚¬Â¦','Creator earnings sent to the payout wallet.');
      if (action==='forward-fees') return permissionlessWrite(state,c=>c.withdrawPlatformFees(),'Forwarding reserved platform feesÃ¢â‚¬Â¦','Reserved platform fees forwarded.');
      if (action==='save-display') {
        const mode=safeInt($('rfccDisplayMode')?.value,0,1,'Default display'); const uri=String($('rfccDisplayUri')?.value||'').trim(), holders=!!$('rfccHolderDisplay')?.checked;
        return writeCollection(state,c=>c.setRenderConfig(uri,holders,mode),'Saving display settingsÃ¢â‚¬Â¦','Display settings updated.');
      }
      if (action==='renounce') {
        if(String($('rfccSurrenderConfirm')?.value||'').trim()!=='SURRENDER')return status('Type SURRENDER exactly before using the permanent action.',true);
        if(!window.confirm('Permanently surrender creator control? This cannot be undone.'))return;
        return writeCollection(state,c=>c.renounceControl(),'Permanently surrendering creator controlÃ¢â‚¬Â¦','Creator control has been permanently surrendered.');
      }
      } catch (error) { status(error.shortMessage || error.message, true); }
    });
  }

  function start() {
    const detail = $('launchedCollectionDetail');
    if (!detail) return;

    const renderSnapshot = snapshot => {
      renderForDetail(detail, snapshot).catch(error => {
        const loading = $('rfCompleteCreatorControlsLoading');
        if (loading) loading.textContent = `Unable to load complete creator controls: ${error.message}`;
      });
    };

    // forge.js emits this once after it has rendered a selected V1 collection.
    // There is intentionally no MutationObserver here: creator controls now
    // update only from explicit collection-open/refresh events.
    window.addEventListener('relicforge:creator-dashboard-collection-opened', event => {
      renderSnapshot(event.detail?.snapshot || null);
    });

    window.addEventListener('relicforge:wallet-accounts-changed', () => {
      if (currentAddress) refreshCurrent().catch(() => {});
    });

    // Fallback for unusual script-order/cache situations where a V1 detail was
    // already present before this script initialized.
    if (detail.querySelector('[data-v1-dashboard-action]')) renderSnapshot(null);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
