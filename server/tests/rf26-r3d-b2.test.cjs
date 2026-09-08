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
const scope={chainId:11155111,factory:A(1),releaseId:'test-release',manifestHash:null};
const wallet=A(2),provenance=H(3);
test('installed browser and Node recovery cores are byte-identical',()=>{
  assert.equal(read('rf26-deployment-recovery-core.js'),read('rf26-deployment-recovery-core.cjs'));
});
test('the installed core rejects cross-network, cross-creator and cross-Factory journal adoption',()=>{
  const record={schema:core.SCHEMA,...core.identity(scope,wallet,provenance),status:'partial',steps:{}};
  assert.throws(()=>core.normalize({...record,chainId:1},scope,wallet));
  assert.throws(()=>core.normalize({...record,wallet:A(9)},scope,wallet));
  assert.throws(()=>core.normalize({...record,factory:A(9)},scope,wallet));
});
test('production recovery identity requires the exact release manifest',()=>{
  assert.throws(()=>core.identity({chainId:1,factory:A(1)},wallet,provenance));
  const release={chainId:1,factory:A(1),releaseId:'production-r1',manifestHash:H(8)};
  const first=core.identity(release,wallet,provenance);
  const second=core.identity({...release,manifestHash:H(9)},wallet,provenance);
  assert.notEqual(core.key(first),core.key(second));
});
test('existing submitted transactions cannot be silently replayed or have hashes replaced',async()=>{
  const storage=new Map();
  const store=core.createStore({scope,wallet,storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}});
  const journal=store.save({...core.identity(scope,wallet,provenance),schema:core.SCHEMA,status:'partial',
    steps:{'art-0':{status:'submitted',txHash:H(4)}}});
  let calls=0;
  const provider={getNetwork:async()=>({chainId:11155111}),getTransaction:async()=>null,getTransactionReceipt:async()=>null};
  await assert.rejects(core.executeStep({store,journal,stepKey:'art-0',label:'art',assertWrite:async()=>{},
    submit:async()=>{calls++;},provider}),e=>e.code==='RF26_PENDING_TRANSACTION');
  assert.equal(calls,0);
  assert.throws(()=>core.checkpoint(journal,'art-0',{status:'submitted',txHash:H(5)}));
});
test('Studio and Dashboard load the recovery runtime after the guarded Forge',()=>{
  for(const page of ['studio.html','dashboard.html']){
    const html=read(page);
    const names=['rf26-forge-network.js?v=r3d-b1','forge.js?v=r3d-b1',
      'rf26-deployment-recovery-core.js?v=r3d-b2-r1','rf26-deployment-recovery.js?v=r3d-b2-r1',
      'rf26-recovery-inspector.js?v=r3d-b2-r1'];
    let last=-1;
    for(const name of names){
      const at=html.indexOf(name);
      assert.ok(at>last,page+' '+name);last=at;
    }
    assert.equal((html.match(/rf26-recovery-inspector\.js\?v=r3d-b2-r1/g)||[]).length,1);
    assert.match(html,/rf26-recovery-inspector\.css\?v=r3d-b2-r1/);
  }
});
test('the recovery inspector has no deployment or minting writer',()=>{
  const source=read('rf26-deployment-recovery.js')+'\n'+read('rf26-recovery-inspector.js');
  assert.doesNotMatch(source,/eth_sendRawTransaction|eth_sendTransaction|wallet_switchEthereumChain|wallet_addEthereumChain/);
  assert.doesNotMatch(source,/\.sendTransaction\(|\.createCollectionV2\(|\.sealContent\(|\.setMasterMintEnabled\(|\.replayFulfillment\(/);
  assert.match(source,/readScope,verifyCollection,inspect,publicationTarget/);
  assert.doesNotMatch(source,/window\.RF26Recovery=Object\.freeze\(\{[^}]*\bexecute\b/);
});
test('existing R3D-B1 transaction execution fence is unchanged and Mainnet remains disabled',()=>{
  const runtime=read('rf26-forge-network.js');
  assert.match(runtime,/const EXECUTION_CHAIN=11155111/);
  const context={window:{}};vm.createContext(context);
  vm.runInContext(read('relicforge-v2-addresses.js'),context);
  const mainnet=context.window.RELICFORGE_V2_ADDRESSES[1];
  assert.equal(mainnet.launchEnabled,false);
  assert.equal(mainnet.factory,'');
  assert.equal(mainnet.releaseId,'');
  assert.equal(mainnet.deploymentManifestHash,'');
});
test('the original Forge, recovery and creator publication entrypoints remain installed',()=>{
  assert.match(read('forge.js'),/async function forgeCollection\(\)/);
  assert.match(read('forge.js'),/async function requireForgeWrite\(/);
  assert.match(read('studio-resume.js'),/async function reconcileData\(/);
  assert.match(read('studio-resume.js'),/async function reconcilePhases\(/);
  assert.match(read('studio-r2.js'),/async function publish\(/);
  assert.match(read('rf26-forge-network.js'),/const EXECUTION_CHAIN=11155111/);
});
