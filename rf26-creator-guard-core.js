(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RF26CreatorGuardCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const ADDRESS=/^0x[0-9a-f]{40}$/i;
  const ZERO='0x'+'0'.repeat(40);
  const fail=(message,code='RF26_CREATOR_SCOPE')=>Object.assign(new Error(message),{code});
  function address(value){
    const v=String(value||'').toLowerCase();
    if(!ADDRESS.test(v)||/^0x0{40}$/.test(v))throw fail('Invalid nonzero creator-control address.');
    return v;
  }
  function controllerAddress(value){
    const v=String(value||'').toLowerCase();
    return v===ZERO?ZERO:address(v);
  }
  function chain(value){
    const n=typeof value==='string'&&/^0x[0-9a-f]+$/i.test(value)?Number(BigInt(value)):Number(value);
    if(!Number.isSafeInteger(n)||![1,11155111].includes(n))throw fail('Unsupported creator-control network.');
    return n;
  }
  function identity(scope,verified){
    if(!scope||!verified)throw fail('A verified release and collection are required.');
    const id=chain(scope.chainId);
    if(chain(verified.chainId)!==id||address(scope.factory)!==address(verified.factory))
      throw fail('Collection Factory or network does not match the selected release.');
    const result={
      chainId:id,factory:address(scope.factory),collection:address(verified.collection),
      creator:address(verified.creator),controller:controllerAddress(verified.controller),
      data:address(verified.data),phases:address(verified.phases),
      releaseId:String(scope.releaseId||''),manifestHash:String(scope.manifestHash||'').toLowerCase()
    };
    if(id===1&&(!result.releaseId||!/^([0-9a-f]{64})$/.test(result.manifestHash)))
      throw fail('Production creator controls require a certified release identity.');
    return Object.freeze(result);
  }
  function sameIdentity(a,b){
    return Object.keys(a).every(key=>a[key]===b[key]);
  }
  function actor(identityValue,wallet,role='controller'){
    const expected=role==='creator'?identityValue.creator:role==='controller'?identityValue.controller:null;
    if(!expected)throw fail('Unsupported creator-control role.');
    if(expected===ZERO)throw fail('Collection control has been renounced.','RF26_CREATOR_UNAUTHORIZED');
    if(address(wallet)!==expected)throw fail('The connected wallet is not the active '+role+'.','RF26_CREATOR_UNAUTHORIZED');
    return address(wallet);
  }
  function transaction(identityValue,tx,hashSelector){
    if(identityValue.chainId!==11155111)
      throw fail('Mainnet creator transactions remain locked pending lifecycle certification.','RF26_NETWORK_LOCKED');
    if(!tx||typeof hashSelector!=='function')throw fail('A populated creator transaction is required.');
    if(tx.chainId!=null&&chain(tx.chainId)!==identityValue.chainId)throw fail('Creator transaction chain mismatch.');
    const to=address(tx.to);
    if(to!==identityValue.phases)throw fail('Stage Manager may write only to this collection’s verified MintPhases contract.');
    const data=String(tx.data||'0x').toLowerCase();
    if(!/^0x(?:[0-9a-f]{2})*$/.test(data)||data.length<10)throw fail('Invalid creator transaction calldata.');
    const permitted=[
      'createPhase(uint96,uint64,uint64,uint32,uint32,bytes32,uint8,uint16,bool)',
      'updatePhase(uint32,uint96,uint64,uint64,uint32,uint32,bytes32,uint8,uint16)'
    ].map(hashSelector);
    if(!permitted.includes(data.slice(0,10)))throw fail('This creator transaction method is not certified for the R4 Stage Manager.');
    let value;try{value=BigInt(tx.value??0);}catch{throw fail('Invalid transaction value.');}
    if(value!==0n)throw fail('Stage Manager transactions must not transfer ETH.');
    return true;
  }
  return Object.freeze({address,chain,identity,sameIdentity,actor,transaction});
});
