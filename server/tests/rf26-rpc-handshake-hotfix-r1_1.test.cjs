const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const s=fs.readFileSync(path.join(ROOT,'server/src/routes/public.js'),'utf8');

test('single eth_chainId/net_version handshakes return before upstream URL resolution',()=>{
  const block=s.slice(s.indexOf("if (!isBatch) {"),s.indexOf("const resultsById"));
  const local=block.indexOf("const local = localResult(calls[0])");
  const upstream=block.indexOf("const upstreamUrl = rpcUrl(chainId)");
  assert.ok(local>=0);
  assert.ok(upstream>local);
  assert.match(block,/if \(local\) \{/);
  assert.match(block,/handshake-r1\.1-local/);
});

test('pure handshake batch returns without resolving upstream',()=>{
  assert.match(s,/if \(!remoteCalls\.length\) \{/);
  assert.match(s,/handshake-r1\.1-local-batch/);
});

test('diagnostic endpoint exposes proxy version and Railway commit without API key',()=>{
  assert.match(s,/\/api\/public\/rpc\/:chainId\/diagnostic/);
  assert.match(s,/proxyVersion: 'handshake-r1\.1'/);
  assert.match(s,/RAILWAY_GIT_COMMIT_SHA/);
  assert.doesNotMatch(s,/apiKey:/);
});

test('normal read methods still forward upstream',()=>{
  assert.match(s,/const upstreamUrl = rpcUrl\(chainId\)/);
  assert.match(s,/await fetch\(upstreamUrl/);
  assert.match(s,/eth_call/);
  assert.match(s,/eth_getCode/);
  assert.match(s,/eth_getLogs/);
});
