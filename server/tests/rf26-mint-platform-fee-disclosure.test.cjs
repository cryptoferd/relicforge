const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('R12-v2 mint pages disclose dynamic platform fee and total',()=>{
  const s=read('mint-v2-adapter.js');
  assert.match(s,/function refreshStageMintCost\(phaseId\)/);
  assert.match(s,/quoteMint\(phase\.id,qty\)/);
  assert.match(s,/Platform fee × \$\{qty\}/);
  assert.match(s,/Total due/);
  assert.match(s,/fmtEth\(platformFeeWei\).*fmtUsdCents\(totalCents\)/s);
  assert.match(s,/currentCollectionFeeCents/);
  assert.match(s,/centsPerNft\*qty/);
});

test('creator-sponsored collections explicitly waive collector platform fee',()=>{
  const s=read('mint-v2-adapter.js');
  assert.match(s,/mode===1/);
  assert.match(s,/0 ETH \(\$0\.00\)/);
  assert.match(s,/Platform fees are waived for collectors due to creator sponsorship\./);
});

test('platform fee disclosure updates when quantity changes',()=>{
  const s=read('mint-v2-adapter.js');
  assert.match(s,/data-v2-qty/);
  assert.match(s,/scheduleStageMintCost/);
  assert.match(s,/\['input','change','keyup'\]/);
});

test('mint page contains dedicated fee-breakdown styling and cache-bust',()=>{
  const s=read('mint.html');
  assert.match(s,/\.mint-cost-breakdown/);
  assert.match(s,/\.mint-cost-row\.platform/);
  assert.match(s,/mint-v2-adapter\.js\?v=r12v2-platform-fee-disclosure1/);
});
