const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('read proxy permits ethers priority-fee read and reports exact rejected method',()=>{
  const s=read('server/src/routes/public.js');
  assert.match(s,/eth_maxPriorityFeePerGas/);
  assert.match(s,/Relic Forge read proxy/);
  assert.match(s,/String\(call\.method \|\| 'unknown'\)/);
});

test('Reserve tab no longer uses ethers getFeeData fan-out',()=>{
  const s=read('founder-operations.js');
  assert.doesNotMatch(s,/p\.getFeeData\(\)/);
  assert.match(s,/p\.send\('eth_gasPrice',\[\]\)/);
  assert.match(s,/const gasPrice=BigInt\(gasPriceHex\|\|'0x0'\)/);
});

test('Reserve randomness estimate uses exact gas-price value',()=>{
  const s=read('founder-operations.js');
  assert.match(s,/estimateRequestPriceAtGasPrice\(Number\(cfg\.autoRevealConsumerCallbackGas\|\|1400000\),gasPrice\)/);
  assert.match(s,/formatUnits\(gasPrice,'gwei'\)/);
});

test('R1.1 local network handshake remains intact',()=>{
  const s=read('server/src/routes/public.js');
  assert.match(s,/handshake-r1\.1-local/);
  assert.match(s,/call\.method === 'eth_chainId'/);
  assert.match(s,/call\.method === 'net_version'/);
});
