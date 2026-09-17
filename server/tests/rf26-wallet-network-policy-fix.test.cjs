const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('launch connect authenticates actual signing wallet before policy preflight',()=>{
  const s=read('rf26-forge-network.js');
  const b=s.slice(s.indexOf('async function connect('),s.indexOf('async function assertWrite'));
  const account=b.indexOf('requestAccount(forceChooser)');
  const auth=b.indexOf('ensureSignedIn(requested)');
  const preflight=b.indexOf('const ready=await preflight()');
  assert.ok(account>=0&&auth>account&&preflight>auth);
  assert.match(b,/RF26_POLICY_WALLET_MISMATCH/);
});

test('policy JWT must match non-interactive connected wallet',()=>{
  const s=read('rf26-forge-network.js');
  assert.match(s,/async function matchingCloudSession/);
  assert.match(s,/method:'eth_accounts'/);
  assert.match(s,/active\.wallet/);
  assert.match(s,/clearSession/);
});

test('server returns wallet identity used for authenticated policy',()=>{
  const s=read('server/src/routes/policy.js');
  assert.match(s,/evaluatedWallet:request\.user\.wallet/);
  assert.match(s,/explicitOverride:/);
  assert.match(read('rf26-forge-network.js'),/payload\.evaluatedWallet/);
});

test('wallet account/provider changes clear stale Cloud authorization',()=>{
  const s=read('rf26-forge-network.js');
  assert.match(s,/relicforge:wallet-accounts-changed/);
  assert.match(s,/relicforge:wallet-provider-changed/);
  assert.match(s,/cloud\?\.clearSession/);
});

test('cloud emits auth lifecycle events',()=>{
  const s=read('cloud.js');
  assert.match(s,/relicforge:cloud-signed-in/);
  assert.match(s,/relicforge:cloud-session-cleared/);
});

test('Disabled globally plus Force Allow remains the intended server precedence',()=>{
  const s=read('server/src/lib/founder-policy.js');
  const explicit=s.indexOf("else if(typeof explicit==='boolean')launch=explicit;");
  const disabled=s.indexOf("else if(mode==='disabled')launch=false;");
  assert.ok(explicit>=0&&disabled>explicit);
});

test('deployment registration independently rechecks authenticated-wallet policy',()=>{
  const s=read('server/src/routes/rf26.js');
  assert.match(s,/effectiveNetworkPolicy\(await networkPolicy\(id\),request\.user\.wallet,Boolean\(request\.user\.isFounder\)\)/);
  assert.match(s,/verifyCollectionOwner\(id,contract,requester\)/);
});
