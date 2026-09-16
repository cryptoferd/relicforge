(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const core = window.RelicForgeSafeAdminCore;
  const MAX_COLLECTIONS = 500;

  const COLLECTION_READ_ABI = [
    'function name() view returns(string)',
    'function symbol() view returns(string)',
    'function creator() view returns(address)',
    'function controller() view returns(address)',
    'function factory() view returns(address)',
    'function feePolicy() view returns(address)',
    'function forgeReserve() view returns(address)',
    'function mintPhases() view returns(address)',
    'function platformFeeMode() view returns(uint8)',
    'function lockedPlatformFeeCents() view returns(uint32)',
    'function batchWindowSeconds() view returns(uint64)',
    'function maxRandomnessCostPerBatchWei() view returns(uint256)',
    'function payoutReceiver() view returns(address)',
    'function royaltyReceiver() view returns(address)',
    'function royaltyBps() view returns(uint96)',
    'function futureRevealMode() view returns(uint8)',
    'function flattenedRenderBaseURI() view returns(string)',
    'function holderRenderModeEnabled() view returns(bool)',
    'function defaultRenderMode() view returns(uint8)'
  ];
  const MINT_PHASES_READ_ABI = [
    'function controller() view returns(address)',
    'function masterMintEnabled() view returns(bool)',
    'function phaseCount() view returns(uint32)',
    'function phases(uint32) view returns(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 minted,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled)'
  ];
  const FEE_POLICY_READ_ABI = [
    'function platformAdmin() view returns(address)',
    'function pendingPlatformAdmin() view returns(address)',
    'function treasury() view returns(address)',
    'function pendingTreasury() view returns(address)',
    'function sponsoredFeeCents() view returns(uint32)',
    'function minterFeeCents() view returns(uint32)',
    'function accruedFees() view returns(uint256)',
    'function collectionFeesEnabled(address) view returns(bool)',
    'function collectionFeeWaived(address) view returns(bool)',
    'function collectionFeeOverrideSet(address) view returns(bool)',
    'function currentCollectionFeeCents(address,uint32) view returns(uint32)'
  ];
  const RESERVE_READ_ABI = [
    'function founder() view returns(address)',
    'function pendingFounder() view returns(address)',
    'function revenueTreasury() view returns(address)',
    'function pendingRevenueTreasury() view returns(address)',
    'function minimumReserveWei() view returns(uint256)',
    'function perActiveBatchBufferWei() view returns(uint256)',
    'function exposureSafetyBps() view returns(uint32)',
    'function maxSubsidyPerRequestWei() view returns(uint256)',
    'function maxSubsidyPerCollectionWei() view returns(uint256)',
    'function availableRevenueWei() view returns(uint256)',
    'function collectionCount() view returns(uint256)',
    'function collections(uint256) view returns(address)',
    'function canonicalCollection(address) view returns(bool)'
  ];
  const SAFE_READ_ABI = [
    'function getOwners() view returns(address[])',
    'function getThreshold() view returns(uint256)',
    'function VERSION() view returns(string)'
  ];

  const state = {
    chainId: 1,
    cfg: null,
    provider: null,
    collections: [],
    selected: null,
    generated: null,
    providerCache: new Map()
  };

  function esc(value){
    return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function short(value){
    const s=String(value||'');
    return s.length>14?`${s.slice(0,8)}…${s.slice(-6)}`:(s||'—');
  }
  function status(message,type=''){
    const node=$('founderSafeStatus');
    if(!node)return;
    node.textContent=message;
    node.className=`founder-safe-status ${type}`.trim();
  }
  function setText(id,value){const node=$(id);if(node)node.textContent=value;}
  function canonicalConfig(chainId=state.chainId){
    const cfg=window.RELICFORGE_V2_ADDRESSES?.[Number(chainId)];
    if(!cfg||cfg.launchEnabled!==true)throw new Error(`No enabled Relic Forge release is configured for chain ${chainId}.`);
    for(const key of ['factory','feePolicy','reserve']){
      if(!window.ethers?.isAddress(cfg[key]))throw new Error(`Canonical ${key} is unavailable for ${cfg.network||chainId}.`);
    }
    return cfg;
  }
  async function requireFounder(){
    const cloud=window.RelicForgeCloud;
    if(!cloud?.enabled?.())throw new Error('RelicForge Cloud is required to verify Founder access.');
    const wallet=window.RelicForgeProjects?.getWallet?.();
    if(wallet)await cloud.ensureSignedIn(wallet);
    const me=await cloud.json('/api/auth/me',{},true);
    if(!me?.isFounder)throw new Error('Founder authorization is required.');
    return me;
  }
  async function readProvider(chainId=state.chainId){
    const id=Number(chainId);
    if(state.providerCache.has(id))return state.providerCache.get(id);
    const apiBase=String(window.RelicForgeCloud?.apiBase?.()||window.RELICFORGE_CONFIG?.apiBase||'').replace(/\/$/,'');
    let provider;
    if(apiBase){
      provider=new window.ethers.JsonRpcProvider(`${apiBase}/api/public/rpc/${id}`,id,{staticNetwork:true});
    }else{
      const injected=window.RelicForgeWalletSession?.getProvider?.()||window.ethereum;
      if(!injected)throw new Error('No read provider is available.');
      provider=new window.ethers.BrowserProvider(injected);
      const network=await provider.getNetwork();
      if(Number(network.chainId)!==id)throw new Error('RelicForge Cloud RPC is unavailable and the connected wallet is on a different network.');
    }
    state.providerCache.set(id,provider);
    return provider;
  }

  function populateNetworks(){
    const select=$('founderSafeNetwork');
    if(!select)return;
    const entries=Object.values(window.RELICFORGE_V2_ADDRESSES||{})
      .filter(cfg=>cfg?.launchEnabled===true&&Number.isFinite(Number(cfg.chainId)))
      .sort((a,b)=>Number(a.chainId===1?0:1)-Number(b.chainId===1?0:1)||String(a.network).localeCompare(String(b.network)));
    select.innerHTML=entries.map(cfg=>`<option value="${Number(cfg.chainId)}">${esc(cfg.network||`Chain ${cfg.chainId}`)}</option>`).join('');
    if(entries.some(cfg=>Number(cfg.chainId)===1))select.value='1';
    state.chainId=Number(select.value||entries[0]?.chainId||1);
  }

  function populateActions(){
    const select=$('founderSafeAction');
    if(!select||!core)return;
    const groups=new Map();
    for(const action of core.ACTIONS){
      if(!groups.has(action.group))groups.set(action.group,[]);
      groups.get(action.group).push(action);
    }
    select.innerHTML=[...groups.entries()].map(([label,actions])=>
      `<optgroup label="${esc(label)}">${actions.map(action=>`<option value="${esc(action.id)}">${esc(action.label)}</option>`).join('')}</optgroup>`
    ).join('');
    select.value='collection.randomnessCeiling';
  }

  async function readCollection(address,index=null){
    const cfg=state.cfg||canonicalConfig();
    const provider=state.provider||await readProvider();
    const checksum=window.ethers.getAddress(address);
    const reserve=new window.ethers.Contract(cfg.reserve,RESERVE_READ_ABI,provider);
    if(!await reserve.canonicalCollection(checksum))throw new Error('Address is not a canonical collection in the selected Relic Forge Reserve.');

    const collection=new window.ethers.Contract(checksum,COLLECTION_READ_ABI,provider);
    const [
      name,symbol,creator,controller,factory,feePolicy,forgeReserve,mintPhases,
      feeMode,lockedCents,batchWindow,randomnessCeiling,payoutReceiver,royaltyReceiver,
      royaltyBps,futureRevealMode,flattenedRenderBaseURI,holderRenderModeEnabled,defaultRenderMode
    ]=await Promise.all([
      collection.name(),collection.symbol(),collection.creator(),collection.controller(),collection.factory(),
      collection.feePolicy(),collection.forgeReserve(),collection.mintPhases(),collection.platformFeeMode(),
      collection.lockedPlatformFeeCents(),collection.batchWindowSeconds(),collection.maxRandomnessCostPerBatchWei(),
      collection.payoutReceiver(),collection.royaltyReceiver(),collection.royaltyBps(),collection.futureRevealMode(),
      collection.flattenedRenderBaseURI(),collection.holderRenderModeEnabled(),collection.defaultRenderMode()
    ]);
    if(String(factory).toLowerCase()!==String(cfg.factory).toLowerCase())throw new Error('Collection Factory does not match the selected canonical release.');
    if(String(feePolicy).toLowerCase()!==String(cfg.feePolicy).toLowerCase())throw new Error('Collection FeePolicy does not match the selected canonical release.');
    if(String(forgeReserve).toLowerCase()!==String(cfg.reserve).toLowerCase())throw new Error('Collection Reserve does not match the selected canonical release.');

    const phases=new window.ethers.Contract(mintPhases,MINT_PHASES_READ_ABI,provider);
    const [phaseController,masterMintEnabled,phaseCount]=await Promise.all([
      phases.controller(),phases.masterMintEnabled(),phases.phaseCount()
    ]);
    if(String(phaseController).toLowerCase()!==String(controller).toLowerCase()){
      throw new Error('Collection and MintPhases controller bindings do not match.');
    }
    return {
      index,address:checksum,name:String(name),symbol:String(symbol),creator:window.ethers.getAddress(creator),
      controller:window.ethers.getAddress(controller),mintPhases:window.ethers.getAddress(mintPhases),
      feeMode:Number(feeMode),lockedCents:Number(lockedCents),batchWindow:Number(batchWindow),
      randomnessCeiling:BigInt(randomnessCeiling),payoutReceiver:window.ethers.getAddress(payoutReceiver),
      royaltyReceiver:window.ethers.getAddress(royaltyReceiver),royaltyBps:Number(royaltyBps),
      futureRevealMode:Number(futureRevealMode),flattenedRenderBaseURI:String(flattenedRenderBaseURI||''),
      holderRenderModeEnabled:Boolean(holderRenderModeEnabled),defaultRenderMode:Number(defaultRenderMode),
      masterMintEnabled:Boolean(masterMintEnabled),phaseCount:Number(phaseCount)
    };
  }

  async function batchMap(items,size,fn){
    const out=[];
    for(let i=0;i<items.length;i+=size){
      const chunk=items.slice(i,i+size);
      out.push(...await Promise.all(chunk.map(fn)));
    }
    return out;
  }

  async function loadCollections(){
    await requireFounder();
    state.cfg=canonicalConfig(state.chainId);
    state.provider=await readProvider(state.chainId);
    state.generated=null;
    renderGenerated();
    status(`Loading canonical ${state.cfg.network||state.chainId} collections…`);

    const reserve=new window.ethers.Contract(state.cfg.reserve,RESERVE_READ_ABI,state.provider);
    const count=Number(await reserve.collectionCount());
    const take=Math.min(count,MAX_COLLECTIONS);
    const indexes=Array.from({length:take},(_,i)=>count-1-i);
    const addresses=await batchMap(indexes,25,async index=>({index,address:await reserve.collections(index)}));
    const details=await batchMap(addresses,8,async row=>{
      try{return await readCollection(row.address,row.index);}
      catch(error){console.warn('Safe Admin collection read failed',row.address,error);return null;}
    });
    state.collections=details.filter(Boolean);
    renderCollectionOptions(count);
    state.selected=state.collections[0]||null;
    if(state.selected)$('founderSafeCollection').value=state.selected.address;
    await renderSelectedCollection();
    await renderAction();
    status(count
      ? `Loaded ${state.collections.length}${count>MAX_COLLECTIONS?` of ${count} latest`:''} canonical collection${count===1?'':'s'} from the onchain Reserve.`
      : `No canonical collections have been deployed on ${state.cfg.network||'this network'} yet. You can still load a canonical address manually later.`,
      count?'success':'warning'
    );
  }

  function renderCollectionOptions(total){
    const select=$('founderSafeCollection');
    if(!select)return;
    select.innerHTML=state.collections.length
      ? state.collections.map(row=>`<option value="${esc(row.address)}">${esc(row.name||'Unnamed')} (${esc(row.symbol||'')}) — ${esc(short(row.address))}${row.index!=null?` · #${Number(row.index)+1}`:''}</option>`).join('')
      : '<option value="">No deployed canonical collections on this network</option>';
    select.disabled=!state.collections.length;
    setText('founderSafeCollectionCount',`${total} canonical deployment${total===1?'':'s'} registered`);
  }

  async function manualLoad(){
    await requireFounder();
    const raw=String($('founderSafeManualCollection')?.value||'').trim();
    if(!window.ethers.isAddress(raw))throw new Error('Enter a valid collection address.');
    status('Verifying canonical collection…');
    const row=await readCollection(raw,null);
    const existing=state.collections.find(item=>item.address.toLowerCase()===row.address.toLowerCase());
    if(!existing){
      state.collections.unshift(row);
      renderCollectionOptions(state.collections.length);
    }
    state.selected=existing||row;
    const select=$('founderSafeCollection');
    if(select){select.disabled=false;select.value=state.selected.address;}
    await renderSelectedCollection();
    await renderAction();
    status(`Loaded canonical collection ${row.name}.`,'success');
  }

  async function selectCollection(){
    const address=String($('founderSafeCollection')?.value||'');
    state.selected=state.collections.find(row=>row.address.toLowerCase()===address.toLowerCase())||null;
    state.generated=null;
    renderGenerated();
    await renderSelectedCollection();
    await renderAction();
  }

  function renderSelectedCollection(){
    const host=$('founderSafeCollectionDetail');
    if(!host)return;
    if(!state.selected){
      host.innerHTML='<div class="empty-state">Select or load a canonical collection to build an admin call.</div>';
      return;
    }
    const s=state.selected;
    host.innerHTML=`<div><span>Collection</span><strong>${esc(s.name)} (${esc(s.symbol)})</strong></div>
      <div><span>Contract</span><code>${esc(s.address)}</code></div>
      <div><span>Creator</span><code>${esc(s.creator)}</code></div>
      <div><span>Controller</span><code>${esc(s.controller)}</code></div>
      <div><span>MintPhases</span><code>${esc(s.mintPhases)}</code></div>
      <div><span>Fee mode</span><strong>${s.feeMode===1?'Creator Sponsored':s.feeMode===2?'Collector Supported':`Mode ${s.feeMode}`}</strong></div>
      <div><span>Forge window</span><strong>${s.batchWindow}s</strong></div>
      <div><span>Randomness ceiling</span><strong>${esc(window.ethers.formatEther(s.randomnessCeiling))} ETH</strong></div>`;
  }

  function currentAction(){return core?.byId($('founderSafeAction')?.value)||null;}
  function actionNeedsCollection(action){return !!action&&(action.target==='collection'||action.target==='mintPhases'||action.inputs?.some(input=>input.auto==='collection'));}
  function inputId(name){return `founderSafeInput_${name}`;}

  function fieldHtml(spec){
    if(spec.auto)return '';
    const value=spec.defaultValue??'';
    if(spec.kind==='bool'){
      return `<label class="field"><span>${esc(spec.label)}</span><select id="${esc(inputId(spec.name))}"><option value="true"${value==='true'?' selected':''}>Yes / True</option><option value="false"${value==='false'?' selected':''}>No / False</option></select></label>`;
    }
    if(spec.kind==='select'){
      return `<label class="field"><span>${esc(spec.label)}</span><select id="${esc(inputId(spec.name))}">${(spec.options||[]).map(([v,l])=>`<option value="${esc(v)}"${String(v)===String(value)?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
    }
    const inputMode=['uint'].includes(spec.kind)?' inputmode="numeric"':'';
    const placeholder=spec.kind==='address'?'0x…':spec.kind==='eth'?'0.005':spec.kind==='usd'?'0.50':'';
    return `<label class="field"><span>${esc(spec.label)}</span><input id="${esc(inputId(spec.name))}" type="text"${inputMode} value="${esc(value)}" placeholder="${esc(placeholder)}"/></label>`;
  }

  async function prefillAction(action){
    if(!state.provider||actionNeedsCollection(action)&&!state.selected)return;
    const s=state.selected;
    const cfg=state.cfg;
    const policy=new window.ethers.Contract(cfg.feePolicy,FEE_POLICY_READ_ABI,state.provider);
    const reserve=new window.ethers.Contract(cfg.reserve,RESERVE_READ_ABI,state.provider);
    const set=(name,value)=>{const node=$(inputId(name));if(node&&value!=null)node.value=String(value);};
    try{
      switch(action.id){
        case 'collection.batchWindow': set('newWindowSeconds',s.batchWindow); break;
        case 'collection.randomnessCeiling': set('newCeilingWei',window.ethers.formatEther(s.randomnessCeiling)); break;
        case 'fees.collectionEnabled': set('enabled',String(await policy.collectionFeesEnabled(s.address))); break;
        case 'fees.collectionRate': {
          const cents=Number(await policy.currentCollectionFeeCents(s.address,s.lockedCents)); set('feeCents',(cents/100).toFixed(2)); break;
        }
        case 'fees.defaults': {
          const [a,b]=await Promise.all([policy.sponsoredFeeCents(),policy.minterFeeCents()]);
          set('sponsoredCents',(Number(a)/100).toFixed(2));set('minterCents',(Number(b)/100).toFixed(2));break;
        }
        case 'reserve.policy': {
          const values=await Promise.all([
            reserve.minimumReserveWei(),reserve.perActiveBatchBufferWei(),reserve.exposureSafetyBps(),
            reserve.maxSubsidyPerRequestWei(),reserve.maxSubsidyPerCollectionWei()
          ]);
          set('minimumReserveWei_',window.ethers.formatEther(values[0]));
          set('perActiveBatchBufferWei_',window.ethers.formatEther(values[1]));
          set('exposureSafetyBps_',Number(values[2]));
          set('maxSubsidyPerRequestWei_',window.ethers.formatEther(values[3]));
          set('maxSubsidyPerCollectionWei_',window.ethers.formatEther(values[4]));
          break;
        }
        case 'creator.payout': set('receiver',s.payoutReceiver); break;
        case 'creator.royalty': set('receiver',s.royaltyReceiver);set('bps',s.royaltyBps);break;
        case 'creator.futureReveal': set('mode',s.futureRevealMode); break;
        case 'creator.renderConfig':
          set('baseURI',s.flattenedRenderBaseURI);set('holderEnabled',String(s.holderRenderModeEnabled));set('defaultMode',s.defaultRenderMode);break;
        case 'phases.masterMint': set('enabled',String(s.masterMintEnabled)); break;
      }
    }catch(error){console.warn('Safe Admin prefill failed',action.id,error);}
  }

  async function renderAction(){
    const action=currentAction();
    const fields=$('founderSafeActionFields');
    const copy=$('founderSafeActionCopy');
    const warning=$('founderSafeActionWarning');
    if(!action||!fields)return;
    fields.innerHTML=action.inputs.map(fieldHtml).join('')||'<div class="founder-safe-no-inputs">This call has no parameters.</div>';
    if(copy)copy.textContent=action.description||'';
    if(warning){
      warning.classList.toggle('hidden',!action.warning);
      warning.classList.toggle('critical',!!action.critical);
      warning.textContent=action.warning||'';
    }
    state.generated=null;
    renderGenerated();
    await prefillAction(action);
    await refreshAuthorization();
    await renderCurrentState();
  }

  async function authorityFor(action){
    if(!action)return {required:null,label:'Unknown'};
    if(action.authority==='controller'&&!state.selected)return {required:null,label:'Collection controller unavailable'};
    const cfg=state.cfg;
    const provider=state.provider;
    const policy=new window.ethers.Contract(cfg.feePolicy,FEE_POLICY_READ_ABI,provider);
    const reserve=new window.ethers.Contract(cfg.reserve,RESERVE_READ_ABI,provider);
    switch(action.authority){
      case 'reserveFounder': return {required:window.ethers.getAddress(await reserve.founder()),label:'Reserve founder'};
      case 'platformAdmin': return {required:window.ethers.getAddress(await policy.platformAdmin()),label:'FeePolicy platformAdmin'};
      case 'pendingPlatformAdmin': return {required:window.ethers.getAddress(await policy.pendingPlatformAdmin()),label:'FeePolicy pendingPlatformAdmin'};
      case 'pendingTreasury': return {required:window.ethers.getAddress(await policy.pendingTreasury()),label:'FeePolicy pendingTreasury'};
      case 'pendingFounder': return {required:window.ethers.getAddress(await reserve.pendingFounder()),label:'Reserve pendingFounder'};
      case 'pendingRevenueTreasury': return {required:window.ethers.getAddress(await reserve.pendingRevenueTreasury()),label:'Reserve pendingRevenueTreasury'};
      case 'controller': return {required:state.selected.controller,label:'Collection controller'};
      case 'any': return {required:null,label:'Any sender'};
      default: return {required:null,label:'Unknown'};
    }
  }

  async function inspectSafe(address){
    if(!address||!window.ethers.isAddress(address))return {address:null,contract:false,isSafe:false,owners:[],threshold:null,version:null};
    const checksum=window.ethers.getAddress(address);
    const code=await state.provider.getCode(checksum);
    if(!code||code==='0x')return {address:checksum,contract:false,isSafe:false,owners:[],threshold:null,version:null};
    const contract=new window.ethers.Contract(checksum,SAFE_READ_ABI,state.provider);
    const [ownersResult,thresholdResult,versionResult]=await Promise.allSettled([
      contract.getOwners(),contract.getThreshold(),contract.VERSION()
    ]);
    const owners=ownersResult.status==='fulfilled'?ownersResult.value.map(window.ethers.getAddress):[];
    return {
      address:checksum,contract:true,isSafe:owners.length>0,owners,
      threshold:thresholdResult.status==='fulfilled'?Number(thresholdResult.value):null,
      version:versionResult.status==='fulfilled'?String(versionResult.value):null
    };
  }

  async function refreshAuthorization(){
    const action=currentAction();
    const host=$('founderSafeAuthorization');
    if(!host||!action||actionNeedsCollection(action)&&!state.selected)return;
    const auth=await authorityFor(action);
    const safeRaw=String($('founderSafeAddress')?.value||'').trim();
    let safe={address:null,contract:false,isSafe:false,owners:[],threshold:null,version:null};
    if(safeRaw&&window.ethers.isAddress(safeRaw)){
      try{safe=await inspectSafe(safeRaw);}catch(error){console.warn('Safe inspection failed',error);}
    }
    const zero=window.ethers.ZeroAddress;
    const pendingMissing=auth.required&&auth.required.toLowerCase()===zero.toLowerCase();
    const match=!auth.required||(safe.address&&safe.address.toLowerCase()===auth.required.toLowerCase());
    const authLabel=auth.required?(pendingMissing?'Not configured':auth.required):'Any sender';
    const safeState=!safeRaw?'Enter your Safe address'
      :!safe.address?'Invalid address'
      :!safe.contract?'Address has no contract code on this network'
      :!safe.isSafe?'Contract detected, but Safe getOwners() could not be verified'
      :`Safe verified${safe.version?` · v${safe.version}`:''}${safe.threshold?` · ${safe.threshold}/${safe.owners.length}`:''}`;
    const result=auth.required?(pendingMissing?'BLOCKED — pending authority is not configured':match?'AUTHORIZED — selected Safe matches required sender':'NOT AUTHORIZED — this Safe would revert as sender'):'AUTHORIZED — this function is permissionless';
    host.innerHTML=`<div><span>Required sender</span><code>${esc(authLabel)}</code><small>${esc(auth.label)}</small></div>
      <div><span>Selected Safe</span><code>${esc(safe.address||safeRaw||'—')}</code><small>${esc(safeState)}</small></div>
      <div class="${match&&!pendingMissing?'ok':'warn'}"><span>Authorization</span><strong>${esc(result)}</strong></div>`;
    host.dataset.authorized=String(Boolean(match&&!pendingMissing));
    host.dataset.safeVerified=String(Boolean(safe.isSafe));
  }

  async function renderCurrentState(){
    const action=currentAction();
    const node=$('founderSafeCurrentState');
    if(!node||!action||actionNeedsCollection(action)&&!state.selected)return;
    node.textContent='Reading current onchain state…';
    const s=state.selected,cfg=state.cfg;
    const policy=new window.ethers.Contract(cfg.feePolicy,FEE_POLICY_READ_ABI,state.provider);
    const reserve=new window.ethers.Contract(cfg.reserve,RESERVE_READ_ABI,state.provider);
    try{
      let text='';
      switch(action.id){
        case 'collection.batchWindow': text=`Current Forge batch window: ${s.batchWindow} seconds.`;break;
        case 'collection.randomnessCeiling': text=`Current randomness ceiling: ${window.ethers.formatEther(s.randomnessCeiling)} ETH.`;break;
        case 'fees.collectionEnabled': text=`Collection fee enabled: ${await policy.collectionFeesEnabled(s.address)}. Permanent waiver: ${await policy.collectionFeeWaived(s.address)}.`;break;
        case 'fees.collectionRate': {
          const cents=Number(await policy.currentCollectionFeeCents(s.address,s.lockedCents));
          text=`Locked base: $${(s.lockedCents/100).toFixed(2)}. Current effective rate: $${(cents/100).toFixed(2)} / NFT. Override set: ${await policy.collectionFeeOverrideSet(s.address)}.`;break;
        }
        case 'fees.clearCollectionRate': text=`Override set: ${await policy.collectionFeeOverrideSet(s.address)}. Locked base: $${(s.lockedCents/100).toFixed(2)} / NFT.`;break;
        case 'fees.waiveCollection': text=`Permanent waiver already set: ${await policy.collectionFeeWaived(s.address)}.`;break;
        case 'fees.defaults': {
          const [a,b]=await Promise.all([policy.sponsoredFeeCents(),policy.minterFeeCents()]);
          text=`Current future defaults: creator-sponsored $${(Number(a)/100).toFixed(2)} / NFT; collector-paid $${(Number(b)/100).toFixed(2)} / NFT.`;break;
        }
        case 'fees.proposeTreasury':
        case 'fees.acceptTreasury': text=`Treasury: ${await policy.treasury()}. Pending treasury: ${await policy.pendingTreasury()}.`;break;
        case 'fees.transferAdmin':
        case 'fees.acceptAdmin': text=`Platform admin: ${await policy.platformAdmin()}. Pending admin: ${await policy.pendingPlatformAdmin()}.`;break;
        case 'fees.withdraw': text=`Accrued FeePolicy balance ready to forward: ${window.ethers.formatEther(await policy.accruedFees())} ETH.`;break;
        case 'reserve.policy': {
          const v=await Promise.all([reserve.minimumReserveWei(),reserve.perActiveBatchBufferWei(),reserve.exposureSafetyBps(),reserve.maxSubsidyPerRequestWei(),reserve.maxSubsidyPerCollectionWei()]);
          text=`Reserve policy: minimum ${window.ethers.formatEther(v[0])} ETH; active-batch buffer ${window.ethers.formatEther(v[1])} ETH; safety ${Number(v[2])} bps; request cap ${window.ethers.formatEther(v[3])} ETH; collection cap ${window.ethers.formatEther(v[4])} ETH.`;break;
        }
        case 'reserve.releaseRevenue': text=`Available releasable revenue: ${window.ethers.formatEther(await reserve.availableRevenueWei())} ETH.`;break;
        case 'reserve.proposeTreasury':
        case 'reserve.acceptTreasury': text=`Reserve revenue treasury: ${await reserve.revenueTreasury()}. Pending: ${await reserve.pendingRevenueTreasury()}.`;break;
        case 'reserve.proposeFounder':
        case 'reserve.acceptFounder': text=`Reserve founder: ${await reserve.founder()}. Pending founder: ${await reserve.pendingFounder()}.`;break;
        case 'creator.payout': text=`Current payout receiver: ${s.payoutReceiver}.`;break;
        case 'creator.royalty': text=`Current royalty: ${s.royaltyReceiver} at ${s.royaltyBps} bps.`;break;
        case 'creator.futureReveal': text=`Current future reveal mode: ${s.futureRevealMode===0?'Deferred Reveal':'Forge Reveal'}.`;break;
        case 'creator.renderConfig': text=`Current render config: holder switching ${s.holderRenderModeEnabled?'enabled':'disabled'}, default mode ${s.defaultRenderMode}, base URI ${s.flattenedRenderBaseURI||'(empty)'}.`;break;
        case 'creator.transferOwnership':
        case 'creator.renounce': text=`Current collection controller: ${s.controller}.`;break;
        case 'phases.masterMint': text=`Master Mint is ${s.masterMintEnabled?'ENABLED':'DISABLED'}. ${s.phaseCount} stage${s.phaseCount===1?'':'s'} configured.`;break;
        case 'phases.stageEnabled': text=`${s.phaseCount} stage${s.phaseCount===1?'':'s'} configured. Enter a valid existing stage ID.`;break;
        default: text=`Selected collection controller: ${s.controller}.`;
      }
      node.textContent=text;
    }catch(error){node.textContent=`Current-state read failed: ${error.shortMessage||error.message}`;}
  }

  function rawInput(spec){
    if(spec.auto==='collection')return state.selected.address;
    return String($(inputId(spec.name))?.value??'').trim();
  }
  function convertInput(spec,raw){
    switch(spec.kind){
      case 'address':
        if(!window.ethers.isAddress(raw))throw new Error(`${spec.label} must be a valid EVM address.`);
        return window.ethers.getAddress(raw);
      case 'bool':
        if(raw!=='true'&&raw!=='false')throw new Error(`${spec.label} must be true or false.`);
        return raw==='true';
      case 'eth':
        if(!/^\d+(?:\.\d+)?$/.test(raw))throw new Error(`${spec.label} must be a valid ETH amount.`);
        return window.ethers.parseEther(raw);
      case 'usd': {
        const cents=core.parseUsdCents(raw);
        if(cents>500n)throw new Error(`${spec.label} exceeds the R12-v2 $5.00 hard ceiling.`);
        return cents;
      }
      case 'uint':
      case 'select': return core.parseUnsigned(raw,spec.label);
      case 'string': return raw;
      default: return raw;
    }
  }
  function safeValue(value){
    if(typeof value==='bigint')return value.toString();
    if(typeof value==='boolean')return value?'true':'false';
    return String(value);
  }
  function targetFor(action){
    if(action.target==='collection')return state.selected.address;
    if(action.target==='mintPhases')return state.selected.mintPhases;
    if(action.target==='feePolicy')return state.cfg.feePolicy;
    if(action.target==='reserve')return state.cfg.reserve;
    throw new Error(`Unknown target type: ${action.target}`);
  }

  async function generate(){
    await requireFounder();
    const action=currentAction();
    if(!action)throw new Error('Select an admin action.');
    if(actionNeedsCollection(action)&&!state.selected)throw new Error('Select a canonical deployed collection first.');
    const rawValues={},args=[],safeValues={};
    for(const spec of action.inputs){
      const raw=rawInput(spec);
      rawValues[spec.name]=raw;
      const converted=convertInput(spec,raw);
      args.push(converted);
      safeValues[spec.name]=safeValue(converted);
    }
    const iface=new window.ethers.Interface([action.abi]);
    const fn=(action.abi.match(/function\s+([A-Za-z0-9_]+)/)||[])[1];
    const data=iface.encodeFunctionData(fn,args);
    const target=window.ethers.getAddress(targetFor(action));
    const auth=await authorityFor(action);
    const safeRaw=String($('founderSafeAddress')?.value||'').trim();
    const safeAddress=safeRaw&&window.ethers.isAddress(safeRaw)?window.ethers.getAddress(safeRaw):null;
    const pendingMissing=auth.required&&auth.required.toLowerCase()===window.ethers.ZeroAddress.toLowerCase();
    const authorized=!auth.required||(safeAddress&&safeAddress.toLowerCase()===auth.required.toLowerCase());
    let safeInfo={isSafe:false};
    if(safeAddress)try{safeInfo=await inspectSafe(safeAddress);}catch{}
    let simulation={attempted:false,ok:false,message:'Enter and verify a Safe address to simulate this call.'};
    if(safeAddress){
      simulation.attempted=true;
      try{
        await state.provider.call({from:safeAddress,to:target,data,value:0n});
        simulation.ok=true;
        simulation.message='Read-only eth_call simulation succeeded from the selected Safe address.';
      }catch(error){
        simulation.message=`Simulation reverted: ${error.shortMessage||error.reason||error.message}`;
      }
    }
    state.generated={
      action,target,data,functionName:fn,args,safeValues,rawValues,auth,safeAddress,safeInfo,
      authorized:Boolean(authorized&&!pendingMissing),pendingMissing,simulation
    };
    renderGenerated();
    await refreshAuthorization();
    status(simulation.ok?'Admin call generated and read-only simulation passed.':'Admin call generated. Review the authorization/simulation warning before using it in Safe.',simulation.ok?'success':'warning');
  }

  function renderGenerated(){
    const box=$('founderSafeGenerated');
    if(!box)return;
    const g=state.generated;
    if(!g){
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    setText('founderSafeTarget',g.target);
    setText('founderSafeValue','0 ETH');
    setText('founderSafeFunctionAbi',g.action.abi);
    setText('founderSafeArguments',JSON.stringify(g.safeValues,null,2));
    setText('founderSafeCalldata',g.data);
    const sim=$('founderSafeSimulation');
    if(sim){
      sim.textContent=g.simulation.message;
      sim.className=`founder-safe-simulation ${g.simulation.ok?'success':'warning'}`;
    }
    const safeReady=Boolean(g.safeAddress&&g.safeInfo?.isSafe&&g.authorized&&g.simulation.ok);
    const download=$('founderSafeDownloadJsonBtn');
    if(download){
      download.disabled=!safeReady;
      download.title=safeReady?'Download Safe Transaction Builder JSON':
        !g.safeAddress?'Enter a Safe address first.':
        !g.safeInfo?.isSafe?'Selected address was not verified as a Safe on this network.':
        !g.authorized?'Selected Safe is not the required onchain sender.':
        'Read-only simulation must succeed before Safe JSON export is enabled.';
    }
    const jsonPreview=$('founderSafeJsonPreview');
    if(jsonPreview){
      if(g.safeAddress){
        const json=core.buildSafeTransactionBuilder({
          action:g.action,chainId:state.chainId,safeAddress:g.safeAddress,target:g.target,inputValues:g.safeValues,
          name:`Relic Forge — ${g.action.label}`,
          description:`${state.cfg.network||state.chainId} · ${state.selected?state.selected.name+' · '+state.selected.address:'Platform-level call'}`
        });
        jsonPreview.textContent=JSON.stringify(json,null,2);
      }else jsonPreview.textContent='Enter a Safe address to generate the Safe Transaction Builder JSON.';
    }
  }

  async function copyText(value,label){
    await navigator.clipboard.writeText(String(value||''));
    status(`${label} copied to clipboard.`,'success');
  }
  function downloadSafeJson(){
    const g=state.generated;
    if(!g||!g.safeAddress||!g.safeInfo?.isSafe||!g.authorized||!g.simulation.ok)throw new Error('Safe JSON export is locked until Safe verification, authorization, and simulation all pass.');
    const json=core.buildSafeTransactionBuilder({
      action:g.action,chainId:state.chainId,safeAddress:g.safeAddress,target:g.target,inputValues:g.safeValues,
      name:`Relic Forge — ${g.action.label}`,
      description:`${state.cfg.network||state.chainId} · ${state.selected?state.selected.name+' · '+state.selected.address:'Platform-level call'}`
    });
    const blob=new Blob([JSON.stringify(json,null,2)+'\n'],{type:'application/json'});
    const a=document.createElement('a');
    const url=URL.createObjectURL(blob);
    a.href=url;
    const subject=state.selected?state.selected.address.slice(2,10):'platform';
    a.download=`relicforge-safe-${state.chainId}-${g.action.id.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-${subject}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('Safe Transaction Builder JSON downloaded. Import it into the matching Safe and verify every field before signing.','success');
  }

  function saveSafeAddress(){
    const raw=String($('founderSafeAddress')?.value||'').trim();
    try{
      if(raw&&window.ethers.isAddress(raw))localStorage.setItem(`relicforge:founder-safe:${state.chainId}`,window.ethers.getAddress(raw));
      else localStorage.removeItem(`relicforge:founder-safe:${state.chainId}`);
    }catch{}
  }
  function restoreSafeAddress(){
    try{
      const saved=localStorage.getItem(`relicforge:founder-safe:${state.chainId}`)||'';
      if($('founderSafeAddress'))$('founderSafeAddress').value=saved;
    }catch{}
  }

  async function onNetworkChange(){
    state.chainId=Number($('founderSafeNetwork')?.value||1);
    state.cfg=null;state.provider=null;state.collections=[];state.selected=null;state.generated=null;
    restoreSafeAddress();
    await loadCollections();
  }

  async function open(){
    if(!core)throw new Error('Safe Admin core module is unavailable.');
    await requireFounder();
    if(!$('founderSafeNetwork')?.options?.length)populateNetworks();
    if(!$('founderSafeAction')?.options?.length)populateActions();
    state.chainId=Number($('founderSafeNetwork')?.value||1);
    restoreSafeAddress();
    await loadCollections();
  }

  function bind(){
    populateNetworks();
    populateActions();
    restoreSafeAddress();

    $('founderSafeNetwork')?.addEventListener('change',()=>onNetworkChange().catch(error=>status(error.message,'error')));
    $('founderSafeRefreshCollectionsBtn')?.addEventListener('click',()=>loadCollections().catch(error=>status(error.message,'error')));
    $('founderSafeManualLoadBtn')?.addEventListener('click',()=>manualLoad().catch(error=>status(error.message,'error')));
    $('founderSafeManualCollection')?.addEventListener('keydown',event=>{if(event.key==='Enter')manualLoad().catch(error=>status(error.message,'error'));});
    $('founderSafeCollection')?.addEventListener('change',()=>selectCollection().catch(error=>status(error.message,'error')));
    $('founderSafeAction')?.addEventListener('change',()=>renderAction().catch(error=>status(error.message,'error')));
    $('founderSafeAddress')?.addEventListener('change',()=>{
      saveSafeAddress();refreshAuthorization().catch(error=>status(error.message,'error'));
      state.generated=null;renderGenerated();
    });
    $('founderSafeAddress')?.addEventListener('input',()=>{state.generated=null;renderGenerated();});
    $('founderSafeGenerateBtn')?.addEventListener('click',()=>generate().catch(error=>status(error.shortMessage||error.message,'error')));

    $('founderSafeCopyTargetBtn')?.addEventListener('click',()=>state.generated&&copyText(state.generated.target,'Target'));
    $('founderSafeCopyAbiBtn')?.addEventListener('click',()=>state.generated&&copyText(state.generated.action.abi,'Function ABI'));
    $('founderSafeCopyCalldataBtn')?.addEventListener('click',()=>state.generated&&copyText(state.generated.data,'Calldata'));
    $('founderSafeCopyJsonBtn')?.addEventListener('click',()=>{
      const text=$('founderSafeJsonPreview')?.textContent||'';
      if(text&&text.startsWith('{'))copyText(text,'Safe JSON').catch(error=>status(error.message,'error'));
    });
    $('founderSafeDownloadJsonBtn')?.addEventListener('click',()=>{try{downloadSafeJson();}catch(error){status(error.message,'error');}});
  }

  async function openPlatform(chainId,actionId){
    if($('founderSafeNetwork'))$('founderSafeNetwork').value=String(chainId);
    state.chainId=Number(chainId);restoreSafeAddress();await loadCollections();
    if(actionId&&core.byId(actionId)){$('founderSafeAction').value=actionId;await renderAction();}
  }
  async function openForCollection(chainId,address,actionId=null){
    await openPlatform(chainId,actionId||'collection.randomnessCeiling');
    if($('founderSafeManualCollection'))$('founderSafeManualCollection').value=address;
    await manualLoad();
    if(actionId&&core.byId(actionId)){$('founderSafeAction').value=actionId;await renderAction();}
  }
  window.RelicForgeSafeAdmin=Object.freeze({open,refresh:loadCollections,openPlatform,openForCollection});
  bind();
})();
