(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const TRANSFER_IFACE = new window.ethers.Interface([
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'
  ]);
  const TRANSFER_TOPIC = window.ethers.id('Transfer(address,address,uint256)');
  const ZERO_TOPIC = window.ethers.zeroPadValue(window.ethers.ZeroAddress, 32);
  const COLLECTION_ABI = [
    'function maxSupply() view returns(uint32)',
    'function totalMinted() view returns(uint32)',
    'function totalCommitted() view returns(uint32)',
    'function mintPhases() view returns(address)',
    'function ownerOf(uint256 tokenId) view returns(address)',
    'function tokenURI(uint256 tokenId) view returns(string)'
  ];

  const state = {
    active:false,
    chainId:0,
    contract:null,
    provider:null,
    collection:null,
    maxSupply:0,
    totalMinted:0,
    totalCommitted:0,
    wallet:null,
    recent:[],
    mine:[],
    timer:null,
    tick:0,
    refreshing:false,
  };

  const short = value => {
    const s=String(value||'');
    return s.length>14 ? `${s.slice(0,6)}…${s.slice(-4)}` : s;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  function queryConfig() {
    const q=new URLSearchParams(location.search);
    let routeTarget=null;
    try{routeTarget=window.RelicForgeMintContext?.read?.()||null;}catch(error){
      console.warn('RelicForge V2 live mint context:',error);
      return null;
    }
    const rawContract=routeTarget?.contract || q.get('contract') || window.RELICFORGE_MINT_CONFIG?.contract || '';
    if(!window.ethers?.isAddress(rawContract)) return null;
    const rawChain=Number(routeTarget?.chainId || q.get('chain') || window.RELICFORGE_MINT_CONFIG?.chainId || 11155111);
    if(![1,11155111].includes(rawChain)) return null;
    return {contract:window.ethers.getAddress(rawContract),chainId:rawChain};
  }

  function apiBase() {
    return String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/,'');
  }

  function selectedInjectedWallet() {
    if(window.RelicForgeWallets)return window.RelicForgeWallets.getProvider?.() || null;
    return window.ethereum || null;
  }

  async function providerFor(chainId) {
    const id=Number(chainId);
    const candidates=[];
    if(apiBase()) candidates.push(`${apiBase()}/api/public/rpc/${id}`);
    if(id===11155111) {
      candidates.push('https://ethereum-sepolia-rpc.publicnode.com','https://sepolia.drpc.org','https://rpc.sepolia.org');
    } else {
      candidates.push('https://ethereum-rpc.publicnode.com','https://eth.drpc.org');
    }

    let last=null;
    for(const rpc of candidates) {
      try {
        const p=new window.ethers.JsonRpcProvider(rpc,id,{staticNetwork:true,batchMaxCount:20});
        await p.getBlockNumber();
        return p;
      } catch(error) { last=error; }
    }

    const injected=selectedInjectedWallet();
    if(injected) {
      const p=new window.ethers.BrowserProvider(injected);
      const net=await p.getNetwork();
      if(Number(net.chainId)===id) return p;
    }
    throw last || new Error('No RPC provider is available.');
  }

  async function detectV2(config) {
    try {
      const p=await providerFor(config.chainId);
      const c=new window.ethers.Contract(config.contract,COLLECTION_ABI,p);
      const phases=await c.mintPhases();
      if(!window.ethers.isAddress(phases) || phases===window.ethers.ZeroAddress) return null;
      if((await p.getCode(phases))==='0x') return null;
      return {provider:p,collection:c};
    } catch(_) {
      return null;
    }
  }

  function injectStyle() {
    if($('rfV2LiveMintStyle')) return;
    const style=document.createElement('style');
    style.id='rfV2LiveMintStyle';
    style.textContent=`
      .v2-live-progress{margin-top:14px;border:1px solid var(--border);border-radius:12px;padding:13px;background:#090909}
      .v2-live-progress-head{display:flex;justify-content:space-between;gap:12px;align-items:center}
      .v2-live-progress-head span{font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
      .v2-live-progress-head strong{font-size:12px;font-variant-numeric:tabular-nums}
      .v2-live-progress-track{height:12px;margin-top:9px;border-radius:999px;background:#1a1a1a;overflow:hidden;border:1px solid #262626}
      .v2-live-progress-fill{height:100%;width:0;background:linear-gradient(90deg,#8b8b8b,#e4e4e4);transition:width .45s ease}
      .v2-sold-out{margin-top:10px;border:1px solid #806c40;background:#17140d;color:#e0ca91;border-radius:10px;padding:10px 12px;text-align:center;font-size:11px;font-weight:900;letter-spacing:.16em}
      .v2-live-kicker{display:inline-flex;align-items:center;gap:6px;color:#9fbcaa;font-size:8px;letter-spacing:.12em;text-transform:uppercase}
      .v2-live-kicker::before{content:"";width:6px;height:6px;border-radius:50%;background:#73b28b;box-shadow:0 0 0 3px rgba(115,178,139,.09)}
      .v2-live-meta{display:flex;justify-content:space-between;gap:7px;align-items:center;margin-top:5px}
      .v2-live-meta span,.v2-live-meta a{font-size:8px;color:var(--dim);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .v2-live-meta a:hover{color:#d0d0d0}
      .v2-live-owner-state{display:inline-block!important;margin-top:5px!important;font-size:7px!important;letter-spacing:.08em;text-transform:uppercase}
      .v2-live-owner-state.held{color:#95b9a2!important}.v2-live-owner-state.moved{color:#9a8d82!important}
      .v2-live-note{color:var(--dim);font-size:9px;line-height:1.45;margin-top:5px}
      .v2-live-error{color:#c9aaaa;font-size:9px}
      .explorer.v2-live-mode{grid-template-columns:1fr}
      .explorer.v2-live-mode>aside{display:none!important}
      @media(max-width:500px){.v2-live-progress-head{align-items:flex-start;flex-direction:column}}
    `;
    document.head.append(style);
  }

  function ensureUi() {
    injectStyle();

    const stats=document.querySelector('.collection .stats');
    if(stats && !$('v2LiveProgress')) {
      const box=document.createElement('div');
      box.className='v2-live-progress';
      box.id='v2LiveProgress';
      box.innerHTML=`
        <div class="v2-live-progress-head">
          <span>Live mint progress</span>
          <strong id="v2LiveProgressLabel">Loading…</strong>
        </div>
        <div class="v2-live-progress-track"><div class="v2-live-progress-fill" id="v2LiveProgressFill"></div></div>
        <div class="v2-sold-out hidden" id="v2SoldOutBanner">SOLD OUT</div>
      `;
      stats.insertAdjacentElement('afterend',box);
    }

    const mine=$('myNftsSection');
    if(mine) {
      mine.classList.remove('hidden');
      const eyebrow=mine.querySelector('.eyebrow');
      const title=mine.querySelector('h2');
      if(eyebrow) eyebrow.textContent='YOUR WALLET';
      if(title) title.textContent='Your mints';
      if($('myNftsSummary')) $('myNftsSummary').textContent='Connect a wallet to see NFTs minted directly to this wallet.';
      if($('myNftsRefreshBtn') && !$('myNftsRefreshBtn').dataset.v2LiveBound) {
        $('myNftsRefreshBtn').dataset.v2LiveBound='1';
        $('myNftsRefreshBtn').addEventListener('click',()=>refreshMine(true));
      }
      $('myNftsPagination')?.classList.add('hidden');
    }

    const explorer=document.querySelector('.explorer');
    if(explorer) {
      explorer.classList.remove('hidden');
      explorer.classList.add('v2-live-mode');
      const card=explorer.querySelector('.explorer-card');
      if(card && !card.dataset.v2LiveOwned) {
        card.dataset.v2LiveOwned='1';
        card.innerHTML=`
          <div class="section-head">
            <div>
              <div class="v2-live-kicker">Live</div>
              <h2>Recent mints</h2>
              <div class="v2-live-note" id="v2RecentStatus">Watching the collection for new mints…</div>
            </div>
            <button class="small-btn" id="v2RecentRefreshBtn" type="button">Refresh</button>
          </div>
          <div class="minted-grid" id="v2RecentGrid"><div class="minted-empty">Loading recent mints…</div></div>
        `;
        $('v2RecentRefreshBtn')?.addEventListener('click',()=>refreshRecent(true));
      }
    }
  }

  function explorerBase() {
    return state.chainId===1 ? 'https://etherscan.io' : 'https://sepolia.etherscan.io';
  }

  function updateProgress() {
    ensureUi();
    const max=Math.max(0,Number(state.maxSupply||0));
    const minted=Math.max(0,Number(state.totalMinted||0));
    const pct=max>0 ? Math.min(100,(minted/max)*100) : 0;
    if($('v2LiveProgressLabel')) $('v2LiveProgressLabel').textContent=`${minted.toLocaleString()} / ${max.toLocaleString()} minted · ${pct.toFixed(pct>=10?1:2)}%`;
    if($('v2LiveProgressFill')) $('v2LiveProgressFill').style.width=`${pct}%`;
    if($('mintedStat')) $('mintedStat').textContent=`${minted.toLocaleString()} / ${max.toLocaleString()}`;

    const sold=max>0 && minted>=max;
    $('v2SoldOutBanner')?.classList.toggle('hidden',!sold);
    if(sold) {
      if($('mintIntro')) $('mintIntro').textContent='SOLD OUT — this collection has reached its maximum supply.';
      document.querySelectorAll('[data-v2-mint],#publicMintBtn,#whitelistMintBtn').forEach(button=>{
        button.disabled=true;
        if(button.hasAttribute('data-v2-mint')) button.textContent='Sold Out';
      });
    }
  }

  async function walletAddress() {
    try {
      const injected=selectedInjectedWallet();
      const accounts=await injected?.request?.({method:'eth_accounts'});
      return accounts?.[0] && window.ethers.isAddress(accounts[0]) ? window.ethers.getAddress(accounts[0]) : null;
    } catch(_) { return null; }
  }

  function recipientTopic(address) {
    return address ? window.ethers.zeroPadValue(address,32) : null;
  }

  async function getLogsRange(fromBlock,toBlock,topics) {
    try {
      return await state.provider.getLogs({address:state.contract,fromBlock,toBlock,topics});
    } catch(error) {
      const span=Number(toBlock)-Number(fromBlock)+1;
      if(span<=1000) throw error;
      const mid=Math.floor((Number(fromBlock)+Number(toBlock))/2);
      const [a,b]=await Promise.all([
        getLogsRange(fromBlock,mid,topics),
        getLogsRange(mid+1,toBlock,topics)
      ]);
      return [...a,...b];
    }
  }

  async function scanMintLogs({toWallet=null,limit=12,maxBlocks=120000}={}) {
    const latest=await state.provider.getBlockNumber();
    const topics=[TRANSFER_TOPIC,ZERO_TOPIC];
    if(toWallet) topics.push(recipientTopic(toWallet));

    let cursor=latest;
    let scanned=0;
    const out=[];
    const chunk=10000;

    while(cursor>=0 && scanned<maxBlocks && out.length<limit) {
      const from=Math.max(0,cursor-chunk+1);
      const logs=await getLogsRange(from,cursor,topics);
      out.push(...logs);
      scanned += cursor-from+1;
      cursor=from-1;
    }

    const seen=new Set();
    return out
      .sort((a,b)=>Number(b.blockNumber)-Number(a.blockNumber)||Number(b.index??b.logIndex??0)-Number(a.index??a.logIndex??0))
      .map(log=>{
        try {
          const parsed=TRANSFER_IFACE.parseLog(log);
          return {
            tokenId:Number(parsed.args.tokenId),
            to:window.ethers.getAddress(parsed.args.to),
            transactionHash:log.transactionHash,
            blockNumber:Number(log.blockNumber)
          };
        } catch(_) { return null; }
      })
      .filter(Boolean)
      .filter(row=>{
        const key=String(row.tokenId);
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0,limit);
  }

  function decodeDataJson(uri) {
    if(!String(uri).startsWith('data:application/json')) return null;
    const comma=String(uri).indexOf(',');
    if(comma<0) return null;
    const head=String(uri).slice(0,comma);
    const body=String(uri).slice(comma+1);
    try {
      if(/;base64/i.test(head)) {
        const bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
      }
      return JSON.parse(decodeURIComponent(body));
    } catch(_) { return null; }
  }

  async function tokenInfo(row) {
    let meta=null, owner=null;
    try {
      const [uri,currentOwner]=await Promise.all([
        state.collection.tokenURI(row.tokenId).catch(()=>null),
        state.collection.ownerOf(row.tokenId).catch(()=>null)
      ]);
      owner=currentOwner && window.ethers.isAddress(currentOwner) ? window.ethers.getAddress(currentOwner) : null;
      if(uri) {
        meta=decodeDataJson(uri);
        if(!meta && /^https?:\/\//i.test(uri)) {
          try {
            const res=await fetch(uri,{cache:'no-store'});
            if(res.ok) meta=await res.json();
          } catch(_) {}
        }
      }
    } catch(_) {}
    return {...row,meta,owner};
  }

  function tokenCard(row,{showRecipient=false,showOwnerState=false}={}) {
    const image=row.meta?.image || '';
    const title=row.meta?.name || `Token #${row.tokenId}`;
    const txUrl=`${explorerBase()}/tx/${encodeURIComponent(row.transactionHash)}`;
    const held=state.wallet && row.owner && row.owner.toLowerCase()===state.wallet.toLowerCase();
    return `<article class="minted-token-card">
      <div class="minted-token-thumb">${image?`<img src="${esc(image)}" alt="${esc(title)}"/>`:'<div class="minted-thumb-empty">Artwork loading…</div>'}</div>
      <div class="minted-token-info">
        <div><strong>${esc(title)}</strong><span>#${row.tokenId}</span></div>
        ${showRecipient?`<small>Minted to ${esc(short(row.to))}</small>`:''}
        ${showOwnerState?`<small class="v2-live-owner-state ${held?'held':'moved'}">${held?'Still in your wallet':'Minted by you · since transferred'}</small>`:''}
        <div class="v2-live-meta"><span>Block ${row.blockNumber.toLocaleString()}</span><a href="${txUrl}" target="_blank" rel="noreferrer">Transaction ↗</a></div>
      </div>
    </article>`;
  }

  async function renderRecent() {
    const grid=$('v2RecentGrid');
    if(!grid) return;
    if(!state.recent.length) {
      grid.innerHTML='<div class="minted-empty">No mint events found yet.</div>';
      return;
    }
    const rows=await Promise.all(state.recent.map(tokenInfo));
    grid.innerHTML=rows.map(row=>tokenCard(row,{showRecipient:true})).join('');
    if($('v2RecentStatus')) $('v2RecentStatus').textContent=`Showing the ${rows.length} most recent mint${rows.length===1?'':'s'} · live refresh every 4 seconds`;
  }

  async function renderMine() {
    const grid=$('myNftsGrid');
    if(!grid) return;
    if(!state.wallet) {
      grid.innerHTML='<div class="minted-empty">Connect a wallet to load NFTs minted directly to it.</div>';
      if($('myNftsSummary')) $('myNftsSummary').textContent='Connect a wallet to see NFTs minted directly to this wallet.';
      return;
    }
    if(!state.mine.length) {
      grid.innerHTML='<div class="minted-empty">No mint events were found for this wallet in the scanned collection history.</div>';
      if($('myNftsSummary')) $('myNftsSummary').textContent='No mints found for this wallet yet.';
      return;
    }
    const rows=await Promise.all(state.mine.map(tokenInfo));
    grid.innerHTML=rows.map(row=>tokenCard(row,{showOwnerState:true})).join('');
    if($('myNftsSummary')) $('myNftsSummary').textContent=`${rows.length} recent NFT${rows.length===1?'':'s'} minted directly to ${short(state.wallet)}.`;
  }

  async function refreshRecent(force=false) {
    if(!state.active) return;
    if($('v2RecentStatus') && force) $('v2RecentStatus').textContent='Refreshing recent mint events…';
    try {
      state.recent=await scanMintLogs({limit:12,maxBlocks:120000});
      await renderRecent();
    } catch(error) {
      console.warn('RelicForge live recent mints:',error);
      if($('v2RecentStatus')) $('v2RecentStatus').innerHTML=`<span class="v2-live-error">Live activity refresh failed. Retrying automatically.</span>`;
    }
  }

  async function refreshMine(force=false) {
    if(!state.active) return;
    const wallet=await walletAddress();
    if(wallet!==state.wallet) {
      state.wallet=wallet;
      state.mine=[];
    }
    if(!wallet) {
      await renderMine();
      return;
    }
    if(force && $('myNftsSummary')) $('myNftsSummary').textContent='Refreshing your mint history…';
    try {
      state.mine=await scanMintLogs({toWallet:wallet,limit:24,maxBlocks:250000});
      await renderMine();
    } catch(error) {
      console.warn('RelicForge wallet mint history:',error);
      if($('myNftsSummary')) $('myNftsSummary').textContent='Could not refresh wallet mint history. Retrying automatically.';
    }
  }

  async function refreshSupply() {
    const [max,minted,committed]=await Promise.all([
      state.collection.maxSupply(),
      state.collection.totalMinted(),
      state.collection.totalCommitted()
    ]);
    const old=state.totalMinted;
    state.maxSupply=Number(max);
    state.totalMinted=Number(minted);
    state.totalCommitted=Number(committed);
    updateProgress();
    return old!==state.totalMinted;
  }

  async function tick(force=false) {
    if(!state.active || state.refreshing) return;
    state.refreshing=true;
    try {
      ensureUi();
      const wallet=await walletAddress();
      const walletChanged=wallet!==state.wallet;
      if(walletChanged) state.wallet=wallet;

      const supplyChanged=await refreshSupply();
      state.tick++;

      if(force || supplyChanged || state.tick%3===1) await refreshRecent(force);
      if(force || supplyChanged || walletChanged || state.tick%3===1) await refreshMine(force);
    } catch(error) {
      console.warn('RelicForge V2 live mint UI:',error);
    } finally {
      state.refreshing=false;
    }
  }

  async function start() {
    if(!window.ethers) return;
    const cfg=queryConfig();
    if(!cfg) return;
    const detected=await detectV2(cfg);
    if(!detected) return;

    state.active=true;
    state.chainId=cfg.chainId;
    state.contract=cfg.contract;
    state.provider=detected.provider;
    state.collection=detected.collection;

    ensureUi();
    await tick(true);

    if(state.timer) clearInterval(state.timer);
    state.timer=setInterval(()=>tick(false),4000);

    window.addEventListener('relicforge:v2-mint-confirmed',()=>setTimeout(()=>tick(true),700));

    const injected=selectedInjectedWallet();
    try {
      injected?.on?.('accountsChanged',()=>setTimeout(()=>tick(true),50));
      injected?.on?.('chainChanged',()=>setTimeout(()=>tick(true),50));
    } catch(_) {}
  }

  if(document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded',()=>setTimeout(start,120));
  } else {
    setTimeout(start,120);
  }
})();
