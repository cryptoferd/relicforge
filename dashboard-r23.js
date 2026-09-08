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
    countdownTimer:null, countdownBoundaryRefreshing:false, chainTimeOffsetMs:0,
  };

  const apiBase = () => String(window.RelicForgeCloud?.apiBase?.() || window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short = value => { const s=String(value||''); return s.length>14 ? `${s.slice(0,6)}…${s.slice(-4)}` : s; };

  function setStatus(message,tone='') {
    const node=$('r23ManagerStatus'); if(!node)return;
    node.textContent=message; node.className=`r23-status ${tone}`.trim();
  }

  function dashboardChainNow() {
    return Math.floor((Date.now()+Number(state.chainTimeOffsetMs||0))/1000);
  }
  function dashboardCountdown(targetSeconds) {
    let total=Math.max(0,Number(targetSeconds)-dashboardChainNow());
    const days=Math.floor(total/86400); total%=86400;
    const hours=Math.floor(total/3600); total%=3600;
    const minutes=Math.floor(total/60);
    const seconds=Math.floor(total%60);
    const hh=String(hours).padStart(2,'0'),mm=String(minutes).padStart(2,'0'),ss=String(seconds).padStart(2,'0');
    return days>0?`${days}d ${hh}h ${mm}m ${ss}s`:`${hh}h ${mm}m ${ss}s`;
  }
  function dashboardStartLabel(seconds) {
    if(!Number(seconds))return '';
    return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(Number(seconds)*1000));
  }
  function updateDashboardCountdowns() {
    let crossed=false;
    document.querySelectorAll('[data-r25-dashboard-countdown]').forEach(node=>{
      const start=Number(node.dataset.start||0);
      const value=node.querySelector('b');
      if(!start||!value)return;
      if(start<=dashboardChainNow()){
        value.textContent='Opening…';
        crossed=true;
      }else value.textContent=dashboardCountdown(start);
    });
    if(crossed && !state.countdownBoundaryRefreshing && state.collection){
      state.countdownBoundaryRefreshing=true;
      setTimeout(async()=>{
        try{await loadOnchain(state.collection);renderPanel();}
        catch(error){console.warn('Dashboard phase countdown refresh:',error);}
        finally{state.countdownBoundaryRefreshing=false;}
      },1200);
    }
  }
  function startDashboardCountdowns() {
    if(state.countdownTimer){clearInterval(state.countdownTimer);state.countdownTimer=null;}
    if(!document.querySelector('[data-r25-dashboard-countdown]'))return;
    updateDashboardCountdowns();
    state.countdownTimer=setInterval(updateDashboardCountdowns,1000);
  }

  async function readProvider() {
    const scope=await window.RelicForgeForgeNetwork.requireReady();
    if(scope.chainId!==CHAIN_ID)throw new Error('This R12-v2 Stage Manager is restricted to verified Sepolia deployments.');
    const provider=window.RelicForgeNetworks.readProvider(CHAIN_ID);
    await window.RelicForgeNetworks.assertProvider(provider,CHAIN_ID);
    state.provider=provider;
    return provider;
  }

  async function creatorSigner() {
    if(!state.collection)throw new Error('Select a verified R12-v2 collection first.');
    return window.RF26CreatorGuard.signer(state.collection,{controller:state.controller,chainId:CHAIN_ID});
  }

  function currentR12Address() {
    const detail=$('launchedCollectionDetail'); if(!detail)return null;
    const eyebrow=detail.querySelector('.launched-detail-head .eyebrow')?.textContent||'';
    if(!/R12-v2 COLLECTION/i.test(eyebrow))return null;
    const text=detail.querySelector('.launched-detail-head p')?.textContent?.trim()||'';
    return window.ethers?.isAddress(text)?window.ethers.getAddress(text):null;
  }

  async function loadOnchain(address) {
    const ticket=state.readSerial=(state.readSerial||0)+1;
    const bound=await window.RF26CreatorGuard.read(address,{chainId:CHAIN_ID});
    const provider=await readProvider();
    const collection=new window.ethers.Contract(address,COLLECTION_ABI,provider);
    const mpAddress=window.ethers.getAddress(await collection.mintPhases());
    const mp=new window.ethers.Contract(mpAddress,MINT_PHASES_ABI,provider);
    const [controller,countRaw,latestBlock]=await Promise.all([mp.controller(),mp.phaseCount(),provider.getBlock('latest').catch(()=>null)]);
    if(latestBlock?.timestamp) state.chainTimeOffsetMs=(Number(latestBlock.timestamp)*1000)-Date.now();
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
    await bound.assert();
    if(ticket!==state.readSerial)throw new Error('A newer collection selection replaced this dashboard read.');
    if(window.ethers.getAddress(controller).toLowerCase()!==bound.identity.controller||mpAddress.toLowerCase()!==bound.identity.phases)
      throw new Error('Collection controller or MintPhases binding changed during refresh.');
    state.collection=window.ethers.getAddress(address);
    state.mintPhasesAddress=mpAddress;
    state.controller=window.ethers.getAddress(controller);
    state.phases=rows;
  }

  function pairHash(a,b){
    return BigInt(a)<=BigInt(b)?window.ethers.keccak256(window.ethers.concat([a,b])):window.ethers.keccak256(window.ethers.concat([b,a]));
  }

  function normalizeAddress(value) {
    const raw=String(value||'').trim();
    if(!/^0x[0-9a-fA-F]{40}$/.test(raw))throw new Error(`Invalid EVM wallet address: ${raw||'(blank)'}`);
    return window.ethers.getAddress(raw.toLowerCase());
  }

  function normalizeEntries(entries) {
    const map=new Map();
    for(const raw of entries||[]){
      const address=normalizeAddress(raw.address||raw.wallet||'');
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
    if(!state.collection)throw new Error('Select a verified collection first.');
    const session=await window.RF26CreatorGuard.account(state.collection,{role:'controller',chainId:CHAIN_ID});
    if(state.controller&&session.identity.controller!==state.controller.toLowerCase())
      throw new Error('The displayed MintPhases controller is stale. Refresh the collection.');
    await session.assert();
    await window.RelicForgeCloud.ensureSignedIn(session.wallet);
    return session;
  }

  async function getCloudList(phaseId){
    const session=await cloudAuth(),collection=session.identity.collection;
    await session.assert();
    return window.RelicForgeCloud.json(`/api/collections/${CHAIN_ID}/${encodeURIComponent(collection)}/v2/whitelist/${Number(phaseId)}`,{},true);
  }

  async function publishCloudList(phaseId,tree){
    const session=await cloudAuth(),collection=session.identity.collection;
    const provider=await readProvider();
    const mp=new window.ethers.Contract(session.identity.phases,MINT_PHASES_ABI,provider);
    const phase=await mp.phases(Number(phaseId));
    if(Number(phase.accessType??phase[7])!==1||
       String(phase.merkleRoot??phase[6]).toLowerCase()!==String(tree.root).toLowerCase())
      throw new Error('The onchain Approved Wallet root differs from this proof list. Refresh before publishing.');
    await session.assert();
    return window.RelicForgeCloud.json(
      `/api/collections/${CHAIN_ID}/${encodeURIComponent(collection)}/v2/whitelist/${Number(phaseId)}`,
      {method:'PUT',body:JSON.stringify({
        projectId:null,merkleRoot:tree.root,sourceType:2,sourceChainId:CHAIN_ID,sourceContract:null,snapshotBlock:0,
        entries:tree.entries.map(row=>({address:row.address,allowance:row.allowance,proof:row.proof}))
      })},true
    );
  }

  function phaseSummary(p){
    const type=p.accessType===1?'Approved Wallets':'Public';
    const countdown=p.enabled&&p.startTime>dashboardChainNow()
      ? `<small class="r25-phase-countdown" data-r25-dashboard-countdown="${p.id}" data-start="${p.startTime}"><span>Opens in</span><b>${dashboardCountdown(p.startTime)}</b><em>${esc(dashboardStartLabel(p.startTime))}</em></small>`
      : '';
    return `<div class="r23-stage-row"><div><strong>Stage ${p.id} · ${type}</strong><small>${esc(window.ethers.formatEther(p.price))} ETH · ${p.minted}${p.phaseSupply?` / ${p.phaseSupply}`:''} minted · priority ${p.priority}</small>${countdown}</div>${p.accessType===1?`<button class="ghost-btn" data-r23-manage="${p.id}" type="button">Manage Wallets</button>`:'<span class="r23-public-pill">PUBLIC</span>'}</div>`;
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
    startDashboardCountdowns();
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
      <label class="field"><span>Bulk wallet list</span><textarea id="r23BulkWallets" rows="4" placeholder="0xWallet, allowance&#10;0xWallet, allowance"></textarea><small>Paste one wallet per line. Save & Publish automatically applies this list when the editor is empty; use Apply Bulk List to preview it first.</small></label>
      <div class="launched-actions"><button class="ghost-btn" id="r23ImportWalletsBtn" type="button">Apply Bulk List</button><button class="primary-btn" id="r23SaveWalletsBtn" type="button">Save & Publish Eligibility</button></div>
    </div>`;
    renderWalletRows();
    $('r23AddWalletBtn')?.addEventListener('click',()=>{
      try{
        const added=normalizeEntries([{address:$('r23WalletAddress').value,allowance:$('r23WalletAllowance').value}])[0];
        state.entries=normalizeEntries([...state.entries,added]);$('r23WalletAddress').value='';$('r23WalletAllowance').value='1';renderWalletRows();
      }catch(error){setStatus(error.message,'bad');}
    });
    $('r23ImportWalletsBtn')?.addEventListener('click',()=>{
      try{
        state.entries=parseBulk($('r23BulkWallets').value);
        renderWalletRows();
        setStatus(`Applied ${state.entries.length} wallet${state.entries.length===1?'':'s'} to the editor. Review, then Save & Publish Eligibility.`,'warn');
      } catch(error){setStatus(error.message,'bad');}
    });
    $('r23BulkWallets')?.addEventListener('paste',()=>{
      setTimeout(()=>{
        try{
          const text=String($('r23BulkWallets')?.value||'').trim();
          if(!text)return;
          state.entries=parseBulk(text);
          renderWalletRows();
          setStatus(`Applied ${state.entries.length} pasted wallet${state.entries.length===1?'':'s'} to the editor. Nothing is onchain until Save & Publish Eligibility.`,'warn');
        } catch(error){setStatus(error.message,'bad');}
      },0);
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
    const bulkText=String($('r23BulkWallets')?.value||'').trim();
    if(!state.entries.length&&bulkText){
      state.entries=parseBulk(bulkText);
      renderWalletRows();
      setStatus(`Applied ${state.entries.length} wallet${state.entries.length===1?'':'s'} from the bulk list. Preparing eligibility update…`,'warn');
    }
    const entries=normalizeEntries(state.entries);if(!entries.length)throw new Error('No wallets are loaded. Paste a wallet list or use Add Wallet before Save & Publish Eligibility.');
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
  for(const event of ['relicforge:launch-network-changed','relicforge:forge-session-invalidated']){
    window.addEventListener(event,()=>{
      state.collection=null;state.mintPhasesAddress=null;state.controller=null;state.phases=[];state.provider=null;
      state.retryPayload=null;state.entries=[];state.busy=false;state.readSerial=(state.readSerial||0)+1;
      if(state.countdownTimer){clearInterval(state.countdownTimer);state.countdownTimer=null;}
      $('r23StageManager')?.remove();
    });
  }
  const detail=$('launchedCollectionDetail');if(detail)new MutationObserver(scheduleScan).observe(detail,{childList:true,subtree:true});
  window.addEventListener('relicforge:wallet-connected',scheduleScan);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleScan);else scheduleScan();
})();