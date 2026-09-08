(function(){
  'use strict';
  const core=window.RF26CreatorGuardCore;
  if(!core)throw new Error('RF26 creator policy core is unavailable.');
  const fail=(message,code='RF26_CREATOR_SCOPE')=>Object.assign(new Error(message),{code});
  const net=()=>{if(!window.RelicForgeForgeNetwork)throw fail('Verified Forge network runtime is unavailable.');return window.RelicForgeForgeNetwork;};
  const eq=(a,b)=>core.address(a)===core.address(b);
  const selector=signature=>window.ethers.id(signature).slice(0,10).toLowerCase();

  async function read(collection,{chainId=null}={}){
    const n=net(),scope=await n.requireReady();
    if(chainId!=null&&core.chain(chainId)!==scope.chainId)throw fail('Creator-control network mismatch.');
    const verified=await n.verifyCollection(core.address(collection),{chainId:scope.chainId});
    if(n.scope()!==scope)throw fail('Network release changed during collection verification.');
    const context={scope,identity:core.identity(scope,verified)};
    return Object.freeze({...context,assert:()=>check(context)});
  }
  async function check(context,{wallet=null,role=null}={}){
    const n=net(),scope=await n.requireReady();
    if(scope!==context.scope)throw fail('Creator-control release changed. Reopen the collection.');
    const verified=await n.verifyCollection(context.identity.collection,{chainId:scope.chainId});
    const current=core.identity(scope,verified);
    if(!core.sameIdentity(context.identity,current))throw fail('Collection, Factory, controller or release bindings changed. Reopen the collection.');
    if(wallet!=null){
      if(!n.account()||!eq(n.account(),wallet))throw fail('Creator wallet session changed.');
      if(role)core.actor(current,wallet,role);
    }
    return context;
  }
  async function account(collection,{role='creator',chainId=null}={}){
    let context=await read(collection,{chainId});
    let wallet=net().account();
    if(!wallet){
      const result=await net().connect({requireLaunch:false});
      wallet=result.wallet;
      context=await read(collection,{chainId});
    }
    core.actor(context.identity,wallet,role);
    await check(context,{wallet,role});
    return Object.freeze({...context,wallet:core.address(wallet),role,
      assert:()=>check(context,{wallet,role})});
  }
  async function signer(collection,{controller=null,chainId=11155111}={}){
    let context=await read(collection,{chainId});
    if(context.scope.chainId!==11155111)throw fail('Mainnet creator transactions remain locked.','RF26_NETWORK_LOCKED');
    if(controller&&core.address(controller)!==context.identity.controller)throw fail('The displayed controller is stale.');
    let n=net(),authorized;
    try{authorized=n.writeSigner();}catch{}
    if(!authorized||!n.account()||!eq(n.account(),context.identity.controller)){
      await n.connect({requireLaunch:true});
      context=await read(collection,{chainId});
      n=net();
    }
    const wallet=core.actor(context.identity,n.account(),'controller');
    authorized=n.writeSigner();
    await n.assertWrite();
    await check(context,{wallet,role:'controller'});
    const original=authorized,identity=context.identity;
    let proxy;
    const validate=async tx=>{
      await n.assertWrite();
      await check(context,{wallet,role:'controller'});
      core.transaction(identity,tx,selector);
      return true;
    };
    proxy=new Proxy(original,{
      get(target,key){
        if(key==='sendTransaction')return async tx=>{
          const release=n.enter();
          try{
            await validate(tx);
            const sent=await target.sendTransaction({...tx,chainId:identity.chainId});
            return new Proxy(sent,{get(response,property){
              if(property==='wait')return async(...args)=>{
                const receipt=await response.wait(...args);
                await check(context,{wallet,role:'controller'});
                return receipt;
              };
              const value=Reflect.get(response,property,response);
              return typeof value==='function'?value.bind(response):value;
            }});
          }finally{release();}
        };
        if(key==='populateTransaction')return async tx=>{
          await validate(tx);
          return target.populateTransaction({...tx,chainId:identity.chainId});
        };
        if(key==='signTransaction')return ()=>{throw fail('Raw transaction signing is not available through creator controls.');};
        if(key==='connect')return provider=>{
          if(provider!==target.provider)throw fail('Reconnect through the verified wallet session to change providers.');
          return proxy;
        };
        const value=Reflect.get(target,key,target);
        return typeof value==='function'?value.bind(target):value;
      }
    });
    return proxy;
  }
  async function withPublication(collection,callback){
    if(typeof callback!=='function')throw fail('A publication callback is required.');
    const session=await account(collection,{role:'creator',chainId:11155111});
    const assert=()=>session.assert();
    await assert();
    return callback(Object.freeze({identity:session.identity,wallet:session.wallet,assert}));
  }
  window.RF26CreatorGuard=Object.freeze({read,account,signer,withPublication});
})();
