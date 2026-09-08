// Pure project/deployment model. No browser, wallet or blockchain dependency.
const BINDINGS = [
  'collectionAddress','dataAddress','mintPhasesAddress','publicPhaseId',
  'whitelistPhaseId','deploymentJournal','infra','masterMintArmed',
  'latestRequestId','latestTokenId','latestCreatorRevealRequestId'
];
const CHAIN_FIELDS = ['chainId','networkChainId','launchChainId'];
const DEPLOYMENT_ONLY = new Set([...BINDINGS,...CHAIN_FIELDS,'slug','factoryAddress','deploymentId','transactionHash','txHash']);
function stripLaunchBindings(value) {
  if(Array.isArray(value))return value.map(stripLaunchBindings);
  if(!object(value))return value;
  const out={};
  for(const [key,item] of Object.entries(value)){
    if(DEPLOYMENT_ONLY.has(key))continue;
    if(['root','merkleRoot','proof','proofByAddress','phaseId'].includes(key) &&
       (value.entries || value.proofByAddress || value.merkleRoot || value.root))continue;
    out[key]=stripLaunchBindings(item);
  }
  return out;
}
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const chain = value => {
  if (value == null || value === '') return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid launch network.');
  return id;
};
function legacyBindings(snapshot) {
  const s=object(snapshot)?snapshot:{}, f=object(s.forge)?s.forge:{};
  const found={};
  for(const key of BINDINGS) if(f[key]!==undefined)found[key]=clone(f[key]);
  const j=f.deploymentJournal;
  const id=chain(j?.chainId ?? f.chainId ?? s.chainId ?? (f.collectionAddress?11155111:null));
  if(id!==null)found.chainId=id;
  return found;
}
export function creativeSnapshot(snapshot) {
  if(!object(snapshot))throw new Error('Project snapshot must be an object.');
  const value=clone(snapshot);
  // Only known launch/deployment identity is moved. Artwork files, compiled
  // recipes, metadata, rarity, rules and unknown future creative fields survive.
  for(const key of CHAIN_FIELDS)delete value[key];
  if(object(value.forge)){
    for(const key of [...BINDINGS,...CHAIN_FIELDS])delete value.forge[key];
    // A reusable allowlist is the address/allowance list, not an onchain proof.
    if(object(value.forge.whitelist)){
      delete value.forge.whitelist.root;
      delete value.forge.whitelist.proofByAddress;
      delete value.forge.whitelist.phaseId;
    }
  }
  return value;
}
export function splitLegacyProject(snapshot) {
  return {schema:'relic-forge/project-envelope@2',
    creative:creativeSnapshot(snapshot),legacy:legacyBindings(snapshot)};
}
export function launchDraft(settings={},targetChainId=null) {
  if(!object(settings))throw new Error('Launch settings must be an object.');
  // Drafts contain reusable settings, not a deployment or a proof already
  // bound to a particular chain. The original object is never mutated.
  return {targetChainId:chain(targetChainId),settings:stripLaunchBindings(clone(settings))};
}
export function deploymentIdentity({chainId,contractAddress}) {
  const id=chain(chainId),address=String(contractAddress||'').toLowerCase();
  if(!/^0x[0-9a-f]{40}$/.test(address)||/^0x0{40}$/.test(address))
    throw new Error('Invalid deployment contract address.');
  return `${id}:${address}`;
}
export function requireDeploymentMatch(record,{chainId,contractAddress,ownerWallet,factoryAddress}) {
  if(deploymentIdentity(record)!==deploymentIdentity({chainId,contractAddress}))
    throw new Error('Deployment network or collection mismatch.');
  if(ownerWallet && String(record.owner_wallet||record.ownerWallet||'').toLowerCase()!==String(ownerWallet).toLowerCase())
    throw new Error('Deployment owner mismatch.');
  if(factoryAddress && String(record.factory_address||record.factoryAddress||'').toLowerCase()!==String(factoryAddress).toLowerCase())
    throw new Error('Deployment Factory mismatch.');
  return true;
}
