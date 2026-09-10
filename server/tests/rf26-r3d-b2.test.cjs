const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

const ROOT=path.resolve(__dirname,'../..');
const read=relative=>fs.readFileSync(path.join(ROOT,relative),'utf8');
const core=require('../../rf26-deployment-recovery-core.cjs');
const A=n=>'0x'+n.toString(16).repeat(40);
const H=n=>'0x'+n.toString(16).repeat(64);
const D=data=>'0x'+crypto.createHash('sha256').update(String(data).toLowerCase()).digest('hex');
const scope={chainId:11155111,factory:A(1),releaseId:'sepolia-r12',manifestHash:null};
const wallet=A(2),provenance=H(3);

test('browser and Node durable recovery cores are byte-identical',()=>{
  assert.equal(read('rf26-deployment-recovery-core.js'),read('rf26-deployment-recovery-core.cjs'));
});

test('durable transaction intents bind network, creator, target, calldata, value and nonce',()=>{
  const i=core.intent({chainId:11155111,wallet,to:A(5),dataHash:H(8),dataLength:12,value:'0',nonce:4});
  assert.equal(i.chainId,11155111);
  assert.equal(i.wallet,A(2));
  assert.equal(i.to,A(5));
  assert.equal(i.nonce,4);
  assert.throws(()=>core.intent({...i,to:A(0)}));
  assert.throws(()=>core.intent({...i,nonce:-1}));
});

test('saved durable intent cannot be replaced or returned from submitted to prepared',()=>{
  const j={...core.identity(scope,wallet,provenance),schema:core.SCHEMA,status:'partial',
    collectionAddress:A(4),dataAddress:A(5),mintPhasesAddress:A(6),
    steps:{'art-0':{status:'prepared',intent:core.intent({
      chainId:11155111,wallet,to:A(5),dataHash:H(8),dataLength:12,value:'0',nonce:4
    })}}};
  assert.throws(()=>core.checkpoint(j,'art-0',{status:'prepared',intent:{...j.steps['art-0'].intent,nonce:5}}),
    e=>e.code==='RF26_INTENT_MISMATCH');
  const submitted=core.checkpoint(j,'art-0',{status:'submitted',intent:j.steps['art-0'].intent,txHash:H(4)});
  assert.throws(()=>core.checkpoint(submitted,'art-0',{status:'prepared',intent:j.steps['art-0'].intent}));
});

test('R3D-B2 R2 resume source routes all fourteen write paths through typed durable plans',()=>{
  const source=read('studio-resume.js');
  assert.match(source,/R3D-B2 R2 durable resume transaction/);
  assert.equal((source.match(/await tx\(/g)||[]).length,14);
  assert.ok((source.match(/plan\(/g)||[]).length>=15);
  assert.match(source,/RF26Recovery\.executeIntent/);
  assert.match(source,/RF26Recovery\.ensureJournal/);
  assert.doesNotMatch(source,/const t=await call\(\)/);
});

test('each resume transaction includes an explicit state-specific postcondition',()=>{
  const source=read('studio-resume.js');
  for(const phrase of [
    'Artwork shard ${i+1} postcondition failed.',
    'Layer-name postcondition failed.',
    'Metadata-visibility postcondition failed.',
    '1/1 layer postcondition failed.',
    'attribute postcondition failed.',
    'postcondition failed.`);}})',
    'DNA shard ${i+1} postcondition failed.',
    'DNA configuration postcondition failed.',
    'Reveal placeholder postcondition failed.',
    'Renderer-policy postcondition failed.',
    'Recipe-validation postcondition failed.',
    'Content-seal postcondition failed.',
    'MintPhases Stage ${s.id} postcondition failed.',
    'Scheduled-mint postcondition failed.'
  ]) assert.ok(source.includes(phrase),phrase);
});

test('browser recovery runtime exposes only guarded durable execution and scoped journal adoption',()=>{
  const source=read('rf26-deployment-recovery.js');
  assert.match(source,/ensureJournal/);
  assert.match(source,/executeIntent/);
  assert.match(source,/network\(\)\.assertWrite\(\)/);
  assert.match(source,/navigator\.locks/);
  assert.match(source,/allowedTarget/);
  assert.doesNotMatch(source,/wallet_switchEthereumChain|wallet_addEthereumChain/);
});

test('R3D-B1 still keeps transaction execution restricted to Sepolia',()=>{
  const source=read('rf26-forge-network.js');
  assert.match(source,/const EXECUTION_CHAIN=11155111/);
  assert.match(source,/Mainnet transaction execution remains locked/);
  assert.doesNotMatch(source,/const EXECUTION_CHAIN=1(?:;|\s)/);
});

test('resume context still rejects Mainnet before any recovery transaction path',()=>{
  const source=read('studio-resume.js');
  assert.match(source,/launchScope\.chainId!==11155111/);
  assert.match(source,/Mainnet deployment recovery remains locked/);
});

test('checked-in Ethereum Mainnet release remains disabled and address-empty',()=>{
  const context={window:{}};vm.createContext(context);
  vm.runInContext(read('relicforge-v2-addresses.js'),context);
  const mainnet=context.window.RELICFORGE_V2_ADDRESSES[1];
  assert.equal(mainnet.launchEnabled,false);
  assert.equal(mainnet.factory,'');
  assert.equal(mainnet.releaseId,'');
  assert.equal(mainnet.deploymentManifestHash,'');
});

test('R3D-B2 inspector and scoped journal UI remain installed alongside durable resume',()=>{
  for(const page of ['studio.html','dashboard.html']){
    const html=read(page);
    assert.match(html,/rf26-deployment-recovery-core\.js\?v=r3d-b2-r1/);
    assert.match(html,/rf26-deployment-recovery\.js\?v=r3d-b2-r1/);
    assert.match(html,/rf26-recovery-inspector\.js\?v=r3d-b2-r1/);
  }
});
