const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('Mainnet R2 registry is the activated fresh release',()=>{
  const context={window:{}};vm.createContext(context);
  vm.runInContext(read('relicforge-v2-addresses.js'),context);
  const c=context.window.RELICFORGE_V2_ADDRESSES[1];
  assert.equal(c.launchEnabled,true);
  assert.equal(c.architectureVersion,'R12V2-R2-ADAPTIVE');
  assert.equal(c.releaseId,'RelicForge-Mainnet-R12V2-R2-FRESH');
  assert.equal(c.factory.toLowerCase(),'0x56c9fd8a81f5d0ce389d04c7e5ea372093930da7');
  assert.equal(c.feePolicy.toLowerCase(),'0x0f155ab81e61faea80ec5bf194f31fbc33af2cac');
});
test('Studio fee quote is no longer hard-locked to Sepolia',()=>{
  const s=read('forge.js');
  assert.doesNotMatch(s,/Mainnet launch execution is locked\. Select Sepolia to use the existing Forge\./);
  assert.match(s,/return rf26OriginalConfig\(id\);/);
  assert.match(s,/quoteCollectionFeeTerms\(supply, mode\)/);
  assert.match(s,/relicforge:forge-preflight-complete/);
  assert.match(s,/refreshPlatformFeeQuote\(\)\.catch/);
});
test('fresh deployment attach follows verified scope chain',()=>{
  const s=read('forge.js');
  assert.match(s,/!\[1,11155111\]\.includes\(Number\(scope\.chainId\)\)/);
  assert.match(s,/Number\(bindings\.chainId\)!==Number\(scope\.chainId\)/);
  assert.match(s,/Number\(prior\.chainId\)!==Number\(scope\.chainId\)/);
  assert.doesNotMatch(s,/A verified Sepolia build is required before attaching a fresh deployment\./);
});
test('Fresh Forge runtime permits Mainnet and Sepolia',()=>{
  assert.match(read('rf26-fresh-forge.js'),/executionAllowed=id=>\[1,11155111\]\.includes\(Number\(id\)\)/);
});
test('legacy standalone Creator Dashboard remains Sepolia-only',()=>{
  assert.match(read('forge.js'),/The legacy Creator Dashboard is Sepolia-only in R3D-B R1\. Select Sepolia to manage historical collections\./);
});
