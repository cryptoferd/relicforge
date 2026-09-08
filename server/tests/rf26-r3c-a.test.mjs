import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createSlugService,RESOLVE_SQL} from '../src/lib/rf26-slug-service.js';
import {publicTarget} from '../src/lib/rf26-slug-core.js';

const A='0x'+'a'.repeat(40),F='0x'+'f'.repeat(40),P='0x'+'1'.repeat(64);
const policy={kind:'production',launch_enabled:true,public_enabled:true,
 factory_address:F,release_id:'release',release_manifest_hash:'sha256:fixture'};
const record={...policy,chain_id:'1',contract_address:A,owner_wallet:A,
 publication_owner:A,slug:'chrono',listed:false,featured:false,
 architecture:'v2',status:'sealed',provenance:P,deployment_factory:F};

function fixture(row=record){
 const calls=[];
 const one=async(sql,params)=>{
   calls.push({sql,params});
   if(sql!==RESOLVE_SQL)throw new Error('Unexpected SQL');
   return row;
 };
 const service=createSlugService({
   db:{query:async()=>({rows:[]}),connect:async()=>{throw new Error('No writes allowed');}},
   one,networkPolicy:async()=>policy,
   verifyV2:async()=>{throw new Error('No RPC needed for public resolution');},
   readController:async()=>{throw new Error('No controller read needed');}
 });
 return {service,calls};
}
test('runtime SQL has qualified join predicates and preserves the public projection',()=>{
 assert.doesNotMatch(RESOLVE_SQL,/\bUSING\s*\(/i);
 for(const predicate of [
   'c.chain_id=p.chain_id AND c.contract_address=p.contract_address',
   'n.chain_id=c.chain_id',
   'd.chain_id=c.chain_id AND d.contract_address=c.contract_address'
 ])assert.ok(RESOLVE_SQL.includes(predicate));
 assert.match(RESOLVE_SQL,/WHERE p\.slug=\$1/);
 assert.equal((RESOLVE_SQL.match(/\$\d+/g)||[]).join(','),'$1');
 for(const column of ['c.chain_id','c.contract_address','c.owner_wallet',
   'publication_owner','p.slug','p.listed','p.feature_requested','p.featured',
   'n.kind','n.public_enabled','n.launch_enabled','n.factory_address',
   'n.release_id','n.release_manifest_hash','d.architecture','d.status',
   'd.provenance','deployment_factory'])assert.ok(RESOLVE_SQL.includes(column),column);
});
test('unlisted sealed production aliases resolve without changing publication state',async()=>{
 const {service,calls}=fixture();
 const result=await service.resolve(' CHRONO ');
 assert.equal(result.mintPage,'/mint.html?chain=1&contract='+A);
 assert.equal(result.listed,false);
 assert.equal(result.permanent,true);
 assert.deepEqual(calls[0].params,['chrono']);
});
test('missing, disabled, and unsealed records remain hidden',async()=>{
 for(const row of [null,{...record,public_enabled:false},
   {...record,status:'deployed'},{...record,provenance:null},
   {...record,deployment_factory:A},{...record,publication_owner:F}]){
   const {service}=fixture(row);
   await assert.rejects(service.resolve('chrono'),e=>e.statusCode===404&&e.code==='NOT_FOUND');
 }
});
test('runtime returns only the public allowlisted fields',async()=>{
 const {service}=fixture({...record,privateKey:'secret',config:{rpc:'secret'}});
 const result=await service.resolve('chrono');
 assert.deepEqual(Object.keys(result),['chainId','contract','slug','listed','featured','mintPage','permanent']);
 assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('invalid and reserved names fail before any database query',async()=>{
 const {service,calls}=fixture();
 for(const slug of ['a','admin','chrono--relic','0x'+'a'.repeat(40)]){
   await assert.rejects(service.resolve(slug),e=>e.statusCode===400);
 }
 assert.equal(calls.length,0);
});
