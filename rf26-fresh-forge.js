(function(){
  'use strict';
  const core=window.RF26FreshForgeCore;
  if(!core)throw new Error('RF26 fresh Forge core is missing.');
  const $=id=>document.getElementById(id);
  const fail=(message,code='RF26_FRESH_MISMATCH')=>Object.assign(new Error(message),{code});
  const net=()=>window.RelicForgeForgeNetwork;
  const forge=()=>window.RelicForgeForge;
  const resume=()=>window.RelicForgeResume;
  const recovery=()=>window.RF26Recovery;
  const FACTORY_ABI=[
    'function quoteCollectionFeeTerms(uint32 maxSupply,uint8 feeMode) view returns(uint32 lockedFeeCents,uint256 upfrontFeeWei,bool oracleHealthy,bool feeActive)',
    'function createCollectionV2((string name,string symbol,string description,uint32 maxSupply,uint16 canvasWidth,uint16 canvasHeight,uint8 layerCount,address payoutReceiver,address royaltyReceiver,uint96 royaltyBps,uint8 feeMode,uint8 initialRevealMode,uint64 batchWindowSeconds,uint256 maxRandomnessCostPerBatchWei) launch) payable returns(address collection,address projectData)',
    'function creatorCollectionCount(address creator) view returns(uint256)',
    'function creatorCollectionAt(address creator,uint256 index) view returns(address)',
    'event CollectionCreated(address indexed creator,address indexed collection,address indexed dataContract,uint256 collectionNumber)'
  ];
  const executionAllowed=id=>[1,11155111].includes(Number(id));
  const networkName=id=>net()?.title?.(id)||(`chain ${Number(id)}`);
  let running=false;
  function status(message,bad=false){
    const node=$('forgeTestStatus');
    if(node){node.textContent=message;node.classList.toggle('bad',bad);}
  }
  function freezeContext(ctx){
    const scope=net().scope();
    if(!scope||!executionAllowed(scope.chainId)||!ctx.wallet||!ctx.compiled)
      throw fail('A verified launch network and compiled build are required.');
    return Object.freeze({
      scope,chainId:scope.chainId,factory:core.address(scope.factory),
      wallet:core.address(ctx.wallet),provenance:core.hash(ctx.compiled.provenance)
    });
  }
  async function assertCurrent(id){
    const scope=await net().requireReady();
    if(scope!==id.scope||scope.chainId!==id.chainId||
       core.address(scope.factory)!==id.factory||
       core.address(net().account())!==id.wallet)
      throw fail('Launch network or creator changed during preparation.');
    return scope;
  }
  async function factoryFor(id,runner){
    await assertCurrent(id);
    return new window.ethers.Contract(id.factory,FACTORY_ABI,runner);
  }
  async function existing(ctx,input,id){
    const legacy=ctx.journal||forge().findLocalDeploymentJournal?.(id.provenance)||null;
    if(legacy){
      if(core.hash(legacy.provenance)!==id.provenance)
        throw fail('The loaded deployment journal belongs to a different compiled build.');
      if(legacy.wallet&&core.address(legacy.wallet)!==id.wallet)
        throw fail('The saved deployment belongs to a different creator wallet.');
      if(legacy.chainId!=null&&Number(legacy.chainId)!==id.chainId)
        throw fail('The saved deployment belongs to a different network.');
      if(legacy.factory&&core.address(legacy.factory)!==id.factory)
        throw fail('The saved deployment Factory does not match the verified release.');
      if(legacy.collectionAddress){
        const candidate=await resume().checkCandidate(legacy.collectionAddress,ctx,ctx.compiled,input,true);
        if(!candidate||candidate.bad?.length)
          throw fail('The saved collection does not match the compiled build. Review its recovery record.');
        return {candidate,legacy};
      }
      throw fail('An unfinished historical Factory attempt exists for this build. Inspect its wallet history before creating another collection.','RF26_EXISTING_DEPLOYMENT');
    }
    const scoped=recovery().read(id.provenance);
    if(scoped?.collectionAddress&&scoped.steps?.factoryCreate?.status==='confirmed'){
      const candidate=await resume().checkCandidate(scoped.collectionAddress,ctx,ctx.compiled,input,true);
      if(!candidate||candidate.bad?.length)throw fail('The scoped collection does not match the compiled build.');
      return {candidate,legacy:null,scoped};
    }
    if(scoped)return {candidate:null,legacy:null,scoped};
    // The Factory has no provenance uniqueness constraint. Scan the creator's
    // history before creating another collection. Never hide a failed read.
    const candidate=await resume().findFreshCandidate(ctx,ctx.compiled,input);
    if(candidate)return {candidate,legacy:null,scoped:null};
    return {candidate:null,legacy:null,scoped:null};
  }
  async function verifyCreated(receiptResult,id,ctx,input,factory){
    const receipt=receiptResult.receipt;
    const event=core.creationEvents(receipt,id.factory,id.wallet,log=>factory.interface.parseLog(log));
    const verified=await net().verifyCollection(event.collection,{creator:id.wallet,chainId:id.chainId});
    if(core.address(verified.data)!==event.data)throw fail('Factory event ProjectData does not match the verified collection.');
    const candidate=await resume().checkCandidate(event.collection,ctx,ctx.compiled,input,true);
    if(!candidate||candidate.bad?.length)
      throw fail('The Factory transaction succeeded, but the deployed collection does not match the frozen launch inputs: '+(candidate?.bad||['unverified']).join(', '));
    const result={
      chainId:id.chainId,factory:id.factory,creator:id.wallet,
      collection:core.address(event.collection),data:core.address(event.data),
      phases:core.address(verified.phases),controller:core.address(verified.controller)
    };
    await assertCurrent(id);
    return result;
  }
  async function continueExisting(candidate,ctx,id,attach){
    await assertCurrent(id);
    await net().verifyCollection(candidate.address,{creator:id.wallet,chainId:id.chainId});
    await attach({
      collection:candidate.address,data:candidate.dataAddress,phases:candidate.mintPhasesAddress,
      chainId:id.chainId,factory:id.factory,creator:id.wallet
    },null);
    return resume().run(true);
  }
  async function run({quoteRandomness,attach}={}){
    if(running)return;
    running=true;
    const button=$('forgeCollectionBtn');
    if(button){button.disabled=true;button.textContent='Preparing Forge…';}
    try{
      if(!forge()?.getResumeContext||!resume()?.prepareFresh||!recovery()?.executeFactory||
         typeof quoteRandomness!=='function'||typeof attach!=='function')
        throw fail('R3D-B2 R3 dependencies are unavailable. Reload Studio.');
      await forge().requireForgeWrite(false);
      const prepared=await resume().prepareFresh();
      const ctx=prepared.ctx,input=prepared.input,id=freezeContext(ctx);
      await assertCurrent(id);
      status('Checking the verified Factory and existing creator deployments…');
      const found=await existing(ctx,input,id);
      if(found.candidate){
        if(found.legacy?.status==='complete'||found.scoped?.status==='complete'){
          status('This compiled build is already associated with a completed collection: '+found.candidate.address+'. Open the existing collection instead of creating another.');
          return {ok:true,existing:true,collection:found.candidate.address};
        }
        if(!window.confirm('A matching collection already exists for this build. Continue its verified deployment instead of creating a duplicate?'))
          throw fail('Existing collection retained. No new Factory transaction was submitted.','RF26_EXISTING_DEPLOYMENT');
        status('Resuming existing collection '+found.candidate.address+'…');
        await continueExisting(found.candidate,ctx,id,attach);
        return {ok:true,existing:true,collection:found.candidate.address};
      }
      const readFactory=await factoryFor(id,ctx.provider);
      const [feeCents,upfront,healthy]=await readFactory.quoteCollectionFeeTerms(ctx.compiled.recipeCount,input.feeMode);
      if(input.feeMode===1&&Number(feeCents)>0&&!healthy)
        throw fail('Creator Covers Platform Fee requires a healthy ETH/USD quote.');
      const randomnessQuote=await quoteRandomness();
      if(!randomnessQuote)throw fail('A verified randomness quote is required.');
      const launch=core.makeLaunch({
        compiled:ctx.compiled,input,wallet:id.wallet,randomnessQuote,upfrontFeeWei:upfront
      });
      const factory=await factoryFor(id,ctx.signer);
      const calldata=factory.interface.encodeFunctionData('createCollectionV2',[launch.tuple]);
      const spec=core.specHash({
        scope:id.scope,wallet:id.wallet,launch,data:calldata,
        hashData:bytes=>window.ethers.keccak256(bytes),
        hashText:text=>window.ethers.keccak256(window.ethers.toUtf8Bytes(text))
      });
      await assertCurrent(id);
      const total=window.ethers.formatEther(launch.feeValue);
      if(!found.scoped){
        const name=networkName(id.chainId);
        const mainnet=id.chainId===1;
        const warning=mainnet
          ? 'WARNING: This creates permanent Ethereum Mainnet contracts and spends REAL ETH. Verify the collection name, supply, Factory, and fee before approving the wallet transaction.'
          : 'This creates real testnet contracts. The remaining artwork and configuration steps use durable recovery checkpoints.';
        const approved=window.confirm(
          'Create a new R12-v2 collection on '+name+'?\\n\\n'+
          'Network: '+name+' ('+id.chainId+')\\nFactory: '+id.factory+
          '\\nCollection: '+launch.tuple[0]+'\\nSupply: '+launch.tuple[3]+
          '\\nUpfront platform fee: '+total+' ETH\\n\\n'+warning
        );
        if(!approved)throw fail('Factory creation cancelled before wallet submission.');
      }
      status('Preparing durable Factory transaction. Do not submit a duplicate if the wallet or RPC becomes unavailable.');
      const result=await recovery().executeFactory({
        provenance:id.provenance,launchSpecHash:spec,legacyJournal:found.legacy,
        contract:factory,args:[launch.tuple,{value:BigInt(launch.feeValue)}],
        verify:r=>verifyCreated(r,id,ctx,input,readFactory)
      });
      if(!result.verified)throw fail('Factory result lacks verified collection bindings.');
      await attach(result.verified,result.transactionHash);
      await assertCurrent(id);
      status('Factory creation verified. Continuing artwork, metadata, DNA, sealing, and mint-stage configuration through durable resume…');
      await resume().run(true);
      const final=forge().getDeploymentJournal?.();
      if(final?.status==='complete'||final?.status==='onchain-complete'||final?.status==='proof-sync-pending')
        status('Fresh Forge onchain lifecycle complete. Collection: '+result.verified.collection);
      else status('Factory creation is complete. Review the recovery panel for any remaining steps.');
      return {ok:true,collection:result.verified.collection};
    }catch(error){
      const message=error.shortMessage||error.message||String(error);
      const hash=error.transactionHash?'\\nRecorded transaction: '+error.transactionHash:'';
      status('FORGE: '+message+hash,true);
      if(error.transactionHash||[
        'RF26_PENDING_TRANSACTION','RF26_PREPARED_INTENT','RF26_CHECKPOINT_FAILED',
        'RF26_POSTCONDITION_FAILED','RF26_EXISTING_DEPLOYMENT','RF26_INTENT_MISMATCH'
      ].includes(error.code)){
        if(button){button.disabled=true;button.textContent='Review / Resume Deployment';}
      }else if(button){const selected=net()?.selectedChainId?.();button.disabled=false;button.textContent='Forge Collection on '+networkName(selected);}
      return {ok:false,code:error.code||'RF26_FRESH_ERROR',transactionHash:error.transactionHash||null};
    }finally{running=false;}
  }
  window.RF26FreshForge=Object.freeze({run});
})();
