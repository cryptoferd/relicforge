import {
  CreatorUrlError,PRODUCTION_CHAIN_ID,SEPOLIA_CHAIN_ID,
  normalizeSlug,normalizeDeployment,canonicalMintPath,customMintPath,
  publicationView,selectDeploymentContext,deploymentMode,friendlyError,
  createCreatorUrlClient
} from './rf26-creator-urls-core.js';

const VERSION='R3C-B-R1';
const ids=Object.freeze({
  trigger:'rf26CreatorUrlTrigger',drawer:'rf26CreatorUrlDrawer',backdrop:'rf26CreatorUrlBackdrop',
  close:'rf26CreatorUrlClose',network:'rf26CreatorUrlNetwork',contract:'rf26CreatorUrlContract',
  direct:'rf26CreatorUrlDirect',copyDirect:'rf26CreatorUrlCopyDirect',status:'rf26CreatorUrlStatus',
  load:'rf26CreatorUrlLoad',production:'rf26CreatorUrlProduction',testnet:'rf26CreatorUrlTestnet',
  slug:'rf26CreatorUrlSlug',preview:'rf26CreatorUrlPreview',availability:'rf26CreatorUrlAvailability',
  check:'rf26CreatorUrlCheck',understand:'rf26CreatorUrlUnderstand',claim:'rf26CreatorUrlClaim',
  claimed:'rf26CreatorUrlClaimed',claimedUrl:'rf26CreatorUrlClaimedUrl',copyClaimed:'rf26CreatorUrlCopyClaimed',openClaimed:'rf26CreatorUrlOpenClaimed',
  listed:'rf26CreatorUrlListed',feature:'rf26CreatorUrlFeature',featured:'rf26CreatorUrlFeatured',
  save:'rf26CreatorUrlSave',publicationStatus:'rf26CreatorUrlPublicationStatus',
  project:'rf26CreatorUrlProject'
});

const state={
  deployment:null,explicitDeployment:null,publication:null,projectId:null,
  productionAvailable:false,availability:false,availabilitySlug:null,
  requestSequence:0,busy:false,installed:false,adapters:{},loaded:false
};

const byId=id=>document.getElementById(id);
const setText=(id,value)=>{const node=byId(id);if(node)node.textContent=String(value??'');};
const setHidden=(id,hidden)=>{const node=byId(id);if(node)node.hidden=Boolean(hidden);};
const setDisabled=(id,disabled)=>{const node=byId(id);if(node)node.disabled=Boolean(disabled);};
const shortAddress=value=>value?`${value.slice(0,8)}…${value.slice(-6)}`:'—';

function apiBase() {
  const configured=state.adapters.apiBase??window.RELICFORGE_CONFIG?.apiBase;
  if(typeof configured!=='string'||!configured.trim())throw new CreatorUrlError('Relic Forge Cloud is unavailable.');
  const url=new URL(configured,location.href);
  if(!['https:','http:'].includes(url.protocol))throw new CreatorUrlError('Relic Forge Cloud configuration is invalid.');
  return url.href.replace(/\/+$/,'');
}
function apiUrl(path) { return new URL(path,apiBase()+'/').href; }

async function parseJsonResponse(response) {
  let payload=null;
  try{payload=await response.json();}catch{}
  if(response.ok)return payload??{};
  const error=new CreatorUrlError(
    payload?.message??payload?.error??`Request failed (${response.status}).`,
    {status:response.status,code:payload?.code??payload?.errorCode??'REQUEST_FAILED'}
  );
  error.payload=payload;
  throw error;
}

async function publicRequest(path) {
  if(typeof state.adapters.publicRequest==='function')return state.adapters.publicRequest(path);
  const response=await fetch(apiUrl(path),{
    method:'GET',headers:{accept:'application/json'},cache:'no-store',credentials:'omit'
  });
  return parseJsonResponse(response);
}

