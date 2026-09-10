const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const core=require('../../rf26-creator-guard-core.cjs');

test('creator policy browser and Node cores are identical',()=>{
  assert.equal(read('rf26-creator-guard-core.cjs'),read('rf26-creator-guard-core.js'));
});
test('Studio publication uses verified creator identity without direct wallet switching',()=>{
  const source=read('studio-r2.js');
  assert.match(source,/async function publish\(detail\)/);
  assert.match(source,/RF26CreatorGuard\.account\(collection/);
  assert.match(source,/RF26CreatorGuard\.account\(collection,\{role:'creator',chainId:CHAIN_ID\}\)/);
  assert.match(source,/RelicForgeForgeNetwork\.verifyCollection\(collection,\{creator:wallet,chainId:launchScope\.chainId\}\)/);
  assert.doesNotMatch(source,/wallet_switchEthereumChain|eth_requestAccounts/);
  assert.match(source,/await session\.assert\(\)/);
});
test('Studio publication requires matching project and MintPhases bindings and prohibits testnet listing',()=>{
  const source=read('studio-r2.js');
  assert.match(source,/state\.collectionAddress\.toLowerCase\(\)!==collection\.toLowerCase\(\)/);
  assert.match(source,/detail\.mintPhasesAddress\.toLowerCase\(\)!==session\.identity\.phases/);
  assert.match(source,/mintPhasesAddress:session\.identity\.phases/);
  assert.match(source,/showcaseEnabled:false/);
  assert.match(source,/showcaseStart:null/);
});
test('R12-v2 Stage Manager uses the verified signer rather than a raw injected provider',()=>{
  const source=read('dashboard-r23.js');
  assert.match(source,/RF26CreatorGuard\.signer\(state\.collection,\{controller:state\.controller,chainId:CHAIN_ID\}\)/);
  assert.doesNotMatch(source,/wallet_switchEthereumChain|eth_requestAccounts|new window\.ethers\.BrowserProvider/);
  assert.match(source,/RF26CreatorGuard\.read\(address,\{chainId:CHAIN_ID\}\)/);
  assert.match(source,/ticket!==state\.readSerial/);
});
test('Stage Manager proof publication checks onchain root and exact controller scope',()=>{
  const source=read('dashboard-r23.js');
  assert.match(source,/role:'controller',chainId:CHAIN_ID/);
  assert.match(source,/session\.identity\.phases/);
  assert.match(source,/onchain Approved Wallet root differs/);
  assert.match(source,/await session\.assert\(\)/);
});
test('creator guard permits only two MintPhases methods and never Mainnet transactions',()=>{
  const source=read('rf26-creator-guard-core.cjs');
  assert.match(source,/createPhase\(uint96,uint64,uint64,uint32,uint32,bytes32,uint8,uint16,bool\)/);
  assert.match(source,/updatePhase\(uint32,uint96,uint64,uint64,uint32,uint32,bytes32,uint8,uint16\)/);
  assert.match(source,/Mainnet creator transactions remain locked/);
  const id=core.identity(
    {chainId:11155111,factory:'0x'+'1'.repeat(40)},
    {chainId:11155111,factory:'0x'+'1'.repeat(40),collection:'0x'+'4'.repeat(40),
      creator:'0x'+'2'.repeat(40),controller:'0x'+'3'.repeat(40),data:'0x'+'5'.repeat(40),phases:'0x'+'6'.repeat(40)}
  );
  assert.throws(()=>core.transaction(id,{to:'0x'+'4'.repeat(40),data:'0x11111111'},()=> '0x11111111'));
});
test('existing R3 durable Forge and its Mainnet execution fence remain installed',()=>{
  assert.match(read('forge.js'),/RF26FreshForge\.run/);
  assert.match(read('studio-resume.js'),/R3D-B2 R2 durable resume transaction/);
  assert.match(read('rf26-forge-network.js'),/const EXECUTION_CHAIN=11155111/);
  const context={window:{}};vm.createContext(context);
  vm.runInContext(read('relicforge-v2-addresses.js'),context);
  const main=context.window.RELICFORGE_V2_ADDRESSES[1];
  assert.equal(main.launchEnabled,false);
  assert.equal(main.factory,'');
  assert.equal(main.releaseId,'');
  assert.equal(main.deploymentManifestHash,'');
});
test('Studio and Dashboard load creator policy after network runtime and before their V2 managers',()=>{
  for(const [page,manager] of [['studio.html','studio-r2.js?v=r12v2-r24-resume1'],['dashboard.html','dashboard-r23.js?v=r12v2-r25-countdown1']]){
    const source=read(page);
    const names=['rf26-forge-network.js?v=r3d-b1','rf26-creator-guard-core.js?v=r3d-b2-r4-1',
      'rf26-creator-guard.js?v=r3d-b2-r4-1',manager];
    let previous=-1;
    for(const name of names){
      const at=source.indexOf(name);
      assert.ok(at>previous,page+' '+name);
      previous=at;
    }
  }
});
