(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RF26FreshForgeCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const ADDRESS=/^0x[0-9a-f]{40}$/i;
  const HASH=/^0x[0-9a-f]{64}$/i;
  function fail(message,code='RF26_FRESH_MISMATCH'){
    return Object.assign(new Error(message),{code});
  }
  function address(value){
    const s=String(value||'').toLowerCase();
    if(!ADDRESS.test(s)||/^0x0{40}$/.test(s))throw fail('Invalid fresh-launch address.');
    return s;
  }
  function hash(value){
    const s=String(value||'').toLowerCase();
    if(!HASH.test(s)||/^0x0{64}$/.test(s))throw fail('Invalid fresh-launch hash.');
    return s;
  }
  function uint(value,bits=256){
    let n;
    try{n=BigInt(value);}catch{throw fail('Invalid unsigned launch value.');}
    if(n<0n||n>=(1n<<BigInt(bits)))throw fail('Launch value is outside its unsigned range.');
    return n.toString();
  }
  function makeLaunch({compiled,input,wallet,randomnessQuote,upfrontFeeWei=0n}){
    if(!compiled?.core||!input||!randomnessQuote)throw fail('A compiled build and verified launch inputs are required.');
    const c=compiled.core;
    const feeMode=Number(input.feeMode),revealMode=Number(input.revealMode);
    if(![1,2].includes(feeMode)||![0,1].includes(revealMode))throw fail('Invalid launch policy.');
    if(!Number.isSafeInteger(compiled.recipeCount)||compiled.recipeCount<1||compiled.recipeCount>4294967295)
      throw fail('Invalid compiled supply.');
    const layers=compiled.layerDefs?.length;
    if(!Number.isInteger(layers)||layers<1||layers>255)throw fail('Invalid compiled layer count.');
    const width=Number(c.canvas?.[0]),height=Number(c.canvas?.[1]);
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>65535||height>65535)
      throw fail('Invalid compiled canvas.');
    if(Number(input.royaltyBps)<0||Number(input.royaltyBps)>1000||!Number.isInteger(Number(input.royaltyBps)))
      throw fail('Invalid royalty basis points.');
    const batchWindow=Number(randomnessQuote.batchWindowSeconds);
    if(!Number.isSafeInteger(batchWindow)||batchWindow<1||batchWindow>86400)
      throw fail('Invalid randomness batch window.');
    const ceiling=uint(randomnessQuote.ceiling);
    if(batchWindow!==Number(input.batchWindow)||ceiling!==uint(input.ceiling))
      throw fail('Randomness quote changed after launch inputs were prepared. Re-check the launch.');
    const payout=address(input.payout||wallet),royalty=address(input.royalty||wallet);
    const tuple=[
      String(c.name||''),String(c.symbol||''),String(c.description||''),
      compiled.recipeCount,width,height,layers,payout,royalty,Number(input.royaltyBps),
      feeMode,revealMode,batchWindow,ceiling
    ];
    if(!tuple[0]||!tuple[1])throw fail('Collection name and symbol are required.');
    return Object.freeze({
      tuple:Object.freeze(tuple),
      feeValue:feeMode===1?uint(upfrontFeeWei):'0',
      provenance:hash(compiled.provenance)
    });
  }
  function specHash({scope,wallet,launch,data,hashData,hashText}){
    if(typeof hashData!=='function'||typeof hashText!=='function')throw fail('Launch hashing is unavailable.');
    const dataHash=hash(hashData(data));
    const identity=[
      Number(scope.chainId),address(scope.factory),address(wallet),
      String(scope.releaseId||''),String(scope.manifestHash||'').toLowerCase(),
      hash(launch.provenance),dataHash,uint(launch.feeValue)
    ];
    return hash(hashText(JSON.stringify(identity)));
  }
  function creationEvents(receipt,factory,creator,parseLog){
    if(!receipt||!Array.isArray(receipt.logs)||typeof parseLog!=='function')
      throw fail('The Factory creation receipt is unavailable.');
    const expectedFactory=address(factory),expectedCreator=address(creator);
    const found=[];
    for(const entry of receipt.logs){
      if(!entry?.address||address(entry.address)!==expectedFactory)continue;
      let parsed;
      try{parsed=parseLog(entry);}catch{continue;}
      if(parsed?.name!=='CollectionCreated')continue;
      const args=parsed.args||{};
      const emittedCreator=address(args.creator??args[0]);
      if(emittedCreator!==expectedCreator)throw fail('Factory event creator mismatch.');
      found.push({
        collection:address(args.collection??args[1]),
        data:address(args.dataContract??args.projectData??args[2])
      });
    }
    if(found.length!==1)throw fail('Expected exactly one CollectionCreated event from the verified Factory.');
    return Object.freeze(found[0]);
  }
  function assertBindings(record,verified){
    if(!record||!verified)throw fail('Verified collection bindings are required.');
    for(const [field,value] of [
      ['chainId',verified.chainId],['factory',verified.factory],['wallet',verified.creator],
      ['collectionAddress',verified.collection],['dataAddress',verified.data],
      ['mintPhasesAddress',verified.phases]
    ]){
      const expected=field==='chainId'?Number(value):address(value);
      const current=field==='chainId'?Number(record[field]):address(record[field]);
      if(expected!==current)throw fail('Fresh-launch '+field+' binding mismatch.');
    }
    return true;
  }
  return Object.freeze({address,hash,uint,makeLaunch,specHash,creationEvents,assertBindings});
});
