const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ethers=require('ethers');

const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const core=require('../../rf26-deployment-recovery-core.cjs');

function A(n){return '0x'+n.toString(16).repeat(40);}
function H(n){return '0x'+n.toString(16).repeat(64);}

function loadRecovery(){
  const context={
    window:{RF26RecoveryCore:core,ethers},
    localStorage:{getItem(){return null;},setItem(){}},
    navigator:{}
  };
  vm.createContext(context);
  vm.runInContext(read('rf26-deployment-recovery.js'),context);
  return context.window.RF26Recovery;
}
function execution(target,value,data){
  return ethers.concat([target,ethers.zeroPadValue(ethers.toBeHex(value),32),data]);
}
function wrappedTx({target,value=0n,data,mode=ethers.ZeroHash,calls=null,to=null}){
  const iface=new ethers.Interface([
    'function redeemDelegations(bytes[] _permissionContexts,bytes32[] _modes,bytes[] _executionCallDatas)'
  ]);
  const actualCalls=calls||[execution(target,value,data)];
  return {
    to:to||'0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
    value:0n,
    data:iface.encodeFunctionData('redeemDelegations',[
      actualCalls.map(()=> '0x'),
      actualCalls.map((_,i)=>i===0?mode:ethers.ZeroHash),
      actualCalls
    ])
  };
}

test('delegated recovery accepts one exact canonical MetaMask inner execution',()=>{
  const recovery=loadRecovery();
  const target=A(1),wallet=A(2),data='0x12345678aabbccdd',value=17n;
  const expected=core.intent({
    chainId:11155111,wallet,to:target,
    dataHash:ethers.keccak256(data),dataLength:(data.length-2)/2,
    value:String(value),nonce:198
  });
  const inner=recovery.resolveDelegatedIntent(wrappedTx({target,value,data}),expected);
  assert.ok(inner);
  assert.equal(inner.to,target.toLowerCase());
  assert.equal(inner.value,value);
  assert.equal(inner.data,data);
});

test('delegated recovery rejects wrong manager, mode, batch, target, value and calldata',()=>{
  const recovery=loadRecovery();
  const target=A(1),wallet=A(2),data='0x12345678aabbccdd',value=17n;
  const expected=core.intent({
    chainId:11155111,wallet,to:target,
    dataHash:ethers.keccak256(data),dataLength:(data.length-2)/2,
    value:String(value),nonce:198
  });

  assert.equal(recovery.resolveDelegatedIntent(wrappedTx({target,value,data,to:A(9)}),expected),null);
  assert.equal(recovery.resolveDelegatedIntent(
    wrappedTx({target,value,data,mode:'0x'+'0'.repeat(63)+'1'}),expected),null);

  const one=execution(target,value,data);
  assert.equal(recovery.resolveDelegatedIntent(
    wrappedTx({target,value,data,calls:[one,one]}),expected),null);

  assert.equal(recovery.resolveDelegatedIntent(wrappedTx({target:A(3),value,data}),expected),null);
  assert.equal(recovery.resolveDelegatedIntent(wrappedTx({target,value:18n,data}),expected),null);
  assert.equal(recovery.resolveDelegatedIntent(
    wrappedTx({target,value,data:'0x12345678aabbccde'}),expected),null);
});

test('intent-aware provider preserves outer sender, chain and nonce while exposing exact inner call',async()=>{
  const recovery=loadRecovery();
  const target=A(1),wallet=A(2),data='0x12345678aabbccdd',value=17n;
  const expected=core.intent({
    chainId:11155111,wallet,to:target,
    dataHash:ethers.keccak256(data),dataLength:(data.length-2)/2,
    value:String(value),nonce:198
  });
  const outer={
    ...wrappedTx({target,value,data}),
    hash:H(7),from:wallet,chainId:11155111n,nonce:198,blockNumber:123
  };
  const provider={
    async getTransaction(){return outer;},
    async getNetwork(){return {chainId:11155111n};}
  };
  const effective=await recovery.providerForIntent(provider,expected).getTransaction(H(7));
  assert.equal(effective.from,wallet);
  assert.equal(effective.chainId,11155111n);
  assert.equal(effective.nonce,198);
  assert.equal(effective.to,target.toLowerCase());
  assert.equal(effective.value,value);
  assert.equal(effective.data,data);
});

test('direct transactions remain unchanged by the intent-aware provider',async()=>{
  const recovery=loadRecovery();
  const target=A(1),wallet=A(2),data='0x12345678',value=0n;
  const expected=core.intent({
    chainId:11155111,wallet,to:target,
    dataHash:ethers.keccak256(data),dataLength:(data.length-2)/2,
    value:'0',nonce:10
  });
  const direct={hash:H(8),from:wallet,to:target,chainId:11155111n,nonce:10,data,value};
  const provider={
    async getTransaction(){return direct;},
    async getNetwork(){return {chainId:11155111n};}
  };
  const got=await recovery.providerForIntent(provider,expected).getTransaction(H(8));
  assert.equal(got,direct);
});

test('source is BOM-free and preserves fail-closed exact-match checks',()=>{
  const source=read('rf26-deployment-recovery.js');
  assert.equal(source.charCodeAt(0),40,'recovery runtime must start with "(" and contain no UTF-8 BOM');
  assert.match(source,/METAMASK_DELEGATION_MANAGER='0xdb9b1e94b5b69df7e401ddbede43491141047db3'/);
  assert.match(source,/contexts\.length!==1\|\|modes\.length!==1\|\|calls\.length!==1/);
  assert.match(source,/DEFAULT_SINGLE_MODE/);
  assert.match(source,/dataLength!==Number\(expected\.dataLength\)/);
  assert.match(source,/keccak256\(data\).*expected\.dataHash/);
  assert.match(source,/providerForIntent\(provider,intentValue\)/);
  assert.match(read('studio.html'),/rf26-deployment-recovery\.js\?v=6e2a-mmdelegation1/);
});
