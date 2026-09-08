'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_API = 'https://relicforge-production.up.railway.app';
const RESERVED = new Set([
  'admin','api','app','assets','auth','blog','collections','create','dashboard',
  'docs','ethereum','explore','favicon','forge','help','home','how-to','index',
  'login','logout','mainnet','mint','new','profile','projects','relicforge',
  'reliquary','settings','static','studio','support','test','testnet','upcoming',
  'v1','v2','www','sepolia'
]);
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CACHE = 'no-store, max-age=0';
const HTML_TYPE = 'text/html; charset=utf-8';

class RouteError extends Error {
  constructor(status,code) { super(code); this.status=status; this.code=code; }
}
const reject=(status,code)=>{throw new RouteError(status,code);};
function normalizeSlug(value) {
  if(typeof value!=='string')reject(400,'INVALID_SLUG');
  let slug=value;
  if(slug.includes('%')) {
    try { slug=decodeURIComponent(slug); }catch { reject(400,'INVALID_SLUG'); }
  }
  slug=slug.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug)||
     slug.includes('--')||RESERVED.has(slug)||ADDRESS.test(slug))
    reject(400,'INVALID_SLUG');
  return slug;
}
function normalizeAddress(value) {
  const address=String(value||'').toLowerCase();
  if(!ADDRESS.test(address)||/^0x0{40}$/.test(address))reject(502,'INVALID_TARGET');
  return address;
}
function canonicalPath(chainId,contract) {
  return `/mint.html?chain=${chainId}&contract=${contract}`;
}
function validateTarget(value,slug) {
  if(!value||typeof value!=='object'||Array.isArray(value))reject(502,'INVALID_TARGET');
  if(value.permanent!==true||Number(value.chainId)!==1||
     value.slug!==slug)reject(502,'INVALID_TARGET');
  const contract=normalizeAddress(value.contract);
  if(value.mintPage!==canonicalPath(1,contract))reject(502,'INVALID_TARGET');
  return Object.freeze({chainId:1,contract,slug});
}
function originOf(value,{allowHttp=false}={}) {
  const url=new URL(String(value));
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||
     (url.protocol!=='https:'&&!(allowHttp&&url.protocol==='http:')))
    throw new Error('Invalid configured origin.');
  return url.origin;
}
function getApiOrigin(env=process.env) {
  return originOf(env.RF26_PUBLIC_API_BASE||DEFAULT_API);
}
function getSiteOrigin(env=process.env) {
  const configured=env.RF26_PUBLIC_SITE_ORIGIN;
  if(configured)return originOf(configured);
  const host=(env.VERCEL_ENV==='production'?env.VERCEL_PROJECT_PRODUCTION_URL:null)||env.VERCEL_URL||env.VERCEL_PROJECT_PRODUCTION_URL;
  if(!host)throw new Error('No verified public site origin is configured.');
  return originOf('https://'+host.replace(/^https?:\/\//,''));
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
function jsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,ch=>({
    '<':'\\u003c','>':'\\u003e','&':'\\u0026','\u2028':'\\u2028','\u2029':'\\u2029'
  }[ch]));
}
function cleanText(value,max=240) {
  if(typeof value!=='string')return '';
  return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function metadataFromConfig(value,slug) {
  const config=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const name=cleanText(config.name||config.collectionName||config.title,100)||
    slug.split('-').map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ');
  const description=cleanText(config.description||config.collectionDescription,300)||
    'Explore and mint this onchain collection, created with Relic Forge.';
  return {name,description,imageIds:[config.collectionImageAssetId,config.bannerImageAssetId]
    .filter(id=>typeof id==='string'&&UUID.test(id)).slice(0,2)};
}

async function readLimitedJson(response,maxBytes=2500000) {
  const length=Number(response.headers?.get?.('content-length')||0);
  if(length>maxBytes)reject(502,'UPSTREAM_TOO_LARGE');
  let bytes;
  if(response.body&&typeof response.body.getReader==='function') {
    const reader=response.body.getReader(),chunks=[];let total=0;
    try {
      while(true) {
        const {done,value}=await reader.read();
        if(done)break;
        total+=value.byteLength;
        if(total>maxBytes){await reader.cancel();reject(502,'UPSTREAM_TOO_LARGE');}
        chunks.push(Buffer.from(value));
      }
      bytes=Buffer.concat(chunks,total);
    }finally{reader.releaseLock();}
  }else {
    const text=await response.text();
    bytes=Buffer.from(text);
    if(bytes.length>maxBytes)reject(502,'UPSTREAM_TOO_LARGE');
  }
  try{return JSON.parse(bytes.toString('utf8'));}catch{reject(502,'UPSTREAM_INVALID_JSON');}
}

function createFetcher(fetchImpl,{timeout=8000}={}) {
  return async(url,method='GET')=>{
    return fetchImpl(url,{method,redirect:'error',credentials:'omit',
      headers:{accept:method==='HEAD'?'image/png,image/jpeg':'application/json'},
      signal:AbortSignal.timeout(timeout),cache:'no-store'});
  };
}
async function fetchPublicTarget(slug,apiOrigin,fetcher) {
  const response=await fetcher(`${apiOrigin}/api/public/mint-slugs/${encodeURIComponent(slug)}`);
  if(response.status===404)return null;
  if(!response.ok)reject(503,'UPSTREAM_UNAVAILABLE');
  return validateTarget(await readLimitedJson(response,65536),slug);
}
async function fetchMetadata(target,apiOrigin,fetcher,siteOrigin) {
  let config={};
  try {
    const response=await fetcher(`${apiOrigin}/api/public/mint/1/${target.contract}/config`);
    if(response.ok) {
      const payload=await readLimitedJson(response);
      if(payload?.published===true)config=payload.config||{};
    }
  }catch(error) {
    // Metadata is optional. Never replace a verified target with unverified data.
  }
  const meta=metadataFromConfig(config,target.slug);
  const fallback=`${siteOrigin}/relic-forge-preview.png`;
  let image=fallback,imageType='image/png';
  for(const id of meta.imageIds) {
    const candidate=`${apiOrigin}/api/public/assets/${id}`;
    try {
      const response=await fetcher(candidate,'HEAD');
      const type=String(response.headers?.get?.('content-type')||'').split(';')[0].trim().toLowerCase();
      const size=Number(response.headers?.get?.('content-length')||0);
      if(response.ok&&['image/png','image/jpeg'].includes(type)&&(!size||size<=5000000)) {
        image=candidate;imageType=type;break;
      }
    }catch{}
  }
  return {...meta,image,imageType};
}

const META_NAMES=new Set(['description','twitter:card','twitter:title','twitter:description','twitter:image','twitter:image:alt']);
const META_PROPERTIES=new Set(['og:type','og:site_name','og:title','og:description','og:url','og:image','og:image:type','og:image:width','og:image:height','og:image:alt']);
function attr(tag,name) {
  const match=tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,'i'));
  return match?match[1]??match[2]:null;
}
function replaceHead(template,markup) {
  const start=template.search(/<head(?:\s[^>]*)?>/i);
  const end=template.search(/<\/head\s*>/i);
  if(start<0||end<=start||(template.match(/<\/head\s*>/gi)||[]).length!==1)
    throw new Error('Unexpected mint HTML template.');
  const open=template.slice(start).match(/^<head(?:\s[^>]*)?>/i)[0];
  let head=template.slice(start+open.length,end);
  head=head.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi,'');
  head=head.replace(/<meta\b[^>]*>/gi,tag=>{
    const name=attr(tag,'name')?.toLowerCase(),property=attr(tag,'property')?.toLowerCase();
    return META_NAMES.has(name)||META_PROPERTIES.has(property)?'':tag;
  });
  head=head.replace(/<link\b[^>]*>/gi,tag=>
    (attr(tag,'rel')||'').toLowerCase()==='canonical'||(attr(tag,'rel')||'').toLowerCase()==='base'?'':tag);
  head=head.replace(/<base\b[^>]*>/gi,'');
  return template.slice(0,start)+open+'\n<base href="/">\n'+markup+head+template.slice(end);
}
function renderMintHtml(template,target,meta,siteOrigin) {
  const canonical=`${siteOrigin}/mint/${encodeURIComponent(target.slug)}`;
  const title=`${meta.name} — Relic Forge`;
  const tags=[
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Relic Forge">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:image" content="${escapeHtml(meta.image)}">`,
    `<meta property="og:image:type" content="${escapeHtml(meta.imageType)}">`,
    `<meta property="og:image:alt" content="${escapeHtml(meta.name)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(meta.image)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(meta.name)}">`,
    '<script id="rf26-mint-target" type="application/json">'+jsonForHtml(target)+'</script>'
  ].join('\n');
  return replaceHead(template,tags+'\n');
}
function errorPage(status) {
  const missing=status===404;
  const title=missing?'Mint page not found':'Mint page temporarily unavailable';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Relic Forge</title></head><body style="margin:0;background:#080808;color:#eee;font:16px/1.6 system-ui;padding:8vw;max-width:680px"><h1>${title}</h1><p>${missing?'This mint URL is not available.':'Please try again shortly.'}</p><a style="color:#ccc" href="/">Return to Relic Forge</a></body></html>`;
}
function send(res,status,body,{head=false,headers={}}={}) {
  res.statusCode=status;
  res.setHeader('Content-Type',HTML_TYPE);
  res.setHeader('Cache-Control',CACHE);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Robots-Tag',status===200?'noarchive':'noindex, nofollow, noarchive');
  res.setHeader('Vary','Accept-Encoding');
  for(const [key,value]of Object.entries(headers))if(value!=null)res.setHeader(key,value);
  res.end(head?'':body);
}
function createHandler({fetchImpl=globalThis.fetch,readTemplate,env=process.env}={}) {
  if(typeof fetchImpl!=='function'||typeof readTemplate!=='function')throw new Error('Missing mint route dependencies.');
  return async(req,res)=>{
    const head=req.method==='HEAD';
    if(req.method!=='GET'&&!head) {
      res.setHeader('Allow','GET, HEAD');
      return send(res,405,errorPage(404),{head});
    }
    let slug;
    try {
      const raw=req.query?.slug;
      if(Array.isArray(raw))reject(400,'INVALID_SLUG');
      slug=normalizeSlug(raw);
    }catch{return send(res,404,errorPage(404),{head});}
    try {
      const apiOrigin=getApiOrigin(env),siteOrigin=getSiteOrigin(env);
      const fetcher=createFetcher(fetchImpl);
      const target=await fetchPublicTarget(slug,apiOrigin,fetcher);
      if(!target)return send(res,404,errorPage(404),{head});
      const meta=await fetchMetadata(target,apiOrigin,fetcher,siteOrigin);
      const html=renderMintHtml(await readTemplate(),target,meta,siteOrigin);
      return send(res,200,html,{head});
    }catch(error) {
      // Do not leak upstream error bodies, credentials, unpublished metadata,
      // network settings, or contract identities in error responses.
      const status=error instanceof RouteError&&error.status===404?404:503;
      return send(res,status,errorPage(status),{head,headers:{'Retry-After':status===503?'30':undefined}});
    }
  };
}
function readMintTemplate() {
  const candidates=[path.resolve(process.cwd(),'mint.html'),path.resolve(__dirname,'mint.html')];
  for(const file of candidates)if(fs.existsSync(file))return fs.readFileSync(file,'utf8');
  throw new Error('mint.html was not included in the function bundle.');
}

function createWebHandler(options) {
  const handler=createHandler(options);
  return async request=>{
    const url=new URL(request.url);
    const slugs=url.searchParams.getAll('slug');
    const headers=new Headers();
    const response={
      statusCode:200,body:'',
      setHeader(name,value){headers.set(name,String(value));},
      end(value){this.body=value??'';}
    };
    await handler({method:request.method,query:{slug:slugs.length>1?slugs:slugs[0]}},response);
    return new Response(request.method==='HEAD'?null:response.body,{
      status:response.statusCode,headers
    });
  };
}

module.exports={RESERVED_SLUGS:Object.freeze([...RESERVED]),createHandler,createWebHandler,readMintTemplate,normalizeSlug,normalizeAddress,validateTarget,
  canonicalPath,originOf,getApiOrigin,getSiteOrigin,escapeHtml,jsonForHtml,cleanText,
  metadataFromConfig,renderMintHtml,fetchPublicTarget,fetchMetadata,readLimitedJson,RouteError};
