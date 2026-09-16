(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short=v=>{const s=String(v||'');return s.length>14?`${s.slice(0,8)}…${s.slice(-6)}`:s;};
  const fmtBytes=n=>{n=Number(n||0);if(n<1024)return`${n} B`;if(n<1048576)return`${(n/1024).toFixed(1)} KB`;if(n<1073741824)return`${(n/1048576).toFixed(1)} MB`;return`${(n/1073741824).toFixed(2)} GB`;};
  const dt=v=>v?new Date(v).toLocaleString():'—';
  const HANDLED=new Set(['overview','users','networks','flags','collections','reserve','operations','announcements','audit']);
  const state={profiles:[],flags:[],selectedUser:null,collections:[],selectedCollection:null};
  function cloud(){if(!window.RelicForgeCloud?.enabled?.())throw new Error('RelicForge Cloud is unavailable.');return window.RelicForgeCloud;}
  async function api(path,options={}){return cloud().json(path,options,true);}
  function status(message,type=''){const n=$('founderOpsStatus');if(n){n.textContent=message;n.className=`fo-status ${type}`.trim();}}
  function reason(promptText='Reason for this admin change'){const v=window.prompt(promptText,'');if(v==null)return null;const s=v.trim();if(!s)throw new Error('An admin reason is required.');return s;}
  function setPanelHtml(id,html){const n=$(id);if(n)n.innerHTML=html;}
  function addTab(container,key,label){const b=document.createElement('button');b.type='button';b.dataset.founderTab=key;b.textContent=label;b.addEventListener('click',()=>window.RelicForgeFounderConsole?.open?.(key));return b;}
  function panel(key,html){const s=document.createElement('section');s.className='founder-console-panel-body founder-ops-panel hidden';s.id=`founderOps_${key}`;s.dataset.founderPanel=key;s.innerHTML=html;return s;}

  function installShell(){
    const tabs=document.querySelector('.founder-console-tabs'),projectBtn=document.querySelector('[data-founder-tab="projects"]'),
      feeBtn=document.querySelector('[data-founder-tab="fees"]'),safeBtn=document.querySelector('[data-founder-tab="safe"]');
    if(!tabs||!projectBtn||!feeBtn||!safeBtn||$('founderOps_overview'))return;
    $('founderProjectsPanel')?.setAttribute('data-founder-panel','projects');
    $('founderFeesPanel')?.setAttribute('data-founder-panel','fees');
    $('founderSafePanel')?.setAttribute('data-founder-panel','safe');
    const buttons=[
      addTab(tabs,'overview','Overview'),addTab(tabs,'users','Users & Overrides'),addTab(tabs,'networks','Networks'),
      addTab(tabs,'flags','Feature Flags'),projectBtn,addTab(tabs,'collections','Collections'),addTab(tabs,'reserve','Reserve & Randomness'),
      feeBtn,addTab(tabs,'operations','Operations'),addTab(tabs,'announcements','Announcements'),safeBtn,addTab(tabs,'audit','Audit Log')
    ];
    tabs.replaceChildren(...buttons);
    const anchor=$('founderProjectsPanel'),parent=anchor?.parentElement;if(!parent)return;
    const statusNode=document.createElement('div');statusNode.id='founderOpsStatus';statusNode.className='fo-status';statusNode.textContent='Founder operations console ready.';
    anchor.before(statusNode);

    const html={
      overview:`<div class="fo-grid" id="foOverviewKpis"></div><div class="fo-grid two"><div class="fo-card"><h3>Network release state</h3><div id="foOverviewNetworks"></div></div><div class="fo-card"><h3>Recent founder actions</h3><div id="foOverviewAudit"></div></div></div>`,
      users:`<div class="fo-card"><h3>User-level policy overrides</h3><p>Profiles and per-wallet exceptions can raise site/cloud limits, grant beta/network access, or explicitly bypass emergency website stops. They never bypass hard onchain contract limits.</p><div class="fo-toolbar"><label class="field"><span>Wallet search</span><input id="foUserSearch" placeholder="0x..."/></label><button class="primary-btn" id="foUserSearchBtn">Search</button></div><div id="foUserList"></div></div><div class="fo-card hidden" id="foUserEditor"></div><div class="fo-card"><h3>Override profiles</h3><div class="fo-toolbar"><label class="field"><span>Profile</span><select id="foProfileSelect"></select></label><button class="ghost-btn" id="foProfileLoadBtn">Load Profile</button></div><div id="foProfileEditor"></div></div>`,
      networks:`<div class="fo-card"><h3>Network / release controls</h3><p>Deployment mode can be Disabled, Founder only, Beta/allowlist, or Public without changing the certified Factory/release identity. Public discovery is a separate production-only switch.</p><div id="foNetworkList" class="fo-network-list"></div></div>`,
      flags:`<div class="fo-card"><h3>Feature flags</h3><p>OFF / FOUNDER / BETA / EVERYONE flags are immediately available through the authenticated policy API. Per-wallet overrides can still force a specific flag on/off.</p><div id="foFeatureList" class="fo-feature-list"></div></div>`,
      collections:`<div class="fo-card"><h3>Collection diagnostics</h3><div class="fo-toolbar"><label class="field"><span>Search</span><input id="foCollectionSearch" placeholder="contract, creator, project"/></label><label class="field"><span>Network</span><select id="foCollectionChain"><option value="">All</option><option value="1">Ethereum Mainnet</option><option value="11155111">Ethereum Sepolia</option></select></label><button class="primary-btn" id="foCollectionSearchBtn">Search</button></div><div id="foCollectionList" class="fo-collection-list"></div></div><div class="fo-card hidden" id="foCollectionDiagnostic"></div>`,
      reserve:`<div class="fo-card"><h3>Reserve & randomness operations</h3><div class="fo-toolbar"><label class="field"><span>Network</span><select id="foReserveChain"><option value="1">Ethereum Mainnet</option><option value="11155111">Ethereum Sepolia</option></select></label><button class="primary-btn" id="foReserveRefresh">Refresh Onchain Metrics</button></div><div id="foReserveMetrics" class="fo-grid"></div><div id="foRandomnessMetrics" class="fo-grid two"></div><div class="fo-actions"><button class="ghost-btn" data-fo-safe-action="reserve.policy">Build Reserve Policy Safe Call</button><button class="ghost-btn" data-fo-safe-action="reserve.releaseRevenue">Build Revenue Release Safe Call</button><button class="ghost-btn" data-fo-safe-action="fees.defaults">Build Fee Defaults Safe Call</button></div></div>`,
      operations:`<div class="fo-grid two"><div class="fo-card"><h3>Emergency website controls</h3><p>These stop Relic Forge website/cloud operations. They do not claim to pause already-deployed decentralized contracts.</p><div id="foRuntimeControls"></div></div><div class="fo-card"><h3>System health</h3><div class="fo-actions"><button class="primary-btn" id="foHealthRefresh">Run Full Diagnostic</button></div><div id="foHealth"></div></div></div>`,
      announcements:`<div class="fo-grid two"><div class="fo-card"><h3>New site announcement</h3><label class="field"><span>Title</span><input id="foAnnTitle"/></label><label class="field"><span>Message</span><textarea id="foAnnBody" rows="5"></textarea></label><label class="field"><span>Severity</span><select id="foAnnSeverity"><option>info</option><option>warning</option><option>critical</option><option>success</option></select></label><label class="fo-check"><span><strong>Enabled immediately</strong><small>Visible on Studio, Dashboard and mint pages.</small></span><input id="foAnnEnabled" type="checkbox" checked/></label><button class="primary-btn" id="foAnnCreate">Publish Announcement</button></div><div class="fo-card"><h3>Announcements</h3><div id="foAnnouncementList" class="fo-announcement-list"></div></div></div>`,
      audit:`<div class="fo-card"><h3>Founder admin audit log</h3><div class="fo-toolbar"><label class="field"><span>Filter</span><input id="foAuditSearch" placeholder="wallet, action, subject, reason"/></label><button class="primary-btn" id="foAuditSearchBtn">Search</button></div><div id="foAuditList" class="fo-audit-list"></div></div>`
    };
    for(const key of HANDLED)anchor.before(panel(key,html[key]));
    bind();
  }

  async function overview(){
    status('Loading founder overview…');const d=await api('/api/founder/ops/overview');
    const c=d.counts||{},items=[['Projects',c.projects],['Creator wallets',c.wallets],['Collections',c.collections],['Deployments',c.deployments],['Cloud assets',c.assets],['Cloud storage',fmtBytes(c.assetBytes)],['Active overrides',c.activeOverrides],['Support-enabled projects',c.supportEnabled]];
    setPanelHtml('foOverviewKpis',items.map(([a,b])=>`<div class="fo-card fo-kpi"><span>${esc(a)}</span><strong>${esc(b??0)}</strong></div>`).join(''));
    setPanelHtml('foOverviewNetworks',(d.networks||[]).map(n=>`<div class="fo-row"><div class="fo-row-head"><strong>${esc(n.label)}</strong><span class="fo-pill ${n.mode==='public'?'ok':n.mode==='disabled'?'bad':'warn'}">${esc(n.mode)}</span></div><small>Chain ${n.chain_id} · base launch ${n.launch_enabled?'ON':'OFF'} · public discovery ${n.public_enabled?'ON':'OFF'}</small><code>${esc(n.factory_address||'No Factory')}</code></div>`).join('')||'<div class="fo-empty">No networks.</div>');
    setPanelHtml('foOverviewAudit',(d.recentAudit||[]).map(a=>`<div class="fo-row"><div class="fo-row-head"><strong>${esc(a.action)}</strong><small>${esc(dt(a.created_at))}</small></div><span>${esc(a.subject_type)} ${esc(a.subject_id||'')}</span><small>${esc(a.reason||'No reason')}</small></div>`).join('')||'<div class="fo-empty">No admin actions yet.</div>');
    status('Founder overview loaded.','success');
  }

  async function users(){
    const q=String($('foUserSearch')?.value||'').trim();status('Loading users…');
    const d=await api('/api/founder/ops/users'+(q?`?q=${encodeURIComponent(q)}`:''));
    setPanelHtml('foUserList',`<table class="fo-table"><thead><tr><th>Wallet</th><th>Projects</th><th>Collections</th><th>Profile</th><th>Expiry</th></tr></thead><tbody>${(d.users||[]).map(u=>`<tr data-click data-user="${esc(u.wallet)}"><td><code>${esc(u.wallet)}</code></td><td>${u.project_count}</td><td>${u.collection_count}</td><td>${esc(u.profile_name||'Standard')}</td><td>${esc(dt(u.expires_at))}</td></tr>`).join('')}</tbody></table>`);
    $('foUserList')?.querySelectorAll('[data-user]').forEach(r=>r.addEventListener('click',()=>loadUser(r.dataset.user)));
    await loadProfiles();status(`Loaded ${(d.users||[]).length} wallet${d.users?.length===1?'':'s'}.`,'success');
  }
  async function loadProfiles(){
    const d=await api('/api/founder/ops/profiles');state.profiles=d.profiles||[];
    if($('foProfileSelect'))$('foProfileSelect').innerHTML=state.profiles.map(p=>`<option>${esc(p.name)}</option>`).join('');
  }
  function limitVal(policy,key,div=1){const n=Number(policy?.limits?.[key]||0);return div===1?n:(n/div).toFixed(n/div<10?1:0);}
  async function loadUser(wallet){
    status('Loading wallet policy…');const d=await api(`/api/founder/ops/users/${encodeURIComponent(wallet)}`);state.selectedUser=d;
    if(!state.profiles.length)await loadProfiles();
    if(!state.flags.length)state.flags=(await api('/api/founder/ops/feature-flags')).flags||[];
    const p=d.policy||{},o=p.override||{},netObj=o.networks||{},featureObj=o.features||{};
    const featureOverrides=state.flags.map(flag=>`<label class="field"><span>${esc(flag.label)}</span><select data-user-feature="${esc(flag.key)}"><option value="">Inherit (${p.features?.[flag.key]?'allowed':'blocked'})</option><option value="allow" ${featureObj[flag.key]===true?'selected':''}>Force Allow</option><option value="deny" ${featureObj[flag.key]===false?'selected':''}>Force Deny</option></select></label>`).join('');
    const networkOverrides=(p.networks||[]).map(net=>`<label class="field"><span>${esc(net.label)} deployment override</span><select data-user-net="${Number(net.chainId)}"><option value="">Inherit (${net.deploymentAllowed?'allowed':'blocked'})</option><option value="allow" ${netObj[String(net.chainId)]?.deploy===true?'selected':''}>Force Allow</option><option value="deny" ${netObj[String(net.chainId)]?.deploy===false?'selected':''}>Force Deny</option></select></label>`).join('');
    const editor=$('foUserEditor');editor.classList.remove('hidden');
    editor.innerHTML=`<div class="fo-row-head"><div><h3>User override</h3><code>${esc(d.wallet)}</code></div><span class="fo-pill">${esc(p.profile)}</span></div>
      <div class="fo-grid"><div class="fo-card fo-kpi"><span>Projects used</span><strong>${d.usage.projects}</strong></div><div class="fo-card fo-kpi"><span>Collections</span><strong>${d.usage.collections}</strong></div><div class="fo-card fo-kpi"><span>Storage</span><strong>${esc(fmtBytes(d.usage.assetBytes))}</strong></div><div class="fo-card fo-kpi"><span>Emergency bypass</span><strong>${p.bypassEmergency?'YES':'NO'}</strong></div></div>
      <div class="fo-form-grid"><label class="field"><span>Profile</span><select id="foUserProfile"><option value="">Standard</option>${state.profiles.filter(x=>x.name!=='Standard').map(x=>`<option ${o.profileName===x.name?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Project limit override</span><input id="foLimitProjects" type="number" min="1" placeholder="${esc(limitVal(p,'projectLimit'))}" value="${esc(o.limits?.projectLimit||'')}"/></label>
      <label class="field"><span>Project asset max (MB)</span><input id="foLimitAssetMb" type="number" min="1" placeholder="${esc(limitVal(p,'projectAssetMaxBytes',1048576))}" value="${o.limits?.projectAssetMaxBytes?esc(Number(o.limits.projectAssetMaxBytes)/1048576):''}"/></label>
      <label class="field"><span>Mint-page asset max (MB)</span><input id="foLimitMintMb" type="number" min="1" placeholder="${esc(limitVal(p,'mintPageAssetMaxBytes',1048576))}" value="${o.limits?.mintPageAssetMaxBytes?esc(Number(o.limits.mintPageAssetMaxBytes)/1048576):''}"/></label>
      <label class="field"><span>Whitelist rows max</span><input id="foLimitWhitelist" type="number" min="1" placeholder="${esc(limitVal(p,'whitelistMaxEntries'))}" value="${esc(o.limits?.whitelistMaxEntries||'')}"/></label>
      <label class="field"><span>Expires</span><input id="foUserExpires" type="datetime-local" value="${o.expiresAt?new Date(o.expiresAt).toISOString().slice(0,16):''}"/></label></div>
      <div class="fo-form-grid"><label class="field"><span>Beta access</span><select id="foUserBeta"><option value="">Inherit (${p.features?.betaAccess?'allowed':'blocked'})</option><option value="allow" ${o.features?.betaAccess===true?'selected':''}>Force Allow</option><option value="deny" ${o.features?.betaAccess===false?'selected':''}>Force Deny</option></select><small>Controls Beta feature/network eligibility.</small></label>
      <label class="fo-check"><span><strong>Bypass emergency website stops</strong><small>Use only for founder/support canaries.</small></span><input id="foUserBypass" type="checkbox" ${o.bypassEmergency?'checked':''}/></label>${networkOverrides}</div>
      <h4>Per-feature exceptions</h4><div class="fo-form-grid">${featureOverrides||'<div class="fo-empty">No feature flags configured.</div>'}</div>
      <div class="fo-actions"><button class="primary-btn" id="foUserSave">Save Override</button><button class="ghost-btn danger-btn" id="foUserClear" ${p.override?'':'disabled'}>Clear Override</button></div>
      <details><summary>Effective policy</summary><pre class="fo-json">${esc(JSON.stringify(p,null,2))}</pre></details>`;
    $('foUserSave').addEventListener('click',saveUser);$('foUserClear').addEventListener('click',clearUser);status('Wallet policy loaded.','success');
  }
  function maybeLimit(id,mult=1){const v=String($(id)?.value||'').trim();return v?Math.floor(Number(v)*mult):null;}
  async function saveUser(){
    const d=state.selectedUser;if(!d)return;const why=reason('Reason for this user override');if(why==null)return;
    const l={};for(const [id,key,m] of [['foLimitProjects','projectLimit',1],['foLimitAssetMb','projectAssetMaxBytes',1048576],['foLimitMintMb','mintPageAssetMaxBytes',1048576],['foLimitWhitelist','whitelistMaxEntries',1]]){const v=maybeLimit(id,m);if(v!=null)l[key]=v;}
    const networks={};document.querySelectorAll('#foUserEditor [data-user-net]').forEach(node=>{if(node.value)networks[String(node.dataset.userNet)]={deploy:node.value==='allow'};});
    const features={};if($('foUserBeta').value)features.betaAccess=$('foUserBeta').value==='allow';document.querySelectorAll('#foUserEditor [data-user-feature]').forEach(node=>{if(node.value)features[node.dataset.userFeature]=node.value==='allow';});
    const body={profileName:$('foUserProfile').value||null,limits:l,features,networks,bypassEmergency:$('foUserBypass').checked,expiresAt:$('foUserExpires').value?new Date($('foUserExpires').value).toISOString():null,reason:why};
    await api(`/api/founder/ops/users/${encodeURIComponent(d.wallet)}/override`,{method:'PUT',body:JSON.stringify(body)});await loadUser(d.wallet);status('User override saved and active.','success');
  }
  async function clearUser(){const d=state.selectedUser;if(!d)return;const why=reason('Reason for clearing this user override');if(why==null)return;await api(`/api/founder/ops/users/${encodeURIComponent(d.wallet)}/override`,{method:'DELETE',body:JSON.stringify({reason:why})});await loadUser(d.wallet);status('User override cleared.','success');}
  function renderProfile(){
    const name=$('foProfileSelect')?.value,p=state.profiles.find(x=>x.name===name);if(!p){setPanelHtml('foProfileEditor','');return;}
    const l=p.limits||{},f=p.features||{};
    setPanelHtml('foProfileEditor',`<div class="fo-form-grid"><label class="field"><span>Description</span><input id="foPDesc" value="${esc(p.description||'')}"/></label><label class="field"><span>Project limit</span><input id="foPProjects" type="number" value="${esc(l.projectLimit||'')}"/></label><label class="field"><span>Project asset max MB</span><input id="foPAsset" type="number" value="${l.projectAssetMaxBytes?Number(l.projectAssetMaxBytes)/1048576:''}"/></label><label class="field"><span>Mint-page max MB</span><input id="foPMint" type="number" value="${l.mintPageAssetMaxBytes?Number(l.mintPageAssetMaxBytes)/1048576:''}"/></label><label class="field"><span>Whitelist max</span><input id="foPWhitelist" type="number" value="${esc(l.whitelistMaxEntries||'')}"/></label><label class="fo-check"><span><strong>Beta access</strong></span><input id="foPBeta" type="checkbox" ${f.betaAccess?'checked':''}/></label><label class="fo-check"><span><strong>Emergency bypass</strong></span><input id="foPBypass" type="checkbox" ${p.bypass_emergency?'checked':''}/></label></div><button class="primary-btn" id="foPSave">Save Profile</button>`);
    $('foPSave').addEventListener('click',saveProfile);
  }
  async function saveProfile(){const name=$('foProfileSelect').value,why=reason(`Reason for updating ${name}`);if(why==null)return;const l={};for(const [id,key,m] of [['foPProjects','projectLimit',1],['foPAsset','projectAssetMaxBytes',1048576],['foPMint','mintPageAssetMaxBytes',1048576],['foPWhitelist','whitelistMaxEntries',1]]){const v=maybeLimit(id,m);if(v!=null)l[key]=v;}await api(`/api/founder/ops/profiles/${encodeURIComponent(name)}`,{method:'PUT',body:JSON.stringify({description:$('foPDesc').value,limits:l,features:{betaAccess:$('foPBeta').checked},networks:{},bypassEmergency:$('foPBypass').checked,enabled:true,reason:why})});await loadProfiles();renderProfile();status('Profile updated.','success');}

  async function networks(){
    status('Loading network policy…');const d=await api('/api/founder/ops/networks');
    setPanelHtml('foNetworkList',(d.networks||[]).map(n=>`<div class="fo-row" data-net="${n.chain_id}"><div class="fo-row-head"><div><strong>${esc(n.label)}</strong><small> · ${esc(n.kind)} · chain ${n.chain_id}</small></div><span class="fo-pill ${n.mode==='public'?'ok':n.mode==='disabled'?'bad':'warn'}">${esc(n.mode)}</span></div><code>${esc(n.factory_address||'No Factory')}</code><small>Release: ${esc(n.release_id||'—')} · ${esc(n.release_manifest_hash||'—')}</small><div class="fo-form-grid two"><label class="field"><span>Creator deployment mode</span><select data-mode><option value="disabled" ${n.mode==='disabled'?'selected':''}>Disabled</option><option value="founder" ${n.mode==='founder'?'selected':''}>Founder only</option><option value="beta" ${n.mode==='beta'?'selected':''}>Beta / allowlist</option><option value="public" ${n.mode==='public'?'selected':''}>Public</option></select></label><label class="fo-check"><span><strong>Public discovery</strong><small>Production only. Separate from direct mint URLs.</small></span><input data-public type="checkbox" ${n.public_enabled?'checked':''} ${n.kind!=='production'?'disabled':''}/></label></div><button class="primary-btn" data-save-net>Save Network Policy</button></div>`).join(''));
    $('foNetworkList')?.querySelectorAll('[data-save-net]').forEach(b=>b.addEventListener('click',()=>saveNetwork(b.closest('[data-net]'))));status('Network policy loaded.','success');
  }
  async function saveNetwork(row){const id=Number(row.dataset.net),mode=row.querySelector('[data-mode]').value,pub=row.querySelector('[data-public]').checked,why=reason('Reason for this network policy change');if(why==null)return;let confirmPublic=null;if(pub){confirmPublic=window.prompt('If public discovery is currently OFF, type ENABLE PUBLIC DISCOVERY to allow the backend to enable it.','');if(confirmPublic==null)return;}await api(`/api/founder/ops/networks/${id}`,{method:'PUT',body:JSON.stringify({mode,publicEnabled:pub,confirmPublic,reason:why})});await networks();status('Network policy updated.','success');}

  async function flags(){
    status('Loading feature flags…');const d=await api('/api/founder/ops/feature-flags');state.flags=d.flags||[];
    setPanelHtml('foFeatureList',(d.flags||[]).map(f=>`<div class="fo-row" data-flag="${esc(f.key)}"><div class="fo-row-head"><div><strong>${esc(f.label)}</strong><code> ${esc(f.key)}</code></div><span class="fo-pill">${esc(f.state)}</span></div><p>${esc(f.description)}</p><div class="fo-form-grid two"><label class="field"><span>State</span><select data-state><option value="off" ${f.state==='off'?'selected':''}>OFF</option><option value="founder" ${f.state==='founder'?'selected':''}>FOUNDER</option><option value="beta" ${f.state==='beta'?'selected':''}>BETA</option><option value="everyone" ${f.state==='everyone'?'selected':''}>EVERYONE</option></select></label><label class="field"><span>Description</span><input data-desc value="${esc(f.description)}"/></label></div><button class="primary-btn" data-save-flag>Save Flag</button></div>`).join(''));
    $('foFeatureList')?.querySelectorAll('[data-save-flag]').forEach(b=>b.addEventListener('click',()=>saveFlag(b.closest('[data-flag]'))));status('Feature flags loaded.','success');
  }
  async function saveFlag(row){const key=row.dataset.flag,why=reason(`Reason for changing ${key}`);if(why==null)return;await api(`/api/founder/ops/feature-flags/${encodeURIComponent(key)}`,{method:'PUT',body:JSON.stringify({state:row.querySelector('[data-state]').value,description:row.querySelector('[data-desc]').value,configuration:{},reason:why})});await flags();status('Feature flag updated.','success');}

  async function collections(){
    const q=String($('foCollectionSearch')?.value||'').trim(),chain=$('foCollectionChain')?.value||'';status('Loading collections…');
    const params=new URLSearchParams();if(q)params.set('q',q);if(chain)params.set('chainId',chain);
    const d=await api('/api/founder/ops/collections'+(params.toString()?`?${params}`:''));state.collections=d.collections||[];
    setPanelHtml('foCollectionList',`<table class="fo-table"><thead><tr><th>Project</th><th>Network</th><th>Contract</th><th>Creator</th><th>Status</th><th></th></tr></thead><tbody>${state.collections.map((c,i)=>`<tr><td>${esc(c.project_name||'Unlinked')}</td><td>${c.chain_id===1?'Mainnet':c.chain_id===11155111?'Sepolia':c.chain_id}</td><td><code>${esc(short(c.contract_address))}</code></td><td><code>${esc(short(c.owner_wallet))}</code></td><td>${esc(c.deployment_status||'registered')}</td><td><button class="ghost-btn" data-diag="${i}">Diagnose</button></td></tr>`).join('')}</tbody></table>`);
    $('foCollectionList')?.querySelectorAll('[data-diag]').forEach(b=>b.addEventListener('click',()=>diagnose(Number(b.dataset.diag))));status(`Loaded ${state.collections.length} collections.`,'success');
  }
  async function diagnose(i){const c=state.collections[i];if(!c)return;status('Running collection diagnostic…');const d=await api(`/api/founder/ops/collections/${c.chain_id}/${c.contract_address}/diagnostic`);state.selectedCollection=d;const host=$('foCollectionDiagnostic');host.classList.remove('hidden');host.innerHTML=`<div class="fo-row-head"><div><h3>${esc(d.onchain?.name||c.project_name||'Collection')}</h3><code>${esc(d.contract)}</code></div><span class="fo-pill ${d.warnings?.length?'warn':'ok'}">${d.warnings?.length?`${d.warnings.length} warning(s)`:'Healthy'}</span></div><div class="fo-grid"><div class="fo-card"><span>Creator</span><code>${esc(d.onchain?.creator||d.cloud?.owner_wallet||'—')}</code></div><div class="fo-card"><span>Controller</span><code>${esc(d.onchain?.controller||'—')}</code></div><div class="fo-card"><span>Supply</span><strong>${esc(d.onchain?.totalMinted??'—')} / ${esc(d.onchain?.maxSupply??'—')}</strong></div><div class="fo-card"><span>pendingSupply</span><strong>${esc(d.onchain?.pendingSupply??'—')}</strong></div></div>${d.warnings?.length?`<div class="fo-row fo-warning">${d.warnings.map(w=>`<div>${esc(w)}</div>`).join('')}</div>`:''}<details><summary>Full diagnostic</summary><pre class="fo-json">${esc(JSON.stringify(d,null,2))}</pre></details><div class="fo-actions"><button class="primary-btn" id="foDiagSafe">Open in Safe Admin Calls</button></div>`;$('foDiagSafe').addEventListener('click',()=>{window.RelicForgeFounderConsole?.open?.('safe');setTimeout(()=>window.RelicForgeSafeAdmin?.openForCollection?.(Number(d.chainId),d.contract),120);});status('Collection diagnostic complete.',d.warnings?.length?'warning':'success');}

  async function reserve(){
    const chain=Number($('foReserveChain')?.value||1),cfg=window.RELICFORGE_V2_ADDRESSES?.[chain];if(!cfg)throw new Error('Network config unavailable.');
    status('Reading Reserve and randomness state…');const base=String(window.RelicForgeCloud?.apiBase?.()||window.RELICFORGE_CONFIG?.apiBase||'').replace(/\/$/,'');const p=new window.ethers.JsonRpcProvider(`${base}/api/public/rpc/${chain}`,chain,{staticNetwork:true});
    const reserve=new window.ethers.Contract(cfg.reserve,['function founder() view returns(address)','function requiredReserveWei() view returns(uint256)','function availableRevenueWei() view returns(uint256)','function totalExposureWei() view returns(uint256)','function totalRestrictedSponsoredLiabilityWei() view returns(uint256)','function totalActiveBatches() view returns(uint256)','function activeCollectionCount() view returns(uint256)','function maxSubsidyPerRequestWei() view returns(uint256)','function maxSubsidyPerCollectionWei() view returns(uint256)'],p);
    const policy=new window.ethers.Contract(cfg.feePolicy,['function platformAdmin() view returns(address)','function treasury() view returns(address)','function sponsoredFeeCents() view returns(uint32)','function minterFeeCents() view returns(uint32)','function accruedFees() view returns(uint256)'],p);
    const [founder,balance,required,available,exposure,restricted,batches,active,perReq,perCol,fee,platformAdmin,feeTreasury,sponsoredCents,minterCents,accruedFees]=await Promise.all([reserve.founder(),p.getBalance(cfg.reserve),reserve.requiredReserveWei(),reserve.availableRevenueWei(),reserve.totalExposureWei(),reserve.totalRestrictedSponsoredLiabilityWei(),reserve.totalActiveBatches(),reserve.activeCollectionCount(),reserve.maxSubsidyPerRequestWei(),reserve.maxSubsidyPerCollectionWei(),p.getFeeData(),policy.platformAdmin(),policy.treasury(),policy.sponsoredFeeCents(),policy.minterFeeCents(),policy.accruedFees()]);
    const vals=[['Reserve balance',`${window.ethers.formatEther(balance)} ETH`],['Protected requirement',`${window.ethers.formatEther(required)} ETH`],['Available revenue',`${window.ethers.formatEther(available)} ETH`],['Active collections',Number(active)],['Active reveal batches',Number(batches)],['Exposure',`${window.ethers.formatEther(exposure)} ETH`],['Restricted sponsored liability',`${window.ethers.formatEther(restricted)} ETH`],['Founder',short(founder)]];
    setPanelHtml('foReserveMetrics',vals.map(([a,b])=>`<div class="fo-card fo-kpi"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join(''));
    let quote='Unavailable';try{const adapter=new window.ethers.Contract(cfg.randomnessAdapter,['function estimateRequestPriceAtGasPrice(uint32,uint256) view returns(uint256)'],p),gas=fee.gasPrice||0n;const q=await adapter.estimateRequestPriceAtGasPrice(Number(cfg.autoRevealConsumerCallbackGas||1400000),gas);quote=`${window.ethers.formatEther(q)} ETH @ ${window.ethers.formatUnits(gas,'gwei')} gwei`;}catch{}
    setPanelHtml('foRandomnessMetrics',`<div class="fo-card"><span>Platform Forge batch window</span><strong>${esc(cfg.defaultBatchWindowSeconds||30)} seconds</strong><small class="fo-muted">Creator-uneditable default; founder can generate collection-specific emergency Safe calls.</small></div><div class="fo-card"><span>Randomness ceiling</span><strong>${window.ethers.formatEther(BigInt(cfg.defaultMaxRandomnessCostPerBatchWei||'5000000000000000'))} ETH</strong><small class="fo-muted">Current max-tier request estimate: ${esc(quote)}</small></div><div class="fo-card"><span>Max subsidy / request</span><strong>${window.ethers.formatEther(perReq)} ETH</strong></div><div class="fo-card"><span>Max lifetime subsidy / collection</span><strong>${window.ethers.formatEther(perCol)} ETH</strong></div><div class="fo-card"><span>FeePolicy defaults</span><strong>Sponsored $${(Number(sponsoredCents)/100).toFixed(2)} · Collector $${(Number(minterCents)/100).toFixed(2)}</strong><small class="fo-muted">Admin ${esc(short(platformAdmin))}</small></div><div class="fo-card"><span>Legacy accrued FeePolicy fees</span><strong>${window.ethers.formatEther(accruedFees)} ETH</strong><small class="fo-muted">Treasury ${esc(short(feeTreasury))}</small></div>`);status('Reserve/randomness/fee metrics loaded.','success');
  }

  async function operations(){
    const d=await api('/api/founder/ops/runtime'),map=Object.fromEntries((d.settings||[]).map(x=>[x.key,x]));
    const defs=[['newDeploymentsPaused','Pause new deployments','Blocks site preflight/registration unless a wallet has explicit emergency bypass.'],['projectWritesPaused','Pause project writes','Stops creator cloud project save/new project artwork preparation.'],['mintPagePublishingPaused','Pause mint-page publishing','Stops mint-page configuration publication.'],['whitelistPublishingPaused','Pause whitelist publishing','Stops whitelist/proof publication.'],['publicDiscoveryPaused','Pause public discovery','Hides public collection discovery while direct mint URLs remain available.'],['maintenanceMode','Maintenance banner','Shows a global maintenance notice.']];
    setPanelHtml('foRuntimeControls',defs.map(([k,l,d])=>`<label class="fo-check"><span><strong>${esc(l)}</strong><small>${esc(d)}</small></span><input data-runtime="${k}" type="checkbox" ${map[k]?.value?'checked':''}/></label>`).join(''));
    $('foRuntimeControls')?.querySelectorAll('[data-runtime]').forEach(input=>input.addEventListener('change',()=>saveRuntime(input).catch(e=>{input.checked=!input.checked;status(e.message,'error');})));
    await health(false);
  }
  async function saveRuntime(input){const why=reason(`Reason for changing ${input.dataset.runtime}`);if(why==null)throw new Error('Cancelled');await api(`/api/founder/ops/runtime/${input.dataset.runtime}`,{method:'PUT',body:JSON.stringify({value:input.checked,reason:why})});status(`${input.dataset.runtime} updated immediately.`,'success');}
  async function health(showStatus=true){if(showStatus)status('Running system diagnostic…');const d=await api('/api/founder/ops/operations');setPanelHtml('foHealth',`<div class="fo-row ${d.database?.ok?'fo-success':'fo-danger'}"><strong>Database ${d.database?.ok?'OK':'FAILED'}</strong><small>${esc(dt(d.database?.now))}</small></div>${(d.rpc||[]).map(r=>`<div class="fo-row ${r.rpcOk&&(!r.factoryCode?false:true)?'fo-success':'fo-warning'}"><div class="fo-row-head"><strong>${esc(r.label)}</strong><span class="fo-pill ${r.rpcOk?'ok':'bad'}">${r.rpcOk?'RPC OK':'RPC FAIL'}</span></div><small>Block ${esc(r.blockNumber??'—')} · Factory code ${r.factoryCode?'YES':'NO'}</small>${r.error?`<small>${esc(r.error)}</small>`:''}</div>`).join('')}<details><summary>Deployment status / counts</summary><pre class="fo-json">${esc(JSON.stringify({counts:d.counts,deploymentStatuses:d.deploymentStatuses,runtime:d.runtime},null,2))}</pre></details>`);if(showStatus)status('System diagnostic complete.','success');}

  async function announcements(){
    const d=await api('/api/founder/ops/announcements');setPanelHtml('foAnnouncementList',(d.announcements||[]).map(a=>`<div class="fo-row ${a.severity==='critical'?'fo-danger':a.severity==='warning'?'fo-warning':''}" data-ann="${a.id}"><div class="fo-row-head"><strong>${esc(a.title)}</strong><span class="fo-pill">${esc(a.severity)} · ${a.enabled?'ON':'OFF'}</span></div><p>${esc(a.body)}</p><small>${esc(dt(a.starts_at))} → ${esc(dt(a.ends_at))}</small><div class="fo-actions"><button class="ghost-btn" data-toggle>${a.enabled?'Disable':'Enable'}</button><button class="ghost-btn danger-btn" data-delete>Delete</button></div></div>`).join('')||'<div class="fo-empty">No announcements.</div>');
    $('foAnnouncementList')?.querySelectorAll('[data-ann]').forEach(row=>{row.querySelector('[data-toggle]').addEventListener('click',()=>toggleAnnouncement(row,d.announcements.find(a=>a.id===row.dataset.ann)));row.querySelector('[data-delete]').addEventListener('click',()=>deleteAnnouncement(row.dataset.ann));});
  }
  async function createAnnouncement(){const why=reason('Reason for publishing this announcement');if(why==null)return;await api('/api/founder/ops/announcements',{method:'POST',body:JSON.stringify({title:$('foAnnTitle').value,body:$('foAnnBody').value,severity:$('foAnnSeverity').value,enabled:$('foAnnEnabled').checked,reason:why})});$('foAnnTitle').value='';$('foAnnBody').value='';await announcements();status('Announcement published.','success');}
  async function toggleAnnouncement(row,a){const why=reason(`Reason for ${a.enabled?'disabling':'enabling'} this announcement`);if(why==null)return;await api(`/api/founder/ops/announcements/${a.id}`,{method:'PUT',body:JSON.stringify({enabled:!a.enabled,reason:why})});await announcements();}
  async function deleteAnnouncement(id){const why=reason('Reason for deleting this announcement');if(why==null)return;if(!confirm('Delete this announcement?'))return;await api(`/api/founder/ops/announcements/${id}`,{method:'DELETE',body:JSON.stringify({reason:why})});await announcements();}

  async function auditLog(){
    const q=String($('foAuditSearch')?.value||'').trim(),d=await api('/api/founder/ops/audit'+(q?`?q=${encodeURIComponent(q)}`:''));
    setPanelHtml('foAuditList',(d.entries||[]).map(a=>`<div class="fo-row"><div class="fo-row-head"><strong>${esc(a.action)}</strong><small>${esc(dt(a.created_at))}</small></div><div><span class="fo-pill">${esc(a.subject_type)}</span> <code>${esc(a.subject_id||'')}</code></div><small>Founder: ${esc(a.founder_wallet)}</small><p>${esc(a.reason||'No reason recorded')}</p><details><summary>Before / after</summary><pre class="fo-json">${esc(JSON.stringify({before:a.before_state,after:a.after_state},null,2))}</pre></details></div>`).join('')||'<div class="fo-empty">No audit entries.</div>');
  }

  function safeAction(actionId){
    const chain=Number($('foReserveChain')?.value||1);
    window.RelicForgeFounderConsole?.open?.('safe');
    setTimeout(()=>window.RelicForgeSafeAdmin?.openPlatform?.(chain,actionId),120);
  }
  function bind(){
    $('foUserSearchBtn')?.addEventListener('click',()=>users().catch(e=>status(e.message,'error')));$('foUserSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter')users().catch(x=>status(x.message,'error'));});
    $('foProfileLoadBtn')?.addEventListener('click',renderProfile);$('foProfileSelect')?.addEventListener('change',renderProfile);
    $('foCollectionSearchBtn')?.addEventListener('click',()=>collections().catch(e=>status(e.message,'error')));
    $('foReserveRefresh')?.addEventListener('click',()=>reserve().catch(e=>status(e.message,'error')));$('foReserveChain')?.addEventListener('change',()=>reserve().catch(e=>status(e.message,'error')));
    document.querySelectorAll('[data-fo-safe-action]').forEach(b=>b.addEventListener('click',()=>safeAction(b.dataset.foSafeAction)));
    $('foHealthRefresh')?.addEventListener('click',()=>health(true).catch(e=>status(e.message,'error')));
    $('foAnnCreate')?.addEventListener('click',()=>createAnnouncement().catch(e=>status(e.message,'error')));
    $('foAuditSearchBtn')?.addEventListener('click',()=>auditLog().catch(e=>status(e.message,'error')));$('foAuditSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter')auditLog().catch(x=>status(x.message,'error'));});
  }

  async function open(tab){
    if(!HANDLED.has(tab))return;
    try{
      if(tab==='overview')await overview();else if(tab==='users')await users();else if(tab==='networks')await networks();else if(tab==='flags')await flags();
      else if(tab==='collections')await collections();else if(tab==='reserve')await reserve();else if(tab==='operations')await operations();
      else if(tab==='announcements')await announcements();else if(tab==='audit')await auditLog();
    }catch(error){status(error.shortMessage||error.message,'error');}
  }
  window.RelicForgeFounderOps=Object.freeze({handles:key=>HANDLED.has(key),open});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installShell);else installShell();
})();
