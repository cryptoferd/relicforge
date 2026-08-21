/* Relic Forge Sepolia test compiler worker. TEST ONLY. */
const SOLC_URL = 'https://binaries.soliditylang.org/bin/soljson-v0.8.30+commit.73712a01.js';
let compileStandard = null;
let versionFn = null;

function ensureCompiler() {
  if (compileStandard) return;
  self.Module = {};
  importScripts(SOLC_URL);
  const mod = self.Module;
  if (!mod || typeof mod.cwrap !== 'function') throw new Error('Official soljson compiler did not initialize.');
  compileStandard = mod.cwrap('solidity_compile', 'string', ['string', 'number', 'number']);
  try { versionFn = mod.cwrap('solidity_version', 'string', []); } catch (_) {}
}

self.onmessage = (event) => {
  try {
    ensureCompiler();
    const source = event.data && event.data.source;
    if (!source) throw new Error('No Solidity source supplied.');
    const input = {
      language: 'Solidity',
      sources: { 'RelicForgeTest.sol': { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
        evmVersion: 'cancun',
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
      }
    };
    const raw = compileStandard(JSON.stringify(input), 0, 0);
    const output = JSON.parse(raw);
    self.postMessage({ ok: true, output, version: versionFn ? versionFn() : '0.8.30' });
  } catch (error) {
    self.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
  }
};
