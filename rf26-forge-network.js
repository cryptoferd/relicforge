(function(){
  'use strict';
  const core=window.RF26ForgeNetworkCore;
  if(!core)throw new Error('RF26 network core is missing.');
  const $=id=>document.getElementById(id);
  const CHOICE='relicforge_selected_network_v2';
  const EXECUTION_CHAIN=11155111; // R3D-B R1: deliberately no Mainnet transaction execution.
  const fail=(message,code='RF26_NETWORK_LOCKED')=>Object.assign(new Error(message),{code});
  let selected=null,scope=null,guarded=null,account=null,busy=0,serial=0,message='';
  const networks=()=>{if(!window.RelicForgeNetworks)throw fail('RelicForge network registry is unavailable.');return window.RelicForgeNetworks;};
  const apiBase=()=>String(window.RelicForgeCloud?.apiBase?.()||window.RELICFORGE_CONFIG?.apiBase||'').replace(/\/$/,'');
  const localConfig=id=>window.RELICFORGE_V2_ADDRESSES?.[core.chain(id)]||null;
  const meta=id=>networks().metadata(core.chain(id));
  const title=id=>id==null?'Choose a network':meta(id).name;
  const selectedChainId=()=>selected;
  const localReady=id=>{try{return networks().isLaunchEnabled(core.chain(id))===true;}catch{return false;}};
  function requireSelection(){if(selected==null)throw fail('Choose Ethereum Mainnet or Sepolia in the launch network selector.');return selected;}
  function requireLocal(){const id=requireSelection();if(!localReady(id))throw fail(title(id)+' infrastructure is not available for deployment yet.');return localConfig(id);}
  function status(value){message=String(value||'');render();}
  function render(){
    const picker=$('rf26ForgeNetworkSelect');if(picker&&picker.value!==String(selected??''))picker.value=selected==null?'':String(selected);
    const label=$('rf26ForgeNetworkStatus');if(label)label.textContent=message||(
      selected==null?'Choose a network before preparing a launch.':
      localReady(selected)?title(selected)+' is configured locally. Verify its release and infrastructure before deploying.':
      title(selected)+' is not available for deployment yet. You can continue creating and saving artwork.');
  }
  async function serverPolicy(id){
    id=core.chain(id);
    const base=apiBase();if(!base)throw fail('RelicForge Cloud is required for deployment release verification.');
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10000);
    try{
      const response=await fetch(base+'/api/public/forge-networks/'+id+'/preflight',{
        cache:'no-store',credentials:'omit',redirect:'error',headers:{accept:'application/json'},signal:abort.signal
      });
      if(!response.ok)throw fail('Network release preflight returned HTTP '+response.status+'.');
      const payload=await response.json();
      if(!payload?.network||Number(payload.network.chainId)!==id)throw fail('Invalid network release response.');
      return payload.network;
    }finally{clearTimeout(timer);}
  }
  function discardSession(){scope=null;guarded=null;account=null;serial++;}
  const controller=core.createController({
    localConfig,serverPolicy,
    readProvider:id=>networks().readProvider(id),
    assertProvider:(provider,id)=>networks().assertProvider(provider,id),
    verifyInfrastructure:(id,provider)=>networks().verifyInfrastructure(id,provider),
    onSubmitted:(tx,s,wallet)=>window.dispatchEvent(new CustomEvent('relicforge:transaction-submitted',{
      detail:{chainId:s.chainId,factory:s.factory,wallet,txHash:tx.hash}
    })),
    onChange:()=>{discardSession();message='';}
  });
  function revokeSession(reason='Wallet session changed. Reconnect before deploying.'){
    controller.revoke();discardSession();status(reason);
    window.dispatchEvent(new CustomEvent('relicforge:forge-session-invalidated',{detail:{reason}}));
  }
  function boundChain(){
    const forge=window.RelicForgeForge;
    const journal=forge?.getDeploymentJournal?.();
    const saved=forge?.getForgeProjectState?.();
    if(!journal?.collectionAddress&&!journal?.provenance&&!saved?.collectionAddress)return null;
    return core.chain(journal?.chainId??saved?.chainId??saved?.launchChainId??11155111);
  }
  function select(id){
    id=core.chain(id);
    if(busy)throw fail('Finish or inspect the current deployment operation before changing networks.');
    const bound=boundChain();
    if(bound!=null&&bound!==id)throw fail('This launch is bound to '+title(bound)+'. Save the project and open a new launch draft before switching. Existing deployment records are never reassigned.','RF26_DEPLOYMENT_MISMATCH');
    if(selected===id)return id;
    controller.select(id);selected=id;message='';
    try{sessionStorage.setItem(CHOICE,String(id));localStorage.setItem(CHOICE,String(id));}catch{}
    window.dispatchEvent(new CustomEvent('relicforge:launch-network-changed',{detail:{chainId:id}}));
    render();return id;
  }
  function initialPreference(){
    const query=new URLSearchParams(location.search).get('chain');
    if(query!=null){try{return core.chain(query);}catch{return null;}}
    // The standalone legacy Dashboard is explicitly a Sepolia recovery view.
    // This is not inferred from the wallet's currently selected network.
    if(document.body?.classList.contains('dashboard-page-body'))return 11155111;
    try{const raw=sessionStorage.getItem(CHOICE)||localStorage.getItem(CHOICE);if(raw)return core.chain(raw);}catch{}
    return null;
  }
  const initial=initialPreference();if(initial!=null){selected=initial;controller.select(initial);}
  async function preflight(){
    requireSelection();const ticket=serial;
    const result=await controller.preflight();
    if(ticket!==serial||selected!==result.chainId)throw fail('Network or wallet changed during preflight.');
    scope=result;
    status(title(result.chainId)+' release verified. Factory: '+result.factory+'.'+(result.chainId===1?' Mainnet transaction execution remains locked in R3D-B R1.':''));
    window.dispatchEvent(new CustomEvent('relicforge:forge-preflight-complete',{detail:{chainId:result.chainId}}));
    return result;
  }
  async function requireReady(){
    if(scope&&scope.chainId===selected){await controller.assertScope(scope);return scope;}
    return preflight();
  }
  const selectedWalletProvider=()=>window.RelicForgeWalletSession?.getProvider?.()||window.RelicForgeWallets?.getProvider?.()||window.ethereum||null;
  async function requestAccount(forceChooser){
    if(window.RelicForgeWalletSession?.requestAccount)return window.RelicForgeWalletSession.requestAccount({forceChooser});
    if(window.RelicForgeWallets?.requestAccount)return window.RelicForgeWallets.requestAccount({forceChooser});
    const injected=selectedWalletProvider();if(!injected?.request)throw fail('No selected EVM wallet provider is available.');
    const accounts=await injected.request({method:'eth_requestAccounts'});if(!accounts?.[0])throw fail('Wallet did not return an account.');return accounts[0];
  }
  async function connect({forceChooser=false,requireLaunch=false}={}){
    // Account-only sign-in is chain-agnostic and never switches the wallet.
    if(requireLaunch&&selected!==EXECUTION_CHAIN)throw fail('Mainnet transaction execution remains locked until the R3D-B recovery integration is certified.');
    const ready=requireLaunch?await requireReady():null;
    const ticket=serial;
    const requested=core.address(await requestAccount(forceChooser));
    const injected=selectedWalletProvider();if(!injected?.request)throw fail('Selected wallet provider is unavailable.');
    if(!requireLaunch){
      if(ticket!==serial)throw fail('Wallet or network changed while connecting.');
      controller.revoke();discardSession();account=requested;
      return {provider:null,signer:null,wallet:requested,scope:null};
    }
    await networks().ensureWalletChain(injected,ready.chainId);
    const provider=new window.ethers.BrowserProvider(injected);
    await networks().assertProvider(provider,ready.chainId);
    const signer=await provider.getSigner(),wallet=core.address(await signer.getAddress());
    if(!core.same(wallet,requested))throw fail('The selected wallet account does not match the requested account.');
    if(ticket!==serial||scope!==ready)throw fail('Wallet or network changed while connecting.');
    guarded=controller.guardSigner(signer,ready,wallet);account=wallet;
    return {provider,signer:guarded,wallet,scope:ready};
  }
  async function assertWrite(){
    if(selected!==EXECUTION_CHAIN)throw fail('Mainnet transaction execution remains locked until the R3D-B recovery integration is certified.');
    if(!scope||!guarded)throw fail('Connect the creator wallet to the verified launch network before submitting a transaction.');
    await controller.assertScope(scope);
    if(!guarded||!account)throw fail('The creator signing session was revoked.');
    return scope;
  }
  function writeSigner(){if(selected!==EXECUTION_CHAIN||!scope||!guarded)throw fail('A verified Sepolia launch signing session is required.');return guarded;}
  function assertBound(record,wallet){if(!scope)throw fail('Verify the launch network before using a deployment.');return core.assertDeployment(record,scope,wallet||account);}
  function assertJournal(journal){if(!scope||!account)throw fail('A verified creator session is required to use a deployment journal.');return core.journalIdentity(journal,scope,account);}
  function readJournal(provenance,wallet=account,factory=scope?.factory,id=selected){
    if(id==null||!wallet||!factory)return null;
    if(!scope||scope.chainId!==core.chain(id)||!core.same(factory,scope.factory)||!core.same(wallet,account))throw fail('Deployment journal scope mismatch.');
    return networks().readJournal(provenance,wallet,factory,id);
  }
  function writeJournal(journal){assertJournal(journal);return networks().writeJournal(journal,account,scope.factory,scope.chainId);}
  async function verifyCollection(address,expected={}){
    const s=await requireReady(),addr=core.address(address),provider=networks().readProvider(s.chainId);
    await networks().assertProvider(provider,s.chainId);
    const factory=new window.ethers.Contract(s.factory,[
      'function isRelicForgeCollection(address) view returns(bool)',
      'function dataForCollection(address) view returns(address)',
      'function mintPhasesForCollection(address) view returns(address)'
    ],provider);
    if(!await factory.isRelicForgeCollection(addr))throw fail('Collection is not registered by the selected Factory.');
    const collection=new window.ethers.Contract(addr,[
      'function factory() view returns(address)','function creator() view returns(address)',
      'function controller() view returns(address)','function dataContract() view returns(address)',
      'function mintPhases() view returns(address)'
    ],provider);
    const [factoryAddress,creator,controllerAddress,data,phases]=await Promise.all([
      collection.factory(),collection.creator(),collection.controller(),collection.dataContract(),collection.mintPhases()
    ]);
    if(!core.same(factoryAddress,s.factory)||!core.same(data,await factory.dataForCollection(addr))||!core.same(phases,await factory.mintPhasesForCollection(addr)))
      throw fail('Collection, Factory, ProjectData, or MintPhases bindings do not match.');
    if(expected.chainId!=null&&core.chain(expected.chainId)!==s.chainId)throw fail('Collection network mismatch.');
    if(expected.creator&&!core.same(creator,expected.creator))throw fail('Collection creator mismatch.');
    if(expected.controller&&!core.same(controllerAddress,expected.controller))throw fail('Active collection controller mismatch.');
    for(const linked of [data,phases])if(await provider.getCode(linked)==='0x')throw fail('Collection has a missing linked contract.');
    return {chainId:s.chainId,factory:s.factory,collection:addr,creator:core.address(creator),controller:core.address(controllerAddress),data:core.address(data),phases:core.address(phases)};
  }
  function enter(){busy++;const release=controller.enter();let done=false;return()=>{if(done)return;done=true;busy=Math.max(0,busy-1);release();render();};}
  function clear(){if(busy)throw fail('A deployment operation is in progress.');revokeSession();}
  function install(){
    const picker=$('rf26ForgeNetworkSelect');
    picker?.addEventListener('change',()=>{
      try{if(!picker.value)throw fail('Choose a launch network.');select(picker.value);}
      catch(error){status(error.message);}
    });
    $('rf26ForgePreflightBtn')?.addEventListener('click',async()=>{
      try{status('Verifying selected release and onchain infrastructure…');await preflight();}
      catch(error){status(error.message);}
    });
    for(const event of ['relicforge:wallet-disconnected','relicforge:wallet-accounts-changed','relicforge:wallet-provider-changed'])
      window.addEventListener(event,()=>revokeSession('Wallet session changed. Reconnect before deploying.'));
    render();
  }
  window.RelicForgeForgeNetwork=Object.freeze({selectedChainId,requireSelection,select,localConfig,requireLocal,preflight,requireReady,connect,writeSigner,assertWrite,assertBound,assertJournal,readJournal,writeJournal,verifyCollection,enter,clear,revokeSession,meta,title,localReady,render,scope:()=>scope,account:()=>account});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
