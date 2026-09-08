import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const coreSource=fs.readFileSync(new URL('../../rf26-creator-urls-core.js',import.meta.url),'utf8');
const core=await import('data:text/javascript;base64,'+Buffer.from(coreSource).toString('base64'));
const {
  RESERVED_SLUGS,normalizeSlug,normalizeDeployment,canonicalMintPath,
  deploymentPublicationPath,slugAvailabilityPath,publicationInput,
  selectDeploymentContext,deploymentMode,friendlyError,createCreatorUrlClient
}=core;

const A='0x'+'a'.repeat(40);
const B='0x'+'b'.repeat(40);
const mainnet={chainId:1,contract:A,projectId:'11111111-1111-4111-8111-111111111111'};
const sepolia={chainId:11155111,contract:A};

test('frontend slug policy matches the server contract',()=>{
  assert.equal(RESERVED_SLUGS.includes('mint'),true);
  assert.equal(normalizeSlug(' Chrono-Relic '),'chrono-relic');
  for(const value of ['ab','-bad','bad-','bad--slug','admin','mint','0x'+'a'.repeat(40)])
    assert.throws(()=>normalizeSlug(value));
  assert.equal(normalizeSlug('a'.repeat(48)),'a'.repeat(48));
  assert.throws(()=>normalizeSlug('a'.repeat(49)));
});
test('deployment identity is explicit and never inferred from wallet network',()=>{
  assert.deepEqual(normalizeDeployment(mainnet),{...mainnet,contract:A});
  assert.equal(deploymentMode(mainnet),'production');
  assert.equal(deploymentMode(sepolia),'testnet');
  assert.equal(selectDeploymentContext({querySearch:'?chain=1&contract='+A}).chainId,1);
  assert.equal(selectDeploymentContext({querySearch:'?contract='+A}),null);
  assert.equal(selectDeploymentContext({forgeState:{collectionAddress:A}}),null);
  assert.equal(selectDeploymentContext({forgeState:{chainId:1,collectionAddress:A}}),null);
  assert.equal(selectDeploymentContext({forgeState:{deploymentJournal:{chainId:11155111},collectionAddress:A}}).chainId,11155111);
});
test('contract-address mint fallback remains chain-qualified',()=>{
  assert.equal(canonicalMintPath(1,A),'/mint.html?chain=1&contract='+A);
  assert.equal(canonicalMintPath(11155111,A),'/mint.html?chain=11155111&contract='+A);
});
test('testnet load never performs an authenticated creator request',async()=>{
  const calls={public:0,auth:0};
  const client=createCreatorUrlClient({
    publicRequest:async()=>{calls.public++;return {};},
    authenticatedRequest:async()=>{calls.auth++;return {};}
  });
  const result=await client.load(sepolia);
  assert.equal(result.mode,'testnet');
  assert.equal(result.productionAvailable,false);
  assert.deepEqual(calls,{public:0,auth:0});
});
test('disabled mainnet checks the public release gate without signing in',async()=>{
  const paths=[];let auth=0;
  const client=createCreatorUrlClient({
    publicRequest:async path=>{paths.push(path);return {productionAvailable:false,available:true};},
    authenticatedRequest:async()=>{auth++;return {};}
  });
  const result=await client.load(mainnet);
  assert.equal(result.productionAvailable,false);
  assert.equal(auth,0);
  assert.deepEqual(paths,[slugAvailabilityPath('relicforge-release-check')]);
});
test('enabled mainnet loads publication through the authenticated controller endpoint',async()=>{
  const calls=[];
  const client=createCreatorUrlClient({
    publicRequest:async()=>({productionAvailable:true}),
    authenticatedRequest:async(path,options)=>{calls.push({path,options});return {
      publication:{slug:'chrono',listed:true,featureRequested:true,featured:false},
      deployment:{status:'sealed',projectId:mainnet.projectId}
    };}
  });
  const result=await client.load(mainnet);
  assert.equal(result.productionAvailable,true);
  assert.equal(result.publication.slug,'chrono');
  assert.equal(result.serverDeployment.status,'sealed');
  assert.equal(calls.length,1);
  assert.equal(calls[0].path,deploymentPublicationPath(1,A));
  assert.equal(calls[0].options,undefined);
});
test('availability is public, normalized and production-only',async()=>{
  const calls=[];
  const client=createCreatorUrlClient({
    publicRequest:async path=>{calls.push(path);return {available:true,claimed:false,productionAvailable:true};},
    authenticatedRequest:async()=>{throw new Error('auth should not run');}
  });
  const result=await client.availability(mainnet,' My-Relic ');
  assert.deepEqual(result,{slug:'my-relic',available:true,claimed:false,productionAvailable:true});
  assert.deepEqual(calls,[slugAvailabilityPath('my-relic')]);
  await assert.rejects(client.availability(sepolia,'my-relic'));
});
test('permanent claim uses the dedicated authenticated endpoint and project identity',async()=>{
  const calls=[];
  const client=createCreatorUrlClient({
    publicRequest:async()=>({}),
    authenticatedRequest:async(path,options)=>{calls.push({path,options});return {slug:'my-relic'};}
  });
  const result=await client.claim(mainnet,' My-Relic ');
  assert.equal(result.slug,'my-relic');
  assert.equal(calls[0].path,deploymentPublicationPath(1,A,'/slug'));
  assert.equal(calls[0].options.method,'PUT');
  assert.deepEqual(JSON.parse(calls[0].options.body),{slug:'my-relic',projectId:mainnet.projectId});
});
test('publication opt-in cannot request featuring while unlisted',async()=>{
  assert.deepEqual(publicationInput(false,true),{listed:false,featureRequested:false});
  const calls=[];
  const client=createCreatorUrlClient({
    publicRequest:async()=>({}),
    authenticatedRequest:async(path,options)=>{calls.push({path,options});return {
      publication:{slug:null,listed:false,featureRequested:false,featured:false}
    };}
  });
  await client.savePublication(mainnet,{listed:false,featureRequested:true});
  assert.equal(calls[0].path,deploymentPublicationPath(1,A,'/publication'));
  assert.deepEqual(JSON.parse(calls[0].options.body),{listed:false,featureRequested:false});
});
test('server authorization and permanence errors map to creator-safe messages',()=>{
  assert.match(friendlyError({status:401}),/Sign in/);
  assert.match(friendlyError({status:403,code:'PRODUCTION_DISABLED'}),/not active yet/i);
  assert.match(friendlyError({status:409,code:'SLUG_TAKEN'}),/already claimed/i);
  assert.match(friendlyError({status:409,code:'SLUG_PERMANENT'}),/cannot be renamed/i);
  assert.match(friendlyError({status:404}),/not registered/i);
});
test('UI source does not guess credentials or expose secret storage conventions',()=>{
  const source=fs.readFileSync(new URL('../../rf26-creator-urls.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\blocalStorage\b|\bsessionStorage\b|Authorization\s*:|Bearer\s|privateKey|seedPhrase|mnemonic/i);
  assert.match(source,/RelicForgeCloud/);
  assert.match(source,/ensureSignedIn/);
  assert.match(source,/cloud\.json\(path,options,true\)/);
  assert.match(source,/relicforge:v2-launch-complete/);
  assert.match(source,/textContent/);
  assert.equal((source.match(/\.innerHTML=/g)||[]).length,1);
});
