// R3B: one canonical policy for URL claims and public resolution.
export const RESERVED_SLUGS = Object.freeze([
  'admin','api','app','assets','auth','blog','collections','create','dashboard',
  'docs','ethereum','explore','favicon','forge','help','home','how-to','index',
  'login','logout','mainnet','mint','new','profile','projects','relicforge',
  'reliquary','settings','static','studio','support','test','testnet','upcoming',
  'v1','v2','www','sepolia'
]);
const reserved = new Set(RESERVED_SLUGS);
export const fail = (message,statusCode=400,code='INVALID_REQUEST') =>
  Object.assign(new Error(message),{statusCode,code});

export function normalizeSlug(value) {
  if(typeof value!=='string')throw fail('Enter a custom mint URL.');
  const slug=value.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug)||slug.includes('--'))
    throw fail('Use 3–48 letters, numbers, or single hyphens; no leading or trailing hyphen.');
  if(reserved.has(slug)||/^0x[0-9a-f]{40}$/.test(slug))
    throw fail('This slug is reserved.');
  return slug;
}
export function chainId(value) {
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<=0)throw fail('Invalid chain ID.');
  return id;
}
export function address(value) {
  const a=String(value||'').toLowerCase();
  if(!/^0x[0-9a-f]{40}$/.test(a)||/^0x0{40}$/.test(a))throw fail('Invalid EVM address.');
  return a;
}
export function productionPolicy(policy) {
  if(!policy||policy.kind!=='production'||policy.launch_enabled!==true||
    policy.public_enabled!==true||!policy.factory_address||!policy.release_id||
    !policy.release_manifest_hash)
    throw fail('Production mint URLs are not available on this network yet.',403,'PRODUCTION_DISABLED');
  return policy;
}
export function canonicalMintPath(id,contract) {
  return `/mint.html?chain=${chainId(id)}&contract=${encodeURIComponent(address(contract))}`;
}
export function customMintPath(slug) { return '/mint/'+normalizeSlug(slug); }
export function validProvenance(value) {
  return /^0x[0-9a-f]{64}$/i.test(String(value||''))&&!/^0x0{64}$/i.test(String(value||''));
}
export function publicTarget(row) {
  if(!row||row.kind!=='production'||row.launch_enabled!==true||
    row.public_enabled!==true||!row.release_id||!row.release_manifest_hash||
    row.architecture!=='v2'||row.status!=='sealed'||!validProvenance(row.provenance)||
    !row.factory_address||address(row.deployment_factory)!==address(row.factory_address)||
    address(row.owner_wallet)!==address(row.publication_owner))
    throw fail('Mint page not found.',404,'NOT_FOUND');
  const id=chainId(row.chain_id),contract=address(row.contract_address);
  return {chainId:id,contract,slug:normalizeSlug(row.slug),
    listed:row.listed===true,featured:row.featured===true,
    mintPage:canonicalMintPath(id,contract),permanent:true};
}
