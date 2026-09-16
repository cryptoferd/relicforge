const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('network selector treats project as reusable source instead of chain-bound launch',()=>{
  const s=read('rf26-forge-network.js');
  assert.doesNotMatch(s,/Save the project and open a new launch draft before switching/);
  assert.doesNotMatch(s,/RF26_DEPLOYMENT_MISMATCH/);
  assert.match(s,/selected as a separate deployment target/);
  assert.match(s,/boundDeploymentChainId/);
  assert.match(s,/previousChainId/);
});

test('switching networks archives and detaches only the active deployment context',()=>{
  const s=read('forge.js');
  assert.match(s,/function rf26DetachDeploymentForNetworkSwitch\(/);
  assert.match(s,/archiveDeploymentJournal\(journal,'network-switch'\)/);
  assert.match(s,/rf26ClearDeploymentBindings\(\)/);
  assert.match(s,/forgeState\.newDeploymentRequest=null/);
  assert.match(s,/rf26DetachDeploymentForNetworkSwitch\(target,bound\)/);
});

test('local deployment journal lookup is chain-aware for one build on many networks',()=>{
  const s=read('forge.js');
  assert.match(s,/function findLocalDeploymentJournal\(provenance, chainId=activeChainId\(\)\)/);
  assert.match(s,/directChain===target/);
  assert.match(s,/getDeploymentHistory\(provenance\)/);
  assert.match(s,/Number\(row\?\.chainId\?\?11155111\)===target/);
});

test('both Ethereum Mainnet and Sepolia remain supported execution chains',()=>{
  assert.match(read('rf26-forge-network.js'),/new Set\(\[1,11155111\]\)/);
  assert.match(read('studio-resume.js'),/new Set\(\[1,11155111\]\)/);
});

test('cross-network reuse does not reassign an existing deployment record',()=>{
  const network=read('rf26-forge-network.js');
  const forge=read('forge.js');
  assert.match(network,/existing .* deployment remains unchanged in deployment history/);
  assert.match(forge,/archiveDeploymentJournal\(journal,'network-switch'\)/);
  assert.doesNotMatch(forge,/journal\.chainId\s*=\s*target/);
});
