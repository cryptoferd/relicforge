(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const embedded = window.RELICFORGE_MINT_CONFIG || {};
  const API_BASE = String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const CONTRACT = String(embedded.contract || params.get('contract') || '').trim();
  const CHAIN_ID = Number(embedded.chainId || params.get('chain') || 11155111);
  const PAGE_SIZE = 10;
  const TRANSFER_TOPIC = window.ethers?.id?.('Transfer(address,address,uint256)') || '';
  const PUBLIC_RPCS = Object.freeze({
    11155111: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.drpc.org', 'https://rpc.sepolia.org'],
    1: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    8453: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    84532: ['https://sepolia.base.org'],
  });

  const state = {
    active: false,
    provider: null,
    contract: null,
    totalMinted: 0,
    recentPage: 1,
    recentSearch: null,
    wallet: null,
    myIds: [],
    myPage: 1,
    refreshTimer: null,
    scanSerial: 0,
    tokenCache: new Map(),
  };

  const ABI = [
    'function totalMinted() view returns(uint32)',
    'function balanceOf(address) view returns(uint256)',
    'function ownerOf(uint256 tokenId) view returns(address)',
    'function tokenURI(uint256 tokenId) view returns(string)',
    'function isRevealed(uint256 tokenId) view returns(bool)',
  ];

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));

  const short = value => {
    const text = String(value || '');
    return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : (text || '—');
  };

  function api(path) {
    return `${API_BASE}${path}`;
  }

  function dataUriText(uri) {
    const value = String(uri || '');
    const comma = value.indexOf(',');
    if (comma < 0) return '';
    const header = value.slice(0, comma);
    const payload = value.slice(comma + 1);
    try {
      return /;base64/i.test(header) ? atob(payload) : decodeURIComponent(payload);
    } catch (_) {
      return '';
    }
  }

  function browserUri(uri) {
    const value = String(uri || '').trim();
    if (/^ipfs:\/\//i.test(value)) return `https://ipfs.io/ipfs/${value.replace(/^ipfs:\/\/(?:ipfs\/)?/i, '')}`;
    if (/^ar:\/\//i.test(value)) return `https://arweave.net/${value.replace(/^ar:\/\//i, '')}`;
    return value;
  }

  async function metadataFor(uri) {
    const value = String(uri || '').trim();
    if (!value) return {};
    if (/^data:application\/json/i.test(value)) {
      try { return JSON.parse(dataUriText(value)); } catch (_) { return {}; }
    }
    const target = browserUri(value);
    if (!/^https?:\/\//i.test(target)) return {};
    try {
      const response = await fetch(target, { headers: { accept: 'application/json' } });
      return response.ok ? await response.json() : {};
    } catch (_) {
      return {};
    }
  }

  function imageMarkup(src, name) {
    const value = browserUri(src);
    if (!value) return '<div class="minted-thumb-empty">No image</div>';
    return `<img src="${esc(value)}" alt="${esc(name || 'NFT')}" loading="lazy"/>`;
  }

  async function tokenCard(tokenId) {
    const cached = state.tokenCache.get(Number(tokenId));
    if (cached?.revealed && cached.html) return cached.html;
    try {
      const [owner, uri, revealed] = await Promise.all([
        state.contract.ownerOf(tokenId),
        state.contract.tokenURI(tokenId),
        state.contract.isRevealed(tokenId).catch(() => false),
      ]);
      const meta = await metadataFor(uri);
      const html = `<article class="minted-token-card" data-token-id="${tokenId}">
        <div class="minted-token-thumb">${imageMarkup(meta.image, meta.name)}</div>
        <div class="minted-token-info">
          <div><strong>${esc(meta.name || `Token #${tokenId}`)}</strong><span>#${tokenId}</span></div>
          <small>${revealed ? 'Revealed' : 'Unrevealed'} · ${esc(short(owner))}</small>
        </div>
      </article>`;
      if (revealed) state.tokenCache.set(Number(tokenId), { revealed:true, html });
      return html;
    } catch (error) {
      return `<article class="minted-token-card"><div class="minted-token-thumb"><div class="minted-thumb-empty">#${tokenId}</div></div><div class="minted-token-info"><div><strong>Token #${tokenId}</strong></div><small>${esc(error?.shortMessage || error?.message || 'Unable to load token')}</small></div></article>`;
    }
  }

  async function loadPublishedConfig() {
    if (embedded.schema === 'relic-forge/mint-page@2') return embedded;
    if (!API_BASE || !CONTRACT || !window.ethers?.isAddress(CONTRACT)) return null;
    try {
      const response = await fetch(api(`/api/public/mint/${CHAIN_ID}/${encodeURIComponent(CONTRACT)}/config`), {
        headers: { accept: 'application/json' }, cache: 'no-store'
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.config?.schema === 'relic-forge/mint-page@2' ? payload.config : null;
    } catch (_) {
      return null;
    }
  }

  function walletProvider() {
    return window.RelicForgeWallets?.getProvider?.() || window.ethereum || null;
  }

  async function readProvider() {
    if (state.provider) return state.provider;
    if (!window.ethers) throw new Error('ethers.js is unavailable.');
    const candidates = [...(PUBLIC_RPCS[CHAIN_ID] || [])];
    if (API_BASE) candidates.push(api(`/api/public/rpc/${CHAIN_ID}`));
    for (const rpc of candidates) {
      try {
        const provider = new window.ethers.JsonRpcProvider(rpc, CHAIN_ID, { staticNetwork:true, batchMaxCount:20 });
        const code = await provider.getCode(CONTRACT);
        if (code && code !== '0x') { state.provider = provider; return provider; }
      } catch (_) {}
    }
    const injected = walletProvider();
    if (injected) {
      const provider = new window.ethers.BrowserProvider(injected);
      const network = await provider.getNetwork();
      if (Number(network.chainId) === CHAIN_ID) { state.provider = provider; return provider; }
    }
    throw new Error('No collection read provider is available.');
  }

  async function currentWallet() {
    const injected = walletProvider();
    if (!injected?.request || !window.ethers) return null;
    try {
      const chainHex = await injected.request({ method: 'eth_chainId' });
      if (Number(BigInt(chainHex)) !== CHAIN_ID) return null;
      const accounts = await injected.request({ method: 'eth_accounts' });
      return accounts?.[0] ? window.ethers.getAddress(accounts[0]) : null;
    } catch (_) {
      return null;
    }
  }

  function setupUi() {
    const explorer = document.querySelector('.explorer');
    if (explorer) {
      explorer.classList.remove('hidden');
      explorer.style.gridTemplateColumns = '1fr';
      const cards = explorer.querySelectorAll('.explorer-card');
      if (cards[1]) cards[1].classList.add('hidden');
      const heading = cards[0]?.querySelector('h2');
      if (heading) heading.textContent = 'Recent Mints';
      const eyebrow = cards[0]?.querySelector('.eyebrow');
      if (eyebrow) eyebrow.textContent = 'RECENTLY FORGED';
    }
  }

  async function refreshSupply() {
    if (!state.contract) return;
    state.totalMinted = Number(await state.contract.totalMinted());
  }

  function updateRecentControls() {
    const total = state.totalMinted;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.recentPage = Math.min(Math.max(1, state.recentPage), pages);
    const prev = $('mintedPrevBtn');
    const next = $('mintedNextBtn');
    if (prev) prev.disabled = state.recentPage <= 1 || !!state.recentSearch;
    if (next) next.disabled = state.recentPage >= pages || !!state.recentSearch;
  }

  async function renderRecent() {
    const grid = $('mintedGrid');
    const info = $('mintedPageInfo');
    if (!grid || !info || !state.contract) return;
    const total = state.totalMinted;
    if (!total) {
      grid.innerHTML = '<div class="minted-empty">Nothing has been minted yet.</div>';
      info.textContent = '0 minted';
      updateRecentControls();
      return;
    }

    let ids = [];
    if (state.recentSearch) {
      ids = [state.recentSearch];
      info.textContent = `Token #${state.recentSearch}`;
    } else {
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      state.recentPage = Math.min(Math.max(1, state.recentPage), pages);
      const newest = total - ((state.recentPage - 1) * PAGE_SIZE);
      const oldest = Math.max(1, newest - PAGE_SIZE + 1);
      for (let id = newest; id >= oldest; id--) ids.push(id);
      info.textContent = `${oldest}-${newest} of ${total.toLocaleString()} · newest first · Page ${state.recentPage} of ${pages}`;
    }

    grid.innerHTML = '<div class="minted-empty">Loading recent mints…</div>';
    grid.innerHTML = (await Promise.all(ids.map(tokenCard))).join('');
    updateRecentControls();
  }

  function searchRecent() {
    const total = state.totalMinted;
    const input = $('mintedSearchInput');
    const value = Math.floor(Number(input?.value || 0));
    if (!value) {
      state.recentSearch = null;
      if (input) input.value = '';
      renderRecent().catch(() => {});
      return;
    }
    if (value < 1 || value > total) {
      if ($('mintedPageInfo')) $('mintedPageInfo').textContent = `Token must be between 1 and ${total}.`;
      return;
    }
    state.recentSearch = value;
    renderRecent().catch(() => {});
  }

  function walletCacheKey(wallet) {
    return `relicforge_v1_wallet_tokens_${CHAIN_ID}_${CONTRACT.toLowerCase()}_${wallet.toLowerCase()}`;
  }

  function readCachedWalletIds(wallet) {
    try {
      const rows = JSON.parse(localStorage.getItem(walletCacheKey(wallet)) || '[]');
      return Array.isArray(rows) ? rows.map(Number).filter(Number.isSafeInteger).filter(id => id > 0) : [];
    } catch (_) {
      return [];
    }
  }

  function writeCachedWalletIds(wallet, ids) {
    try { localStorage.setItem(walletCacheKey(wallet), JSON.stringify([...new Set(ids.map(Number))].sort((a, b) => a - b))); } catch (_) {}
  }

  async function verifyOwnedCandidates(wallet, ids) {
    const owned = [];
    const unique = [...new Set(ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
    for (let start = 0; start < unique.length; start += 30) {
      const batch = unique.slice(start, start + 30);
      const rows = await Promise.all(batch.map(async id => {
        try {
          const owner = await state.contract.ownerOf(id);
          return String(owner).toLowerCase() === wallet.toLowerCase() ? id : null;
        } catch (_) { return null; }
      }));
      owned.push(...rows.filter(Boolean));
    }
    return owned;
  }

  async function historyProvider() {
    try { return await readProvider(); } catch (_) {}
    const injected = walletProvider();
    if (injected && window.ethers) {
      const chainHex = await injected.request({ method:'eth_chainId' });
      if (Number(BigInt(chainHex)) === CHAIN_ID) return new window.ethers.BrowserProvider(injected);
    }
    throw new Error('No holder-history RPC is available.');
  }

  function tokenIdFromLog(log) {
    try { return Number(BigInt(log.topics?.[3] || 0)); } catch (_) { return 0; }
  }

  async function scanWalletReceipts(wallet, expectedBalance, seedIds, serial) {
    const provider = await historyProvider();
    const latest = await provider.getBlockNumber();
    const topicWallet = window.ethers.zeroPadValue(wallet, 32);
    const candidates = new Set(seedIds);
    let owned = await verifyOwnedCandidates(wallet, [...candidates]);
    if (owned.length >= expectedBalance) return owned.slice(0, expectedBalance);

    let toBlock = latest;
    let chunk = 100000;
    let attempts = 0;
    while (toBlock >= 0 && owned.length < expectedBalance && attempts < 1000) {
      if (serial !== state.scanSerial) return owned;
      const fromBlock = Math.max(0, toBlock - chunk + 1);
      try {
        const logs = await provider.getLogs({
          address: CONTRACT,
          fromBlock,
          toBlock,
          topics: [TRANSFER_TOPIC, null, topicWallet],
        });
        const before = candidates.size;
        logs.forEach(log => {
          const id = tokenIdFromLog(log);
          if (id > 0) candidates.add(id);
        });
        if (candidates.size !== before) owned = await verifyOwnedCandidates(wallet, [...candidates]);
        toBlock = fromBlock - 1;
        attempts++;
        if (logs.length < 25 && chunk < 500000) chunk = Math.min(500000, chunk * 2);
      } catch (error) {
        if (chunk > 1000) {
          chunk = Math.max(1000, Math.floor(chunk / 4));
          continue;
        }
        throw error;
      }
    }
    return owned;
  }

  async function renderMyNfts(forceScan = false) {
    const section = $('myNftsSection');
    const grid = $('myNftsGrid');
    const summary = $('myNftsSummary');
    const pager = $('myNftsPagination');
    if (!section || !grid || !state.contract) return;

    const wallet = await currentWallet();
    state.wallet = wallet;
    if (!wallet) {
      section.classList.add('hidden');
      state.myIds = [];
      return;
    }
    section.classList.remove('hidden');

    const serial = ++state.scanSerial;
    const balance = Number(await state.contract.balanceOf(wallet));
    if (summary) summary.textContent = `${balance.toLocaleString()} NFT${balance === 1 ? '' : 's'} currently owned from this collection.`;
    if (!balance) {
      state.myIds = [];
      grid.innerHTML = '<div class="minted-empty">You do not currently own any NFTs from this collection.</div>';
      pager?.classList.add('hidden');
      writeCachedWalletIds(wallet, []);
      return;
    }

    grid.innerHTML = '<div class="minted-empty">Locating the NFTs in your wallet…</div>';
    let cached = forceScan ? [] : readCachedWalletIds(wallet);
    let owned = await verifyOwnedCandidates(wallet, cached);
    if (owned.length < balance) {
      try {
        owned = await scanWalletReceipts(wallet, balance, [...new Set([...cached, ...owned])], serial);
      } catch (error) {
        if (summary) summary.textContent = `${balance.toLocaleString()} owned · token ID scan could not finish (${error?.shortMessage || error?.message || 'RPC error'}).`;
      }
    }
    if (serial !== state.scanSerial) return;

    state.myIds = [...new Set(owned)].sort((a, b) => b - a);
    writeCachedWalletIds(wallet, state.myIds);
    if (!state.myIds.length) {
      grid.innerHTML = '<div class="minted-empty">Your balance is onchain, but token IDs could not be resolved yet. Press Refresh to scan again.</div>';
      pager?.classList.add('hidden');
      return;
    }

    const pages = Math.max(1, Math.ceil(state.myIds.length / PAGE_SIZE));
    state.myPage = Math.min(Math.max(1, state.myPage), pages);
    const start = (state.myPage - 1) * PAGE_SIZE;
    const end = Math.min(state.myIds.length, start + PAGE_SIZE);
    if ($('myNftsPageInfo')) $('myNftsPageInfo').textContent = `${start + 1}-${end} of ${state.myIds.length.toLocaleString()} · Page ${state.myPage} of ${pages}`;
    if ($('myNftsPrevBtn')) $('myNftsPrevBtn').disabled = state.myPage <= 1;
    if ($('myNftsNextBtn')) $('myNftsNextBtn').disabled = state.myPage >= pages;
    pager?.classList.toggle('hidden', pages <= 1);
    grid.innerHTML = '<div class="minted-empty">Loading your NFTs…</div>';
    grid.innerHTML = (await Promise.all(state.myIds.slice(start, end).map(tokenCard))).join('');
  }

  async function refreshAll(forceWalletScan = false) {
    if (!state.active || !state.contract) return;
    try {
      await refreshSupply();
      await renderRecent();
    } catch (error) {
      if ($('mintedGrid')) $('mintedGrid').innerHTML = `<div class="minted-empty">Recent mints unavailable: ${esc(error?.shortMessage || error?.message || 'RPC error')}</div>`;
    }
    try { await renderMyNfts(forceWalletScan); } catch (_) {}
  }

  function bind() {
    $('mintedPrevBtn')?.addEventListener('click', () => { state.recentPage = Math.max(1, state.recentPage - 1); renderRecent().catch(() => {}); });
    $('mintedNextBtn')?.addEventListener('click', () => { state.recentPage += 1; renderRecent().catch(() => {}); });
    $('mintedSearchBtn')?.addEventListener('click', searchRecent);
    $('mintedClearBtn')?.addEventListener('click', () => { state.recentSearch = null; if ($('mintedSearchInput')) $('mintedSearchInput').value = ''; renderRecent().catch(() => {}); });
    $('mintedSearchInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchRecent(); } });
    $('myNftsRefreshBtn')?.addEventListener('click', () => renderMyNfts(true).catch(() => {}));
    $('myNftsPrevBtn')?.addEventListener('click', () => { state.myPage = Math.max(1, state.myPage - 1); renderMyNfts(false).catch(() => {}); });
    $('myNftsNextBtn')?.addEventListener('click', () => { state.myPage += 1; renderMyNfts(false).catch(() => {}); });

    window.addEventListener('relicforge:wallet-accounts-changed', () => { state.myPage = 1; renderMyNfts(false).catch(() => {}); });
    window.addEventListener('relicforge:v1-mint-confirmed', () => { state.recentPage = 1; state.recentSearch = null; state.myPage = 1; refreshAll(false).catch(() => {}); });
    window.addEventListener('relicforge:v1-runtime-ready', () => refreshAll(false).catch(() => {}));
  }

  async function init() {
    if (!window.ethers || !CONTRACT || !window.ethers.isAddress(CONTRACT) || !Number.isInteger(CHAIN_ID)) return;
    const published = await loadPublishedConfig();
    if (!published) return;
    state.active = true;
    setupUi();
    bind();
    const provider = await readProvider();
    state.contract = new window.ethers.Contract(CONTRACT, ABI, provider);
    await refreshAll(false);
    state.refreshTimer = setInterval(() => refreshAll(false).catch(() => {}), 30000);
  }

  init().catch(error => {
    console.warn('Relic Forge V1 gallery unavailable:', error?.message || error);
  });
})();
