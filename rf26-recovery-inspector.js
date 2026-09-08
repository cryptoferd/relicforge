(function(){
  'use strict';
  const core=window.RF26RecoveryCore;
  if(!core)throw new Error('RF26 recovery core is missing.');
  const $=id=>document.getElementById(id);
  const state={busy:false,journal:null,verified:null,scope:null,provider:null,wallet:null};
  const net=()=>window.RelicForgeForgeNetwork;
  const fail=message=>{throw new Error(message);};
  const display=address=>address?address.slice(0,8)+'…'+address.slice(-6):'—';
  const explorer=(id,address)=>'https://'+(id===1?'etherscan.io':'sepolia.etherscan.io')+'/address/'+encodeURIComponent(address);
  const txExplorer=(id,hash)=>'https://'+(id===1?'etherscan.io':'sepolia.etherscan.io')+'/tx/'+encodeURIComponent(hash);

  function status(message,bad=false){
    const node=$('rf26RecoveryStatus');if(!node)return;
    node.textContent=message;node.style.color=bad?'#d9a1a1':'';
  }
  function node(tag,text,className){
    const el=document.createElement(tag);
    if(text!=null)el.textContent=String(text);
    if(className)el.className=className;
    return el;
  }
  function row(host,label,value,link){
    const item=node('div',null,'forge-row');
    item.append(node('span',label));
    const strong=node('strong',value);
    if(link){const a=node('a');a.href=link;a.target='_blank';a.rel='noopener noreferrer';a.append(strong);item.append(a);}
    else item.append(strong);
    host.append(item);
  }
  function render(){
    const host=$('rf26RecoveryResults');if(!host)return;
    host.replaceChildren();
    if(!state.verified)return;
    const v=state.verified,s=state.scope;
    row(host,'Network',s.chainId===1?'Ethereum Mainnet':'Ethereum Sepolia');
    row(host,'Collection',v.collection,explorer(s.chainId,v.collection));
    row(host,'Creator',v.creator);
    row(host,'Controller',v.controller);
    row(host,'Factory',v.factory,explorer(s.chainId,v.factory));
    row(host,'ProjectData',v.data,explorer(s.chainId,v.data));
    row(host,'MintPhases',v.phases,explorer(s.chainId,v.phases));
    const j=state.journal;
    if(!j){host.append(node('p','No scoped recovery journal is attached to this verified collection.'));return;}
    row(host,'Journal',j.schema);
    row(host,'Status',j.status);
    row(host,'Build fingerprint',j.provenance);
    const steps=node('div',null,'rf26-recovery-steps');
    const entries=Object.entries(j.steps||{});
    steps.append(node('h4','Recorded transactions ('+entries.length+')'));
    if(!entries.length)steps.append(node('p','No transaction checkpoints have been recorded.'));
    for(const [key,step] of entries){
      const item=node('div',null,'rf26-recovery-step');
      item.append(node('strong',step.label||key));
      item.append(node('span',step.status||'unknown'));
      if(step.txHash){
        const a=node('a',display(step.txHash));a.href=txExplorer(s.chainId,step.txHash);
        a.target='_blank';a.rel='noopener noreferrer';item.append(a);
      }
      steps.append(item);
    }
    host.append(steps);
  }
  function assertCurrent(){
    if(!state.scope||net()?.scope()!==state.scope||
       net().selectedChainId()!==state.scope.chainId||
       core.address(net().account())!==state.wallet)
      fail('Network or creator session changed. Inspect the deployment again.');
    return true;
  }
  function currentRecord(){
    const forge=window.RelicForgeForge;
    const j=forge?.getDeploymentJournal?.()||null;
    const saved=forge?.getForgeProjectState?.()||{};
    return {journal:j,saved};
  }
  async function establish(){
    if(!net())fail('The Forge network runtime is unavailable. Reload the page.');
    const id=net().requireSelection();
    // The local release gate runs before any wallet request or RPC operation.
    let scope=await net().requireReady();
    let wallet=net().account();
    if(!wallet){
      const session=await net().connect({requireLaunch:false});
      wallet=session.wallet;
      // Account-only sign-in revokes the old preflight; verify again.
      scope=await net().requireReady();
    }
    if(!wallet)fail('Connect the creator wallet.');
    const provider=window.RelicForgeNetworks.readProvider(scope.chainId);
    await window.RelicForgeNetworks.assertProvider(provider,scope.chainId);
    state.scope=scope;state.wallet=core.address(wallet);state.provider=provider;
    assertCurrent();
    return scope;
  }
  async function inspect(){
    state.verified=null;state.journal=null;state.scope=null;state.provider=null;
    render();
    $('rf26RecoveryAdoptBtn').disabled=true;
    $('rf26RecoveryReconcileBtn').disabled=true;
    const scope=await establish();
    const {journal,saved}=currentRecord();
    const input=String($('rf26RecoveryAddress')?.value||'').trim();
    const address=core.address(input||journal?.collectionAddress||saved.collectionAddress);
    const raw=journal?.collectionAddress&&core.address(journal.collectionAddress)===address?journal:null;
    if(raw){
      const recordedChain=raw.chainId??(raw.schema==='relic-forge/deployment-journal@1'?11155111:null);
      if(core.chain(recordedChain)!==scope.chainId)fail('The saved deployment belongs to a different network.');
      if(core.address(raw.factory)!==core.address(scope.factory))fail('The saved Factory does not match this release.');
    }
    const verified=await net().verifyCollection(address,{chainId:scope.chainId,creator:state.wallet});
    const recovery=window.RF26Recovery;
    let stored=null;
    if(raw?.provenance){
      stored=recovery.read(raw.provenance);
      if(stored&&stored.collectionAddress&&core.address(stored.collectionAddress)!==address)
        fail('The scoped journal is bound to another collection.');
    }
    const data=new window.ethers.Contract(verified.data,[
      'function contentSealed() view returns(bool)','function provenanceHash() view returns(bytes32)',
      'function recipeCount() view returns(uint32)','function validatedRecipeCursor() view returns(uint64)'
    ],state.provider);
    const phases=new window.ethers.Contract(verified.phases,[
      'function phaseCount() view returns(uint32)','function masterMintEnabled() view returns(bool)'
    ],state.provider);
    const [sealed,provenance,recipes,cursor,phaseCount,mintEnabled]=await Promise.all([
      data.contentSealed(),data.provenanceHash(),data.recipeCount(),data.validatedRecipeCursor(),
      phases.phaseCount(),phases.masterMintEnabled()
    ]);
    assertCurrent();
    if(raw?.provenance&&sealed&&raw.provenance.toLowerCase()!==String(provenance).toLowerCase())
      fail('The saved journal provenance does not match the sealed collection.');
    state.verified=verified;state.journal=stored;
    render();
    const host=$('rf26RecoveryResults');
    row(host,'Content sealed',sealed?'Yes':'No');
    row(host,'Onchain provenance',provenance);
    row(host,'Validated recipes',String(cursor)+' / '+String(recipes));
    row(host,'Mint phases',String(phaseCount));
    row(host,'Master mint',mintEnabled?'Enabled':'Disabled');
    $('rf26RecoveryAdoptBtn').disabled=!raw?.provenance||!!state.journal||scope.chainId!==11155111;
    $('rf26RecoveryReconcileBtn').disabled=!state.journal||!Object.values(state.journal.steps||{}).some(s=>s.txHash);
    status('Verified on '+(scope.chainId===1?'Ethereum Mainnet':'Sepolia')+'. No transaction was submitted.');
    return {verified,provenance};
  }
  async function adopt(){
    if(!state.verified||!state.scope||state.scope.chainId!==11155111)fail('Inspect a verified Sepolia collection first.');
    await net().requireReady();assertCurrent();
    const {journal}=currentRecord();
    if(!journal?.provenance||!journal.collectionAddress||
       core.address(journal.collectionAddress)!==state.verified.collection)
      fail('No matching historical journal is loaded.');
    const recovery=window.RF26Recovery,store=recovery.store();
    let saved=store.read(journal.provenance);
    if(!saved){
      const verified=state.verified;
      saved=store.adoptLegacy(journal.provenance,{verifiedCollection:verified});
      if(!saved){
        // A legacy journal may exist only in the current project snapshot.
        // Conversion is explicit and follows the onchain verification above.
        saved=store.save(journal,{allowLegacy:true});
      }
    }
    assertCurrent();
    state.journal=saved;render();
    $('rf26RecoveryAdoptBtn').disabled=true;
    $('rf26RecoveryReconcileBtn').disabled=!Object.values(saved.steps||{}).some(s=>s.txHash);
    status('Historical journal copied into scoped recovery storage. The original record was preserved.');
  }
  async function reconcile(){
    if(!state.journal||!state.verified)fail('Inspect a verified recovery journal first.');
    await net().requireReady();assertCurrent();
    const recovery=window.RF26Recovery;
    let j=state.journal,confirmed=0,pending=0,failed=0;
    const observations={...(j.receiptObservations||{})};
    for(const [key,step] of Object.entries(j.steps||{})){
      if(!step.txHash)continue;
      const result=await recovery.inspect(j,key);
      assertCurrent();
      observations[key]={
        transactionHash:step.txHash,state:result.state,
        blockNumber:result.receipt?.blockNumber??null,
        checkedAt:new Date().toISOString()
      };
      if(result.state==='confirmed')confirmed++;
      else if(result.state==='failed')failed++;
      else pending++;
    }
    // A successful receipt is not proof that the intended artwork, phase,
    // or metadata operation matches the compiled build. Observations are
    // recorded separately; the original checkpoint status is never promoted.
    assertCurrent();
    j=recovery.save({...j,receiptObservations:observations});
    state.journal=j;render();
    status('Receipt inspection complete: '+confirmed+' successful receipts, '+pending+' pending or unavailable, '+failed+' failed. Checkpoint statuses were not changed and no transaction was replayed.');
  }
  async function action(fn){
    if(state.busy)return;state.busy=true;
    for(const id of ['rf26RecoveryInspectBtn','rf26RecoveryAdoptBtn','rf26RecoveryReconcileBtn'])if($(id))$(id).disabled=true;
    try{await fn();}
    catch(error){status(error?.message||String(error),true);}
    finally{
      state.busy=false;
      $('rf26RecoveryInspectBtn').disabled=false;
      if(state.verified&&state.journal)$('rf26RecoveryReconcileBtn').disabled=!Object.values(state.journal.steps||{}).some(s=>s.txHash);
    }
  }
  function install(){
    if($('rf26RecoveryInspector'))return;
    const anchor=$('r24ResumePanel')||$('forgeCompiledSummary')||$('launchedDashboardStatus');
    if(!anchor)return;
    const panel=node('section',null,'r24-resume-panel');
    panel.id='rf26RecoveryInspector';
    const head=node('div',null,'r24-head');
    const title=node('div');title.append(node('span','RECOVERY INSPECTOR'),node('h4','Verify an existing deployment'));
    title.append(node('p','Read onchain bindings and inspect saved transaction receipts. Historical journals can be copied into chain-qualified storage after verification. This tool never creates, mints, seals, or replays transactions.'));
    head.append(title);panel.append(head);
    const field=node('label',null,'field');field.append(node('span','Collection address (optional: uses the loaded project)'));
    const input=node('input');input.id='rf26RecoveryAddress';input.placeholder='0x…';input.type='text';input.autocomplete='off';field.append(input);panel.append(field);
    const actions=node('div',null,'r24-actions');
    const buttons=[
      ['rf26RecoveryInspectBtn','Inspect deployment',()=>inspect()],
      ['rf26RecoveryAdoptBtn','Copy verified legacy journal',()=>adopt()],
      ['rf26RecoveryReconcileBtn','Inspect recorded receipts',()=>reconcile()]
    ];
    buttons.forEach(([id,label,fn])=>{const b=node('button',label,id==='rf26RecoveryInspectBtn'?'primary-btn':'ghost-btn');b.id=id;b.type='button';b.disabled=id!=='rf26RecoveryInspectBtn';b.addEventListener('click',()=>action(fn));actions.append(b);});
    panel.append(actions);
    const message=node('div','Choose a launch network, then inspect an existing collection.','r24-status');
    message.id='rf26RecoveryStatus';message.setAttribute('role','status');message.setAttribute('aria-live','polite');panel.append(message);
    const results=node('div');results.id='rf26RecoveryResults';panel.append(results);
    anchor.insertAdjacentElement('afterend',panel);
    for(const event of ['relicforge:launch-network-changed','relicforge:forge-session-invalidated']){
      window.addEventListener(event,()=>{
        state.verified=null;state.journal=null;state.scope=null;state.provider=null;state.wallet=null;
        render();
        $('rf26RecoveryAdoptBtn').disabled=true;
        $('rf26RecoveryReconcileBtn').disabled=true;
        status('Network or wallet session changed. Inspect the deployment again.');
      });
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})();