function cloudApi() {
  const cloud=window.RelicForgeCloud;
  if(!cloud?.enabled?.())throw new CreatorUrlError('Relic Forge Cloud is unavailable.');
  if(typeof cloud.json!=='function'||typeof cloud.ensureSignedIn!=='function')
    throw new CreatorUrlError('Relic Forge Cloud sign-in is not ready. Reload Studio and try again.');
  return cloud;
}
async function requestWallet() {
  if(typeof state.adapters.requestWallet==='function')return state.adapters.requestWallet();
  const wallets=window.RelicForgeWalletSession??window.RelicForgeWallets;
  let account=null;
  if(typeof wallets?.requestAccount==='function')account=await wallets.requestAccount({forceChooser:false});
  else if(window.ethereum?.request)account=(await window.ethereum.request({method:'eth_requestAccounts'}))?.[0]??null;
  const text=String(account??'');
  if(!/^0x[0-9a-fA-F]{40}$/.test(text)||/^0x0{40}$/i.test(text))
    throw new CreatorUrlError('Connect an EVM wallet to continue.');
  return window.ethers?.getAddress?window.ethers.getAddress(text):text.toLowerCase();
}
async function authenticatedRequest(path,options={}) {
  if(typeof state.adapters.authenticatedRequest==='function')
    return state.adapters.authenticatedRequest(path,options);
  const cloud=cloudApi();
  const wallet=await requestWallet();
  await cloud.ensureSignedIn(wallet);
  return cloud.json(path,options,true);
}

function client() {
  return createCreatorUrlClient({publicRequest,authenticatedRequest});
}

function status(message,tone='neutral',target=ids.status) {
  const node=byId(target);
  if(!node)return;
  node.textContent=String(message??'');
  node.dataset.tone=tone;
}
function setBusy(busy) {
  state.busy=Boolean(busy);
  const controls=[ids.load,ids.check,ids.claim,ids.save,ids.copyDirect,ids.copyClaimed];
  for(const id of controls)setDisabled(id,state.busy);
  if(!state.busy)syncControlState();
}
function productionLockedMessage() {
  return 'Ethereum Mainnet mint URLs remain locked until Relic Forge activates the verified production release.';
}

