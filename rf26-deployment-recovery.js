(function(){
  'use strict';
  const core=window.RF26RecoveryCore;
  if(!core)throw new Error('RF26 recovery core is missing.');
  const fail=(message,code='RF26_RECOVERY_MISMATCH')=>Object.assign(new Error(message),{code});
  const METAMASK_DELEGATION_MANAGER='0xdb9b1e94b5b69df7e401ddbede43491141047db3';
  const DEFAULT_SINGLE_MODE='0x'+'0'.repeat(64);
  const DELEGATION_MANAGER_ABI=[
    'function redeemDelegations(bytes[] _permissionContexts,bytes32[] _modes,bytes[] _executionCallDatas)'
  ];
  let delegationManagerInterface=null;
  function delegationInterface(){
    if(!window.ethers?.Interface)throw fail('ethers.js delegation decoder is unavailable.','RF26_INTENT_MISMATCH');
    return delegationManagerInterface||(delegationManagerInterface=new window.ethers.Interface(DELEGATION_MANAGER_ABI));
  }
  function decodeSingleExecution(raw){
    const hex=String(raw||'').toLowerCase();
    if(!/^0x(?:[0-9a-f]{2})*$/i.test(hex)||hex.length<106)return null;
    const target='0x'+hex.slice(2,42),valueHex='0x'+hex.slice(42,106),data='0x'+hex.slice(106);
    try{return {to:core.address(target),value:BigInt(valueHex),data};}catch{return null;}
  }
  function resolveDelegatedIntent(transaction,expected){
    try{
      if(!transaction?.to||core.address(transaction.to)!==METAMASK_DELEGATION_MANAGER)return null;
      const parsed=delegationInterface().parseTransaction({data:String(transaction.data||'0x'),value:transaction.value??0});
      if(!parsed||parsed.name!=='redeemDelegations')return null;
      const contexts=Array.from(parsed.args?.[0]||[]),modes=Array.from(parsed.args?.[1]||[]),calls=Array.from(parsed.args?.[2]||[]);
      // Fail closed: one delegated action only, using the observed/default single-call mode.
      if(contexts.length!==1||modes.length!==1||calls.length!==1)return null;
      if(String(modes[0]||'').toLowerCase()!==DEFAULT_SINGLE_MODE)return null;
      const inner=decodeSingleExecution(calls[0]);
      if(!inner)return null;
      const data=String(inner.data||'0x').toLowerCase(),dataLength=(data.length-2)/2;
      if(core.address(inner.to)!==core.address(expected.to)||
         String(inner.value)!==String(BigInt(expected.value))||
         dataLength!==Number(expected.dataLength)||
         window.ethers.keccak256(data).toLowerCase()!==String(expected.dataHash).toLowerCase())return null;
      return Object.freeze({to:core.address(inner.to),value:inner.value,data});
    }catch{return null;}
  }
  function providerForIntent(provider,expected){
    if(!provider||!expected)return provider;
    return new Proxy(provider,{
      get(target,key){
        if(key==='getTransaction')return async hash=>{
          const tx=await target.getTransaction(hash);
          if(!tx)return tx;
          const inner=resolveDelegatedIntent(tx,expected);
          if(!inner)return tx;
          // Keep the OUTER sender/chain/nonce, while exposing only the cryptographically
          // exact single inner call for the existing durable-intent checks.
          return {
            hash:tx.hash,from:tx.from,to:inner.to,chainId:tx.chainId,nonce:tx.nonce,
            data:inner.data,value:inner.value,blockNumber:tx.blockNumber,
            rf26DelegatedVia:METAMASK_DELEGATION_MANAGER
          };
        };
        const value=Reflect.get(target,key,target);
        return typeof value==='function'?value.bind(target):value;
      }
    });
  }
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
  async function preparePlan(plan,journal,allowFactory=false){
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
    const to=allowFactory?core.address(request.to||plan.contract.target):allowedTarget(journal,request.to||plan.contract.target);
    if(allowFactory&&(plan.method!=='createCollectionV2'||to!==journal.factory))
      throw fail('Only the verified Factory createCollectionV2 method is permitted.','RF26_INTENT_MISMATCH');
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
  async function executeLocked({journal,stepKey,label,contract,method,args=[],verify=null,allowFactory=false}){
    let normalized=assertJournal(journal);
    const active=store().read(normalized.provenance);
    if(active)normalized=core.merge(active,normalized);
    const prior=normalized.steps?.[stepKey];
    let prepared=null;
    const retryRejected=prior?.status==='failed'&&prior?.intent&&!prior?.txHash&&prior?.rejectionConfirmedAt;
    if((!prior?.intent&&!prior?.txHash)||retryRejected)
      prepared=await preparePlan({contract,method,args},normalized,allowFactory);
    if(prior?.intent&&prepared?.intent&&!core.sameIntent(prior.intent,prepared.intent))
      throw fail('The rebuilt transaction no longer matches the saved durable intent.','RF26_INTENT_MISMATCH');
    const intentValue=prior?.intent||prepared?.intent||null;
    const {provider}=await readScope();
    const verificationProvider=providerForIntent(provider,intentValue);
    return core.executeIntentStep({
      store:store(),journal:normalized,stepKey,label,intentValue,provider:verificationProvider,
      hashData:data=>window.ethers.keccak256(data),
      assertWrite:async expected=>{
        const scope=await network().assertWrite(),wallet=network().account();
        if(scope.chainId!==normalized.chainId||
           core.address(scope.factory)!==normalized.factory||
           core.address(wallet)!==normalized.wallet)
          throw fail('Recovery release or creator changed before transaction submission.');
        if(allowFactory){
          if(stepKey!=='factoryCreate'||method!=='createCollectionV2'||core.address(expected.to)!==normalized.factory)
            throw fail('Factory creation target or method mismatch.','RF26_INTENT_MISMATCH');
        }else allowedTarget(normalized,expected.to);
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
  }
  function exclusiveRecoveryLock(journal,callback){
    if(typeof navigator==='undefined'||!navigator.locks?.request)
      throw fail('This browser does not support the exclusive recovery lock. Use a current Chromium browser.','RF26_RECOVERY_LOCK_UNAVAILABLE');
    return navigator.locks.request(core.key(journal),{mode:'exclusive'},callback);
  }
  async function executeIntent({journal,stepKey,label,contract,method,args=[],verify=null}={}){
    const normalized=assertJournal(journal);
    return exclusiveRecoveryLock(normalized,async()=>{
      const release=network().enter();
      try{return await executeLocked({journal:normalized,stepKey,label,contract,method,args,verify});}
      finally{release();}
    });
  }
  async function executeFactory({provenance,launchSpecHash,legacyJournal=null,contract,args,verify}={}){
    const {scope,wallet}=context();
    if(![1,11155111].includes(Number(scope.chainId)))throw fail('The selected network is not approved for Factory execution.','RF26_NETWORK_LOCKED');
    if(typeof verify!=='function')throw fail('A Factory receipt and onchain postcondition verifier is required.','RF26_INTENT_MISMATCH');
    const fingerprint=core.hash(provenance),spec=core.hash(launchSpecHash);
    const identity=core.identity(scope,wallet,fingerprint);
    return exclusiveRecoveryLock(identity,async()=>{
      const release=network().enter();
      try{
        const s=store();
        let journal=s.read(fingerprint);
        if(!journal){
          if(legacyJournal)throw fail('A historical deployment journal already exists for this build. Inspect or resume it before creating another collection.','RF26_EXISTING_DEPLOYMENT');
          journal=s.begin(fingerprint,scope.factory);
        }
        if(journal.status==='complete')throw fail('This launch is already complete. Open the existing collection instead of creating another.','RF26_EXISTING_DEPLOYMENT');
        if(journal.steps?.factoryCreate?.intent&&core.address(journal.steps.factoryCreate.intent.to)!==journal.factory)
          throw fail('Saved Factory transaction intent targets a different contract.','RF26_INTENT_MISMATCH');
        if(journal.launchSpecHash&&journal.launchSpecHash!==spec)
          throw fail('The launch parameters differ from the saved Factory attempt. Restore the original build and launch settings.','RF26_INTENT_MISMATCH');
        if(journal.collectionAddress&&!journal.steps?.factoryCreate?.txHash)
          throw fail('A collection is already bound to this build. Use Resume Deployment.','RF26_EXISTING_DEPLOYMENT');
        journal=s.save({...journal,launchSpecHash:spec});
        let verified=null;
        const result=await executeLocked({
          journal,stepKey:'factoryCreate',label:'Create R12-v2 Collection + ProjectData + MintPhases',
          contract,method:'createCollectionV2',args,allowFactory:true,
          verify:async receiptResult=>{
            const bindings=await verify(receiptResult);
            if(!bindings)throw fail('Factory postcondition did not return verified collection bindings.');
            const normalizedBindings={
              collectionAddress:core.address(bindings.collection),
              dataAddress:core.address(bindings.data),
              mintPhasesAddress:core.address(bindings.phases)
            };
            const current=s.read(fingerprint);
            if(!current||current.launchSpecHash!==spec)throw fail('Factory journal changed during verification.');
            const next=s.save({...current,...normalizedBindings,status:'partial'});
            if(next.collectionAddress!==normalizedBindings.collectionAddress)throw fail('Factory collection binding changed.');
            verified=bindings;
          }
        });
        return {...result,journal:s.read(fingerprint),verified};
      }finally{release();}
    });
  }
  function publicationTarget(detail,verified){
    return core.publicationTarget(detail,context().scope,verified);
  }
  window.RF26Recovery=Object.freeze({
    core,context,store,read,save,begin,adoptLegacy,assertJournal,
    readScope,verifyCollection,inspect,ensureJournal,executeIntent,executeFactory,publicationTarget,
    resolveDelegatedIntent,providerForIntent,METAMASK_DELEGATION_MANAGER
  });
})();
