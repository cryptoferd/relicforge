// R3D-A: public, fail-closed production release contract.
// This module reads only server-owned RF26 network policy. It never enables a
// network, mutates the database, uses wallet state, or broadcasts a transaction.

export const PRODUCTION_MANIFEST_SCHEMA='relic-forge/production-release@1';
export const PRODUCTION_CHAIN_ID=1;
export const REQUIRED_PRODUCTION_ADDRESSES=Object.freeze([
  'feePolicy','collectionImplementation','dataImplementation',
  'mintPhasesImplementation','renderer','randomnessAdapter',
  'reserve','canonicalRegistry'
]);

const ADDRESS=/^0x[0-9a-f]{40}$/i;
const HASH=/^(?:0x)?[0-9a-f]{64}$/i;

function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
function address(value){
  const text=String(value||'').toLowerCase();
  return ADDRESS.test(text)&&!/^0x0{40}$/.test(text)?text:null;
}
function hash(value){
  const text=String(value||'').toLowerCase();
  return HASH.test(text)?text:null;
}
function chain(value){
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<=0)throw Object.assign(new Error('Invalid RF26 network record.'),{statusCode:500});
  return id;
}
function bool(value){return value===true;}

export function productionManifestStatus(row){
  const id=chain(row?.chain_id??row?.chainId);
  const kind=String(row?.kind||'');
  if(kind!=='production'||id!==PRODUCTION_CHAIN_ID)
    return {configured:false,state:'not-production',missing:[]};

  const config=object(row.configuration);
  const factory=address(row.factory_address??row.factoryAddress);
  const releaseId=String(row.release_id??row.releaseId??'').trim()||null;
  const manifestHash=hash(row.release_manifest_hash??row.releaseManifestHash);
  const schema=String(config.manifestSchema||'').trim();
  const environment=String(config.environment||'').trim();
  const addresses=object(config.addresses);
  const missing=[];

  if(!factory)missing.push('factory');
  if(!releaseId)missing.push('releaseId');
  if(!manifestHash)missing.push('deploymentManifestHash');
  if(schema!==PRODUCTION_MANIFEST_SCHEMA)missing.push('manifestSchema');
  if(environment!=='production')missing.push('environment');
  for(const key of REQUIRED_PRODUCTION_ADDRESSES)if(!address(addresses[key]))missing.push(key);

  const configured=missing.length===0;
  const requestedLaunch=bool(row.launch_enabled??row.launchEnabled);
  const requestedPublic=bool(row.public_enabled??row.publicEnabled);
  const launchEnabled=configured&&requestedLaunch;
  const publicEnabled=launchEnabled&&requestedPublic;

  let state='locked';
  if(requestedLaunch&&!configured)state='invalid-release';
  else if(launchEnabled&&!requestedPublic)state='launch-ready';
  else if(publicEnabled)state='public-ready';

  return {
    configured,state,missing,
    releaseId:configured?releaseId:null,
    deploymentManifestHash:configured?manifestHash:null,
    factory:configured?factory:null,
    launchEnabled,publicEnabled
  };
}

export function publicForgeNetwork(row){
  const id=chain(row?.chain_id??row?.chainId);
  const kind=String(row?.kind||'');
  if(!['production','testnet'].includes(kind))
    throw Object.assign(new Error('Invalid RF26 network kind.'),{statusCode:500});

  if(kind==='production'){
    const release=productionManifestStatus(row);
    return {
      chainId:id,
      name:String(row.label??row.name??'Ethereum Mainnet'),
      kind,
      launchEnabled:release.launchEnabled,
      publicEnabled:release.publicEnabled,
      currency:'ETH',
      release:{
        state:release.state,
        configured:release.configured,
        releaseId:release.releaseId,
        deploymentManifestHash:release.deploymentManifestHash,
        factory:release.factory,
        missing:release.missing
      }
    };
  }

  // Existing Sepolia behavior is preserved. Testnets never become public
  // discovery networks and do not require a production release manifest.
  return {
    chainId:id,
    name:String(row.label??row.name??'Development network'),
    kind,
    launchEnabled:bool(row.launch_enabled??row.launchEnabled),
    publicEnabled:false,
    currency:'ETH',
    release:{
      state:'development',
      configured:Boolean(address(row.factory_address??row.factoryAddress)),
      releaseId:String(row.release_id??row.releaseId??'').trim()||null,
      deploymentManifestHash:null,
      factory:address(row.factory_address??row.factoryAddress),
      missing:[]
    }
  };
}

export function requireProductionRelease(record){
  const result=publicForgeNetwork(record);
  if(result.kind!=='production'||!result.launchEnabled||!result.release.configured)
    throw Object.assign(new Error('Ethereum Mainnet launch is locked until the certified production release manifest is activated.'),{
      statusCode:409,code:'PRODUCTION_RELEASE_LOCKED'
    });
  return result;
}