function installMarkup() {
  if(byId(ids.drawer))return;
  const backdrop=document.createElement('div');
  backdrop.id=ids.backdrop;
  backdrop.className='rf26-url-backdrop';
  backdrop.hidden=true;

  const drawer=document.createElement('aside');
  drawer.id=ids.drawer;
  drawer.className='rf26-url-drawer';
  drawer.setAttribute('aria-label','Mint URL settings');
  drawer.setAttribute('aria-hidden','true');
  drawer.innerHTML=`
    <div class="rf26-url-head">
      <div><span class="rf26-url-kicker">COLLECTION MANAGEMENT</span><h2>Permanent Mint URL</h2></div>
      <button id="${ids.close}" class="rf26-url-icon" type="button" aria-label="Close mint URL settings">×</button>
    </div>
    <div class="rf26-url-body">
      <section class="rf26-url-card rf26-url-identity">
        <div class="rf26-url-card-title"><span>Deployment</span><span id="${ids.network}" class="rf26-url-badge">None selected</span></div>
        <p id="${ids.contract}" class="rf26-url-contract">Launch or select a deployment to begin.</p>
        <p id="${ids.project}" class="rf26-url-subtle" hidden></p>
        <label class="rf26-url-label">Contract-address mint link</label>
        <div class="rf26-url-copyrow">
          <input id="${ids.direct}" class="rf26-url-input" type="text" readonly aria-label="Contract-address mint link">
          <button id="${ids.copyDirect}" class="rf26-url-button rf26-url-secondary" type="button">Copy</button>
        </div>
        <div id="${ids.status}" class="rf26-url-status" role="status" aria-live="polite" data-tone="neutral">
          Launch or select a deployment to manage its mint URL.
        </div>
        <button id="${ids.load}" class="rf26-url-button rf26-url-primary" type="button">Load production controls</button>
      </section>

      <section id="${ids.testnet}" class="rf26-url-card" hidden>
        <span class="rf26-url-kicker">DEVELOPMENT NETWORK</span>
        <h3>Direct link only</h3>
        <p>Testnet deployments never receive custom Relic Forge slugs, discovery listings, or feature requests. The contract-address link above remains available for testing.</p>
      </section>

      <section id="${ids.production}" class="rf26-url-card" hidden>
        <div class="rf26-url-card-title"><span>Custom URL</span><span class="rf26-url-badge rf26-url-badge-warn">Permanent</span></div>
        <p>Choose a human-readable path for a verified production collection. Once claimed, it cannot be renamed or transferred through Relic Forge.</p>
        <div class="rf26-url-preview"><span>${location.origin}</span><strong>/mint/</strong><span id="${ids.preview}">your-collection</span></div>
        <label class="rf26-url-label" for="${ids.slug}">Custom slug</label>
        <input id="${ids.slug}" class="rf26-url-input" type="text" minlength="3" maxlength="48"
          spellcheck="false" autocomplete="off" placeholder="chronorelic">
        <p class="rf26-url-hint">3–48 lowercase letters, numbers, and single hyphens. Reserved routes and wallet-address lookalikes are blocked.</p>
        <div class="rf26-url-actions">
          <button id="${ids.check}" class="rf26-url-button rf26-url-secondary" type="button">Check availability</button>
          <button id="${ids.claim}" class="rf26-url-button rf26-url-primary" type="button" disabled>Claim permanently</button>
        </div>
        <div id="${ids.availability}" class="rf26-url-status" role="status" aria-live="polite" data-tone="neutral">
          Check a name before claiming it.
        </div>
        <label class="rf26-url-confirm">
          <input id="${ids.understand}" type="checkbox">
          <span>I understand this mint URL becomes permanent for this collection.</span>
        </label>
        <div id="${ids.claimed}" class="rf26-url-claimed" hidden>
          <label class="rf26-url-label">Permanent custom link</label>
          <div class="rf26-url-copyrow">
            <input id="${ids.claimedUrl}" class="rf26-url-input" type="text" readonly aria-label="Permanent custom mint link">
            <button id="${ids.copyClaimed}" class="rf26-url-button rf26-url-secondary" type="button">Copy</button>
            <a id="${ids.openClaimed}" class="rf26-url-button rf26-url-secondary" target="_blank" rel="noopener noreferrer" href="#" aria-label="Open permanent mint URL">Open</a>
          </div>
          <p class="rf26-url-hint">The custom link opens the verified collection mint page. The contract-address link above remains available.</p>
        </div>

        <hr class="rf26-url-rule">
        <div class="rf26-url-card-title"><span>Public discovery</span><span id="${ids.featured}" class="rf26-url-badge">Not featured</span></div>
        <p>A custom URL does not automatically publish the collection. Direct sharing and public discovery remain separate choices.</p>
        <label class="rf26-url-toggle">
          <input id="${ids.listed}" type="checkbox">
          <span><strong>List in Relic Forge</strong><small>Opt this production collection into public discovery.</small></span>
        </label>
        <label class="rf26-url-toggle">
          <input id="${ids.feature}" type="checkbox">
          <span><strong>Request featuring</strong><small>Requests review only. Featured placement is controlled by Relic Forge.</small></span>
        </label>
        <button id="${ids.save}" class="rf26-url-button rf26-url-primary" type="button">Save publication settings</button>
        <div id="${ids.publicationStatus}" class="rf26-url-status" role="status" aria-live="polite" data-tone="neutral">
          No publication changes saved.
        </div>
      </section>
    </div>`;
  document.body.append(backdrop,drawer);

  const trigger=document.createElement('button');
  trigger.id=ids.trigger;
  trigger.type='button';
  trigger.className='rf26-url-trigger';
  trigger.textContent='Mint URL';
  trigger.setAttribute('aria-controls',ids.drawer);
  trigger.setAttribute('aria-expanded','false');
  const host=document.querySelector('.topbar-actions,.studio-topbar-actions,.topbar .actions,.header-actions');
  if(host){trigger.classList.add('rf26-url-trigger-inline');host.appendChild(trigger);}
  else document.body.appendChild(trigger);
}

function openDrawer() {
  setHidden(ids.backdrop,false);
  const drawer=byId(ids.drawer),trigger=byId(ids.trigger);
  drawer?.classList.add('is-open');
  drawer?.setAttribute('aria-hidden','false');
  trigger?.setAttribute('aria-expanded','true');
}
function closeDrawer() {
  setHidden(ids.backdrop,true);
  const drawer=byId(ids.drawer),trigger=byId(ids.trigger);
  drawer?.classList.remove('is-open');
  drawer?.setAttribute('aria-hidden','true');
  trigger?.setAttribute('aria-expanded','false');
}

