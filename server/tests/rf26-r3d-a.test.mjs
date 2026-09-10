import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  PRODUCTION_MANIFEST_SCHEMA,REQUIRED_PRODUCTION_ADDRESSES,
  publicForgeNetwork,requireProductionRelease
} from '../src/lib/rf26-release-preflight.js';

const ROOT=new URL('../../',import.meta.url);
const read=relative=>fs.readFileSync(new URL(relative,ROOT),'utf8');
const A='0x'+'1'.repeat(40);
const H='0x'+'a'.repeat(64);
const addresses=Object.fromEntries(REQUIRED_PRODUCTION_ADDRESSES.map((key,i)=>[key,'0x'+String(i+2).repeat(40).slice(0,40)]));

test('checked-in Mainnet browser registry remains explicitly disabled and address-empty',()=>{
  const context={window:{}};vm.createContext(context);
  vm.runInContext(read('relicforge-v2-addresses.js'),context);
  const config=context.window.RELICFORGE_V2_ADDRESSES[1];
  assert.equal(config.chainId,1);
  assert.equal(config.environment,'not-deployed');
  assert.equal(config.launchEnabled,false);
  assert.equal(config.releaseId,'');
  assert.equal(config.deploymentManifestHash,'');
  for(const key of ['factory',...REQUIRED_PRODUCTION_ADDRESSES])assert.equal(config[key],'',key);
});

test('Sepolia certified configuration is preserved exactly as a separate testnet release',()=>{
  const context={window:{}};vm.createContext(context);
  vm.runInContext(read('relicforge-v2-addresses.js'),context);
  const config=context.window.RELICFORGE_V2_ADDRESSES[11155111];
  assert.equal(config.launchEnabled,true);
  assert.equal(config.factory.toLowerCase(),'0x2d63a398c037fe9ea09c7176eab378c5a51fa88d');
  assert.equal(config.environment,'certified-preproduction');
});

test('server release contract fails closed for the currently disabled production row',()=>{
  const row={chain_id:1,label:'Ethereum Mainnet',kind:'production',launch_enabled:false,public_enabled:false,
    factory_address:null,release_id:null,release_manifest_hash:null,configuration:{}};
  const publicRow=publicForgeNetwork(row);
  assert.equal(publicRow.launchEnabled,false);
  assert.equal(publicRow.publicEnabled,false);
  assert.equal(publicRow.release.state,'locked');
  assert.equal(publicRow.release.configured,false);
  assert.throws(()=>requireProductionRelease(row),error=>error.code==='PRODUCTION_RELEASE_LOCKED');
});

test('a production database flag alone cannot activate launch without the full manifest',()=>{
  const row={chain_id:1,label:'Ethereum Mainnet',kind:'production',launch_enabled:true,public_enabled:true,
    factory_address:A,release_id:'rf26-mainnet-r1',release_manifest_hash:H,configuration:{}};
  const value=publicForgeNetwork(row);
  assert.equal(value.launchEnabled,false);
  assert.equal(value.publicEnabled,false);
  assert.equal(value.release.state,'invalid-release');
});

test('complete production release identity can make launch ready while publication stays separate',()=>{
  const row={chain_id:1,label:'Ethereum Mainnet',kind:'production',launch_enabled:true,public_enabled:false,
    factory_address:A,release_id:'rf26-mainnet-r1',release_manifest_hash:H,
    configuration:{manifestSchema:PRODUCTION_MANIFEST_SCHEMA,environment:'production',addresses}};
  const value=requireProductionRelease(row);
  assert.equal(value.launchEnabled,true);
  assert.equal(value.publicEnabled,false);
  assert.equal(value.release.state,'launch-ready');
});

test('public forge network routes expose curated release state and never raw configuration',()=>{
  const source=read('server/src/routes/rf26.js');
  assert.match(source,/import \{ publicForgeNetwork \} from '\.\.\/lib\/rf26-release-preflight\.js';/);
  assert.match(source,/forge-networks\/:chainId\/preflight/);
  assert.match(source,/rows\.map\(publicForgeNetwork\)/);
  assert.match(source,/factory_address,release_id,release_manifest_hash,configuration/);
  assert.doesNotMatch(source,/networks:rows\.map\(row=>\(\{\s*chainId:/);
});

test('existing server deployment gate still requires enabled release policy',()=>{
  const source=read('server/src/lib/rf26-networks.js');
  assert.match(source,/if\(!policy\.launch_enabled\|\|!policy\.factory_address\)/);
  assert.match(source,/policy\.kind==='production'.*!policy\.release_id\|\|!policy\.release_manifest_hash/s);
});

test('R3D-A performs no migration, contract deployment, environment activation or blockchain write',()=>{
  const source=read('server/src/lib/rf26-release-preflight.js')+'\n'+read('server/src/routes/rf26.js');
  assert.doesNotMatch(source,/eth_sendTransaction|eth_sendRawTransaction|wallet_switchEthereumChain|CREATE TABLE|ALTER TABLE|UPDATE rf26_networks/i);
});
