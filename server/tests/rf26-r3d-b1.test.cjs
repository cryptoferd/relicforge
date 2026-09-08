const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const read=relative=>fs.readFileSync(path.join(ROOT,relative),'utf8');
const core=require('../../rf26-forge-network-core.cjs');
test('browser and Node release-core copies are identical',()=>assert.equal(read('rf26-forge-network-core.js'),read('rf26-forge-network-core.cjs')));
test('Mainnet remains disabled and all production addresses remain empty',()=>{
  const source=read('relicforge-v2-addresses.js');
  const vm=require('node:vm'),context={window:{}};vm.createContext(context);vm.runInContext(source,context);
  const c=context.window.RELICFORGE_V2_ADDRESSES[1];assert.equal(c.chainId,1);assert.equal(c.launchEnabled,false);assert.equal(c.environment,'not-deployed');
  assert.equal(c.releaseId,'');assert.equal(c.deploymentManifestHash,'');
  for(const field of ['factory',...core.REQUIRED])assert.equal(c[field],'',field);
});
test('Forge creation, uploads, minting and recovery use explicit write gates',()=>{
  const s=read('forge.js');
  assert.match(s,/async function requireForgeWrite\(verifyV2=false\)/);
  assert.match(s,/Mainnet transaction execution remains locked/);
  assert.match(s,/await rf26Network\(\)\.assertWrite\(\)/);
  assert.match(s,/await requireForgeWrite\(true\)/);
  assert.match(s,/const rf26OriginalForge=forgeCollection/);
  assert.match(s,/const rf26OriginalOpenLaunch=openLaunchedCollection/);
});
test('new wallet session is account-only when a release is unavailable',()=>{
  const s=read('forge.js');assert.match(s,/connectWallet=async function\(\{forceChooser=false,requireLaunch=/);
  assert.match(s,/forgeState\.provider=session\.signer\?session\.provider:null/);
  assert.match(s,/forgeState\.signer=session\.signer/);
  assert.match(s,/rf26Network\(\)\.connect\(\{forceChooser,requireLaunch\}\)/);
  assert.match(s,/launch-network-changed/);
});
test('legacy project restoration preserves source and clears stale in-memory deployment bindings',()=>{
  const s=read('forge.js');assert.match(s,/rf26ClearDeploymentBindings/);assert.match(s,/persistDeploymentJournal\(forgeState\.deploymentJournal\)/);
  assert.match(s,/launchChainId:activeChainId\(\)/);assert.match(s,/rf26OriginalRestore\(saved,options\)/);
  assert.match(s,/getForgeProjectState,restoreForgeProjectState|getForgeProjectState, restoreForgeProjectState/);
});
test('Studio includes explicit network selection and ordered source dependencies',()=>{
  const s=read('studio.html');const i=x=>s.indexOf(x);for(const id of ['rf26ForgeNetworkSelect','rf26ForgePreflightBtn','rf26ForgeNetworkStatus'])assert.ok(s.includes('id="'+id+'"'));
  assert.ok(i('relicforge-networks.js')<i('rf26-forge-network-core.js'));
  assert.ok(i('rf26-forge-network-core.js')<i('rf26-forge-network.js'));
  assert.ok(i('rf26-forge-network.js')<i('forge.js?v=r3d-b1'));
  assert.match(s,/Mainnet transaction execution remains locked/);
});
test('recovery and collector publication cannot cross into Mainnet',()=>{
  const r=read('studio-resume.js'),p=read('studio-r2.js');
  assert.match(r,/Mainnet deployment recovery remains locked/);assert.match(r,/rf26Leave=window\.RelicForgeForgeNetwork\.enter\(\)/);
  assert.match(r,/await api\(\)\.requireForgeWrite\(true\)/);
  assert.match(p,/restricted to verified Sepolia deployments/);assert.match(p,/RelicForgeForgeNetwork\.verifyCollection\(collection,\{creator:wallet,chainId:launchScope\.chainId\}\)/);
});
test('production release policy remains a separate server-owned gate',()=>{
  const source=read('server/src/lib/rf26-release-preflight.js');
  assert.match(source,/relic-forge\/production-release@1/);
  assert.match(source,/launchEnabled=configured&&requestedLaunch/);
  assert.match(source,/publicEnabled=launchEnabled&&requestedPublic/);
  assert.match(read('server/src/routes/rf26.js'),/forge-networks\/:chainId\/preflight/);
});

test('standalone Creator Dashboard loads the same guarded runtime before Forge',()=>{
  const s=read('dashboard.html');const i=x=>s.indexOf(x);
  assert.ok(i('relicforge-networks.js')<i('rf26-forge-network-core.js'));
  assert.ok(i('rf26-forge-network-core.js')<i('rf26-forge-network.js'));
  assert.ok(i('rf26-forge-network.js')<i('forge.js?v=r3d-b1'));
});