function directUrl(deployment) {
  return new URL(canonicalMintPath(deployment.chainId,deployment.contract),location.origin).href;
}
function slugUrl(slug) {
  return new URL(customMintPath(slug),location.origin).href;
}
function renderDeployment() {
  const deployment=state.deployment;
  state.loaded=false;
  state.publication=null;
  state.projectId=deployment?.projectId??null;
  state.productionAvailable=false;
  state.availability=false;
  state.availabilitySlug=null;

  const direct=byId(ids.direct);
  if(!deployment) {
    setText(ids.network,'None selected');
    setText(ids.contract,'Launch or select a deployment to begin.');
    if(direct)direct.value='';
    setHidden(ids.project,true);
    setHidden(ids.testnet,true);
    setHidden(ids.production,true);
    setDisabled(ids.load,true);
    status('Launch or select a deployment to manage its mint URL.');
    syncControlState();
    return;
  }

  const mode=deploymentMode(deployment);
  setText(ids.network,mode==='production'?'Ethereum Mainnet':mode==='testnet'?'Ethereum Sepolia':'Unsupported network');
  setText(ids.contract,shortAddress(deployment.contract));
  if(direct)direct.value=directUrl(deployment);
  if(state.projectId){setText(ids.project,'Project '+state.projectId);setHidden(ids.project,false);}
  else setHidden(ids.project,true);

  setHidden(ids.testnet,mode!=='testnet');
  setHidden(ids.production,mode!=='production');
  if(mode==='testnet') {
    setDisabled(ids.load,true);
    status('Sepolia is a development deployment. Custom slugs, discovery listing, and feature requests are intentionally unavailable.','info');
  } else if(mode==='production') {
    setDisabled(ids.load,false);
    status('Production controls are gated by the verified Relic Forge release registry.','neutral');
    resetProductionForm();
  } else {
    setDisabled(ids.load,true);
    status('Custom URLs are not available for this deployment network.','warn');
  }
  syncControlState();
}

function resetProductionForm() {
  const slug=byId(ids.slug),understand=byId(ids.understand);
  if(slug){slug.value='';slug.readOnly=false;}
  if(understand)understand.checked=false;
  setText(ids.preview,'your-collection');
  setHidden(ids.claimed,true);
  const listed=byId(ids.listed),feature=byId(ids.feature);
  if(listed)listed.checked=false;
  if(feature){feature.checked=false;feature.disabled=true;}
  setText(ids.featured,'Not featured');
  status('Check a name before claiming it.','neutral',ids.availability);
  status('No publication changes saved.','neutral',ids.publicationStatus);
}

async function copyValue(inputId,targetStatus=ids.status) {
  const value=byId(inputId)?.value;
  if(!value)return;
  try{
    await navigator.clipboard.writeText(value);
    status('Link copied.','good',targetStatus);
  }catch{
    const input=byId(inputId);
    input?.focus();input?.select?.();
    status('Select and copy the highlighted link.','info',targetStatus);
  }
}

function renderPublication(data) {
  const view=publicationView(data);
  state.publication=view;
  const slugInput=byId(ids.slug),listed=byId(ids.listed),feature=byId(ids.feature);
  if(listed)listed.checked=view.listed;
  if(feature){feature.checked=view.featureRequested;feature.disabled=!view.listed||!state.productionAvailable;}
  setText(ids.featured,view.featured?'Featured by Relic Forge':'Not featured');
  if(view.slug) {
    if(slugInput){slugInput.value=view.slug;slugInput.readOnly=true;}
    setText(ids.preview,view.slug);
    const claimed=byId(ids.claimedUrl);if(claimed)claimed.value=slugUrl(view.slug);
    const open=byId(ids.openClaimed);if(open)open.href=slugUrl(view.slug);
    setHidden(ids.claimed,false);
    state.availability=true;state.availabilitySlug=view.slug;
    status('Permanent URL already claimed for this collection.','good',ids.availability);
  } else {
    setHidden(ids.claimed,true);
    if(slugInput)slugInput.readOnly=false;
    status('Choose a name and check availability.','neutral',ids.availability);
  }
  syncControlState();
}

