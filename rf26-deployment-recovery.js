(function(){
  'use strict';
  const core=window.RF26RecoveryCore;
  if(!core)throw new Error('RF26 recovery core is missing.');
  const fail=(message,code='RF26_RECOVERY_MISMATCH')=>Object.assign(new Error(message),{code});
  const network=()=>{
    if(!window.RelicForgeForgeNetwork)throw fail('Verified Forge network runtime is unavailable.');
    return window.RelicForgeForgeNetwork;
  };
  function context(){
    const scope=network().scope(),wallet=network().account();
    if(!scope||!wallet)throw fail('Verify the launch network and connect the creator wallet before using a deployment journal.');
    return {scope,wallet};
  }
  function store(){
    const {scope,wallet}=context();
    return core.createStore({storage:localStorage,legacyStorage:localStorage,scope,wallet});
  }
  function read(provenance){return store().read(provenance);}
  function save(journal,options){return store().save(journal,options);}
  function begin(provenance,factory){return store().begin(provenance,factory);}
  function adoptLegacy(provenance,verifiedCollection,projectId){
    return store().adoptLegacy(provenance,{verifiedCollection,expectedProjectId:projectId});
  }
  function assertJournal(journal){
    const {scope,wallet}=context();
    return core.normalize(journal,scope,wallet);
  }
  async function readScope(){
    const scope=await network().requireReady();
    const provider=window.RelicForgeNetworks.readProvider(scope.chainId);
    await window.RelicForgeNetworks.assertProvider(provider,scope.chainId);
    return {scope,provider};
  }
  async function verifyCollection(address,expected={}){
    const scope=await network().requireReady();
    if(expected.chainId!=null&&core.chain(expected.chainId)!==scope.chainId)throw fail('Collection network mismatch.');
    return network().verifyCollection(address,{...expected,chainId:scope.chainId});
  }
  async function inspect(journal,stepKey,expectedTo=null){
    const normalized=assertJournal(journal);
    const {provider}=await readScope();
    return core.inspectTransaction({provider,journal:normalized,stepKey,expectedWallet:normalized.wallet,expectedTo});
  }
  function assertVerifiedBindings(journal,verified){
    const normalized=assertJournal(journal);
    if(core.chain(verified.chainId)!==normalized.chainId||
       core.address(verified.factory)!==normalized.factory||
       core.address(verified.creator)!==normalized.wallet||
       core.address(verified.collection)!==normalized.collectionAddress||
       core.address(verified.data)!==normalized.dataAddress||
       core.address(verified.phases)!==normalized.mintPhasesAddress)
      throw fail('Scoped recovery journal does not match the verified onchain collection.');
    return normalized;
  }
  async function ensureJournal({provenance,verifiedCollection,legacyJournal=null,projectId=null}={}){
    const verified=verifiedCollection;
    if(!verified)throw fail('A verified onchain collection is required before recovery journal adoption.');
    const {scope,wallet}=context();
    const fingerprint=core.hash(provenance);
    if(core.chain(verified.chainId)!==scope.chainId||
       core.address(verified.factory)!==core.address(scope.factory)||
       core.address(verified.creator)!==core.address(wallet))
      throw fail('Verified collection does not match the active recovery scope.');
    const s=store();
    let journal=s.read(fingerprint);
    if(!journal){
      journal=s.adoptLegacy(fingerprint,{verifiedCollection:verified,expectedProjectId:projectId});
    }
    if(!journal&&legacyJournal){
      const candidate={
        ...legacyJournal,
        schema:legacyJournal.schema||'relic-forge/deployment-journal@1',
        chainId:scope.chainId,
        factory:scope.factory,
        provenance:fingerprint,
        collectionAddress:verified.collection,
        dataAddress:verified.data,
        mintPhasesAddress:verified.phases,
        status:legacyJournal.status||'partial'
      };
      if(projectId!=null&&candidate.projectId==null)candidate.projectId=String(projectId);
      journal=s.save(candidate,{allowLegacy:true});
    }
    if(!journal){
      journal=s.begin(fingerprint,scope.factory);
      journal=s.save({
        ...journal,status:'partial',
        collectionAddress:verified.collection,
        dataAddress:verified.data,
        mintPhasesAddress:verified.phases,
        ...(projectId!=null?{projectId:String(projectId)}:{})
      });
    }
    return assertVerifiedBindings(journal,verified);
  }
  function allowedTarget(journal,to){
    const target=core.address(to);
    const allowed=[journal.collectionAddress,journal.dataAddress,journal.mintPhasesAddress]
      .filter(Boolean).map(core.address);
    if(!allowed.includes(target))
      throw fail('Recovery transaction destination is outside the verified collection bindings.','RF26_INTENT_MISMATCH');
    return target;
  }
  async function preparePlan(plan,journal){
    if(!plan||!plan.contract||typeof plan.method!=='string'||!Array.isArray(plan.args))
      throw fail('A typed recovery transaction plan is required.','RF26_INTENT_MISMATCH');
    const method=plan.contract?.[plan.method];
    if(!method||typeof method.populateTransaction!=='function')
      throw fail('Recovery transaction method cannot be populated.','RF26_INTENT_MISMATCH');
    const {scope,provider}=await readScope();
    const {wallet}=context();
    if(scope.chainId!==journal.chainId||core.address(scope.factory)!==journal.factory||core.address(wallet)!==journal.wallet)
      throw fail('Recovery scope changed before transaction preparation.');
    await network().assertWrite();
    const request=await method.populateTransaction(...plan.args);
    const to=allowedTarget(journal,request.to||plan.contract.target);
    const data=String(request.data||'0x').toLowerCase();
    if(!/^0x(?:[0-9a-f]{2})*$/i.test(data))throw fail('Invalid populated transaction calldata.','RF26_INTENT_MISMATCH');
    const signer=network().writeSigner();
    const nonce=typeof signer.getNonce==='function'?await signer.getNonce('pending'):await provider.getTransactionCount(wallet,'pending');
    const value=BigInt(request.value??0);
    const intent=core.intent({
      chainId:scope.chainId,wallet,to,
      dataHash:window.ethers.keccak256(data),
      dataLength:(data.length-2)/2,
      value:String(value),nonce
    });
    return {
      intent,
      request:{to,data,value,nonce,chainId:scope.chainId}
    };
  }
  async function executeIntent({journal,stepKey,label,contract,method,args=[],verify=null}={}){
    let normalized=assertJournal(journal);
    if(typeof navigator==='undefined'||!navigator.locks?.request)
      throw fail('This browser does not support the exclusive recovery lock. Use a current Chromium browser.','RF26_RECOVERY_LOCK_UNAVAILABLE');
    const lockName=core.key(normalized);
    return navigator.locks.request(lockName,{mode:'exclusive'},async()=>{
      const release=network().enter();
      try{
        const active=store().read(normalized.provenance);
        if(active)normalized=core.merge(active,normalized);
        const prior=normalized.steps?.[stepKey];
        let prepared=null;
        const retryRejected=prior?.status==='failed'&&prior?.intent&&!prior?.txHash&&prior?.rejectionConfirmedAt;
        if((!prior?.intent&&!prior?.txHash)||retryRejected)
          prepared=await preparePlan({contract,method,args},normalized);
        if(prior?.intent&&prepared?.intent&&!core.sameIntent(prior.intent,prepared.intent))
          throw fail('The rebuilt transaction no longer matches the rejected durable intent. Review the deployment before retrying.','RF26_INTENT_MISMATCH');
        const intentValue=prior?.intent||prepared?.intent||null;
        const {provider}=await readScope();
        const result=await core.executeIntentStep({
          store:store(),journal:normalized,stepKey,label,intentValue,provider,
          hashData:data=>window.ethers.keccak256(data),
          assertWrite:async expected=>{
            const scope=await network().assertWrite();
            const wallet=network().account();
            if(scope.chainId!==normalized.chainId||
               core.address(scope.factory)!==normalized.factory||
               core.address(wallet)!==normalized.wallet)
              throw fail('Recovery release or creator changed before transaction submission.');
            allowedTarget(normalized,expected.to);
          },
          submitIntent:async expected=>{
            if(!prepared||!core.sameIntent(expected,prepared.intent))
              throw fail('Prepared transaction bytes are unavailable or changed. It will not be submitted.','RF26_INTENT_MISMATCH');
            const scope=await network().assertWrite();
            if(scope.chainId!==expected.chainId)throw fail('Recovery network changed before transaction submission.');
            return network().writeSigner().sendTransaction(prepared.request);
          },
          verifyReceipt:typeof verify==='function'?async receiptResult=>{
            await network().requireReady();
            if(core.address(network().account())!==normalized.wallet)
              throw fail('Creator wallet changed before postcondition verification.');
            await verify(receiptResult);
          }:null
        });
        return result;
      }finally{release();}
    });
  }
  function publicationTarget(detail,verified){
    return core.publicationTarget(detail,context().scope,verified);
  }
  window.RF26Recovery=Object.freeze({
    core,context,store,read,save,begin,adoptLegacy,assertJournal,
    readScope,verifyCollection,inspect,ensureJournal,executeIntent,publicationTarget
  });
})();
