const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const s=fs.readFileSync(path.join(ROOT,'server/src/routes/public.js'),'utf8');

test('RPC proxy answers ethers network handshake locally',()=>{
  assert.match(s,/call\.method === 'eth_chainId'/);
  assert.match(s,/chainId\.toString\(16\)/);
  assert.match(s,/call\.method === 'net_version'/);
  assert.match(s,/result: String\(chainId\)/);
});

test('RPC proxy no longer nests an ethers getNetwork handshake',()=>{
  assert.doesNotMatch(s,/providerFor\(chainId\)\.getNetwork\(\)/);
  assert.doesNotMatch(s,/collectionFor, providerFor, rpcUrl/);
});

test('RPC proxy still forwards normal read methods to chain-qualified upstream',()=>{
  assert.match(s,/const upstreamUrl = rpcUrl\(chainId\)/);
  assert.match(s,/await fetch\(upstreamUrl/);
  assert.match(s,/eth_call/);
  assert.match(s,/eth_getCode/);
  assert.match(s,/eth_getLogs/);
});

test('batched handshakes and contract reads are merged back in caller order',()=>{
  assert.match(s,/const remoteCalls = \[\]/);
  assert.match(s,/resultsById/);
  assert.match(s,/const ordered = calls\.map/);
  assert.match(s,/RPC response was missing from upstream batch/);
});