async function loadProductionControls() {
  if(!state.deployment||deploymentMode(state.deployment)!=='production')
    throw new CreatorUrlError('Select an Ethereum Mainnet deployment first.');
  status('Checking production release status…','neutral');
  const result=await client().load(state.deployment);
  state.productionAvailable=result.productionAvailable===true;
  if(!state.productionAvailable) {
    state.loaded=false;
    status(productionLockedMessage(),'warn');
    status(productionLockedMessage(),'warn',ids.availability);
    status('Public discovery remains locked with the production release.','warn',ids.publicationStatus);
    syncControlState();
    return;
  }
  state.loaded=true;
  state.projectId=result?.serverDeployment?.projectId??state.projectId;
  if(state.projectId){setText(ids.project,'Project '+state.projectId);setHidden(ids.project,false);}
  renderPublication(result?.publication??{});
  status(result?.serverDeployment?.status==='sealed'
    ?'Verified production deployment loaded. Permanent URL controls are ready.'
    :'Deployment loaded, but it must be sealed before publication writes are allowed.',
    result?.serverDeployment?.status==='sealed'?'good':'warn');
}

function localSlug() {
  const input=byId(ids.slug);
  return normalizeSlug(input?.value??'');
}

async function checkAvailability() {
  if(!state.deployment||deploymentMode(state.deployment)!=='production')
    throw new CreatorUrlError('Custom URLs are production-only.');
  if(state.publication?.slug)return;
  const slug=localSlug();
  const sequence=++state.requestSequence;
  state.availability=false;state.availabilitySlug=null;
  status('Checking availability…','neutral',ids.availability);
  syncControlState();
  const result=await client().availability(state.deployment,slug);
  if(sequence!==state.requestSequence)return;
  let current;
  try{current=localSlug();}catch{return;}
  if(current!==slug)return;
  state.productionAvailable=result.productionAvailable===true;
  state.availability=result.available===true;
  state.availabilitySlug=slug;
  if(!state.productionAvailable) {
    status(productionLockedMessage(),'warn',ids.availability);
  } else if(!state.availability) {
    status('That mint URL is already claimed.','bad',ids.availability);
  } else {
    status('Available. Claiming is permanent; confirm the acknowledgement below before continuing.','good',ids.availability);
  }
  syncControlState();
}

async function claimSlug() {
  if(!state.loaded||!state.productionAvailable)throw new CreatorUrlError(productionLockedMessage(),{status:403,code:'PRODUCTION_DISABLED'});
  if(state.publication?.slug)throw new CreatorUrlError('This collection already has a permanent mint URL.',{status:409,code:'SLUG_PERMANENT'});
  const slug=localSlug();
  if(!state.availability||state.availabilitySlug!==slug)throw new CreatorUrlError('Check this name again before claiming it.');
  if(byId(ids.understand)?.checked!==true)throw new CreatorUrlError('Confirm that you understand the mint URL is permanent.');
  const approved=window.confirm(`Permanently assign /mint/${slug} to this collection?\n\nThis claim cannot be renamed or transferred through Relic Forge.`);
  if(!approved)return;
  status('Confirm the Relic Forge Cloud sign-in if prompted…','neutral',ids.availability);
  const result=await client().claim(state.deployment,slug,{projectId:state.projectId});
  renderPublication({
    slug:result?.slug??slug,
    listed:state.publication?.listed===true,
    featureRequested:state.publication?.featureRequested===true,
    featured:state.publication?.featured===true
  });
  status('Permanent mint URL claimed successfully.','good',ids.availability);
}

async function savePublication() {
  if(!state.loaded||!state.productionAvailable)throw new CreatorUrlError(productionLockedMessage(),{status:403,code:'PRODUCTION_DISABLED'});
  const input={listed:byId(ids.listed)?.checked===true,featureRequested:byId(ids.feature)?.checked===true};
  status('Saving publication settings…','neutral',ids.publicationStatus);
  const result=await client().savePublication(state.deployment,input);
  renderPublication(result.publication??{...state.publication,...input});
  status(input.listed
    ?'Publication settings saved. Featuring remains subject to platform approval.'
    :'Collection removed from public discovery. Direct links remain unchanged.',
    'good',ids.publicationStatus);
}

function syncControlState() {
  const mode=deploymentMode(state.deployment);
  const slugClaimed=Boolean(state.publication?.slug);
  const slugReady=state.availability&&state.availabilitySlug&&byId(ids.understand)?.checked===true;
  setDisabled(ids.copyDirect,state.busy||!byId(ids.direct)?.value);
  setDisabled(ids.load,state.busy||mode!=='production');
  setDisabled(ids.check,state.busy||mode!=='production'||slugClaimed);
  setDisabled(ids.claim,state.busy||!state.loaded||!state.productionAvailable||slugClaimed||!slugReady);
  setDisabled(ids.save,state.busy||!state.loaded||!state.productionAvailable);
  setDisabled(ids.copyClaimed,state.busy||!slugClaimed);
  const feature=byId(ids.feature);
  if(feature)feature.disabled=state.busy||!state.loaded||!state.productionAvailable||byId(ids.listed)?.checked!==true;
}

