(() => {
  'use strict';
  if (!document.body?.classList.contains('dashboard-page-body')) return;

  const $ = id => document.getElementById(id);
  const CHAIN_ID = 11155111;
  const ZERO = '0x' + '0'.repeat(64);
  const COLLECTION_ABI = ['function mintPhases() view returns(address)'];
  const MINT_PHASES_ABI = [
    'function controller() view returns(address)',
    'function phaseCount() view returns(uint32)',
    'function phases(uint32) view returns(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 minted,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled)',
    'function createPhase(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled) returns(uint32 phaseId)',
    'function updatePhase(uint32 phaseId,uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority)',
  ];

  const state = {
    collection:null, mintPhasesAddress:null, controller:null, phases:[], provider:null,
    listPhaseId:null, entries:[], listPublished:false, listInSync:false, storedRoot:null,
    retryPayload:null, scanTimer:null, busy:false,
  };

  const apiBase = () => String(window.RelicForgeCloud?.apiBase?.() || window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short = value => { const s=String(value||''); return s.length>14 ? `${s.slice(0,6)}…${s.slice(-4)}` : s; };

  function setStatus(message,tone='') {
    const node=$('r23ManagerStatus'); if(!node)return;
    node.textContent=message; node.className=`r23-status ${tone}`.trim();
  }

  async function readProvider() {
    if(state.provider)return state.provider;
    const base=apiBase(); if(!base)throw new Error('RelicForge Cloud API is not configured.');
    const provider=new window.ethers.JsonRpcProvider(`${base}/api/public/rpc/${CHAIN_ID}`,CHAIN_ID,{staticNetwork:true,batchMaxCount:20});
    await provider.getBlockNumber();
    state.provider=provider;
    return provider;
  }

  async function creatorSigner() {
    let injected=window.RelicForgeWallets?.getProvider?.()||window.ethereum;
    if(!injected?.request&&window.RelicForgeWallets?.getProviderAsync) injected=await window.RelicForgeWallets.getProviderAsync({allowChooser:true});
    if(!injected?.request)throw new Error('No EVM wallet provider is available.');
    let accounts=await injected.request({method:'eth_accounts'});
    if(!accounts?.[0]&&window.RelicForgeWallets?.requestAccount){
      const selected=await window.RelicForgeWallets.requestAccount({forceChooser:false});
      accounts=selected?[selected]:[];
    }
    if(!accounts?.[0])accounts=await injected.request({method:'eth_requestAccounts'});
    if(!accounts?.[0])throw new Error('Connect the collection controller wallet.');
    const desired=`0x${CHAIN_ID.toString(16)}`;
    const current=String(await injected.request({method:'eth_chainId'})).toLowerCase();
    if(current!==desired.toLowerCase()){
      try{await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:desired}]});}
      catch{throw new Error('Switch the creator wallet to Sepolia and try again.');}
    }
    const browser=new window.ethers.BrowserProvider(injected);
    const signer=await browser.getSigner();
    const wallet=window.ethers.getAddress(await signer.getAddress());
    if(state.controller&&wallet.toLowerCase()!==state.controller.toLowerCase())throw new Error(`Connected wallet ${short(wallet)} is not the active MintPhases controller.`);
    return signer;
  }

  function currentR12Address() {
    const detail=$('launchedCollectionDetail'); if(!detail)return null;
    const eyebrow=detail.querySelector('.launched-detail-head .eyebrow')?.textContent||'';
    if(!/R12-v2 COLLECTION/i.test(eyebrow))return null;
    const text=detail.querySelector('.launched-detail-head p')?.textContent?.trim()||'';
    return window.ethers?.isAddress(text)?window.ethers.getAddress(text):null;
  }

  async function loadOnchain(address) {
    const provider=await readProvider();
    const collection=new window.ethers.Contract(address,COLLECTION_ABI,provider);
    const mpAddress=window.ethers.getAddress(await collection.mintPhases());
    const mp=new window.ethers.Contract(mpAddress,MINT_PHASES_ABI,provider);
    const [controller,countRaw]=await Promise.all([mp.controller(),mp.phaseCount()]);
    const count=Number(countRaw),rows=[];
    for(let start=1;start<=count;start+=25){
      const ids=Array.from({length:Math.min(25,count-start+1)},(_,i)=>start+i);
      rows.push(...await Promise.all(ids.map(async id=>{
        const raw=await mp.phases(id);
        return {
          id, price:BigInt(raw.price??raw[0]), startTime:Number(raw.startTime??raw[1]), endTime:Number(raw.endTime??raw[2]),
          phaseSupply:Number(raw.phaseSupply??raw[3]), minted:Number(raw.minted??raw[4]), maxPerWallet:Number(raw.maxPerWallet??raw[5]),
          merkleRoot:String(raw.merkleRoot??raw[6]), accessType:Number(raw.accessType??raw[7]), priority:Number(raw.priority??raw[8]),
          enabled:Boolean(raw.enabled??raw[9]),
        };
      })));
    }
    state.collection=window.ethers.getAddress(address);
    state.mintPhasesAddress=mpAddress;
    state.controller=window.ethers.getAddress(controller);
    state.phases=rows;
  }

  function pairHash(a,b){
    return BigInt(a)<=BigInt(b)?window.ethers.keccak256(window.ethers.concat([a,b])):window.ethers.keccak256(window.ethers.concat([b,a]));
  }

  function normalizeEntries(entries) {
    const map=new Map();
    for(const raw of entries||[]){
      const address=window.ethers.getAddress(String(raw.address||raw.wallet||'').trim());
      const allowance=Math.floor(Number(raw.allowance||0));
      if(!Number.isInteger(allowance)||allowance<1||allowance>4294967295)throw new Error(`Allowance for ${short(address)} must be 1-4,294,967,295.`);
      map.set(address.toLowerCase(),{address,allowance});
    }
    return [...map.values()].sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  }

  function buildBoundMerkle(entries,collection,phaseId) {
    const clean=normalizeEntries(entries);
    if(!clean.length)throw new Error('Approved Wallet stage needs at least one wallet. Disable the stage instead of publishing an empty Merkle list.');
    const coder=window.ethers.AbiCoder.defaultAbiCoder();
    const leaves=clean.map(entry=>window.ethers.keccak256(coder.encode(
      ['uint256','address','uint32','address','uint32'],
      [BigInt(CHAIN_ID),collection,Number(phaseId),entry.address,Number(entry.allowance)]
    )));
    const layers=[leaves];
    while(layers[layers.length-1].length>1){
      const prev=layers[layers.length-1],next=[];
      for(let i=0;i<prev.length;i+=2)next.push(i+1<prev.length?pairHash(prev[i],prev[i+1]):prev[i]);
      layers.push(next);
    }
    const proofForIndex=index=>{
      const proof=[];let cursor=index;
      for(let level=0;level<layers.length-1;level++){
        const layer=layers[level],sibling=cursor^1;
        if(sibling<layer.length)proof.push(layer[sibling]);
        cursor=Math.floor(cursor/2);
      }
      return proof;
    };
    return {root:layers[layers.length-1][0],entries:clean.map((entry,index)=>({...entry,proof:proofForIndex(index)}))};
  }

  async function cloudAuth(){
    if(!window.RelicForgeCloud?.enabled?.())throw new Error('RelicForge Cloud is unavailable.');
    const signer=await creatorSigner(),wallet=window.ethers.getAddress(await signer.getAddress());
    await window.RelicForgeCloud.ensureSignedIn(wallet);
    return wallet;
  }

  async function getCloudList(phaseId){
    await cloudAuth();
    return window.RelicForgeCloud.json(`/api/collections/${CHAIN_ID}/${encodeURIComponent(state.collection)}/v2/whitelist/${Number(phaseId)}`,{},true);
  }

  async function publishCloudList(phaseId,tree){
    await cloudAuth();
    return window.RelicForgeCloud.json(
      `/api/collections/${CHAIN_ID}/${encodeURIComponent(state.collection)}/v2/whitelist/${Number(phaseId)}`,
      {method:'PUT',body:JSON.stringify({
        projectId:null,merkleRoot:tree.root,sourceType:2,sourceChainId:CHAIN_ID,sourceContract:null,snapshotBlock:0,
        entries:tree.entries.map(row=>({address:row.address,allowance:row.allowance,proof:row.proof}))
      })},true
    );
  }

  function phaseSummary(p){
    const type=p.accessType===1?'Approved Wallets':'Public';
    return `<div class="r23-stage-row"><div><strong>Stage ${p.id} · ${type}</strong><small>${esc(window.ethers.formatEther(p.price))} ETH · ${p.minted}${p.phaseSupply?` / ${p.phaseSupply}`:''} minted · priority ${p.priority}</small></div>${p.accessType===1?`<button class="ghost-btn" data-r23-manage="${p.id}" type="button">Manage Wallets</button>`:'<span class="r23-public-pill">PUBLIC</span>'}</div>`;
  }

  function renderPanel(){
    const detail=$('launchedCollectionDetail'); if(!detail||!state.collection)return;
    detail.querySelector('#r23StageManager')?.remove();
    const panel=document.createElement('section');
    panel.id='r23StageManager';panel.className='launched-section r23-manager';
    panel.innerHTML=`
      <div class="r23-head"><div><h4>Stage & Approved Wallet Manager</h4><p>Create new MintPhases stages and safely update wallet eligibility directly from the Creator Dashboard.</p></div><span>${esc(short(state.mintPhasesAddress))}</span></div>
      <div class="r23-warning"><strong>Merkle safety</strong><span>Wallet-list changes generate a new bound root for this exact collection + stage. Access type and priority are never changed when editing an existing stage.</span></div>
      <div class="r23-stage-list">${state.phases.map(phaseSummary).join('')||'<div class="forge-market-empty">No stages yet.</div>'}</div>
      <div id="r23WalletEditor"></div>
      <div class="r23-create">
        <h4>Create a new stage</h4>
        <div class="r23-create-grid">
          <label class="field"><span>Access</span><select id="r23NewAccess"><option value="0">Public</option><option value="1">Approved Wallets</option></select></label>
          <label class="field"><span>Price ETH</span><input id="r23NewPrice" type="number" min="0" step="0.0001" value="0"/></label>
          <label class="field"><span>Start date / time</span><input id="r23NewStart" type="datetime-local"/></label>
          <label class="field"><span>End date / time</span><input id="r23NewEnd" type="datetime-local" disabled/></label>
          <label class="project-toggle-row"><span><strong>No end date</strong><small>Stage stays available until disabled.</small></span><input id="r23NewNoEnd" type="checkbox" checked/></label>
          <label class="field"><span>Stage supply (0 = unlimited)</span><input id="r23NewSupply" type="number" min="0" value="0"/></label>
          <label class="field"><span>Max / wallet (0 = unlimited)</span><input id="r23NewWalletMax" type="number" min="0" value="0"/></label>
          <label class="project-toggle-row"><span><strong>Enable immediately</strong><small>Schedule rules still apply.</small></span><input id="r23NewEnabled" type="checkbox" checked/></label>
        </div>
        <label class="field r23-new-wallets hidden" id="r23NewWalletsWrap"><span>Initial Approved Wallets</span><textarea id="r23NewWallets" rows="5" placeholder="0xWallet, allowance&#10;0xWallet, allowance"></textarea><small>One wallet per line. Allowance defaults to 1 when omitted.</small></label>
        <button class="primary-btn" id="r23CreateStageBtn" type="button">Create Stage</button>
      </div>
      <div class="r23-status" id="r23ManagerStatus">Ready. Select an Approved Wallet stage to manage its wallets, or create a new stage.</div>`;
    detail.appendChild(panel);

    panel.querySelectorAll('[data-r23-manage]').forEach(button=>button.addEventListener('click',()=>openWalletEditor(Number(button.dataset.r23Manage))));
    $('r23NewAccess')?.addEventListener('change',()=>{$('r23NewWalletsWrap')?.classList.toggle('hidden',Number($('r23NewAccess').value)!==1);});
    $('r23NewNoEnd')?.addEventListener('change',()=>{if($('r23NewEnd')){$('r23NewEnd').disabled=$('r23NewNoEnd').checked;if($('r23NewNoEnd').checked)$('r23NewEnd').value='';}});
    $('r23CreateStageBtn')?.addEventListener('click',()=>createStage().catch(error=>setStatus(`Create stage: ${error.shortMessage||error.message}`,'bad')));
    if(state.retryPayload)renderRetry();
  }

  function parseBulk(text){
    const rows=[];
    for(const raw of String(text||'').split(/\r?\n/)){
      const line=raw.trim();if(!line)continue;
      const parts=line.split(/[,\s]+/).filter(Boolean);
      rows.push({address:parts[0],allowance:parts[1]||1});
    }
    return normalizeEntries(rows);
  }

  function renderWalletEditor(){
    const wrap=$('r23WalletEditor');if(!wrap)return;
    const phase=state.phases.find(p=>p.id===state.listPhaseId);if(!phase){wrap.innerHTML='';return;}
    wrap.innerHTML=`<div class="r23-wallet-editor">
      <div class="r23-head"><div><h4>Stage ${phase.id} Approved Wallets</h4><p>${state.listPublished?(state.listInSync?'Cloud proof list matches the current onchain root.':'Cloud proof list is OUT OF SYNC with the current onchain root.'):'No Cloud proof list is currently published for this stage.'}</p></div><code>${esc(short(phase.merkleRoot))}</code></div>
      ${!state.listPublished?'<div class="r23-warning bad"><strong>Proof table missing</strong><span>If this stage came from a pre-R2 Studio launch, open that saved Studio project and use <b>Repair / Sync Mint Proofs</b> to restore the original list without changing the onchain root. If you save a new list here, it replaces the stage root.</span></div>':''}
      <div class="r23-add-wallet"><label class="field"><span>Wallet</span><input id="r23WalletAddress" placeholder="0x..."/></label><label class="field"><span>Allowance</span><input id="r23WalletAllowance" type="number" min="1" value="1"/></label><button class="ghost-btn" id="r23AddWalletBtn" type="button">Add Wallet</button></div>
      <div class="r23-wallet-list" id="r23WalletList"></div>
      <label class="field"><span>Bulk replace / import</span><textarea id="r23BulkWallets" rows="4" placeholder="0xWallet, allowance&#10;0xWallet, allowance"></textarea><small>Import updates the editor only. Nothing changes onchain until Save & Publish.</small></label>
      <div class="launched-actions"><button class="ghost-btn" id="r23ImportWalletsBtn" type="button">Import into Editor</button><button class="primary-btn" id="r23SaveWalletsBtn" type="button">Save & Publish Eligibility</button></div>
    </div>`;
    renderWalletRows();
    $('r23AddWalletBtn')?.addEventListener('click',()=>{
      try{
        const added=normalizeEntries([{address:$('r23WalletAddress').value,allowance:$('r23WalletAllowance').value}])[0];
        state.entries=normalizeEntries([...state.entries,added]);$('r23WalletAddress').value='';$('r23WalletAllowance').value='1';renderWalletRows();
      }catch(error){setStatus(error.message,'bad');}
    });
    $('r23ImportWalletsBtn')?.addEventListener('click',()=>{
      try{state.entries=parseBulk($('r23BulkWallets').value);renderWalletRows();setStatus(`Imported ${state.entries.length} wallet${state.entries.length===1?'':'s'} into the editor.`,'warn');}
      catch(error){setStatus(error.message,'bad');}
    });
    $('r23SaveWalletsBtn')?.addEventListener('click',()=>saveWalletList().catch(error=>setStatus(`Allowlist update: ${error.shortMessage||error.message}`,'bad')));
  }

  function renderWalletRows(){
    const list=$('r23WalletList');if(!list)return;
    list.innerHTML=state.entries.length?state.entries.map((row,index)=>`<div class="r23-wallet-row"><code title="${esc(row.address)}">${esc(short(row.address))}</code><input type="number" min="1" value="${row.allowance}" data-r23-allowance="${index}"/><button class="ghost-btn danger-btn" data-r23-remove="${index}" type="button">Remove</button></div>`).join(''):'<div class="forge-market-empty">No wallets in the editor.</div>';
    list.querySelectorAll('[data-r23-allowance]').forEach(input=>input.addEventListener('change',()=>{
      try{const i=Number(input.dataset.r23Allowance),a=Math.floor(Number(input.value));if(!Number.isInteger(a)||a<1)throw new Error('Allowance must be at least 1.');state.entries[i].allowance=a;}
      catch(error){setStatus(error.message,'bad');}
    }));
    list.querySelectorAll('[data-r23-remove]').forEach(button=>button.addEventListener('click',()=>{state.entries.splice(Number(button.dataset.r23Remove),1);renderWalletRows();}));
  }

  async function openWalletEditor(phaseId){
    if(state.busy)return;state.busy=true;setStatus(`Loading Stage ${phaseId} Approved Wallet list…`,'warn');
    try{
      const phase=state.phases.find(p=>p.id===phaseId);if(!phase||phase.accessType!==1)throw new Error('Selected stage is not an Approved Wallet stage.');
      const data=await getCloudList(phaseId);
      state.listPhaseId=phaseId;state.entries=normalizeEntries(data.entries||[]);state.listPublished=!!data.published;state.listInSync=!!data.inSync;state.storedRoot=data.storedRoot||null;
      renderWalletEditor();
      setStatus(data.published?`Loaded ${state.entries.length} published wallet${state.entries.length===1?'':'s'} for Stage ${phaseId}.`:`Stage ${phaseId} has no published proof table. Use Studio Repair / Sync Proofs to restore a pre-R2 list, or intentionally replace it here.`,data.published?'good':'warn');
    }finally{state.busy=false;}
  }

  async function saveWalletList(){
    if(state.busy)return;
    const phase=state.phases.find(p=>p.id===state.listPhaseId);if(!phase)throw new Error('Choose an Approved Wallet stage first.');
    const entries=normalizeEntries(state.entries);if(!entries.length)throw new Error('Approved Wallet stages cannot have an empty list. Disable the stage if no wallets should mint.');
    if(!state.listPublished){
      const ok=window.confirm('No published source list exists for this stage. Saving will replace the current onchain Merkle root with the wallets shown in this editor. The old root cannot be reverse-engineered into its prior wallet list. Continue?');
      if(!ok)return;
    }
    state.busy=true;
    try{
      const tree=buildBoundMerkle(entries,state.collection,phase.id),signer=await creatorSigner(),mp=new window.ethers.Contract(state.mintPhasesAddress,MINT_PHASES_ABI,signer),raw=await mp.phases(phase.id);
      setStatus(`Confirm Stage ${phase.id} eligibility-root update in your wallet…`,'warn');
      const tx=await mp.updatePhase(phase.id,BigInt(raw.price??raw[0]),Number(raw.startTime??raw[1]),Number(raw.endTime??raw[2]),Number(raw.phaseSupply??raw[3]),Number(raw.maxPerWallet??raw[5]),tree.root,Number(raw.accessType??raw[7]),Number(raw.priority??raw[8]));
      setStatus(`Stage ${phase.id} root submitted ${short(tx.hash)}. Waiting for confirmation…`,'warn');await tx.wait();
      try{await publishCloudList(phase.id,tree);state.retryPayload=null;setStatus(`Stage ${phase.id} eligibility updated and ${tree.entries.length} wallet proof${tree.entries.length===1?'':'s'} published.`,'good');}
      catch(error){state.retryPayload={phaseId:phase.id,tree};setStatus(`Onchain root updated, but Cloud proof publishing failed: ${error.message}. Do NOT change the stage again; use Retry Proof Sync below.`,'bad');renderRetry();return;}
      await reloadAfterChange(phase.id);
    }finally{state.busy=false;}
  }

  function renderRetry(){
    const wrap=$('r23WalletEditor')||$('r23StageManager');if(!wrap||!state.retryPayload)return;
    $('r23RetryRow')?.remove();
    const row=document.createElement('div');row.id='r23RetryRow';row.className='r23-retry';
    row.innerHTML='<strong>Cloud proof sync pending</strong><span>The onchain root already changed. Retry Cloud publication; do not create another stage or change this root.</span><button class="primary-btn" id="r23RetryBtn" type="button">Retry Proof Sync</button>';
    wrap.appendChild(row);
    $('r23RetryBtn')?.addEventListener('click',async()=>{
      try{const pending=state.retryPayload;setStatus(`Retrying Stage ${pending.phaseId} proof publication…`,'warn');await publishCloudList(pending.phaseId,pending.tree);state.retryPayload=null;row.remove();setStatus(`Stage ${pending.phaseId} proof publication repaired.`,'good');await reloadAfterChange(pending.phaseId);}
      catch(error){setStatus(`Retry failed: ${error.message}`,'bad');}
    });
  }

  function parseDate(id,allowBlank=true){
    const raw=String($(id)?.value||'').trim();if(!raw){if(allowBlank)return 0;throw new Error('End date/time is required unless No end date is selected.');}
    const date=new Date(raw);if(!Number.isFinite(date.getTime()))throw new Error('Date/time is invalid.');return Math.floor(date.getTime()/1000);
  }

  async function createStage(){
    if(state.busy)return;state.busy=true;
    try{
      const access=Number($('r23NewAccess')?.value||0),price=window.ethers.parseEther(String(Math.max(0,Number($('r23NewPrice')?.value||0)))),start=parseDate('r23NewStart',true),noEnd=!!$('r23NewNoEnd')?.checked,end=noEnd?0:parseDate('r23NewEnd',false);
      if(end&&end<=start)throw new Error('End date/time must be later than start.');
      const supply=Math.max(0,Math.floor(Number($('r23NewSupply')?.value||0))),maxWallet=Math.max(0,Math.floor(Number($('r23NewWalletMax')?.value||0))),enabled=!!$('r23NewEnabled')?.checked;
      const signer=await creatorSigner(),mp=new window.ethers.Contract(state.mintPhasesAddress,MINT_PHASES_ABI,signer),freshCount=Number(await mp.phaseCount()),phaseId=freshCount+1,maxPriority=state.phases.reduce((max,row)=>Math.max(max,Number(row.priority||0)),99),priority=Math.min(65535,maxPriority+1);
      let tree=null,root=ZERO;
      if(access===1){const entries=parseBulk($('r23NewWallets')?.value||'');if(!entries.length)throw new Error('Approved Wallet stage requires at least one initial wallet.');tree=buildBoundMerkle(entries,state.collection,phaseId);root=tree.root;}
      setStatus(`Confirm creation of Stage ${phaseId} in your wallet…`,'warn');
      const tx=await mp.createPhase(price,start,end,supply,maxWallet,root,access,priority,enabled);
      setStatus(`Stage ${phaseId} transaction ${short(tx.hash)} submitted. Waiting for confirmation…`,'warn');await tx.wait();
      const confirmedCount=Number(await mp.phaseCount());if(confirmedCount<phaseId)throw new Error('Stage transaction confirmed but phaseCount did not advance as expected.');
      if(tree){
        try{await publishCloudList(phaseId,tree);}
        catch(error){state.retryPayload={phaseId,tree};setStatus(`Stage ${phaseId} exists onchain, but proof publishing failed: ${error.message}. Do NOT create it again; use Retry Proof Sync.`,'bad');renderRetry();return;}
      }
      setStatus(`Stage ${phaseId} created${tree?` with ${tree.entries.length} Approved Wallet proof${tree.entries.length===1?'':'s'} published`:''}.`,'good');
      await reloadAfterChange(access===1?phaseId:null);
    }finally{state.busy=false;}
  }

  async function reloadAfterChange(reopenPhaseId=null){
    await loadOnchain(state.collection);renderPanel();
    if(reopenPhaseId&&state.phases.some(p=>p.id===reopenPhaseId&&p.accessType===1))await openWalletEditor(reopenPhaseId);
    const selected=document.querySelector('.launched-collection-item.selected');if(selected)setTimeout(()=>selected.click(),100);
  }

  async function scan(){
    const address=currentR12Address();if(!address){state.collection=null;return;}
    if(address===state.collection&&$('r23StageManager'))return;
    try{await loadOnchain(address);renderPanel();}catch(error){console.warn('R2.3 dashboard stage manager:',error);}
  }
  function scheduleScan(){clearTimeout(state.scanTimer);state.scanTimer=setTimeout(scan,120);}
  const detail=$('launchedCollectionDetail');if(detail)new MutationObserver(scheduleScan).observe(detail,{childList:true,subtree:true});
  window.addEventListener('relicforge:wallet-connected',scheduleScan);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleScan);else scheduleScan();
})();