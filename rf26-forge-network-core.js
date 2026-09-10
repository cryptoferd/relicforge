(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RF26ForgeNetworkCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const CHAINS=Object.freeze([1,11155111]);
  const REQUIRED=Object.freeze(['feePolicy','collectionImplementation','dataImplementation','mintPhasesImplementation','renderer','randomnessAdapter','reserve','canonicalRegistry']);
  const ADDRESS=/^0x[0-9a-f]{40}$/i, HASH=/^(?:0x)?[0-9a-f]{64}$/i;
  const fail=(message,code='RF26_NETWORK_LOCKED')=>Object.assign(new Error(message),{code});
  function chain(value){
    const id=typeof value==='string'&&/^0x[0-9a-f]+$/i.test(value)?Number(BigInt(value)):Number(value);
    if(!Number.isSafeInteger(id)||!CHAINS.includes(id))throw fail('Unsupported launch network.');
    return id;
  }
  function address(value){
    const v=String(value||'').toLowerCase();
    if(!ADDRESS.test(v)||/^0x0{40}$/.test(v))throw fail('Invalid non-zero EVM address.');
    return v;
  }
  function hash(value){
    const v=String(value||'').toLowerCase().replace(/^0x/,'');
    if(!/^[0-9a-f]{64}$/.test(v)||/^0{64}$/.test(v))throw fail('Invalid production release hash.');
    return v;
  }
  const same=(a,b)=>address(a)===address(b);
  function releaseIdentity(local,remote,id){
    id=chain(id);
    if(!local||Number(local.chainId)!==id||local.launchEnabled!==true)
      throw fail('The selected network has no enabled local deployment registry.');
    if(!remote||Number(remote.chainId)!==id||remote.launchEnabled!==true)
      throw fail('The server has not enabled this network for deployment.');
    const factory=address(local.factory);
    if(!same(factory,remote.release?.factory))throw fail('Local and server Factory addresses do not match.');
    for(const key of REQUIRED)address(local[key]);
    if(id===1){
      if(local.environment!=='production'||remote.kind!=='production'||remote.release?.configured!==true)
        throw fail('Ethereum Mainnet requires a certified production release.');
      const releaseId=String(local.releaseId||'').trim();
      if(!releaseId||releaseId!==remote.release.releaseId)throw fail('Production release IDs do not match.');
      if(hash(local.deploymentManifestHash)!==hash(remote.release.deploymentManifestHash))
        throw fail('Production deployment manifest hashes do not match.');
      return Object.freeze({chainId:id,factory,releaseId,manifestHash:hash(local.deploymentManifestHash)});
    }
    if(remote.kind!=='testnet'||remote.publicEnabled===true)
      throw fail('Sepolia must remain a private development network.');
    return Object.freeze({chainId:id,factory,releaseId:String(remote.release?.releaseId||''),manifestHash:null});
  }
  function journalIdentity(journal,scope,wallet){
    const j=journal||{};
    if(chain(j.chainId)!==scope.chainId||!same(j.factory,scope.factory)||!same(j.wallet,wallet))
      throw fail('Deployment journal network, Factory, or creator wallet mismatch.','RF26_JOURNAL_MISMATCH');
    const provenance=String(j.provenance||'').toLowerCase();
    if(!/^0x[0-9a-f]{64}$/.test(provenance)||/^0x0{64}$/.test(provenance))
      throw fail('Invalid deployment provenance.','RF26_JOURNAL_MISMATCH');
    if(scope.chainId===1&&(j.releaseId!==scope.releaseId||hash(j.manifestHash)!==scope.manifestHash))
      throw fail('Deployment journal belongs to a different production release.','RF26_JOURNAL_MISMATCH');
    return [scope.chainId,address(wallet),scope.factory,provenance].join(':');
  }
  function assertDeployment(record,scope,wallet){
    if(!record||chain(record.chainId)!==scope.chainId||!same(record.factory,scope.factory))
      throw fail('The active collection belongs to a different network or Factory.','RF26_DEPLOYMENT_MISMATCH');
    if(wallet&&!same(record.wallet,wallet))throw fail('Deployment creator wallet mismatch.','RF26_DEPLOYMENT_MISMATCH');
    return true;
  }
  function createController(deps){
    let selected=null,epoch=0,active=null,locked=0;
    const current=()=>selected;
    const scope=()=>active;
    function select(id){
      id=chain(id);
      if(locked)throw fail('A deployment operation is in progress. Finish or inspect it before changing networks.');
      if(selected!==id){selected=id;epoch++;active=null;deps.onChange?.(id);}
      return id;
    }
    function revoke(){active=null;epoch++;}
    function clear(){if(locked)throw fail('A deployment operation is in progress.');revoke();}
    async function preflight(){
      if(selected===null)throw fail('Choose a launch network explicitly.');
      const id=selected,version=epoch;
      const local=deps.localConfig(id);
      // Local gate is checked before any network, wallet, or transaction operation.
      if(!local||local.launchEnabled!==true)throw fail('The selected network is not available for deployment.');
      const remote=await deps.serverPolicy(id);
      const identity=releaseIdentity(local,remote,id);
      const provider=deps.readProvider(id);
      await deps.assertProvider(provider,id);
      await deps.verifyInfrastructure(id,provider);
      if(version!==epoch||selected!==id)throw fail('Launch network changed during preflight.');
      const result=Object.freeze({...identity,epoch:version});
      active=result;
      return result;
    }
    async function assertScope(s){
      if(!s||s.epoch!==epoch||selected!==s.chainId)throw fail('Launch network or signing session changed.');
      const local=deps.localConfig(s.chainId);
      // Recheck server policy and infrastructure before every wallet write.
      const remote=await deps.serverPolicy(s.chainId);
      const identity=releaseIdentity(local,remote,s.chainId);
      if(identity.factory!==s.factory||identity.releaseId!==s.releaseId||identity.manifestHash!==s.manifestHash)
        throw fail('The deployment release changed. Reconnect and review the new release.');
      const provider=deps.readProvider(s.chainId);
      await deps.assertProvider(provider,s.chainId);
      // Revalidate the actual Factory bindings, not just the stored release ID.
      await deps.verifyInfrastructure(s.chainId,provider);
      if(s.epoch!==epoch||selected!==s.chainId)throw fail('Launch network changed before signing.');
      return true;
    }
    function guardSigner(signer,s,expectedWallet){
      if(!signer||typeof signer.sendTransaction!=='function')throw fail('A valid wallet signer is required.');
      const wallet=address(expectedWallet);
      const runner=new Proxy(signer,{
        get(target,key){
          if(key==='sendTransaction')return async tx=>{
            await assertScope(s);
            const actual=await target.getAddress();
            if(!same(actual,wallet))throw fail('The selected wallet account changed.');
            await deps.assertProvider(target.provider,s.chainId);
            if(tx.chainId!=null&&chain(tx.chainId)!==s.chainId)throw fail('Transaction chain ID mismatch.');
            // No arbitrary transaction destination is trusted as a release authority.
            // The caller must also verify collection/Factory identity before writes.
            const sent=await target.sendTransaction({...tx,chainId:s.chainId});
            try{await deps.onSubmitted?.(sent,s,wallet);}
            catch(error){throw Object.assign(fail('Transaction was submitted but its journal checkpoint failed. Preserve the hash and recover before retrying.','RF26_CHECKPOINT_FAILED'),{transactionHash:sent.hash,cause:error});}
            return sent;
          };
          if(key==='signTransaction')return async tx=>{
            await assertScope(s);
            if(!same(await target.getAddress(),wallet))throw fail('The selected wallet account changed.');
            await deps.assertProvider(target.provider,s.chainId);
            if(tx.chainId!=null&&chain(tx.chainId)!==s.chainId)throw fail('Transaction chain ID mismatch.');
            return target.signTransaction({...tx,chainId:s.chainId});
          };
          if(key==='populateTransaction')return async tx=>{
            await assertScope(s);
            if(!same(await target.getAddress(),wallet))throw fail('The selected wallet account changed.');
            await deps.assertProvider(target.provider,s.chainId);
            if(tx.chainId!=null&&chain(tx.chainId)!==s.chainId)throw fail('Transaction chain ID mismatch.');
            return target.populateTransaction({...tx,chainId:s.chainId});
          };
          if(key==='connect')return provider=>{
            // A different provider cannot silently inherit an authorized signing session.
            if(provider!==target.provider)throw fail('Reconnect to change the signing provider.');
            return runner;
          };
          const value=Reflect.get(target,key,target);
          return typeof value==='function'?value.bind(target):value;
        }
      });
      return runner;
    }
    function enter(){locked++;return()=>{locked=Math.max(0,locked-1);};}
    return Object.freeze({current,scope,select,clear,revoke,preflight,assertScope,guardSigner,enter});
  }
  return Object.freeze({CHAINS,REQUIRED,chain,address,hash,same,releaseIdentity,journalIdentity,assertDeployment,createController});
});
