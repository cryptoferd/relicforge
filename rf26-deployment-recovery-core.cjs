(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RF26RecoveryCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const SCHEMA='relic-forge/deployment-journal@2';
  const ADDRESS=/^0x[0-9a-f]{40}$/i;
  const HASH=/^0x[0-9a-f]{64}$/i;
  const STATES=new Set(['creating','partial','base-complete','onchain-complete','proof-sync-pending','complete']);
  const TX_STATES=new Set(['prepared','submitted','confirmed','failed']);
  const BINDINGS=['collectionAddress','dataAddress','mintPhasesAddress'];
  const fail=(message,code='RF26_RECOVERY_MISMATCH')=>Object.assign(new Error(message),{code});
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  function chain(value){
    const n=typeof value==='string'&&/^0x[0-9a-f]+$/i.test(value)?Number(BigInt(value)):Number(value);
    if(!Number.isSafeInteger(n)||![1,11155111].includes(n))throw fail('Unsupported recovery network.');
    return n;
  }
  function address(value){
    const s=String(value||'').toLowerCase();
    if(!ADDRESS.test(s)||/^0x0{40}$/.test(s))throw fail('Invalid recovery address.');
    return s;
  }
  function hash(value){
    const s=String(value||'').toLowerCase();
    if(!HASH.test(s)||/^0x0{64}$/.test(s))throw fail('Invalid recovery hash.');
    return s;
  }
  function optionalAddress(v){return v==null||v===''?null:address(v);}
  function optionalHash(v){return v==null||v===''?null:hash(v);}
  function same(a,b){return address(a)===address(b);}
  function intent(value){
    if(!object(value))throw fail('A durable transaction intent is required.','RF26_INTENT_MISMATCH');
    const dataLength=Number(value.dataLength),nonce=Number(value.nonce);
    if(!Number.isSafeInteger(dataLength)||dataLength<0||dataLength>16777216)
      throw fail('Invalid transaction calldata length.','RF26_INTENT_MISMATCH');
    if(!Number.isSafeInteger(nonce)||nonce<0)
      throw fail('Invalid transaction nonce.','RF26_INTENT_MISMATCH');
    let amount;
    try{amount=BigInt(value.value??0);}catch{throw fail('Invalid transaction value.','RF26_INTENT_MISMATCH');}
    if(amount<0n)throw fail('Invalid transaction value.','RF26_INTENT_MISMATCH');
    return Object.freeze({
      chainId:chain(value.chainId),wallet:address(value.wallet),to:address(value.to),
      dataHash:hash(value.dataHash),dataLength,value:String(amount),nonce
    });
  }
  function sameIntent(a,b){
    const x=intent(a),y=intent(b);
    return x.chainId===y.chainId&&x.wallet===y.wallet&&x.to===y.to&&
      x.dataHash===y.dataHash&&x.dataLength===y.dataLength&&x.value===y.value&&x.nonce===y.nonce;
  }
  function identity(scope,wallet,provenance){
    if(!scope||!object(scope))throw fail('A verified release scope is required.');
    const chainId=chain(scope.chainId),factory=address(scope.factory),owner=address(wallet);
    const releaseId=String(scope.releaseId||'').trim()||null;
    const manifestHash=scope.manifestHash?hash('0x'+String(scope.manifestHash).replace(/^0x/i,'')):null;
    if(chainId===1&&(!releaseId||!manifestHash))throw fail('Production recovery requires the exact certified release identity.');
    const result={chainId,factory,wallet:owner,provenance:hash(provenance),releaseId,manifestHash};
    return Object.freeze(result);
  }
  function key(identityValue){
    const i=identity(identityValue,identityValue.wallet,identityValue.provenance);
    return ['rf26-journal-v2',i.chainId,i.wallet,i.factory,i.releaseId||'-',i.manifestHash||'-',i.provenance].join(':');
  }
  function normalize(record,scope,wallet,{allowLegacy=false}={}){
    if(!object(record))throw fail('Deployment journal must be an object.');
    const i=identity(scope,wallet,record.provenance);
    const legacy=record.schema==='relic-forge/deployment-journal@1';
    if(record.schema!==SCHEMA&&!(legacy&&allowLegacy))
      throw fail('Unsupported deployment journal schema.');
    if(chain(record.chainId)!==i.chainId||!same(record.factory,i.factory))
      throw fail('Journal network or Factory does not match the verified release.');
    if(legacy){
      if(i.chainId!==11155111||record.wallet&& !same(record.wallet,i.wallet))
        throw fail('Legacy journal adoption is restricted to its verified Sepolia creator.');
    }else{
      if(!same(record.wallet,i.wallet)||String(record.releaseId||'').trim()!==(i.releaseId||'')||
         optionalHash(record.manifestHash)!==i.manifestHash)
        throw fail('Journal creator or release identity mismatch.');
    }
    const out={...clone(record),...i,schema:SCHEMA,steps:{}};
    for(const field of BINDINGS)out[field]=optionalAddress(record[field]);
    for(const field of ['publicPhaseId','whitelistPhaseId']){
      const n=record[field]==null?null:Number(record[field]);
      if(n!==null&&(!Number.isSafeInteger(n)||n<1||n>4294967295))throw fail('Invalid deployment phase binding.');
      out[field]=n;
    }
    if(record.status!=null&&!STATES.has(record.status))throw fail('Invalid deployment status.');
    out.status=record.status||'creating';
    if(record.projectId!=null)out.projectId=String(record.projectId);
    const steps=object(record.steps)?record.steps:{};
    for(const [name,step] of Object.entries(steps)){
      if(!name||name.length>200||/[\x00-\x1f\x7f]/.test(name)||['__proto__','constructor','prototype'].includes(name)||!object(step))
        throw fail('Invalid deployment checkpoint.');
      const status=step.status||'prepared';
      if(!TX_STATES.has(status))throw fail('Invalid transaction checkpoint status.');
      out.steps[name]={...clone(step),status};
      if(step.txHash!=null)out.steps[name].txHash=hash(step.txHash);
      if(step.intent!=null)out.steps[name].intent=intent(step.intent);
      if(status==='confirmed'&&!out.steps[name].txHash)
        throw fail('A confirmed transaction checkpoint requires a transaction hash.');
    }
    return out;
  }
  function assertSame(previous,next){
    const fields=['chainId','factory','wallet','provenance','releaseId','manifestHash','projectId',...BINDINGS,
      'publicPhaseId','whitelistPhaseId'];
    for(const field of fields){
      if(previous[field]!=null&&next[field]!=null&&
         String(previous[field]).toLowerCase()!==String(next[field]).toLowerCase())
        throw fail('Immutable deployment binding changed: '+field+'.');
    }
    return true;
  }
  function merge(previous,next){
    assertSame(previous,next);
    const out={...previous,...next,steps:{...previous.steps},startedAt:previous.startedAt||next.startedAt};
    // Partial updates never clear a previously established immutable binding.
    for(const field of ['chainId','factory','wallet','provenance','releaseId','manifestHash','projectId',
      ...BINDINGS,'publicPhaseId','whitelistPhaseId'])
      if(previous[field]!=null&&next[field]==null)out[field]=previous[field];
    for(const [name,step] of Object.entries(next.steps||{})){
      const prior=previous.steps?.[name];
      if(prior?.txHash&&step.txHash&&prior.txHash!==step.txHash)
        throw fail('A checkpoint already has a different transaction hash: '+name+'.','RF26_PENDING_TRANSACTION');
      if(prior?.intent&&step.intent&&!sameIntent(prior.intent,step.intent))
        throw fail('A checkpoint already has a different durable transaction intent: '+name+'.','RF26_INTENT_MISMATCH');
      if(prior?.status==='confirmed'&&step.status!=='confirmed')
        throw fail('A confirmed checkpoint cannot be downgraded.');
      if(prior?.status==='submitted'&&step.status==='prepared')
        throw fail('A submitted transaction cannot be returned to prepared.');
      out.steps[name]={...prior,...step};
    }
    if(previous.status==='complete'&&next.status!=='complete')
      throw fail('A completed deployment cannot be downgraded.');
    return out;
  }
  function createStore({storage,scope,wallet,legacyStorage=null,now=()=>new Date().toISOString()}){
    if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')
      throw fail('Recovery storage is unavailable.');
    const i=identity(scope,wallet,'0x'+'1'.repeat(64));
    const scoped=provenance=>identity(scope,wallet,provenance);
    function read(provenance){
      const id=scoped(provenance),raw=storage.getItem(key(id));
      if(!raw)return null;
      let value;try{value=JSON.parse(raw);}catch{throw fail('Stored deployment journal is corrupt.');}
      return normalize(value,scope,wallet);
    }
    function save(record,{allowLegacy=false}={}){
      const incoming=normalize(record,scope,wallet,{allowLegacy});
      const prior=read(incoming.provenance);
      const out=prior?merge(prior,incoming):incoming;
      out.updatedAt=now();out.startedAt=prior?.startedAt||incoming.startedAt||out.updatedAt;
      storage.setItem(key(out),JSON.stringify(out));
      return clone(out);
    }
    function begin(provenance,factory){
      if(!same(factory,i.factory))throw fail('Collection Factory does not match the selected release.');
      const prior=read(provenance);
      if(prior)throw fail('A deployment journal already exists for this creator, release and build. Inspect or resume it before creating another.','RF26_EXISTING_DEPLOYMENT');
      return save({...scoped(provenance),schema:SCHEMA,status:'creating',steps:{},collectionAddress:null,
        dataAddress:null,mintPhasesAddress:null,publicPhaseId:null,whitelistPhaseId:null});
    }
    function adoptLegacy(provenance,{verifiedCollection,expectedProjectId}={}){
      if(i.chainId!==11155111)throw fail('Legacy journals cannot be adopted into production.');
      const existing=read(provenance);if(existing)return existing;
      if(!legacyStorage)throw fail('Legacy journal storage is unavailable.');
      const raw=legacyStorage.getItem('relicforge_v2_deployment_journals_v1');
      let map;try{map=JSON.parse(raw||'{}');}catch{throw fail('Legacy journal storage is corrupt.');}
      const legacy=map?.[hash(provenance)];
      if(!legacy)return null;
      const checked=normalize(legacy,scope,wallet,{allowLegacy:true});
      if(checked.collectionAddress){
        if(!verifiedCollection||!same(verifiedCollection.collection||verifiedCollection.collectionAddress,checked.collectionAddress)||
           chain(verifiedCollection.chainId)!==i.chainId||!same(verifiedCollection.factory,i.factory)||
           !same(verifiedCollection.creator,i.wallet))
          throw fail('Verify the legacy collection onchain before adopting its journal.');
      }
      if(expectedProjectId!=null&&checked.projectId!=null&&String(checked.projectId)!==String(expectedProjectId))
        throw fail('Legacy journal project mismatch.');
      // The original provenance-keyed map is intentionally never modified.
      return save(checked,{allowLegacy:true});
    }
    return Object.freeze({read,save,begin,adoptLegacy,identity:scoped});
  }
  function checkpoint(journal,keyName,step){
    if(!object(journal)||!object(step)||!TX_STATES.has(step.status))throw fail('Invalid checkpoint.');
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(keyName)||['__proto__','constructor','prototype'].includes(keyName))
      throw fail('Invalid checkpoint key.');
    const previous=journal.steps?.[keyName];
    if(previous?.txHash&&step.txHash&&hash(previous.txHash)!==hash(step.txHash))
      throw fail('A different transaction is already recorded for this step.','RF26_PENDING_TRANSACTION');
    if(previous?.intent&&step.intent&&!sameIntent(previous.intent,step.intent))
      throw fail('A different transaction intent is already recorded for this step.','RF26_INTENT_MISMATCH');
    if(previous?.status==='confirmed'&&step.status!=='confirmed')throw fail('Confirmed checkpoint cannot be downgraded.');
    if(previous?.status==='submitted'&&step.status==='prepared')throw fail('Submitted checkpoint cannot be reset.');
    return {...clone(journal),steps:{...clone(journal.steps||{}),[keyName]:{...previous,...clone(step),txHash:step.txHash?hash(step.txHash):previous?.txHash||null}}};
  }
  async function inspectTransaction({provider,journal,stepKey,expectedWallet,expectedTo=null}){
    const step=journal?.steps?.[stepKey];
    if(!step?.txHash)throw fail('No transaction hash is recorded for this step.');
    const network=await provider.getNetwork();
    if(chain(network.chainId)!==chain(journal.chainId))throw fail('Recovery RPC network mismatch.');
    const tx=await provider.getTransaction(step.txHash);
    const receipt=await provider.getTransactionReceipt(step.txHash);
    if(!tx&&!receipt)return {state:'submitted',transactionHash:step.txHash,receipt:null};
    if(tx){
      if(!same(tx.from,expectedWallet||journal.wallet))throw fail('Transaction sender does not match the creator.');
      if(tx.chainId!=null&&chain(tx.chainId)!==chain(journal.chainId))throw fail('Transaction chain mismatch.');
      if(expectedTo&&(!tx.to||!same(tx.to,expectedTo)))throw fail('Transaction destination mismatch.');
    }
    if(!receipt)return {state:'submitted',transactionHash:step.txHash,receipt:null};
    if(receipt.hash&&receipt.hash.toLowerCase()!==step.txHash.toLowerCase())throw fail('Transaction receipt hash mismatch.');
    if(Number(receipt.status)!==1)return {state:'failed',transactionHash:step.txHash,receipt};
    if(!tx)throw fail('Confirmed transaction details are unavailable; cannot verify creator or destination.');
    return {state:'confirmed',transactionHash:step.txHash,receipt};
  }
  async function executeStep({store,journal,stepKey,label,assertWrite,submit,provider,expectedWallet,expectedTo=null}){
    if(typeof assertWrite!=='function'||typeof submit!=='function')throw fail('Guarded transaction callbacks are required.');
    // Re-read durable state immediately before deciding whether to submit.
    // A previous session may have recorded a hash after this object was loaded.
    const durable=store.read(journal.provenance);
    if(durable)journal=merge(durable,journal);
    const prior=journal.steps?.[stepKey];
    if(prior?.txHash){
      const result=await inspectTransaction({provider,journal,stepKey,expectedWallet,expectedTo});
      if(result.state==='submitted')throw Object.assign(fail('A transaction is pending or its receipt is unavailable. Inspect it before retrying.','RF26_PENDING_TRANSACTION'),{transactionHash:result.transactionHash});
      if(result.state==='failed')throw Object.assign(fail('The recorded transaction failed. A new explicit recovery decision is required.','RF26_TRANSACTION_FAILED'),{transactionHash:result.transactionHash});
      return {journal:store.save(checkpoint(journal,stepKey,{status:'confirmed',txHash:result.transactionHash,confirmedAt:new Date().toISOString()})),receipt:result.receipt,alreadyConfirmed:true};
    }
    await assertWrite();
    journal=store.save(checkpoint(journal,stepKey,{status:'prepared',label}));
    let sent;
    try{sent=await submit();}catch(error){throw error;}
    if(!sent?.hash)throw fail('Wallet did not return a transaction hash.');
    const txHash=hash(sent.hash);
    try{journal=store.save(checkpoint(journal,stepKey,{status:'submitted',label,txHash,submittedAt:new Date().toISOString()}));}
    catch(error){throw Object.assign(fail('Transaction submitted, but its checkpoint could not be saved. Preserve the hash and recover before retrying.','RF26_CHECKPOINT_FAILED'),{transactionHash:txHash,cause:error});}
    // Wait for the submitted transaction; a timeout or provider failure leaves
    // the durable submitted checkpoint intact and must never trigger replay.
    try{await sent.wait();}catch(error){
      if(error?.code!=='CALL_EXCEPTION'&&error?.code!=='TRANSACTION_REPLACED')
        throw Object.assign(fail('Transaction confirmation is unavailable. Inspect the saved hash before retrying.','RF26_PENDING_TRANSACTION'),{transactionHash:txHash,cause:error});
    }
    const result=await inspectTransaction({provider,journal,stepKey,expectedWallet,expectedTo});
    if(result.state!=='confirmed')throw Object.assign(fail('Transaction is not confirmed. Inspect its recorded hash before retrying.','RF26_PENDING_TRANSACTION'),{transactionHash:txHash});
    journal=store.save(checkpoint(journal,stepKey,{status:'confirmed',label,txHash,confirmedAt:new Date().toISOString()}));
    return {journal,receipt:result.receipt,alreadyConfirmed:false};
  }
  async function inspectIntentTransaction({provider,journal,stepKey,hashData}){
    const step=journal?.steps?.[stepKey];
    if(!step?.txHash)throw fail('No transaction hash is recorded for this step.');
    if(!step.intent)throw Object.assign(
      fail('This historical transaction has no durable intent record. Its onchain state must be reconciled instead of replayed.','RF26_LEGACY_TRANSACTION_UNVERIFIED'),
      {transactionHash:step.txHash});
    if(typeof hashData!=='function')throw fail('Transaction data hashing is unavailable.','RF26_INTENT_MISMATCH');
    const expected=intent(step.intent);
    const network=await provider.getNetwork();
    if(chain(network.chainId)!==expected.chainId||chain(journal.chainId)!==expected.chainId)
      throw fail('Recovery RPC network mismatch.');
    const tx=await provider.getTransaction(step.txHash);
    const receipt=await provider.getTransactionReceipt(step.txHash);
    if(!tx&&!receipt)return {state:'submitted',transactionHash:step.txHash,receipt:null,intent:expected};
    if(!tx&&receipt)throw Object.assign(
      fail('Confirmed transaction details are unavailable; the durable intent cannot be verified.','RF26_INTENT_MISMATCH'),
      {transactionHash:step.txHash});
    if(tx){
      if(!same(tx.from,expected.wallet))throw fail('Transaction sender does not match the durable intent.','RF26_INTENT_MISMATCH');
      if(!tx.to||!same(tx.to,expected.to))throw fail('Transaction destination does not match the durable intent.','RF26_INTENT_MISMATCH');
      if(tx.chainId!=null&&chain(tx.chainId)!==expected.chainId)throw fail('Transaction chain does not match the durable intent.','RF26_INTENT_MISMATCH');
      if(Number(tx.nonce)!==expected.nonce)throw fail('Transaction nonce does not match the durable intent.','RF26_INTENT_MISMATCH');
      const txData=String(tx.data||'0x').toLowerCase();
      const bytes=/^0x(?:[0-9a-f]{2})*$/i.test(txData)?(txData.length-2)/2:-1;
      if(bytes!==expected.dataLength||hashData(txData).toLowerCase()!==expected.dataHash)
        throw fail('Transaction calldata does not match the durable intent.','RF26_INTENT_MISMATCH');
      let amount;try{amount=BigInt(tx.value??0);}catch{throw fail('Transaction value is unavailable.','RF26_INTENT_MISMATCH');}
      if(String(amount)!==expected.value)throw fail('Transaction value does not match the durable intent.','RF26_INTENT_MISMATCH');
    }
    if(!receipt)return {state:'submitted',transactionHash:step.txHash,receipt:null,intent:expected,transaction:tx};
    if(receipt.hash&&receipt.hash.toLowerCase()!==step.txHash.toLowerCase())throw fail('Transaction receipt hash mismatch.','RF26_INTENT_MISMATCH');
    if(Number(receipt.status)!==1)return {state:'failed',transactionHash:step.txHash,receipt,intent:expected,transaction:tx};
    return {state:'confirmed',transactionHash:step.txHash,receipt,intent:expected,transaction:tx};
  }
  async function executeIntentStep({store,journal,stepKey,label,intentValue,assertWrite,submitIntent,provider,hashData,verifyReceipt}){
    if(typeof assertWrite!=='function'||typeof submitIntent!=='function'||typeof hashData!=='function')
      throw fail('Guarded durable transaction callbacks are required.','RF26_INTENT_MISMATCH');
    const durable=store.read(journal.provenance);
    if(durable)journal=merge(durable,journal);
    const prior=journal.steps?.[stepKey];
    let expected=prior?.intent?intent(prior.intent):(intentValue?intent(intentValue):null);
    if(prior?.intent&&intentValue&&!sameIntent(prior.intent,intentValue))
      throw fail('The requested transaction no longer matches the saved durable intent.','RF26_INTENT_MISMATCH');
    if(prior?.txHash){
      const result=await inspectIntentTransaction({provider,journal,stepKey,hashData});
      if(result.state==='submitted')throw Object.assign(
        fail('A transaction is pending or its receipt is unavailable. It will not be replayed.','RF26_PENDING_TRANSACTION'),
        {transactionHash:result.transactionHash});
      if(result.state==='failed')throw Object.assign(
        fail('The recorded transaction failed. A new explicit recovery decision is required.','RF26_TRANSACTION_FAILED'),
        {transactionHash:result.transactionHash});
      if(typeof verifyReceipt==='function'){
        try{await verifyReceipt(result);}
        catch(error){throw Object.assign(
          fail('The transaction succeeded, but its intended onchain postcondition could not be verified. It will not be replayed.','RF26_POSTCONDITION_FAILED'),
          {transactionHash:result.transactionHash,cause:error});}
      }
      journal=store.save(checkpoint(journal,stepKey,{
        status:'confirmed',txHash:result.transactionHash,intent:expected,
        confirmedAt:prior.confirmedAt||new Date().toISOString(),postconditionVerifiedAt:new Date().toISOString()
      }));
      return {journal,receipt:result.receipt,transactionHash:result.transactionHash,alreadyConfirmed:true};
    }
    if(prior?.status==='prepared'&&prior.intent)
      throw fail('A prepared transaction intent exists without a recorded hash. Check the wallet history before making any new recovery decision.','RF26_PREPARED_INTENT');
    if(!expected)throw fail('A durable transaction intent is required before submission.','RF26_INTENT_MISMATCH');
    await assertWrite(expected);
    journal=store.save(checkpoint(journal,stepKey,{
      status:'prepared',label,intent:expected,preparedAt:new Date().toISOString()
    }));
    let sent;
    try{sent=await submitIntent(expected);}
    catch(error){
      if(error?.transactionHash){
        const submittedHash=hash(error.transactionHash);
        try{
          journal=store.save(checkpoint(journal,stepKey,{
            status:'submitted',label,intent:expected,txHash:submittedHash,
            submittedAt:new Date().toISOString(),submissionCheckpointError:true
          }));
        }catch(saveError){
          throw Object.assign(
            fail('A transaction was submitted and its hash is known, but the durable checkpoint also failed. Preserve the hash and recover before retrying.','RF26_CHECKPOINT_FAILED'),
            {transactionHash:submittedHash,cause:saveError,submissionError:error});
        }
        throw Object.assign(error,{transactionHash:submittedHash});
      }
      const rejected=error?.code==='ACTION_REJECTED'||error?.code===4001||error?.info?.error?.code===4001;
      if(rejected){
        journal=store.save(checkpoint(journal,stepKey,{
          status:'failed',label,intent:expected,rejectionConfirmedAt:new Date().toISOString()
        }));
      }
      throw error;
    }
    if(!sent?.hash)throw fail('Wallet did not return a transaction hash.');
    const txHash=hash(sent.hash);
    try{journal=store.save(checkpoint(journal,stepKey,{
      status:'submitted',label,intent:expected,txHash,submittedAt:new Date().toISOString()
    }));}
    catch(error){throw Object.assign(
      fail('Transaction submitted, but its durable checkpoint could not be saved. Preserve the hash and recover before retrying.','RF26_CHECKPOINT_FAILED'),
      {transactionHash:txHash,cause:error});}
    try{await sent.wait();}catch(error){
      if(error?.code!=='CALL_EXCEPTION'&&error?.code!=='TRANSACTION_REPLACED')
        throw Object.assign(
          fail('Transaction confirmation is unavailable. Inspect the saved hash before retrying.','RF26_PENDING_TRANSACTION'),
          {transactionHash:txHash,cause:error});
    }
    const result=await inspectIntentTransaction({provider,journal,stepKey,hashData});
    if(result.state==='failed')throw Object.assign(
      fail('The recorded transaction failed. A new explicit recovery decision is required.','RF26_TRANSACTION_FAILED'),
      {transactionHash:txHash});
    if(result.state!=='confirmed')throw Object.assign(
      fail('Transaction is not confirmed. Inspect its recorded hash before retrying.','RF26_PENDING_TRANSACTION'),
      {transactionHash:txHash});
    if(typeof verifyReceipt==='function'){
      try{await verifyReceipt(result);}
      catch(error){throw Object.assign(
        fail('The transaction succeeded, but its intended onchain postcondition could not be verified. It will not be replayed.','RF26_POSTCONDITION_FAILED'),
        {transactionHash:txHash,cause:error});}
    }
    journal=store.save(checkpoint(journal,stepKey,{
      status:'confirmed',label,intent:expected,txHash,confirmedAt:new Date().toISOString(),
      postconditionVerifiedAt:new Date().toISOString()
    }));
    return {journal,receipt:result.receipt,transactionHash:txHash,alreadyConfirmed:false};
  }
  function publicationTarget(detail,scope,verified){
    if(!object(detail)||!object(scope)||!object(verified))throw fail('Verified publication context is required.');
    const chainId=chain(scope.chainId);
    if(chain(detail.chainId)!==chainId||chain(verified.chainId)!==chainId||
       !same(detail.collectionAddress,verified.collection||verified.collectionAddress)||
       !same(verified.factory,scope.factory))
      throw fail('Publication network, Factory or collection identity mismatch.');
    if(detail.factory&& !same(detail.factory,scope.factory))throw fail('Publication Factory mismatch.');
    return Object.freeze({chainId,contract:address(verified.collection||verified.collectionAddress),factory:address(scope.factory)});
  }
  return Object.freeze({SCHEMA,chain,address,hash,intent,sameIntent,identity,key,normalize,merge,createStore,checkpoint,
    inspectTransaction,executeStep,inspectIntentTransaction,executeIntentStep,publicationTarget});
});
