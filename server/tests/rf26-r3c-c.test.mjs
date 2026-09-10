import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const route=require('../../rf26-mint-route.cjs');
const contextModule={exports:{}};
new Function('module',fs.readFileSync(new URL('../../rf26-mint-context.js',import.meta.url),'utf8'))(contextModule);
const context=contextModule.exports;
const root=new URL('../../',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,root),'utf8');
const A='0x'+'a'.repeat(40);
const target={chainId:1,contract:A,slug:'chrono-relic',permanent:true,
 mintPage:`/mint.html?chain=1&contract=${A}`};
test('R3C-C is routed through the exact public Vercel function',()=>{
 const config=JSON.parse(read('vercel.json'));
 assert.equal(config.cleanUrls,true);
 assert.equal(config.rewrites.filter(r=>r.source==='/mint/:slug').length,1);
 assert.equal(config.rewrites.find(r=>r.source==='/mint/:slug').destination,'/api/mint-link?slug=:slug');
 assert.equal(config.functions['api/mint-link.mjs'].includeFiles,'mint.html');
});
test('canonical mint initialization is preserved and verified aliases take precedence',()=>{
 const source=read('mint.js');
 assert.match(source,/const routeTarget = window\.RelicForgeMintContext\?\.read\?\.\(\) \|\| null/);
 assert.match(source,/const localKey = !routeTarget && requestedContract/);
 assert.match(source,/routeTarget\?\.chainId \|\| embedded\.chainId \|\| params\.get\('chain'\)/);
 assert.match(source,/const PUBLIC_RPC_FALLBACKS/);
 assert.match(source,/const ABI = \[/);
 const html=read('mint.html');
 assert.ok(html.indexOf('rf26-mint-context.js')<html.indexOf('mint.js?v=11.1.6-r2v2'));
 assert.equal((html.match(/rf26-mint-context\.js/g)||[]).length,1);
});
test('browser context accepts only the verified Ethereum target and preserves direct links',()=>{
 assert.equal(context.read({getElementById:()=>null}),null);
 const result=context.read({getElementById:()=>({textContent:JSON.stringify(target)})});
 assert.deepEqual(result,{chainId:1,contract:A,slug:'chrono-relic'});
 assert.equal(route.canonicalPath(result.chainId,result.contract),`/mint.html?chain=1&contract=${A}`);
 assert.throws(()=>context.read({getElementById:()=>({textContent:JSON.stringify({...target,chainId:11155111})})}));
});
test('the installed route fails closed for an unverified collection',async()=>{
 const handler=route.createWebHandler({
  env:{RF26_PUBLIC_API_BASE:'https://api.example.test',RF26_PUBLIC_SITE_ORIGIN:'https://site.example.test'},
  readTemplate:()=>read('mint.html'),
  fetchImpl:async()=>new Response(JSON.stringify({error:'Not found'}),{status:404,headers:{'content-type':'application/json'}})
 });
 const response=await handler(new Request('https://site.example.test/api/mint-link?slug=chrono-relic'));
 assert.equal(response.status,404);
 assert.match(response.headers.get('x-robots-tag'),/noindex/);
 assert.doesNotMatch(await response.text(),/rf26-mint-target/);
});
test('Studio has a safe Open link and no production activation or migration changes',()=>{
 const ui=read('rf26-creator-urls.js');
 assert.match(ui,/rf26CreatorUrlOpenClaimed/);
 assert.match(ui,/open\.href=slugUrl\(view\.slug\)/);
 assert.match(ui,/rel="noopener noreferrer"/);
 assert.doesNotMatch(ui,/short-link web route is finalized in the next/);
 const code=read('rf26-mint-route.cjs');
 assert.doesNotMatch(code,/DATABASE_URL|ALCHEMY_API_KEY|privateKey|eth_sendTransaction|eth_sendRawTransaction/);
});
