(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const COLLECTION_ABI = [
    'function name() view returns(string)',
    'function description() view returns(string)',
    'function maxSupply() view returns(uint32)',
    'function totalCommitted() view returns(uint32)',
    'function totalMinted() view returns(uint32)',
    'function futureRevealMode() view returns(uint8)',
    'function mintPhases() view returns(address)',
    'function balanceOf(address) view returns(uint256)',
    'function mint(uint32 phaseId,uint32 quantity,uint32 allowance,bytes32[] proof) payable returns(uint256 startTokenId)',
  ];
  const MINT_PHASES_ABI = [
    'function masterMintEnabled() view returns(bool)',
    'function phaseCount() view returns(uint32)',
    'function phases(uint32) view returns(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 minted,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled)',
    'function phaseWalletMinted(uint32,address) view returns(uint32)',
    'function phaseIsOpen(uint32) view returns(bool)',
    'function quoteMint(uint32,uint32) view returns(uint256 creatorPrice,uint256 platformFeeWei,uint256 minimumValue,bool oracleHealthy,bool feeActive)',
  ];
  const PUBLIC_RPCS = {
    11155111: ['https://ethereum-sepolia-rpc.publicnode.com','https://sepolia.drpc.org','https://rpc.sepolia.org'],
    1: ['https://ethereum-rpc.publicnode.com','https://eth.drpc.org'],
  };
  const app = {
    config:null, provider:null, browserProvider:null, signer:null, wallet:null,
    collection:null, mintPhases:null, mintPhasesAddress:null, state:null, phases:[],
    walletRows:new Map(), proofs:new Map(),
  };

  const apiBase = () => String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const short = value => { const s=String(value||''); return s.length>14 ? `${s.slice(0,6)}…${s.slice(-4)}` : s; };
  const fmtEth = value => {
    try { return `${Number(window.ethers.formatEther(BigInt(value))).toLocaleString(undefined,{maximumFractionDigits:6})} ETH`; }
    catch { return '—'; }
  };
  const networkLabel = chainId => Number(chainId) === 11155111 ? 'Sepolia' : Number(chainId) === 1 ? 'Ethereum' : `Chain ${chainId}`;
  function setStatus(message, bad=false) {
    const node=$('mintStatus'); if(!node)return;
    node.textContent=message; node.style.color=bad?'#c9aaaa':'';
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function phaseLabel(phase) { return phase.accessType === 1 ? `Approved Wallets · Stage ${phase.id}` : `Public · Stage ${phase.id}`; }
  function dateLabel(seconds, fallback) {
    if (!Number(seconds)) return fallback;
    return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(Number(seconds)*1000));
  }
  function timingLabel(phase) {
    const now=Math.floor(Date.now()/1000);
    if (phase.open) return phase.endTime ? `LIVE · ends ${dateLabel(phase.endTime,'')}` : 'LIVE · no automatic end';
    if (!phase.enabled) return 'Disabled by creator';
    if (phase.endTime && now >= phase.endTime) return `Ended ${dateLabel(phase.endTime,'')}`;
    if (phase.startTime && now < phase.startTime) return `Starts ${dateLabel(phase.startTime,'')}`;
    return 'Not currently open';
  }
  function activeInjectedWallet() {
    return window.RelicForgeWallets?.getProvider?.() || window.ethereum || null;
  }
  async function getReadProvider(chainId) {
    if (app.provider) return app.provider;
    const id=Number(chainId);
    const candidates=[...(PUBLIC_RPCS[id]||[])];
    if (apiBase()) candidates.push(`${apiBase()}/api/public/rpc/${id}`);
    let last=null;
    for (const rpc of candidates) {
      try {
        const provider=new window.ethers.JsonRpcProvider(rpc,id,{staticNetwork:true,batchMaxCount:20});
        await provider.getBlockNumber();
        app.provider=provider;
        return provider;
      } catch (error) { last=error; }
    }
    const injected=activeInjectedWallet();
    if (injected) {
      app.browserProvider=new window.ethers.BrowserProvider(injected);
      app.provider=app.browserProvider;
      return app.provider;
    }
    throw last || new Error('No RPC provider is available for this collection.');
  }

  async function detect(config) {
    if (!window.ethers || !config?.contract || !window.ethers.isAddress(config.contract)) return false;
    try {
      const provider=await getReadProvider(Number(config.chainId||11155111));
      const collection=new window.ethers.Contract(config.contract,['function mintPhases() view returns(address)'],provider);
      const phases=await collection.mintPhases();
      if (!window.ethers.isAddress(phases) || phases === window.ethers.ZeroAddress) return false;
      return (await provider.getCode(phases)) !== '0x';
    } catch (_) { return false; }
  }

  function applyMedia() {
    const cfg=app.config||{};
    if (cfg.bannerImage && $('mintBanner')) $('mintBanner').innerHTML=`<img src="${esc(cfg.bannerImage)}" alt=""/>`;
    if (cfg.collectionImage && $('mintAvatar')) $('mintAvatar').innerHTML=`<img src="${esc(cfg.collectionImage)}" alt=""/>`;
  }

  async function readState() {
    const provider=await getReadProvider(app.config.chainId);
    app.collection=new window.ethers.Contract(app.config.contract,COLLECTION_ABI,provider);
    const [name,description,maxSupply,totalCommitted,totalMinted,revealMode,mintPhasesAddress]=await Promise.all([
      app.collection.name(), app.collection.description().catch(()=>''), app.collection.maxSupply(),
      app.collection.totalCommitted(), app.collection.totalMinted(), app.collection.futureRevealMode(), app.collection.mintPhases()
    ]);
    app.mintPhasesAddress=window.ethers.getAddress(mintPhasesAddress);
    app.mintPhases=new window.ethers.Contract(app.mintPhasesAddress,MINT_PHASES_ABI,provider);
    const [masterMintEnabled,phaseCountRaw]=await Promise.all([app.mintPhases.masterMintEnabled(),app.mintPhases.phaseCount()]);
    const phaseCount=Math.min(500,Number(phaseCountRaw));
    const phases=[];
    for(let start=1;start<=phaseCount;start+=25){
      const ids=Array.from({length:Math.min(25,phaseCount-start+1)},(_,i)=>start+i);
      const rows=await Promise.all(ids.map(async id=>{
        const [raw,open]=await Promise.all([app.mintPhases.phases(id),app.mintPhases.phaseIsOpen(id).catch(()=>false)]);
        return {
          id,
          price:BigInt(raw.price??raw[0]),
          startTime:Number(raw.startTime??raw[1]),
          endTime:Number(raw.endTime??raw[2]),
          phaseSupply:Number(raw.phaseSupply??raw[3]),
          minted:Number(raw.minted??raw[4]),
          maxPerWallet:Number(raw.maxPerWallet??raw[5]),
          merkleRoot:String(raw.merkleRoot??raw[6]),
          accessType:Number(raw.accessType??raw[7]),
          priority:Number(raw.priority??raw[8]),
          enabled:Boolean(raw.enabled??raw[9]),
          open:Boolean(open),
        };
      }));
      phases.push(...rows);
    }
    phases.sort((a,b)=>Number(b.open)-Number(a.open)||b.priority-a.priority||a.id-b.id);
    app.state={
      name,description,maxSupply:Number(maxSupply),totalCommitted:Number(totalCommitted),totalMinted:Number(totalMinted),
      revealMode:Number(revealMode),masterMintEnabled:Boolean(masterMintEnabled),phaseCount:Number(phaseCountRaw)
    };
    app.phases=phases;
  }

  async function proofFor(phaseId,wallet) {
    const key=`${phaseId}:${String(wallet).toLowerCase()}`;
    if(app.proofs.has(key)) return app.proofs.get(key);
    if(!apiBase()) { app.proofs.set(key,null); return null; }
    try {
      const res=await fetch(`${apiBase()}/api/public/v2/whitelist/${Number(app.config.chainId)}/${encodeURIComponent(app.config.contract)}/${Number(phaseId)}/${encodeURIComponent(wallet)}`,{headers:{accept:'application/json'},cache:'no-store'});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
      const result=data.eligible?data:null;
      app.proofs.set(key,result);
      return result;
    } catch (_) {
      app.proofs.set(key,null);
      return null;
    }
  }

  function remainingFor(phase,walletMinted,allowance=null) {
    const collectionLeft=Math.max(0,app.state.maxSupply-app.state.totalCommitted);
    const phaseLeft=phase.phaseSupply?Math.max(0,phase.phaseSupply-phase.minted):Number.MAX_SAFE_INTEGER;
    const walletLeft=phase.maxPerWallet?Math.max(0,phase.maxPerWallet-walletMinted):Number.MAX_SAFE_INTEGER;
    const allowLeft=allowance==null?Number.MAX_SAFE_INTEGER:Math.max(0,Number(allowance)-walletMinted);
    return Math.max(0,Math.min(50,collectionLeft,phaseLeft,walletLeft,allowLeft));
  }

  async function render() {
    const state=app.state;
    document.title=`${app.config.title||state.name} — Mint`;
    if($('collectionName')) $('collectionName').textContent=app.config.title||state.name||'Relic Forge Collection';
    if($('collectionDescription')) $('collectionDescription').textContent=app.config.description||state.description||'Fully onchain collection forged with Relic Forge.';
    if($('mintedStat')) $('mintedStat').textContent=`${state.totalMinted.toLocaleString()} / ${state.maxSupply.toLocaleString()}`;
    if($('priceStat')) $('priceStat').textContent='Stage based';
    if($('limitStat')) $('limitStat').textContent='Stage based';
    if($('revealStat')) $('revealStat').textContent=state.revealMode===1?'Forge Reveal':'Deferred Reveal';
    if($('networkStat')) $('networkStat').textContent=networkLabel(app.config.chainId);
    if($('walletMintsStat')) $('walletMintsStat').textContent=app.wallet?'Calculating…':'Connect wallet';
    if($('mintIntro')) $('mintIntro').textContent=state.masterMintEnabled
      ? 'Choose an open mint stage below.'
      : 'Minting is paused by the creator. Stage settings remain intact.';
    const note=document.querySelector('.forge-note');
    if(note) note.textContent=state.revealMode===1
      ? 'Forge Reveal: your mint creates an onchain reservation. The NFT settles after the batch receives verified randomness; no additional collector signature is required.'
      : 'Deferred Reveal: minting creates your NFT now, but its final artwork remains hidden until the collection creator requests reveal.';
    const explorer=Number(app.config.chainId)===11155111?'https://sepolia.etherscan.io':'https://etherscan.io';
    if($('contractInfo')) $('contractInfo').innerHTML=`Collection: <a target="_blank" rel="noreferrer" href="${explorer}/address/${esc(app.config.contract)}">${esc(app.config.contract)}</a> · MintPhases: <a target="_blank" rel="noreferrer" href="${explorer}/address/${esc(app.mintPhasesAddress)}">${esc(short(app.mintPhasesAddress))}</a>`;

    const access=document.querySelector('.access');
    if(!access)return;
    if(!app.phases.length){
      access.innerHTML='<div class="access-card disabled"><div class="access-top"><strong>No mint stages</strong><span>Not configured</span></div></div>';
      setStatus('This R12-v2 collection does not have any MintPhases stages yet.');
      return;
    }

    const walletRows=new Map();
    if(app.wallet){
      await Promise.all(app.phases.map(async phase=>{
        const minted=Number(await app.mintPhases.phaseWalletMinted(phase.id,app.wallet).catch(()=>0n));
        let proof=null;
        if(phase.accessType===1) proof=await proofFor(phase.id,app.wallet);
        walletRows.set(phase.id,{minted,proof});
      }));
    }
    app.walletRows=walletRows;

    access.innerHTML=app.phases.map(phase=>{
      const row=walletRows.get(phase.id)||{minted:0,proof:null};
      const proof=row.proof;
      const eligible=phase.accessType===0 || !!proof?.eligible;
      const allowance=phase.accessType===1 ? Number(proof?.allowance||0) : null;
      const remaining=app.wallet?remainingFor(phase,row.minted,allowance):0;
      const usable=state.masterMintEnabled&&phase.open&&eligible&&(!app.wallet||remaining>0);
      const status=phase.accessType===1
        ? (app.wallet?(eligible?`Eligible · ${remaining} remaining`:'Not eligible'):'Connect to check eligibility')
        : timingLabel(phase);
      return `<div class="access-card ${usable||!app.wallet?'':'disabled'}" data-v2-mint-stage="${phase.id}">
        <div class="access-top"><strong>${esc(phaseLabel(phase))}</strong><span>${esc(fmtEth(phase.price))}</span></div>
        <small class="qtyhint">${esc(timingLabel(phase))} · ${phase.maxPerWallet?`${phase.maxPerWallet} max/wallet`:'No wallet cap'}${phase.phaseSupply?` · ${phase.minted}/${phase.phaseSupply} stage minted`:''}</small>
        <div class="qtyrow"><input id="v2Qty-${phase.id}" min="1" max="${Math.max(1,remaining||50)}" step="1" type="number" value="1" ${app.wallet&&remaining<1?'disabled':''}/><button class="btn ${phase.accessType===1?'secondary':''}" data-v2-mint="${phase.id}" ${app.wallet&&usable?'':'disabled'}>Mint Stage ${phase.id}</button></div>
        <small class="qtyhint" id="v2Hint-${phase.id}">${esc(status)}</small>
      </div>`;
    }).join('');

    access.querySelectorAll('[data-v2-mint]').forEach(button=>button.addEventListener('click',()=>mintPhase(Number(button.dataset.v2Mint)).catch(error=>setStatus(`Mint error: ${error.shortMessage||error.message}`,true))));
    const totalMintedByWallet=[...walletRows.values()].reduce((sum,row)=>sum+Number(row.minted||0),0);
    if($('walletMintsStat')) $('walletMintsStat').textContent=app.wallet?String(totalMintedByWallet):'Connect wallet';
    if($('walletAllotment')) $('walletAllotment').classList.add('hidden');
    setStatus(state.masterMintEnabled
      ? (app.wallet?'Wallet connected. Choose an eligible open R12-v2 stage.':'R12-v2 MintPhases loaded. Connect a wallet to mint.')
      : 'Master Mint is OFF. The creator must resume minting before any stage can execute.');
  }

  async function ensureChain() {
    const injected=activeInjectedWallet();
    if(!injected?.request)throw new Error('No EVM wallet provider detected.');
    const chainId=Number(app.config.chainId);
    const current=Number(BigInt(await injected.request({method:'eth_chainId'})));
    if(current===chainId)return injected;
    try {
      await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:`0x${chainId.toString(16)}`}]});
      return injected;
    } catch (_) {
      throw new Error(`Switch your wallet to ${networkLabel(chainId)} and try again.`);
    }
  }

  async function connect() {
    let address;
    if(window.RelicForgeWallets?.requestAccount) address=await window.RelicForgeWallets.requestAccount({forceChooser:true});
    else address=(await window.ethereum?.request?.({method:'eth_requestAccounts'}))?.[0];
    if(!address)throw new Error('No wallet account selected.');
    const injected=await ensureChain();
    app.browserProvider=new window.ethers.BrowserProvider(injected);
    app.signer=await app.browserProvider.getSigner();
    app.wallet=window.ethers.getAddress(await app.signer.getAddress());
    app.collection=new window.ethers.Contract(app.config.contract,COLLECTION_ABI,app.signer);
    app.mintPhases=new window.ethers.Contract(app.mintPhasesAddress,MINT_PHASES_ABI,app.signer);
    if($('connectBtn')) $('connectBtn').textContent=short(app.wallet);
    app.proofs.clear();
    await readState();
    await render();
  }

  async function mintPhase(phaseId) {
    if(!app.wallet)await connect();
    await readState();
    const phase=app.phases.find(row=>row.id===Number(phaseId));
    if(!phase)throw new Error('Mint stage no longer exists.');
    if(!app.state.masterMintEnabled)throw new Error('Master Mint is paused.');
    if(!phase.open)throw new Error(`Stage ${phase.id} is not open.`);
    const row=app.walletRows.get(phase.id)||{};
    let allowance=0,proof=[];
    if(phase.accessType===1){
      const published=await proofFor(phase.id,app.wallet);
      if(!published?.eligible)throw new Error('This wallet does not have a published proof for this Approved Wallet stage.');
      allowance=Number(published.allowance);
      proof=published.proof||[];
    }
    const input=$(`v2Qty-${phase.id}`);
    const qty=Math.max(1,Math.floor(Number(input?.value||1)));
    const minted=Number(await app.mintPhases.phaseWalletMinted(phase.id,app.wallet));
    const remaining=remainingFor(phase,minted,phase.accessType===1?allowance:null);
    if(qty>remaining)throw new Error(`Only ${remaining} mint${remaining===1?'':'s'} remain for this wallet/stage.`);
    const liveQuote=await app.mintPhases.quoteMint(phase.id,qty);
    const minimumValue=BigInt(liveQuote.minimumValue??liveQuote[2]);
    setStatus(`Confirm ${fmtEth(minimumValue)} for Stage ${phase.id} in your wallet.`);
    const tx=await app.collection.mint(phase.id,qty,allowance,proof,{value:minimumValue});
    setStatus(`Mint submitted: ${short(tx.hash)}. Waiting for confirmation…`);
    const receipt=await tx.wait();
    if(!receipt || Number(receipt.status)!==1)throw new Error('Mint transaction was not confirmed.');
    window.dispatchEvent(new CustomEvent('relicforge:v2-mint-confirmed',{detail:{chainId:Number(app.config.chainId),contract:app.config.contract,wallet:app.wallet,phaseId:phase.id,quantity:qty,transactionHash:receipt.hash||tx.hash}}));
    setStatus(app.state.revealMode===1
      ? `Reservation confirmed. ${qty} NFT${qty===1?'':'s'} will settle after verified batch randomness.`
      : `Mint confirmed. ${qty} NFT${qty===1?'':'s'} remain hidden until Creator Reveal.`);
    await readState();
    await render();
  }

  async function start(config) {
    app.config={...config,chainId:Number(config.chainId||11155111),contract:window.ethers.getAddress(config.contract)};
    applyMedia();
    document.querySelector('.explorer')?.classList.add('hidden');
    document.querySelector('.my-nfts')?.classList.add('hidden');
    if($('whitelistCard')) $('whitelistCard').classList.add('hidden');
    if($('publicCard')) $('publicCard').classList.add('hidden');
    if($('connectBtn')) $('connectBtn').addEventListener('click',()=>connect().catch(error=>setStatus(error.message,true)));
    await readState();
    await render();
    const injected=activeInjectedWallet();
    try {
      const accounts=await injected?.request?.({method:'eth_accounts'});
      if(accounts?.[0]){
        const chain=Number(BigInt(await injected.request({method:'eth_chainId'})));
        if(chain===Number(app.config.chainId)){
          app.browserProvider=new window.ethers.BrowserProvider(injected);
          app.signer=await app.browserProvider.getSigner();
          app.wallet=window.ethers.getAddress(await app.signer.getAddress());
          app.collection=new window.ethers.Contract(app.config.contract,COLLECTION_ABI,app.signer);
          app.mintPhases=new window.ethers.Contract(app.mintPhasesAddress,MINT_PHASES_ABI,app.signer);
          if($('connectBtn')) $('connectBtn').textContent=short(app.wallet);
          await render();
        }
      }
    } catch (_) {}
  }

  window.RelicForgeMintV2Adapter=Object.freeze({detect,start});
})();