async function action(fn,target=ids.status) {
  if(state.busy)return;
  setBusy(true);
  try{await fn();}
  catch(error){status(friendlyError(error),'bad',target);}
  finally{setBusy(false);}
}

function discoverDeployment(eventDetail=null) {
  let forgeState=null,resumeContext=null;
  try{forgeState=window.RelicForgeForge?.getForgeProjectState?.()??null;}catch{}
  try{resumeContext=window.RelicForgeForge?.getResumeContext?.()??null;}catch{}
  return selectDeploymentContext({
    explicit:state.explicitDeployment,
    eventDetail,
    forgeState,resumeContext,
    querySearch:location.search
  });
}
function setDeployment(value) {
  state.explicitDeployment=value?normalizeDeployment(value):null;
  state.deployment=discoverDeployment();
  renderDeployment();
  return state.deployment;
}
function refreshContext(eventDetail=null) {
  state.deployment=discoverDeployment(eventDetail);
  renderDeployment();
  return state.deployment;
}

function wireEvents() {
  byId(ids.trigger)?.addEventListener('click',openDrawer);
  byId(ids.close)?.addEventListener('click',closeDrawer);
  byId(ids.backdrop)?.addEventListener('click',closeDrawer);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDrawer();});
  byId(ids.copyDirect)?.addEventListener('click',()=>action(()=>copyValue(ids.direct)));
  byId(ids.copyClaimed)?.addEventListener('click',()=>action(()=>copyValue(ids.claimedUrl),ids.availability));
  byId(ids.load)?.addEventListener('click',()=>action(loadProductionControls));
  byId(ids.check)?.addEventListener('click',()=>action(checkAvailability,ids.availability));
  byId(ids.claim)?.addEventListener('click',()=>action(claimSlug,ids.availability));
  byId(ids.save)?.addEventListener('click',()=>action(savePublication,ids.publicationStatus));

  byId(ids.slug)?.addEventListener('input',()=>{
    state.requestSequence++;state.availability=false;state.availabilitySlug=null;
    const raw=byId(ids.slug)?.value.trim().toLowerCase()??'';
    setText(ids.preview,raw||'your-collection');
    if(!state.publication?.slug)status('Check availability before claiming.','neutral',ids.availability);
    syncControlState();
  });
  byId(ids.slug)?.addEventListener('blur',()=>{
    if(state.publication?.slug)return;
    const input=byId(ids.slug);
    if(input)input.value=input.value.trim().toLowerCase();
  });
  byId(ids.understand)?.addEventListener('change',syncControlState);
  byId(ids.listed)?.addEventListener('change',()=>{
    if(byId(ids.listed)?.checked!==true&&byId(ids.feature))byId(ids.feature).checked=false;
    syncControlState();
  });
  window.addEventListener('relicforge:v2-launch-complete',event=>refreshContext(event.detail));
  window.addEventListener('relicforge:deployment-checkpoint',event=>refreshContext(event.detail));
  window.addEventListener('popstate',()=>refreshContext());
}

function configure(options={}) {
  if(!options||typeof options!=='object')throw new CreatorUrlError('Invalid creator URL configuration.');
  for(const key of ['publicRequest','authenticatedRequest','requestWallet','apiBase']) {
    if(Object.hasOwn(options,key))state.adapters[key]=options[key];
  }
  return window.RelicForgeCreatorURLs;
}
function snapshot() {
  return Object.freeze({
    version:VERSION,
    deployment:state.deployment?{...state.deployment}:null,
    productionAvailable:state.productionAvailable,
    loaded:state.loaded,
    publication:state.publication?{...state.publication}:null
  });
}

function install() {
  if(state.installed)return;
  state.installed=true;
  installMarkup();
  wireEvents();
  refreshContext();
}

window.RelicForgeCreatorURLs=Object.freeze({
  version:VERSION,
  configure,
  setDeployment,
  refresh:()=>refreshContext(),
  open:openDrawer,
  close:closeDrawer,
  getState:snapshot
});

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
