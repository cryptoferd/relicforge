const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'../..');
const forge=fs.readFileSync(path.join(ROOT,'forge.js'),'utf8');
const studio=fs.readFileSync(path.join(ROOT,'studio.html'),'utf8');

test('randomness ABI exposes explicit gas-price estimator',()=>{
  assert.match(forge,/estimateRequestPriceAtGasPrice\(uint256 requestGasPriceWei\) view returns\(uint256\)/);
});

test('fee-aware randomness helper requires a non-zero gas price and returns it in write overrides',()=>{
  assert.match(forge,/async function rf26RandomnessGasPrice\(\)/);
  assert.match(forge,/provider\.send\('eth_gasPrice', \[\]\)/);
  assert.match(forge,/if \(gasPrice > 0n\) return gasPrice/);
  assert.match(forge,/async function rf26RandomnessRequestOverrides\(cfg, collection, label='Randomness request'\)/);
  assert.match(forge,/return Object\.freeze\(\{gasLimit, gasPrice\}\)/);
});

test('randomness helper preflights Chainlink price against the deployed collection ceiling',()=>{
  assert.match(forge,/rf26RandomnessQuoteAtGasPrice\(gasPrice, callbackGas\)/);
  assert.match(forge,/collection\.maxRandomnessCostPerBatchWei\(\)/);
  assert.match(forge,/if \(quote > ceiling\)/);
});

test('Studio quote display no longer uses zero-price quoteRequestPrice()',()=>{
  assert.match(forge,/const gasPrice = await rf26RandomnessGasPrice\(\);/);
  assert.match(forge,/const price = await rf26RandomnessQuoteAtGasPrice\(gasPrice,/);
  assert.doesNotMatch(
    forge,
    /const price = await v1RandomnessContract\(\)\.quoteRequestPrice\(Number\(cfg\.consumerWordDeliveryGas/
  );
});

test('all four gas-price-sensitive V2 randomness writes use fee-aware overrides',()=>{
  const calls=[
    ...forge.matchAll(/requestDelayedReveal\(([^)]*)\)/g)
  ].map(x=>x[1]);
  // ABI declarations contain requestDelayedReveal(), so target executable writes explicitly.
  assert.match(forge,/requestDelayedReveal\(randomnessOverrides\)/);
  assert.match(forge,/requestRandomnessForBatch\(batchId, randomnessOverrides\)/);
  assert.match(forge,/requestRandomnessForBatch\(id,randomnessOverrides\)/);
  assert.ok((forge.match(/rf26RandomnessRequestOverrides\(/g)||[]).length >= 5,
    'helper definition + four write sites must be present');
  assert.doesNotMatch(forge,/requestDelayedReveal\(\{ ?gasLimit:/);
  assert.doesNotMatch(forge,/requestRandomnessForBatch\([^,\n]+,\s*\{ ?gasLimit:/);
});

test('Studio cache-busts the patched forge runtime',()=>{
  assert.match(studio,/forge\.js\?v=6e2a-feeawarevrf1/);
});

test('patched runtime is UTF-8 BOM free',()=>{
  assert.notEqual(forge.charCodeAt(0),0xFEFF);
  assert.notEqual(studio.charCodeAt(0),0xFEFF);
});
