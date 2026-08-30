(() => {
  'use strict';

  const ABI = [
    'function name() view returns (string)',
    'function description() view returns (string)',
    'function creator() view returns (address)',
    'function controller() view returns (address)',
    'function maxSupply() view returns (uint32)',
    'function totalMinted() view returns (uint32)',
    'function masterMintEnabled() view returns (bool)',
    'function futureRevealMode() view returns (uint8)',
    'function phases(uint32) view returns (uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 minted,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled)',
    'function phaseWalletMinted(uint32,address) view returns (uint32)',
    'function phaseIsOpen(uint32) view returns (bool)',
    'function quoteMint(uint32,uint32) view returns (uint256 creatorPrice,uint256 platformFeeWei,uint256 minimumValue,bool oracleHealthy,bool feeActive)',
    'function mint(uint32 phaseId,uint32 quantity,uint32 allowance,bytes32[] proof) payable returns (uint256 startTokenId)',
    'function balanceOf(address) view returns (uint256)',
  ];

  const $ = id => document.getElementById(id);
  const app = {
    config: null, state: null, wallet: null, walletState: null, whitelist: null,
    browserProvider: null, signer: null, contract: null,
  };

  const apiBase = () => String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const short = value => { const s=String(value||''); return s.length>14 ? `${s.slice(0,6)}…${s.slice(-4)}` : s; };
  const networkLabel = chainId => ({1:'Ethereum',11155111:'Sepolia',8453:'Base',84532:'Base Sepolia',42161:'Arbitrum One',421614:'Arbitrum Sepolia',10:'Optimism',11155420:'Optimism Sepolia',137:'Polygon',80002:'Polygon Amoy'})[Number(chainId)] || `Chain ${chainId}`;

  function setText(id, value) { const el=$(id); if (el) el.textContent = value; }
  function setStatus(value, bad=false) { const el=$('mintStatus'); if (!el) return; el.textContent=value; el.style.color = bad ? '#c9aaaa' : ''; }
  function fmtEth(value) { try { return `${Number(window.ethers.formatEther(BigInt(value))).toLocaleString(undefined,{maximumFractionDigits:6})} ETH`; } catch { return '—'; } }
  function phaseRemaining(phase, walletMinted=0) {
    if (!phase) return 0;
    const supplyLeft = phase.phaseSupply ? Math.max(0, phase.phaseSupply - phase.minted) : Number.MAX_SAFE_INTEGER;
    const walletLeft = phase.maxPerWallet ? Math.max(0, phase.maxPerWallet - walletMinted) : Number.MAX_SAFE_INTEGER;
    const collectionLeft = Math.max(0, Number(app.state.maxSupply) - Number(app.state.totalMinted));
    return Math.max(0, Math.min(50, supplyLeft, walletLeft, collectionLeft));
  }

  async function json(path) {
    const response = await fetch(`${apiBase()}${path}`, { headers:{accept:'application/json'} });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }

  function media() {
    const config = app.config;
    if (config.bannerImageAssetId && $('mintBanner')) {
      $('mintBanner').innerHTML = `<img src="${apiBase()}/api/public/assets/${encodeURIComponent(config.bannerImageAssetId)}" alt=""/>`;
    }
    if (config.collectionImageAssetId && $('mintAvatar')) {
      $('mintAvatar').innerHTML = `<img src="${apiBase()}/api/public/assets/${encodeURIComponent(config.collectionImageAssetId)}" alt=""/>`;
    }
  }

  async function quote(phaseId, qty) {
    return json(`/api/rc47b/public/mint/${Number(app.config.chainId)}/${encodeURIComponent(app.config.contract)}/quote/${Number(phaseId)}/${Number(qty)}`);
  }

  async function refreshStatic() {
    const chainId = Number(app.config.chainId);
    app.state = await json(`/api/rc47b/public/mint/${chainId}/${encodeURIComponent(app.config.contract)}/state`);
    setText('collectionName', app.config.title || app.state.name || 'Relic Forge Collection');
    setText('collectionDescription', app.config.description || app.state.description || '');
    setText('mintedStat', `${app.state.totalMinted} / ${app.state.maxSupply}`);
    setText('networkStat', networkLabel(chainId));
    setText('revealStat', Number(app.state.futureRevealMode) === 1 ? 'Forge Reveal' : 'Deferred Reveal');
    const publicPhase = app.state.publicPhase;
    setText('priceStat', publicPhase ? fmtEth(publicPhase.price) : 'Not configured');
    setText('publicPrice', publicPhase ? fmtEth(publicPhase.price) : 'Unavailable');
    setText('limitStat', publicPhase?.maxPerWallet ? String(publicPhase.maxPerWallet) : 'Phase based');
    const contractNode = $('contractAddress');
    if (contractNode) contractNode.textContent = app.config.contract;
    const publicCard = $('publicCard');
    const wlCard = $('whitelistCard');
    publicCard?.classList.toggle('disabled', !publicPhase || !publicPhase.open);
    wlCard?.classList.toggle('disabled', !app.state.whitelistPhase || !app.state.whitelistPhase.open);
    setText('mintIntro', app.state.masterMintEnabled ? 'Choose an eligible V1 mint phase below.' : 'Master Mint is OFF. The creator must explicitly arm minting.');
    if (!app.state.masterMintEnabled) setStatus('Master Mint is OFF. No public mint transaction can execute until the creator arms the collection.');
    else setStatus('Canonical V1 phase state loaded. Connect a wallet to mint.');
    if (publicPhase) {
      try {
        const one = await quote(publicPhase.id, 1);
        setText('publicPrice', one.feeActive && one.oracleHealthy ? `${fmtEth(one.minimumValue)} total` : fmtEth(one.creatorPrice));
      } catch (_) {}
    }
  }

  async function ensureChain() {
    const chainId = Number(app.config.chainId);
    const provider = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
    if (!provider?.request) throw new Error('No EVM wallet provider is available.');
    const currentHex = await provider.request({ method:'eth_chainId' });
    if (Number(BigInt(currentHex)) === chainId) return provider;
    try {
      await provider.request({ method:'wallet_switchEthereumChain', params:[{chainId:`0x${chainId.toString(16)}`}] });
      return provider;
    } catch (error) {
      throw new Error(`Switch your wallet to ${networkLabel(chainId)} and try again.`);
    }
  }

  async function connect({ forceChooser=false }={}) {
    if (!window.ethers) throw new Error('ethers.js did not load.');
    let address;
    if (window.RelicForgeWallets?.requestAccount) address = await window.RelicForgeWallets.requestAccount({ forceChooser });
    else address = (await window.ethereum?.request?.({method:'eth_requestAccounts'}))?.[0];
    if (!address) throw new Error('No wallet account selected.');
    const injected = await ensureChain();
    app.browserProvider = new window.ethers.BrowserProvider(injected);
    app.signer = await app.browserProvider.getSigner();
    app.wallet = window.ethers.getAddress(await app.signer.getAddress());
    app.contract = new window.ethers.Contract(app.config.contract, ABI, app.signer);
    setText('connectBtn', short(app.wallet));
    await refreshWallet();
    return app.wallet;
  }

  async function refreshWallet() {
    if (!app.wallet) return;
    const chainId = Number(app.config.chainId);
    app.walletState = await json(`/api/rc47b/public/mint/${chainId}/${encodeURIComponent(app.config.contract)}/wallet/${encodeURIComponent(app.wallet)}`);
    setText('walletMintsStat', String(Number(app.walletState.publicMinted||0) + Number(app.walletState.whitelistMinted||0)));
    const publicRemain = phaseRemaining(app.state.publicPhase, Number(app.walletState.publicMinted||0));
    const publicQty = $('publicQty');
    if (publicQty) { publicQty.max = String(Math.max(1, publicRemain)); publicQty.value = String(Math.min(Math.max(1,Number(publicQty.value)||1), Math.max(1,publicRemain))); }
    setText('publicQtyHint', app.state.publicPhase ? `${publicRemain} remaining for this wallet/phase.` : 'No public phase is published.');
    if ($('publicMintBtn')) $('publicMintBtn').disabled = !app.state.masterMintEnabled || !app.state.publicPhase?.open || publicRemain < 1;

    app.whitelist = null;
    if (app.state.whitelistPhase) {
      try { app.whitelist = await json(`/api/rc47b/public/mint/${chainId}/${encodeURIComponent(app.config.contract)}/whitelist/${encodeURIComponent(app.wallet)}`); } catch (_) {}
    }
    const entry = app.whitelist?.entry || null;
    const wlRemain = entry ? Math.max(0, Math.min(phaseRemaining(app.state.whitelistPhase, Number(app.walletState.whitelistMinted||0)), Number(entry.allowance) - Number(app.walletState.whitelistMinted||0))) : 0;
    setText('whitelistState', entry ? (wlRemain > 0 ? 'Eligible' : 'Allowance used') : 'Not eligible');
    const wlQty = $('whitelistQty');
    if (wlQty) { wlQty.max=String(Math.max(1,wlRemain)); wlQty.value=String(Math.min(Math.max(1,Number(wlQty.value)||1),Math.max(1,wlRemain))); }
    if ($('whitelistMintBtn')) $('whitelistMintBtn').disabled = !app.state.masterMintEnabled || !app.state.whitelistPhase?.open || !entry || wlRemain < 1;
    setText('whitelistQtyHint', entry ? `${wlRemain} remaining from allowance ${entry.allowance}.` : 'This wallet has no published V1 Merkle proof.');

    const allot = $('walletAllotment');
    if (allot) {
      allot.classList.remove('hidden');
      const total = publicRemain + wlRemain;
      setText('walletAllotmentText', `${total} currently mintable`);
      const fill = $('walletAllotmentFill');
      if (fill) fill.style.width = `${Math.min(100, total ? 100 : 0)}%`;
    }
    setStatus('Wallet connected. Mint values are quoted from the canonical V1 collection at transaction time.');
  }

  async function mint(kind) {
    if (!app.wallet) await connect();
    await refreshStatic();
    await refreshWallet();
    const isWhitelist = kind === 'whitelist';
    const phase = isWhitelist ? app.state.whitelistPhase : app.state.publicPhase;
    if (!phase?.open) throw new Error(`${isWhitelist ? 'Whitelist' : 'Public'} phase is not open.`);
    const qtyEl = $(isWhitelist ? 'whitelistQty' : 'publicQty');
    const qty = Number(qtyEl?.value || 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new Error('Mint quantity must be between 1 and 50.');
    const entry = isWhitelist ? app.whitelist?.entry : null;
    if (isWhitelist && !entry) throw new Error('No whitelist proof is published for this wallet.');

    setStatus('Quoting canonical V1 mint value…');
    const liveQuote = await app.contract.quoteMint(phase.id, qty);
    const minimumValue = BigInt(liveQuote.minimumValue ?? liveQuote[2]);
    const oracleHealthy = Boolean(liveQuote.oracleHealthy ?? liveQuote[3]);
    const feeActive = Boolean(liveQuote.feeActive ?? liveQuote[4]);
    if (feeActive && !oracleHealthy) setStatus('Platform fee oracle is unavailable; V1 keeps Minter Supported minting live with the platform fee at zero for this quote.');
    else setStatus(`Confirm ${fmtEth(minimumValue)} in your wallet. This value comes directly from quoteMint().`);
    const tx = await app.contract.mint(phase.id, qty, isWhitelist ? Number(entry.allowance) : 0, isWhitelist ? entry.proof : [], { value: minimumValue });
    setStatus(`Transaction submitted: ${short(tx.hash)}. Waiting for confirmation…`);
    await tx.wait();
    setStatus(`Mint confirmed: ${short(tx.hash)}. Refreshing V1 phase state…`);
    await refreshStatic();
    await refreshWallet();
  }

  async function start(config) {
    app.config = { ...config, chainId:Number(config.chainId), contract:String(config.contract) };
    if (!app.config.contract || !app.config.chainId) throw new Error('Published V1 mint page is missing chain or contract configuration.');
    media();
    setText('networkStat', networkLabel(app.config.chainId));
    const explorer = document.querySelector('.explorer');
    const myNfts = document.querySelector('.my-nfts');
    if (explorer) explorer.classList.add('hidden');
    if (myNfts) myNfts.classList.add('hidden');
    const note = document.querySelector('.forge-note');
    if (note) note.innerHTML = 'Canonical Relic Forge V1 mint page <span class="rf-v1-phase-badge">RC4.7B</span><br/>Mint transactions use configured phase IDs and <code>quoteMint()</code> minimumValue.';

    $('connectBtn')?.addEventListener('click', () => connect({forceChooser:true}).catch(error => setStatus(error.message,true)));
    $('publicMintBtn')?.addEventListener('click', () => mint('public').catch(error => setStatus(error.shortMessage || error.message,true)));
    $('whitelistMintBtn')?.addEventListener('click', () => mint('whitelist').catch(error => setStatus(error.shortMessage || error.message,true)));
    try {
      await refreshStatic();
      const injected = window.RelicForgeWallets?.getProvider?.() || window.ethereum;
      const accounts = await injected?.request?.({method:'eth_accounts'});
      if (accounts?.[0]) await connect();
    } catch (error) { setStatus(error.message,true); }
  }

  window.RelicForgeMintV1Adapter = Object.freeze({ start });
})();
