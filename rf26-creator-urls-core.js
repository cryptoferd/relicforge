export const RESERVED_SLUGS = Object.freeze([
  'admin','api','app','assets','auth','blog','collections','create','dashboard',
  'docs','ethereum','explore','favicon','forge','help','home','how-to','index',
  'login','logout','mainnet','mint','new','profile','projects','relicforge',
  'reliquary','settings','static','studio','support','test','testnet','upcoming',
  'v1','v2','www','sepolia'
]);

const reserved = new Set(RESERVED_SLUGS);
export const ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
export const ZERO_ADDRESS_RE = /^0x0{40}$/i;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
export const PRODUCTION_CHAIN_ID = 1;
export const SEPOLIA_CHAIN_ID = 11155111;

export class CreatorUrlError extends Error {
  constructor(message,{status=400,code='INVALID_REQUEST'}={}) {
    super(message);
    this.name='CreatorUrlError';
    this.status=status;
    this.code=code;
  }
}

export function normalizeSlug(value) {
  if(typeof value!=='string')throw new CreatorUrlError('Enter a custom mint URL.');
  const slug=value.trim().toLowerCase();
  if(!SLUG_RE.test(slug)||slug.includes('--'))
    throw new CreatorUrlError('Use 3–48 letters, numbers, or single hyphens; no leading or trailing hyphen.');
  if(reserved.has(slug)||/^0x[0-9a-f]{40}$/.test(slug))
    throw new CreatorUrlError('This name is reserved.');
  return slug;
}

export function normalizeAddress(value) {
  const address=String(value||'').trim().toLowerCase();
  if(!ADDRESS_RE.test(address)||ZERO_ADDRESS_RE.test(address))
    throw new CreatorUrlError('Invalid collection address.');
  return address;
}

export function normalizeChainId(value) {
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<=0)throw new CreatorUrlError('Invalid deployment network.');
  return id;
}

export function normalizeDeployment(value) {
  if(!value||typeof value!=='object')throw new CreatorUrlError('Select a deployed collection first.');
  const chainId=normalizeChainId(value.chainId);
  const contract=normalizeAddress(value.contract??value.collectionAddress??value.address);
  const projectId=typeof value.projectId==='string'&&value.projectId.trim()?value.projectId.trim():null;
  return {chainId,contract,projectId};
}

export function canonicalMintPath(chainId,contract) {
  return `/mint.html?chain=${normalizeChainId(chainId)}&contract=${encodeURIComponent(normalizeAddress(contract))}`;
}
export function customMintPath(slug) {
  return `/mint/${encodeURIComponent(normalizeSlug(slug))}`;
}
export function deploymentPublicationPath(chainId,contract,suffix='') {
  const id=normalizeChainId(chainId),address=normalizeAddress(contract);
  if(suffix&&!['/slug','/publication'].includes(suffix))throw new CreatorUrlError('Invalid publication endpoint.');
  return `/api/rc26/deployments/${id}/${encodeURIComponent(address)}${suffix||'/publication'}`;
}
export function slugAvailabilityPath(slug) {
  return `/api/public/mint-slugs/${encodeURIComponent(normalizeSlug(slug))}/available`;
}

export function publicationInput(listed,featureRequested) {
  const isListed=listed===true;
  return {listed:isListed,featureRequested:isListed&&featureRequested===true};
}

export function publicationView(value={}) {
  return {
    slug:typeof value.slug==='string'&&value.slug?normalizeSlug(value.slug):null,
    listed:value.listed===true,
    featureRequested:value.featureRequested===true,
    featured:value.featured===true
  };
}

function firstDeployment(candidates) {
  for(const candidate of candidates) {
    if(!candidate||typeof candidate!=='object')continue;
    try{return normalizeDeployment(candidate);}catch{}
  }
  return null;
}

export function deploymentFromEvent(detail) {
  if(!detail||typeof detail!=='object')return null;
  return firstDeployment([
    detail,
    detail.deployment,
    detail.collection,
    detail.result,
    detail.publication
  ]);
}

export function deploymentFromForgeState(state) {
  if(!state||typeof state!=='object')return null;
  const journal=state.deploymentJournal;
  const current=state.currentDeployment;
  const candidates=[];
  if(journal&&typeof journal==='object') {
    candidates.push({
      chainId:journal.chainId,
      contract:journal.contract??journal.collectionAddress??state.collectionAddress,
      projectId:journal.projectId??state.projectId
    });
  }
  if(current&&typeof current==='object')candidates.push(current);
  // Do not use a top-level selected/wallet network as deployment identity.
  // A Forge deployment must be journaled or explicitly represented.
  return firstDeployment(candidates);
}

export function deploymentFromResumeContext(context) {
  if(!context||typeof context!=='object')return null;
  const deployment=context.deployment??context.currentDeployment??context.deploymentJournal;
  return firstDeployment([
    deployment,
    context.chainId!=null?{
      chainId:context.chainId,
      contract:context.contract??context.collectionAddress,
      projectId:context.projectId
    }:null
  ]);
}

