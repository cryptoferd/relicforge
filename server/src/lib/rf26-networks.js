// Server-owned network release policy. The public Alchemy catalog is a read
// catalog, not permission to deploy or publish a Relic Forge collection.
import { one } from './db.js';
import { normalizeSlug as canonicalSlug } from './rf26-slug-core.js';

export function networkId(value) {
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<=0)throw Object.assign(new Error('Invalid chain ID.'),{statusCode:400});
  return id;
}
export async function networkPolicy(value,runner=one) {
  const id=networkId(value);
  const row=await runner(
    `SELECT chain_id,label,kind,launch_enabled,public_enabled,factory_address,release_id,release_manifest_hash,configuration
     FROM rf26_networks WHERE chain_id=$1`,[id]
  );
  if(!row)throw Object.assign(new Error('This network is not supported by Relic Forge.'),{statusCode:400});
  return row;
}
export function assertProductionPublication(policy) {
  if(policy.kind!=='production'||!policy.public_enabled||!policy.launch_enabled||
     !policy.factory_address||!policy.release_id||!policy.release_manifest_hash)
    throw Object.assign(new Error('Custom slugs and public discovery are available only on enabled production networks.'),{statusCode:403});
  return policy;
}
export function assertDeploymentEnabled(policy) {
  if(!policy.launch_enabled||!policy.factory_address)
    throw Object.assign(new Error('Relic Forge deployment is not available on this network yet.'),{statusCode:409});
  if(policy.kind==='production'&&(!policy.release_id||!policy.release_manifest_hash))
    throw Object.assign(new Error('The production deployment manifest has not been activated.'),{statusCode:409});
  return policy;
}
export function assertNoTestnetPromotion(policy,settings={}) {
  if(policy.kind==='production'&&policy.public_enabled)return true;
  if(settings?.showcaseEnabled===true||settings?.featured===true||
     settings?.featureRequested===true||settings?.listed===true||settings?.slug!=null)
    throw Object.assign(new Error('Testnet deployments cannot be listed, featured, or assigned a custom slug.'),{statusCode:403});
  return true;
}
export function normalizeSlug(value) {
  return canonicalSlug(value);
}
