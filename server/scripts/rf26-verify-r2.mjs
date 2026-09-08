import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const repo = path.resolve(process.env.RF26_REPO || path.join(import.meta.dirname, '../..'));
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const checks = [];
function check(label, fn) { checks.push({ label, fn }); }
function nodeCheck(p) {
  const r = spawnSync(process.execPath, ['--check', path.join(repo, p)], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${p}: ${r.stderr}`);
}
check('Baseline ancestry and development branch', () => {
  assert.equal(git('branch', '--show-current'), 'ethereum-mainnet');
  assert.equal(git('merge-base', '--is-ancestor', '2356ab873b8852d2a2b4f58d2b460151d3c2b61e', 'HEAD'), '');
});
check('Original Studio application is restored', () => {
  const original = execFileSync('git', ['show', 'b575134d229632d3a857d1877f70aeaf74e63cf6:app.js'], { cwd: repo });
  assert.ok(fs.existsSync(path.join(repo, 'app.js')));
  assert.equal(fs.readFileSync(path.join(repo, 'app.js')).length > 0, true);
  assert.equal(crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${original.length}\0`), original])).digest('hex'), 'ad8847201ae99f07cfd156195a4480a3dfe1eda9');
});
check('RF26 backend is registered exactly once', () => {
  const source = read('server/src/index.js');
  const binding = source.match(/import\s+(\w+)\s+from\s*['"]\.\/routes\/rf26\.js['"]/);
  assert.ok(binding);
  assert.equal((source.match(new RegExp(`await app\\.register\\(${binding[1]}\\);`, 'g')) || []).length, 1);
});
check('Legacy publishing uses the production policy boundary', () => {
  const source = read('server/src/routes/collections.js');
  assert.match(source, /normalizeLegacyMintPage\(request\.body\?\.config \|\| \{\}, await networkPolicy\(chainId\)\)/);
});
check('Preserved frontend and backend network helpers compile', () => {
  for (const p of ['app.js','relicforge-networks.js','relicforge-product-ui.js','server/src/index.js','server/src/routes/rf26.js','server/src/routes/collections.js','server/src/lib/rf26-public-guards.js','server/src/lib/rf26-networks.js','server/src/lib/rf26-project-model.js','server/src/lib/rf26-mint-page-policy.js']) nodeCheck(p);
});
check('Legacy publication guard rejects unauthorized promotion', async () => {
  const { normalizeLegacyMintPage: normalize } = await import(pathToFileURL(path.join(repo, 'server/src/lib/rf26-mint-page-policy.js')));
  const policy = { chain_id: 11155111, kind: 'testnet', public_enabled: false };
  for (const value of [{slug:'my-collection'}, {listed:true}, {featured:true}, {featureRequested:true}, {showcaseEnabled:true}, {listed:'true'}]) assert.throws(() => normalize(value, policy));
  const original = { name:'Relic', collectionImageAssetId:'abc', slug:null, listed:false, chainId:1, contract:'spoofed' };
  const result = normalize(original, policy);
  assert.deepEqual(result, { name:'Relic', collectionImageAssetId:'abc' });
  assert.equal(original.chainId, 1);
  assert.deepEqual(normalize({name:'Mainnet'}, {chain_id:1,kind:'production',public_enabled:true}), {name:'Mainnet'});
});
check('Production network remains disabled and Sepolia remains available', () => {
  const addresses = read('relicforge-v2-addresses.js');
  const context = { window: {} };
  const vm = requireVm();
  vm.runInNewContext(addresses, context);
  const config = context.window.RELICFORGE_V2_ADDRESSES;
  assert.equal(config[1].launchEnabled, false);
  assert.equal(config[11155111].launchEnabled, true);
  assert.equal(config[11155111].factory.toLowerCase(), '0x2d63a398c037fe9ea09c7176eab378c5a51fa88d');
});
check('No certified production-contract edits', () => {
  const diff = git('diff', '--name-only', 'b575134d229632d3a857d1877f70aeaf74e63cf6', 'HEAD', '--', 'contracts/production');
  assert.equal(diff, '');
  const work = git('diff', '--name-only', '--', 'contracts/production');
  assert.equal(work, '');
});
check('RF26 schema and source files are present', () => {
  for (const p of ['server/sql/007_rf26_project_deployments.sql','server/src/lib/rf26-networks.js','server/src/lib/rf26-project-model.js','server/src/routes/rf26.js']) assert.ok(fs.existsSync(path.join(repo,p)), p);
  const sql = read('server/sql/007_rf26_project_deployments.sql');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS rf26_publications_slug_unique/);
  assert.match(sql, /'Ethereum Mainnet','production',FALSE,FALSE/);
});
function requireVm() { return vmModule; }
const vmModule = await import('node:vm');
let failures = 0;
for (const { label, fn } of checks) {
  try { await fn(); console.log(`PASS ${label}`); }
  catch (error) { failures++; console.error(`FAIL ${label}: ${error.message}`); }
}
console.log(`\nPhase 2B R2: ${checks.length - failures}/${checks.length} checks passed.`);
if (failures) process.exitCode = 1;
