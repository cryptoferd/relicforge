import { getAddress } from 'ethers';
import { db, one } from './db.js';

export const DEFAULT_LIMITS = Object.freeze({
  projectLimit: Math.max(1, Number(process.env.PROJECT_LIMIT || 10)),
  projectAssetMaxBytes: 25 * 1024 * 1024,
  mintPageAssetMaxBytes: 2 * 1024 * 1024,
  whitelistMaxEntries: 250000,
});
const NETWORK_MODES=new Set(['disabled','founder','beta','public']);
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const merge=(...v)=>Object.assign({},...v.map(obj));
const wallet=v=>getAddress(String(v||'')).toLowerCase();
const numeric=(v,fallback,min,max)=>{const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):fallback;};

export async function runtimeSettings(){
  const {rows}=await db.query('SELECT key,value,description,updated_by,updated_at FROM founder_platform_settings ORDER BY key');
  const out={};for(const row of rows)out[row.key]=row.value;return out;
}
export async function runtimeSetting(key,fallback=null){
  const row=await one('SELECT value FROM founder_platform_settings WHERE key=$1',[String(key)]);
  return row?row.value:fallback;
}
export async function resolveWalletPolicy(walletInput,{isFounder=false}={}){
  const normalized=wallet(walletInput);
  const override=await one(`SELECT wallet,profile_name,limits,features,networks,bypass_emergency,expires_at,reason,updated_by,updated_at
    FROM founder_user_overrides WHERE wallet=$1 AND (expires_at IS NULL OR expires_at>now())`,[normalized]);
  const profileName=override?.profile_name||'Standard';
  const profile=await one(`SELECT name,description,limits,features,networks,bypass_emergency,enabled
    FROM founder_policy_profiles WHERE name=$1`,[profileName]);
  const active=profile?.enabled===false?null:profile;
  const limits=merge(DEFAULT_LIMITS,active?.limits,override?.limits);
  limits.projectLimit=numeric(limits.projectLimit,DEFAULT_LIMITS.projectLimit,1,10000);
  limits.projectAssetMaxBytes=numeric(limits.projectAssetMaxBytes,DEFAULT_LIMITS.projectAssetMaxBytes,1024,2*1024*1024*1024);
  limits.mintPageAssetMaxBytes=numeric(limits.mintPageAssetMaxBytes,DEFAULT_LIMITS.mintPageAssetMaxBytes,1024,512*1024*1024);
  limits.whitelistMaxEntries=numeric(limits.whitelistMaxEntries,DEFAULT_LIMITS.whitelistMaxEntries,1,5000000);
  return {
    wallet:normalized,profile:active?.name||'Standard',profileDescription:active?.description||'',
    limits,features:merge(active?.features,override?.features),networks:merge(active?.networks,override?.networks),
    bypassEmergency:Boolean(active?.bypass_emergency||override?.bypass_emergency),isFounder:Boolean(isFounder),
    override:override?{
      profileName:override.profile_name,limits:obj(override.limits),features:obj(override.features),networks:obj(override.networks),
      bypassEmergency:Boolean(override.bypass_emergency),expiresAt:override.expires_at||null,reason:override.reason||null,
      updatedBy:override.updated_by||null,updatedAt:override.updated_at||null
    }:null
  };
}
export async function allFeatureAccess(resolved,{isFounder=false}={}){
  const {rows}=await db.query('SELECT key,label,description,state,configuration,updated_at FROM founder_feature_flags ORDER BY key');
  const access={};
  for(const flag of rows){
    const direct=resolved.features?.[flag.key];
    if(typeof direct==='boolean'){access[flag.key]=direct;continue;}
    access[flag.key]=flag.state==='everyone'||(flag.state==='founder'&&isFounder)||(flag.state==='beta'&&(isFounder||resolved.features?.betaAccess===true));
  }
  return {access,flags:rows};
}
export async function assertRuntimeAllowed(walletInput,key,{isFounder=false,message='This Relic Forge operation is temporarily paused.'}={}){
  if(!Boolean(await runtimeSetting(key,false)))return true;
  const resolved=await resolveWalletPolicy(walletInput,{isFounder});
  if(resolved.bypassEmergency)return true;
  throw Object.assign(new Error(message),{statusCode:503});
}
export async function networkControl(chainId){
  return one(`SELECT n.chain_id,n.label,n.kind,n.launch_enabled,n.public_enabled,n.factory_address,n.release_id,
      n.release_manifest_hash,n.configuration,
      COALESCE(c.mode,CASE WHEN n.launch_enabled THEN 'public' ELSE 'disabled' END) AS founder_mode,
      c.note AS founder_note,c.updated_by AS founder_updated_by,c.updated_at AS founder_updated_at
    FROM rf26_networks n LEFT JOIN founder_network_controls c USING(chain_id) WHERE n.chain_id=$1`,[Number(chainId)]);
}
export async function effectiveNetworkPolicy(rawPolicy,walletInput=null,isFounder=false,{publicOnly=false}={}){
  if(!rawPolicy)return rawPolicy;
  const id=Number(rawPolicy.chain_id);
  const control=await one('SELECT mode FROM founder_network_controls WHERE chain_id=$1',[id]);
  const mode=NETWORK_MODES.has(control?.mode)?control.mode:(rawPolicy.launch_enabled?'public':'disabled');
  const settings=await runtimeSettings();
  let launch=Boolean(rawPolicy.launch_enabled);
  const publicEnabled=Boolean(rawPolicy.public_enabled)&&!Boolean(settings.publicDiscoveryPaused);
  if(publicOnly||!walletInput){
    launch=launch&&mode==='public'&&!Boolean(settings.newDeploymentsPaused);
  }else{
    const resolved=await resolveWalletPolicy(walletInput,{isFounder});
    const explicit=resolved.networks?.[String(id)]?.deploy;
    if(Boolean(settings.newDeploymentsPaused)&&!resolved.bypassEmergency)launch=false;
    else if(typeof explicit==='boolean')launch=explicit;
    else if(mode==='disabled')launch=false;
    else if(mode==='founder')launch=Boolean(isFounder);
    else if(mode==='beta')launch=Boolean(isFounder||resolved.features?.betaAccess);
    else launch=Boolean(rawPolicy.launch_enabled);
  }
  return {...rawPolicy,launch_enabled:launch,public_enabled:publicEnabled,founder_mode:mode};
}
export async function policyPayload(walletInput,{isFounder=false}={}){
  const resolved=await resolveWalletPolicy(walletInput,{isFounder});
  const feature=await allFeatureAccess(resolved,{isFounder});
  const settings=await runtimeSettings();
  const {rows}=await db.query(`SELECT chain_id,label,kind,launch_enabled,public_enabled,factory_address,release_id,release_manifest_hash,configuration
    FROM rf26_networks ORDER BY chain_id`);
  const networks=[];
  for(const row of rows){
    const effective=await effectiveNetworkPolicy(row,resolved.wallet,isFounder);
    networks.push({chainId:Number(row.chain_id),label:row.label,kind:row.kind,deploymentAllowed:Boolean(effective.launch_enabled),
      publicEnabled:Boolean(effective.public_enabled),mode:effective.founder_mode,override:resolved.networks?.[String(row.chain_id)]||null});
  }
  return {wallet:resolved.wallet,profile:resolved.profile,profileDescription:resolved.profileDescription,limits:resolved.limits,
    features:feature.access,networks,bypassEmergency:resolved.bypassEmergency,
    runtime:{newDeploymentsPaused:Boolean(settings.newDeploymentsPaused),projectWritesPaused:Boolean(settings.projectWritesPaused),
      mintPagePublishingPaused:Boolean(settings.mintPagePublishingPaused),whitelistPublishingPaused:Boolean(settings.whitelistPublishingPaused),
      publicDiscoveryPaused:Boolean(settings.publicDiscoveryPaused),maintenanceMode:Boolean(settings.maintenanceMode)},
    override:resolved.override};
}
