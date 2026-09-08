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
  // R3D-B2 R1 deliberately exposes no transaction executor. The pure core
  // includes receipt-aware primitives for the later lifecycle integration,
  // but no existing Forge, recovery, or creator action is routed through them.
  function publicationTarget(detail,verified){
    return core.publicationTarget(detail,context().scope,verified);
  }
  window.RF26Recovery=Object.freeze({
    core,context,store,read,save,begin,adoptLegacy,assertJournal,
    readScope,verifyCollection,inspect,publicationTarget
  });
})();
