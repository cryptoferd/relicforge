const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('Founder operations migration installs policy/override/flag/runtime/audit tables and safe defaults',()=>{
  const s=read('server/sql/015_founder_operations_console.sql');
  for(const table of ['founder_policy_profiles','founder_user_overrides','founder_feature_flags','founder_network_controls','founder_platform_settings','founder_announcements','founder_admin_audit']){
    assert.match(s,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(s,/\('Standard','Default Relic Forge creator policy'/);
  assert.match(s,/\('Founder','Founder policy profile/);
  assert.match(s,/\('newDeploymentsPaused','false'/);
  assert.match(s,/\('publicDiscoveryPaused','false'/);
  assert.match(s,/SELECT chain_id,CASE WHEN launch_enabled THEN 'public' ELSE 'disabled' END/);
});

test('Founder policy service merges per-user limits and supports network/runtime policy',()=>{
  const s=read('server/src/lib/founder-policy.js');
  assert.match(s,/projectLimit/);
  assert.match(s,/projectAssetMaxBytes/);
  assert.match(s,/mintPageAssetMaxBytes/);
  assert.match(s,/whitelistMaxEntries/);
  assert.match(s,/bypassEmergency/);
  assert.match(s,/mode==='founder'/);
  assert.match(s,/mode==='beta'/);
  assert.match(s,/newDeploymentsPaused/);
  assert.match(s,/publicDiscoveryPaused/);
});

test('Founder ops mutations require reasons and write an audit log',()=>{
  const s=read('server/src/routes/founder-ops.js');
  assert.match(s,/An admin reason is required/);
  assert.match(s,/INSERT INTO founder_admin_audit/);
  for(const action of ['user.override.set','feature.update','network.policy.update','runtime.update','announcement.create']){
    assert.match(s,new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(s,/ENABLE PUBLIC DISCOVERY/);
});

test('Project, asset, mint page and whitelist limits consume the resolved per-wallet policy',()=>{
  const projects=read('server/src/routes/projects.js');
  const assets=read('server/src/routes/assets.js');
  const collections=read('server/src/routes/collections.js');
  assert.match(projects,/resolveWalletPolicy/);
  assert.match(projects,/projectWritesPaused/);
  assert.match(assets,/projectAssetMaxBytes/);
  assert.match(assets,/mintPageAssetMaxBytes/);
  assert.match(collections,/whitelistMaxEntries/);
  assert.match(collections,/mintPagePublishingPaused/);
  assert.match(collections,/whitelistPublishingPaused/);
});

test('Deployment preflight and registration enforce effective network policy',()=>{
  const route=read('server/src/routes/rf26.js');
  const browser=read('rf26-forge-network.js');
  assert.match(route,/effectiveNetworkPolicy/);
  assert.match(route,/publicOnly:true/);
  assert.match(route,/request\.user\.wallet/);
  assert.match(browser,/\/api\/policy\/forge-networks\//);
  assert.match(browser,/authorization='Bearer '/);
});

test('Public discovery emergency switch is fail-closed in public guards',()=>{
  const s=read('server/src/lib/rf26-public-guards.js');
  assert.match(s,/publicDiscoveryPaused/);
  assert.match(s,/if\(await discoveryPaused\(\)\)return false/);
  assert.match(s,/if\(await discoveryPaused\(\)\)return new Set\(\)/);
  assert.match(s,/model:'public-discovery-paused'/);
});

test('Founder Console includes all requested operations tabs and preserves existing admin tabs',()=>{
  const s=read('founder-operations.js');
  for(const label of ['Overview','Users & Overrides','Networks','Feature Flags','Collections','Reserve & Randomness','Operations','Announcements','Audit Log']){
    assert.match(s,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  const html=read('studio.html');
  for(const preserved of ['data-founder-tab="projects"','data-founder-tab="fees"','data-founder-tab="safe"']){
    assert.match(html,new RegExp(preserved.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(html,/founder-operations\.css/);
  assert.match(html,/founder-operations\.js/);
  assert.match(html,/relicforge-user-policy\.js/);
});

test('Founder operations UI contains diagnostics, profiles, emergency controls and announcements',()=>{
  const s=read('founder-operations.js');
  for(const token of ['Override profiles','Run Full Diagnostic','Public discovery','Beta / allowlist','Publish Announcement','Collection diagnostics','Emergency website controls']){
    assert.match(s,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(s,/window\.RelicForgeFounderOps/);
});

test('Safe Admin remains generator-only and can deep-link platform/collection calls',()=>{
  const s=read('founder-safe-admin.js');
  assert.doesNotMatch(s,/getSigner\s*\(/);
  assert.doesNotMatch(s,/sendTransaction\s*\(/);
  assert.match(s,/function openPlatform\(/);
  assert.match(s,/function openForCollection\(/);
  assert.match(s,/actionNeedsCollection/);
});

test('Announcements/maintenance runtime banner is installed on primary site surfaces',()=>{
  for(const rel of ['studio.html','mint.html','dashboard.html','index.html']){
    const s=read(rel);
    assert.match(s,/relicforge-runtime-banner\.css/);
    assert.match(s,/relicforge-runtime-banner\.js/);
  }
});

test('Founder operations do not embed dashboard admin wallet or mutate certified release addresses',()=>{
  const files=['founder-operations.js','server/src/routes/founder-ops.js','server/src/lib/founder-policy.js'];
  for(const rel of files){
    const s=read(rel);
    assert.doesNotMatch(s,/0x8A651D64E05E1Ebd6612e36ecec5184F549e4106/i);
    assert.doesNotMatch(s,/0x56C9fD8a81F5d0Ce389D04C7e5EA372093930da7/i);
  }
});
