const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const core=require(path.join(ROOT,'founder-safe-admin-core.js'));

test('Founder Console includes Safe Admin Calls tab and module',()=>{
  const html=read('studio.html');
  assert.match(html,/data-founder-tab="safe"/);
  assert.match(html,/id="founderSafePanel"/);
  assert.match(html,/founder-safe-admin-core\.js/);
  assert.match(html,/founder-safe-admin\.js/);
  assert.match(html,/founder-safe-admin\.css/);
});

test('Safe Admin catalog contains platform founder, FeePolicy, Reserve, creator and phase controls',()=>{
  const ids=new Set(core.ACTIONS.map(a=>a.id));
  for(const id of [
    'collection.batchWindow','collection.randomnessCeiling',
    'fees.collectionEnabled','fees.collectionRate','fees.waiveCollection','fees.defaults',
    'reserve.policy','reserve.releaseRevenue','reserve.proposeFounder','reserve.acceptFounder',
    'creator.payout','creator.royalty','creator.transferOwnership','creator.renounce',
    'phases.masterMint','phases.stageEnabled'
  ])assert.ok(ids.has(id),`missing ${id}`);
});

test('Safe Transaction Builder export is readable method JSON and chain-qualified',()=>{
  const action=core.byId('collection.randomnessCeiling');
  const json=core.buildSafeTransactionBuilder({
    action,chainId:1,
    safeAddress:'0x1111111111111111111111111111111111111111',
    target:'0x2222222222222222222222222222222222222222',
    inputValues:{newCeilingWei:'5000000000000000'}
  });
  assert.equal(json.version,'1.0');
  assert.equal(json.chainId,'1');
  assert.equal(json.meta.txBuilderVersion,'1.18.0');
  assert.equal(json.transactions[0].data,null);
  assert.equal(json.transactions[0].contractMethod.name,'setMaxRandomnessCostPerBatchWei');
  assert.equal(json.transactions[0].contractInputsValues.newCeilingWei,'5000000000000000');
});

test('USD conversion is exact to cents',()=>{
  assert.equal(core.parseUsdCents('0.50'),50n);
  assert.equal(core.parseUsdCents('5'),500n);
  assert.equal(core.parseUsdCents('1.23'),123n);
  assert.throws(()=>core.parseUsdCents('1.234'));
});

test('browser Safe Admin enumerates canonical collections from Reserve and verifies bindings',()=>{
  const s=read('founder-safe-admin.js');
  assert.match(s,/collectionCount\(\)/);
  assert.match(s,/collections\(index\)/);
  assert.match(s,/canonicalCollection\(checksum\)/);
  assert.match(s,/Collection Factory does not match/);
  assert.match(s,/Collection FeePolicy does not match/);
  assert.match(s,/Collection Reserve does not match/);
});

test('Safe authorization checks match exact onchain authority',()=>{
  const s=read('founder-safe-admin.js');
  assert.match(s,/reserve\.founder\(\)/);
  assert.match(s,/policy\.platformAdmin\(\)/);
  assert.match(s,/policy\.pendingPlatformAdmin\(\)/);
  assert.match(s,/policy\.pendingTreasury\(\)/);
  assert.match(s,/reserve\.pendingFounder\(\)/);
  assert.match(s,/reserve\.pendingRevenueTreasury\(\)/);
  assert.match(s,/state\.selected\.controller/);
});

test('Safe Admin is generator-only: no wallet signer or transaction submission path',()=>{
  const s=read('founder-safe-admin.js');
  assert.doesNotMatch(s,/getSigner\s*\(/);
  assert.doesNotMatch(s,/sendTransaction\s*\(/);
  assert.doesNotMatch(s,/\.wait\s*\(/);
  assert.match(s,/provider\.call\(\{from:safeAddress,to:target,data,value:0n\}\)/);
});

test('Founder Console tab routing opens Safe Admin without changing fee/project tools',()=>{
  const s=read('founder-console.js');
  assert.match(s,/founderSafePanel/);
  assert.match(s,/RelicForgeSafeAdmin\?\.open/);
  assert.match(s,/tab === 'projects'/);
  assert.match(s,/tab === 'fees'/);
});
