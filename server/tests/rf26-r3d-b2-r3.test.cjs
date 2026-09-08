const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const core=require('../../rf26-deployment-recovery-core.cjs');
const fresh=require('../../rf26-fresh-forge-core.cjs');
const A=n=>'0x'+n.toString(16).repeat(40);
const H=n=>'0x'+n.toString(16).repeat(64);

test('browser and Node recovery and fresh Forge cores remain byte-identical',()=>{
  assert.equal(read('rf26-deployment-recovery-core.cjs'),read('rf26-deployment-recovery-core.js'));
  assert.equal(read('rf26-fresh-forge-core.cjs'),read('rf26-fresh-forge-core.js'));
});
test('fresh launch specification is immutable in the existing chain-qualified journal',()=>{
  const scope={chainId:11155111,factory:A(1),releaseId:'test',manifestHash:null},wallet=A(2),provenance=H(3);
  const first={...core.identity(scope,wallet,provenance),schema:core.SCHEMA,status:'creating',steps:{},launchSpecHash:H(4)};
  const next=core.normalize(first,scope,wallet);
  assert.equal(next.launchSpecHash,H(4));
  assert.throws(()=>core.merge(next,{...next,launchSpecHash:H(5)}));
  assert.equal(core.merge(next,{...next,launchSpecHash:null}).launchSpecHash,H(4));
});
test('initial V2 Forge now delegates to the durable Factory + Resume implementation',()=>{
  const source=read('forge.js'),start=source.indexOf('async function forgeCollection()');
  const end=source.indexOf('function requestedMintQuantity',start);
  assert.ok(start>=0&&end>start);
  const body=source.slice(start,end);
  assert.match(body,/RF26FreshForge\.run/);
  assert.doesNotMatch(body,/factory\.createCollectionV2\(/);
  assert.doesNotMatch(body,/sendV1Step\(/);
  assert.match(source,/const rf26OriginalForge=forgeCollection/);
  assert.match(source,/function rf26AttachFreshDeployment/);
  assert.match(source,/async function requireForgeWrite\(verifyV2=false\)/);
});
test('existing R2 resume lifecycle and all fourteen typed write paths remain installed',()=>{
  const source=read('studio-resume.js');
  assert.equal((source.match(/await tx\(/g)||[]).length,14);
  assert.match(source,/R3D-B2 R2 durable resume transaction/);
  assert.match(source,/RF26Recovery\.executeIntent/);
  assert.match(source,/window\.RelicForgeResume=Object\.freeze/);
  assert.match(source,/findFreshCandidate/);
  assert.match(source,/Mainnet deployment recovery remains locked/);
});
test('fresh Factory executor requires the verified destination and fixed V2 creation method',()=>{
  const source=read('rf26-deployment-recovery.js');
  assert.match(source,/executeFactory/);
  assert.match(source,/plan\.method!=='createCollectionV2'/);
  assert.match(source,/core\.address\(expected\.to\)!==normalized\.factory/);
  assert.match(source,/core\.executeIntentStep/);
  assert.match(source,/network\(\)\.writeSigner\(\)\.sendTransaction/);
  assert.match(source,/navigator\.locks/);
});
test('fresh creation verifies one Factory event, all linked bindings and onchain launch inputs',()=>{
  const source=read('rf26-fresh-forge.js');
  assert.match(source,/core\.creationEvents/);
  assert.match(source,/net\(\)\.verifyCollection/);
  assert.match(source,/resume\(\)\.checkCandidate/);
  assert.match(source,/resume\(\)\.findFreshCandidate/);
  assert.match(source,/resume\(\)\.run\(true\)/);
  assert.match(source,/launchSpecHash:spec/);
});
test('source registry and execution boundary still prohibit Ethereum Mainnet transactions',()=>{
  const source=read('rf26-forge-network.js');
  assert.match(source,/const EXECUTION_CHAIN=11155111/);
  const context={window:{}};vm.createContext(context);
  vm.runInContext(read('relicforge-v2-addresses.js'),context);
  const config=context.window.RELICFORGE_V2_ADDRESSES[1];
  assert.equal(config.launchEnabled,false);
  assert.equal(config.factory,'');
  assert.equal(config.releaseId,'');
  assert.equal(config.deploymentManifestHash,'');
});
test('Studio loads the fresh runtime after its existing Forge and recovery dependencies',()=>{
  const html=read('studio.html');
  const names=['rf26-forge-network.js?v=r3d-b1','forge.js?v=r3d-b1',
    'rf26-deployment-recovery-core.js?v=r3d-b2-r1',
    'rf26-deployment-recovery.js?v=r3d-b2-r1',
    'rf26-fresh-forge-core.js?v=r3d-b2-r3','rf26-fresh-forge.js?v=r3d-b2-r3'];
  let previous=-1;
  for(const name of names){const index=html.indexOf(name);assert.ok(index>previous,name);previous=index;}
  assert.equal((html.match(/rf26-fresh-forge\.js\?v=r3d-b2-r3/g)||[]).length,1);
  assert.match(read('dashboard.html'),/rf26-forge-network.js\?v=r3d-b1/);
});
test('fresh runtime cannot switch networks or install a production release',()=>{
  const source=read('rf26-fresh-forge.js')+'\n'+read('rf26-fresh-forge-core.js');
  assert.doesNotMatch(source,/wallet_switchEthereumChain|wallet_addEthereumChain|eth_sendRawTransaction|UPDATE rf26_networks|ALTER TABLE/);
  assert.match(source,/chainId!==11155111/);
  assert.equal(typeof fresh.makeLaunch,'function');
});

test('recipe-validation batches have distinct durable keys and legacy shared intents are reconciled',()=>{
  const source=read('studio-resume.js');
  assert.match(source,/validate-\$\{startCursor\}-\$\{endCursor\}/);
  assert.match(source,/verifySharedValidationCheckpoint/);
  assert.match(source,/recovery\.core\.inspectIntentTransaction/);
  assert.doesNotMatch(source,/tx\(`Validate recipes [^\n]*,'validate',plan\(/);
});
test('resume registers only missing traits and reads byte lengths from the tuple index',()=>{
  const source=read('studio-resume.js');
  assert.match(source,/const missingItems=\[\]/);
  assert.match(source,/plan\(data,'addTraits',\[missingItems\.map/);
  assert.match(source,/Number\(cur\[3\]\)/);
  assert.match(source,/Number\(now\[3\]\)/);
  assert.doesNotMatch(source,/Number\(cur\.length\?\?cur\[3\]\)/);
});
test('existing standalone 1\/1 metadata is checked against every custom attribute',()=>{
  const source=read('studio-resume.js');
  assert.match(source,/1\/1 metadata \$\{i\+1\} attribute \$\{a\+1\} conflicts/);
  assert.match(source,/data\.oneOfOneAttribute\(row\[0\],a\)/);
});