export function deploymentFromQuery(search) {
  const params=new URLSearchParams(String(search||'').replace(/^\?/,''));
  const chain=params.get('chain');
  const contract=params.get('contract')??params.get('collection');
  if(chain==null||contract==null)return null;
  try{return normalizeDeployment({chainId:chain,contract,projectId:params.get('project')});}catch{return null;}
}

export function selectDeploymentContext({explicit,eventDetail,forgeState,resumeContext,querySearch}={}) {
  return firstDeployment([
    explicit,
    deploymentFromEvent(eventDetail),
    deploymentFromForgeState(forgeState),
    deploymentFromResumeContext(resumeContext),
    deploymentFromQuery(querySearch)
  ]);
}

export function deploymentMode(deployment) {
  if(!deployment)return 'none';
  const id=normalizeChainId(deployment.chainId);
  if(id===PRODUCTION_CHAIN_ID)return 'production';
  if(id===SEPOLIA_CHAIN_ID)return 'testnet';
  return 'unsupported';
}

export function friendlyError(error) {
  const status=Number(error?.statusCode??error?.status??error?.response?.status??0);
  const code=String(error?.code??error?.errorCode??'').toUpperCase();
  if(code==='SLUG_TAKEN'||status===409&&/already.*claimed|taken/i.test(String(error?.message||'')))
    return 'That mint URL is already claimed by another collection.';
  if(code==='SLUG_PERMANENT')
    return 'This collection already has a permanent mint URL and it cannot be renamed.';
  if(code==='PRODUCTION_DISABLED')
    return 'Production mint URLs are not active yet. Mainnet remains locked until the verified production release.';
  if(status===401)return 'Sign in to Relic Forge Cloud with the collection controller wallet.';
  if(status===403)return 'The connected wallet is not authorized to manage this collection, or production publication is not active yet.';
  if(status===404)return 'This deployment is not registered with the Relic Forge production registry yet.';
  if(status===409)return String(error?.message||'The collection is not ready for publication.');
  const message=String(error?.message||'').trim();
  return message&&message.length<=240?message:'The request could not be completed.';
}

export const RELEASE_PROBE_SLUG='relicforge-release-check';

export function createCreatorUrlClient({publicRequest,authenticatedRequest}={}) {
  if(typeof publicRequest!=='function'||typeof authenticatedRequest!=='function')
    throw new CreatorUrlError('Creator URL API adapters are required.');

  async function productionStatus() {
    const result=await publicRequest(slugAvailabilityPath(RELEASE_PROBE_SLUG));
    return {productionAvailable:result?.productionAvailable===true};
  }

  async function load(rawDeployment) {
    const deployment=normalizeDeployment(rawDeployment);
    const mode=deploymentMode(deployment);
    if(mode!=='production')return {deployment,mode,productionAvailable:false,publication:null,serverDeployment:null};
    const gate=await productionStatus();
    if(!gate.productionAvailable)
      return {deployment,mode,productionAvailable:false,publication:null,serverDeployment:null};
    const result=await authenticatedRequest(deploymentPublicationPath(deployment.chainId,deployment.contract));
    return {
      deployment,mode,productionAvailable:true,
      publication:publicationView(result?.publication??{}),
      serverDeployment:result?.deployment??null
    };
  }

  async function availability(rawDeployment,rawSlug) {
    const deployment=normalizeDeployment(rawDeployment);
    if(deploymentMode(deployment)!=='production')
      throw new CreatorUrlError('Custom mint URLs are production-only.',{status:403,code:'PRODUCTION_ONLY'});
    const slug=normalizeSlug(rawSlug);
    const result=await publicRequest(slugAvailabilityPath(slug));
    return {
      slug,
      available:result?.available===true,
      claimed:result?.claimed===true,
      productionAvailable:result?.productionAvailable===true
    };
  }

  async function claim(rawDeployment,rawSlug,{projectId=null}={}) {
    const deployment=normalizeDeployment(rawDeployment);
    if(deploymentMode(deployment)!=='production')
      throw new CreatorUrlError('Custom mint URLs are production-only.',{status:403,code:'PRODUCTION_ONLY'});
    const slug=normalizeSlug(rawSlug);
    const body={slug};
    const id=projectId??deployment.projectId;
    if(typeof id==='string'&&id.trim())body.projectId=id.trim();
    return authenticatedRequest(
      deploymentPublicationPath(deployment.chainId,deployment.contract,'/slug'),
      {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}
    );
  }

  async function savePublication(rawDeployment,{listed=false,featureRequested=false}={}) {
    const deployment=normalizeDeployment(rawDeployment);
    if(deploymentMode(deployment)!=='production')
      throw new CreatorUrlError('Public discovery is production-only.',{status:403,code:'PRODUCTION_ONLY'});
    const body=publicationInput(listed,featureRequested);
    const result=await authenticatedRequest(
      deploymentPublicationPath(deployment.chainId,deployment.contract,'/publication'),
      {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}
    );
    return {publication:publicationView(result?.publication??body)};
  }

  return Object.freeze({productionStatus,load,availability,claim,savePublication});
}
