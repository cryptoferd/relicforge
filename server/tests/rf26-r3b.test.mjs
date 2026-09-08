import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  normalizeSlug,productionPolicy,publicTarget,canonicalMintPath,RESERVED_SLUGS
} from '../src/lib/rf26-slug-core.js';
import {createSlugService} from '../src/lib/rf26-slug-service.js';

const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40),F='0x'+'f'.repeat(40);
const P='0x'+'1'.repeat(64);
const policy={chain_id:1,kind:'production',launch_enabled:true,public_enabled:true,
 factory_address:F,release_id:'release-1',release_manifest_hash:'sha256:test'};
const key=(id,contract)=>id+':'+contract.toLowerCase();
const copy=x=>structuredClone(x);
function fixture({enabled=true,sealed=true,controller=A}={}){
  const state={network:{...policy,public_enabled:enabled},controller,publications:new Map(),
    deployments:new Map(),sql:[],nextFailure:null};
  const deployment=(contract,owner=A)=>({
    chain_id:1,contract_address:contract,owner_wallet:owner,collection_owner:owner,
    project_id:'00000000-0000-4000-8000-000000000001',
    architecture:'v2',status:sealed?'sealed':'deployed',
    factory_address:F,provenance:sealed?P:null
  });
  state.deployments.set(key(1,B),deployment(B));
  state.deployments.set(key(1,C),deployment(C,C));
  let lock=Promise.resolve();
  const db={
    async query(sql,params=[]){
      state.sql.push({sql,params});
      if(sql.includes('SELECT chain_id FROM rf26_networks'))return {rows:enabled?[{chain_id:1}]:[]};
      throw new Error('Unexpected query: '+sql);
    },
    async connect(){
      let release;
      const prior=lock;
      lock=new Promise(resolve=>{release=resolve;});
      await prior;
      const staged=new Map([...state.publications].map(([k,v])=>[k,copy(v)]));
      let active=false;
      return {
        async query(sql,params=[]){
          state.sql.push({sql,params});
          if(sql==='BEGIN'){active=true;return {rows:[]};}
          if(sql==='COMMIT'){state.publications=staged;active=false;return {rows:[]};}
          if(sql==='ROLLBACK'){active=false;return {rows:[]};}
          if(sql.includes('FOR UPDATE'))return {rows:staged.has(key(params[0],params[1]))?[copy(staged.get(key(params[0],params[1])))]:[]};
          if(sql.includes('INSERT INTO rf26_publications')){
            if(state.nextFailure){const e=state.nextFailure;state.nextFailure=null;throw e;}
            const [id,contract,owner]=params,k=key(id,contract);
            const current=staged.get(k);
            if(current&&current.owner_wallet!==owner)return {rows:[]};
            if(sql.includes('slug=EXCLUDED.slug')){
              const slug=params[3];
              if(current?.slug&&current.slug!==slug)return {rows:[]};
              if([...staged].some(([other,row])=>other!==k&&row.slug===slug)){
                const e=new Error('unique');e.code='23505';throw e;
              }
              const next={...(current||{}),chain_id:id,contract_address:contract,owner_wallet:owner,
                slug,listed:current?.listed||false,feature_requested:current?.feature_requested||false,featured:current?.featured||false};
              staged.set(k,next);return {rows:[copy(next)]};
            }
            const listed=params[3],requested=params[4];
            const next={...(current||{}),chain_id:id,contract_address:contract,owner_wallet:owner,
              listed,feature_requested:requested,featured:Boolean(current?.featured&&listed&&requested)};
            staged.set(k,next);return {rows:[copy(next)]};
          }
          throw new Error('Unexpected transactional query: '+sql);
        },
        release(){release();}
      };
    }
  };
  async function one(sql,params=[]){
    state.sql.push({sql,params});
    if(sql.includes('FROM rf26_deployments d JOIN collections c')){
      const row=state.deployments.get(key(params[0],params[1]));return row?copy(row):null;
    }
    if(sql.includes('SELECT 1 FROM rf26_publications')){
      return [...state.publications.values()].some(p=>p.slug===params[0])?{one:1}:null;
    }
    if(sql.includes('SELECT * FROM rf26_publications')){
      const row=state.publications.get(key(params[0],params[1]));return row?copy(row):null;
    }
    if(sql.includes('FROM rf26_publications p')){
      const row=[...state.publications.values()].find(p=>p.slug===params[0]);if(!row)return null;
      const d=state.deployments.get(key(row.chain_id,row.contract_address));
      return {...row,...state.network,chain_id:row.chain_id,
        publication_owner:row.owner_wallet,owner_wallet:d.owner_wallet,
        architecture:d.architecture,status:d.status,provenance:d.provenance,
        deployment_factory:d.factory_address};
    }
    throw new Error('Unexpected read: '+sql);
  }
  const service=createSlugService({db,one,
    networkPolicy:async()=>copy(state.network),
    verifyV2:async(id,contract)=>{const d=state.deployments.get(key(id,contract));
      return {creator:d.owner_wallet,factory:F,sealed,provenance:sealed?P:null};},
    readController:async()=>state.controller
  });
  return {state,service};
}
async function rejects(promise,status,code){
  await assert.rejects(promise,e=>e.statusCode===status&&(!code||e.code===code));
}
test('canonical slug policy rejects short, malformed, reserved, and address-like names',()=>{
  assert.equal(normalizeSlug('  Chrono-Relic '),'chrono-relic');
  assert.equal(normalizeSlug('abc'),'abc');
  assert.equal(normalizeSlug('a'.repeat(48)),'a'.repeat(48));
  for(const value of ['ab','a'.repeat(49),'abc--def','-abc','abc-','abc_def','a b c','0x'+'a'.repeat(40),null,2])
    assert.throws(()=>normalizeSlug(value));
  for(const name of RESERVED_SLUGS)assert.throws(()=>normalizeSlug(name),name);
  assert.equal(canonicalMintPath(1,B),'/mint.html?chain=1&contract='+B);
});
test('production gating rejects missing release fields and testnets',()=>{
  for(const field of ['launch_enabled','public_enabled','factory_address','release_id','release_manifest_hash']){
    assert.throws(()=>productionPolicy({...policy,[field]:null}),e=>e.statusCode===403);
  }
  assert.throws(()=>productionPolicy({...policy,kind:'testnet'}));
});
test('availability is global, normalized, and does not reserve a name',async()=>{
  const {service,state}=fixture();
  assert.deepEqual(await service.availability('Chrono'),{slug:'chrono',available:true,claimed:false,productionAvailable:true});
  assert.equal(state.publications.size,0);
  state.publications.set(key(1,B),{slug:'chrono'});
  assert.equal((await service.availability('CHRONO')).available,false);
  assert.equal((await fixture({enabled:false}).service.availability('chrono')).productionAvailable,false);
});
test('disabled production and unsealed deployments cannot claim',async()=>{
  await rejects(fixture({enabled:false}).service.claim(1,B,A,{slug:'chrono'}),403);
  await rejects(fixture({sealed:false}).service.claim(1,B,A,{slug:'chrono'}),409);
  await rejects(fixture().service.claim(11155111,B,A,{slug:'chrono'}),404);
});
test('only authenticated active controller can claim; creator attribution is immutable',async()=>{
  const {service,state}=fixture({controller:C});
  await rejects(service.claim(1,B,A,{slug:'chrono'}),403);
  const result=await service.claim(1,B,C,{slug:'chrono'});
  assert.equal(result.mintPage,'/mint/chrono');
  assert.equal(state.publications.get(key(1,B)).owner_wallet,A);
  assert.equal((await service.getPublication(1,B,C)).publication.slug,'chrono');
  await rejects(service.getPublication(1,B,A),403);
});
test('claims are permanent and idempotent, including same-collection races',async()=>{
  const {service,state}=fixture();
  const results=await Promise.allSettled([
    service.claim(1,B,A,{slug:'first'}),
    service.claim(1,B,A,{slug:'second'})
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.statusCode===409).length,1);
  const winner=state.publications.get(key(1,B)).slug;
  assert.equal((await service.claim(1,B,A,{slug:winner})).slug,winner);
  await rejects(service.claim(1,B,A,{slug:winner==='first'?'second':'first'}),409,'SLUG_PERMANENT');
});
test('cross-collection uniqueness is enforced by the database',async()=>{
  const {service,state}=fixture();
  await service.claim(1,B,A,{slug:'chrono'});
  state.controller=C;
  await rejects(service.claim(1,C,C,{slug:'chrono'}),409,'SLUG_TAKEN');
  assert.equal(state.publications.size,1);
});
test('conflict rollback preserves the old claim and releases the transaction',async()=>{
  const {service,state}=fixture();
  await service.claim(1,B,A,{slug:'chrono'});
  state.nextFailure=Object.assign(new Error('database failure'),{code:'XX001'});
  await assert.rejects(service.claim(1,B,A,{slug:'chrono'}),/database failure/);
  assert.equal(state.publications.get(key(1,B)).slug,'chrono');
  assert.equal((await service.claim(1,B,A,{slug:'chrono'})).permanent,true);
});
test('project mismatch, spoofed owner and Factory mismatch are denied',async()=>{
  const {service,state}=fixture();
  await rejects(service.claim(1,B,A,{slug:'chrono',projectId:'00000000-0000-4000-8000-000000000002'}),409);
  state.deployments.get(key(1,B)).owner_wallet=C;
  await rejects(service.claim(1,B,A,{slug:'chrono'}),409);
  state.deployments.get(key(1,B)).owner_wallet=A;
  state.deployments.get(key(1,B)).factory_address=C;
  await rejects(service.claim(1,B,A,{slug:'chrono'}),409);
});
test('publication is opt-in; featuring cannot be self-approved or preserved after withdrawal',async()=>{
  const {service,state}=fixture();
  await rejects(service.setPublication(1,B,A,{listed:true,featureRequested:true,featured:true}),400);
  await service.setPublication(1,B,A,{listed:true,featureRequested:true});
  let p=state.publications.get(key(1,B));
  assert.equal(p.featured,false);
  p.featured=true;
  await service.setPublication(1,B,A,{listed:false,featureRequested:true});
  p=state.publications.get(key(1,B));
  assert.deepEqual([p.listed,p.feature_requested,p.featured],[false,false,false]);
});
test('public resolution permits unlisted sealed production aliases but hides invalid records',async()=>{
  const {service,state}=fixture();
  await service.claim(1,B,A,{slug:'chrono'});
  assert.equal((await service.resolve('CHRONO')).listed,false);
  state.network.public_enabled=false;
  await rejects(service.resolve('chrono'),404);
  state.network.public_enabled=true;
  state.deployments.get(key(1,B)).status='deployed';
  await rejects(service.resolve('chrono'),404);
  state.deployments.get(key(1,B)).status='sealed';
  state.deployments.get(key(1,B)).factory_address=C;
  await rejects(service.resolve('chrono'),404);
});
test('no private release settings, credentials, or untrusted JSON appear in public target',()=>{
  const row={...policy,chain_id:1,contract_address:B,owner_wallet:A,publication_owner:A,
    deployment_factory:F,architecture:'v2',status:'sealed',provenance:P,slug:'chrono',
    listed:false,featured:false,configuration:{apiKey:'secret'},privateKey:'secret'};
  const result=publicTarget(row);
  assert.equal(JSON.stringify(result).includes('secret'),false);
  assert.deepEqual(Object.keys(result),['chainId','contract','slug','listed','featured','mintPage','permanent']);
});
