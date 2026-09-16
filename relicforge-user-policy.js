(() => {
  'use strict';
  let cache=null,flight=null,loadedAt=0;const MAX_AGE=60000;
  async function refresh(force=false){
    if(!window.RelicForgeCloud?.enabled?.())return cache;
    if(!force&&cache&&Date.now()-loadedAt<MAX_AGE)return cache;if(flight)return flight;
    const session=window.RelicForgeCloud.loadSession?.();if(!session?.token)return cache;
    flight=window.RelicForgeCloud.json('/api/policy/me',{},true).then(v=>{cache=v;loadedAt=Date.now();window.dispatchEvent(new CustomEvent('relicforge:user-policy',{detail:v}));return v;}).finally(()=>flight=null);
    return flight;
  }
  function limit(key,fallback){const n=Number(cache?.limits?.[key]);return Number.isFinite(n)&&n>0?n:fallback;}
  const limitBytes=(key,fallback)=>Math.floor(limit(key,fallback));
  const feature=(key,fallback=false)=>typeof cache?.features?.[key]==='boolean'?cache.features[key]:fallback;
  const network=id=>(cache?.networks||[]).find(v=>Number(v.chainId)===Number(id))||null;
  window.RelicForgeUserPolicy=Object.freeze({refresh,limit,limitBytes,feature,network,current:()=>cache});
  for(const event of ['relicforge:wallet-connected','relicforge:cloud-signed-in'])window.addEventListener(event,()=>setTimeout(()=>refresh(true).catch(()=>{}),100));
  setTimeout(()=>refresh().catch(()=>{}),1200);
})();
