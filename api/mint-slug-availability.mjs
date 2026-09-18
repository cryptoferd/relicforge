import { normalizeSlug } from '../rf26-creator-urls-core.js';

const DEFAULT_API='https://relicforge-production.up.railway.app';
const JSON_HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store, max-age=0',
  'x-content-type-options':'nosniff'
};

function json(status,value){
  return new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
}
function apiOrigin(env=process.env){
  const raw=String(env.RF26_PUBLIC_API_BASE||DEFAULT_API).trim();
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)
    throw new Error('Invalid public API origin.');
  return url.origin;
}
function validPayload(value,slug){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    value.slug===slug&&typeof value.available==='boolean'&&
    typeof value.claimed==='boolean'&&typeof value.productionAvailable==='boolean';
}

export function createHandler({fetchImpl=globalThis.fetch,env=process.env,timeoutMs=8000}={}){
  if(typeof fetchImpl!=='function')throw new Error('fetch is required.');
  return async request=>{
    if(request.method!=='GET')return json(405,{error:'Method not allowed.'});
    let slug;
    try{
      const url=new URL(request.url);
      const values=url.searchParams.getAll('slug');
      if(values.length!==1)throw new Error('Invalid slug.');
      slug=normalizeSlug(values[0]);
    }catch(error){
      return json(400,{error:error?.message||'Invalid custom mint URL.'});
    }

    const target=apiOrigin(env)+'/api/public/mint-slugs/'+encodeURIComponent(slug)+'/available';
    try{
      const response=await fetchImpl(target,{
        method:'GET',
        headers:{accept:'application/json'},
        redirect:'error',
        cache:'no-store',
        signal:AbortSignal.timeout(timeoutMs)
      });
      if(!response.ok){
        return json(503,{error:'Mint URL availability service is temporarily unavailable.',upstreamStatus:response.status});
      }
      let payload;
      try{payload=await response.json();}catch{
        return json(503,{error:'Mint URL availability service returned an invalid response.'});
      }
      if(!validPayload(payload,slug)){
        return json(503,{error:'Mint URL availability service returned an invalid response.'});
      }
      return json(200,{
        slug,
        available:payload.available,
        claimed:payload.claimed,
        productionAvailable:payload.productionAvailable
      });
    }catch(error){
      const timeout=error?.name==='TimeoutError'||error?.name==='AbortError';
      return json(503,{
        error:timeout
          ?'Mint URL availability service timed out.'
          :'Mint URL availability service could not be reached.'
      });
    }
  };
}

const handler=createHandler();
export default {fetch:handler};
