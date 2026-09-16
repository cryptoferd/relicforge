import crypto from 'node:crypto';
import { Contract, getAddress } from 'ethers';
import { db, one } from '../lib/db.js';
import { authenticateFounder } from '../lib/auth.js';
import { providerFor } from '../lib/rpc.js';
import { networkControl, policyPayload, runtimeSettings } from '../lib/founder-policy.js';

const MODES=new Set(['disabled','founder','beta','public']);
const FLAG_STATES=new Set(['off','founder','beta','everyone']);
const SEVERITIES=new Set(['info','warning','critical','success']);
const LIMIT_KEYS=new Set(['projectLimit','projectAssetMaxBytes','mintPageAssetMaxBytes','whitelistMaxEntries']);
const RUNTIME_KEYS=new Set(['newDeploymentsPaused','projectWritesPaused','mintPagePublishingPaused','whitelistPublishingPaused','publicDiscoveryPaused','maintenanceMode','reserveWarningEth']);
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const norm=v=>getAddress(String(v||'')).toLowerCase();
function needReason(body){const v=String(body?.reason||'').trim().slice(0,1000);if(!v)throw Object.assign(new Error('An admin reason is required.'),{statusCode:400});return v;}
function limits(value){
  const out={};
  for(const [key,raw] of Object.entries(obj(value))){
    if(!LIMIT_KEYS.has(key))continue;
    const n=Math.floor(Number(raw));
    if(!Number.isFinite(n)||n<1)throw Object.assign(new Error(`Invalid ${key}.`),{statusCode:400});
    out[key]=n;
  }
  if((out.projectLimit||0)>10000)throw Object.assign(new Error('projectLimit may not exceed 10,000.'),{statusCode:400});
  if((out.projectAssetMaxBytes||0)>2147483648)throw Object.assign(new Error('projectAssetMaxBytes may not exceed 2 GB.'),{statusCode:400});
  if((out.mintPageAssetMaxBytes||0)>536870912)throw Object.assign(new Error('mintPageAssetMaxBytes may not exceed 512 MB.'),{statusCode:400});
  if((out.whitelistMaxEntries||0)>5000000)throw Object.assign(new Error('whitelistMaxEntries may not exceed 5,000,000.'),{statusCode:400});
  return out;
}
function boolMap(value){const out={};for(const [k,v] of Object.entries(obj(value))){if(typeof v!=='boolean')throw Object.assign(new Error(`${k} must be true or false.`),{statusCode:400});out[k]=v;}return out;}
function networkMap(value){const out={};for(const [k,v] of Object.entries(obj(value))){const id=Number(k);if(!Number.isSafeInteger(id)||id<=0||typeof obj(v).deploy!=='boolean')throw Object.assign(new Error(`Invalid network override ${k}.`),{statusCode:400});out[String(id)]={deploy:v.deploy};}return out;}
async function audit(founder,action,type,id,reason,before=null,after=null,runner=db){
  await runner.query(`INSERT INTO founder_admin_audit(founder_wallet,action,subject_type,subject_id,reason,before_state,after_state)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,[norm(founder),action,type,id?String(id):null,reason||null,before==null?null:JSON.stringify(before),after==null?null:JSON.stringify(after)]);
}
const DIAG_ABI=['function name() view returns(string)','function symbol() view returns(string)','function factory() view returns(address)','function creator() view returns(address)','function controller() view returns(address)','function dataContract() view returns(address)','function mintPhases() view returns(address)','function forgeReserve() view returns(address)','function feePolicy() view returns(address)','function totalMinted() view returns(uint32)','function maxSupply() view returns(uint32)','function pendingSupply() view returns(uint32)'];

export default async function founderOpsRoutes(app){
  app.get('/api/founder/ops/overview',{preHandler:authenticateFounder},async request=>{
    const [projects,wallets,collections,deployments,assets,overrides,support,announcements,networks,recent]=await Promise.all([
      one('SELECT COUNT(*)::int AS count FROM projects'),
      one(`SELECT COUNT(DISTINCT wallet)::int AS count FROM (SELECT owner_wallet wallet FROM projects UNION SELECT owner_wallet wallet FROM collections) q`),
      one('SELECT COUNT(*)::int AS count FROM collections'),one('SELECT COUNT(*)::int AS count FROM rf26_deployments'),
      one(`SELECT COUNT(*)::int AS count,COALESCE(SUM(size_bytes),0)::bigint AS bytes FROM assets WHERE status='ready'`),
      one(`SELECT COUNT(*)::int AS count FROM founder_user_overrides WHERE expires_at IS NULL OR expires_at>now()`),
      one(`SELECT COUNT(*)::int AS count FROM projects WHERE founder_support_enabled=TRUE`),
      one(`SELECT COUNT(*)::int AS count FROM founder_announcements WHERE enabled=TRUE AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now())`),
      db.query(`SELECT n.chain_id,n.label,n.kind,n.launch_enabled,n.public_enabled,n.factory_address,n.release_id,n.release_manifest_hash,
        COALESCE(c.mode,CASE WHEN n.launch_enabled THEN 'public' ELSE 'disabled' END) mode
        FROM rf26_networks n LEFT JOIN founder_network_controls c USING(chain_id)
        ORDER BY CASE WHEN n.chain_id=1 THEN 0 WHEN n.chain_id=11155111 THEN 1 ELSE 2 END,n.label`),
      db.query(`SELECT id,founder_wallet,action,subject_type,subject_id,reason,created_at FROM founder_admin_audit ORDER BY created_at DESC LIMIT 12`)
    ]);
    return {founder:request.user.wallet,counts:{projects:Number(projects?.count||0),wallets:Number(wallets?.count||0),
      collections:Number(collections?.count||0),deployments:Number(deployments?.count||0),assets:Number(assets?.count||0),
      assetBytes:Number(assets?.bytes||0),activeOverrides:Number(overrides?.count||0),supportEnabled:Number(support?.count||0),
      activeAnnouncements:Number(announcements?.count||0)},runtime:await runtimeSettings(),networks:networks.rows,recentAudit:recent.rows};
  });

  app.get('/api/founder/ops/users',{preHandler:authenticateFounder},async request=>{
    const q=String(request.query?.q||'').trim().slice(0,160),like=`%${q}%`;
    const {rows}=await db.query(`WITH w AS (
      SELECT owner_wallet wallet,MAX(updated_at) seen FROM projects GROUP BY owner_wallet
      UNION SELECT owner_wallet wallet,MAX(updated_at) seen FROM collections GROUP BY owner_wallet
    ),m AS (SELECT lower(wallet) wallet,MAX(seen) last_seen FROM w GROUP BY lower(wallet))
    SELECT m.wallet,m.last_seen,(SELECT COUNT(*)::int FROM projects p WHERE lower(p.owner_wallet)=m.wallet) project_count,
      (SELECT COUNT(*)::int FROM collections c WHERE lower(c.owner_wallet)=m.wallet) collection_count,
      o.profile_name,o.expires_at,o.reason,o.updated_at override_updated_at
    FROM m LEFT JOIN founder_user_overrides o ON lower(o.wallet)=m.wallet
    WHERE $1='' OR m.wallet ILIKE $2 ORDER BY COALESCE(o.updated_at,m.last_seen) DESC NULLS LAST LIMIT 250`,[q,like]);
    return {users:rows};
  });

  app.get('/api/founder/ops/users/:wallet',{preHandler:authenticateFounder},async request=>{
    const target=norm(request.params.wallet);
    const [policy,p,c,a]=await Promise.all([policyPayload(target,{isFounder:false}),
      one('SELECT COUNT(*)::int count FROM projects WHERE lower(owner_wallet)=$1',[target]),
      one('SELECT COUNT(*)::int count FROM collections WHERE lower(owner_wallet)=$1',[target]),
      one(`SELECT COALESCE(SUM(size_bytes),0)::bigint bytes FROM assets WHERE lower(owner_wallet)=$1 AND status='ready'`,[target])]);
    return {wallet:target,policy,usage:{projects:Number(p?.count||0),collections:Number(c?.count||0),assetBytes:Number(a?.bytes||0)}};
  });

  app.get('/api/founder/ops/profiles',{preHandler:authenticateFounder},async()=>({profiles:(await db.query('SELECT * FROM founder_policy_profiles ORDER BY name')).rows}));
  app.put('/api/founder/ops/profiles/:name',{preHandler:authenticateFounder},async(request,reply)=>{
    const name=String(request.params.name||'').trim().slice(0,80);if(!name)return reply.code(400).send({error:'Profile name is required.'});
    const why=needReason(request.body),before=await one('SELECT * FROM founder_policy_profiles WHERE name=$1',[name]);
    const l=limits(request.body?.limits),features=boolMap(request.body?.features),networks=networkMap(request.body?.networks);
    const {rows}=await db.query(`INSERT INTO founder_policy_profiles(name,description,limits,features,networks,bypass_emergency,enabled,updated_by)
      VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8)
      ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description,limits=EXCLUDED.limits,features=EXCLUDED.features,
      networks=EXCLUDED.networks,bypass_emergency=EXCLUDED.bypass_emergency,enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING *`,[name,String(request.body?.description||'').slice(0,500),JSON.stringify(l),JSON.stringify(features),JSON.stringify(networks),Boolean(request.body?.bypassEmergency),request.body?.enabled!==false,request.user.wallet]);
    await audit(request.user.wallet,'profile.update','profile',name,why,before,rows[0]);return {profile:rows[0]};
  });

  app.put('/api/founder/ops/users/:wallet/override',{preHandler:authenticateFounder},async(request,reply)=>{
    const target=norm(request.params.wallet),why=needReason(request.body),before=await one('SELECT * FROM founder_user_overrides WHERE wallet=$1',[target]);
    const profileName=request.body?.profileName?String(request.body.profileName):null;
    if(profileName&&!await one('SELECT 1 FROM founder_policy_profiles WHERE name=$1',[profileName]))return reply.code(400).send({error:'Unknown override profile.'});
    let expires=null;if(request.body?.expiresAt){const d=new Date(request.body.expiresAt);if(!Number.isFinite(d.getTime())||d.getTime()<=Date.now())return reply.code(400).send({error:'Expiration must be in the future.'});expires=d.toISOString();}
    const l=limits(request.body?.limits),features=boolMap(request.body?.features),networks=networkMap(request.body?.networks);
    const {rows}=await db.query(`INSERT INTO founder_user_overrides(wallet,profile_name,limits,features,networks,bypass_emergency,expires_at,reason,updated_by)
      VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9)
      ON CONFLICT(wallet) DO UPDATE SET profile_name=EXCLUDED.profile_name,limits=EXCLUDED.limits,features=EXCLUDED.features,
      networks=EXCLUDED.networks,bypass_emergency=EXCLUDED.bypass_emergency,expires_at=EXCLUDED.expires_at,reason=EXCLUDED.reason,
      updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
      [target,profileName,JSON.stringify(l),JSON.stringify(features),JSON.stringify(networks),Boolean(request.body?.bypassEmergency),expires,why,request.user.wallet]);
    await audit(request.user.wallet,'user.override.set','wallet',target,why,before,rows[0]);
    return {override:rows[0],effective:await policyPayload(target,{isFounder:false})};
  });
  app.delete('/api/founder/ops/users/:wallet/override',{preHandler:authenticateFounder},async(request,reply)=>{
    const target=norm(request.params.wallet),why=needReason(request.body),before=await one('SELECT * FROM founder_user_overrides WHERE wallet=$1',[target]);
    if(!before)return reply.code(404).send({error:'No override exists for this wallet.'});
    await db.query('DELETE FROM founder_user_overrides WHERE wallet=$1',[target]);await audit(request.user.wallet,'user.override.clear','wallet',target,why,before,null);
    return {ok:true,effective:await policyPayload(target,{isFounder:false})};
  });

  app.get('/api/founder/ops/feature-flags',{preHandler:authenticateFounder},async()=>({flags:(await db.query('SELECT * FROM founder_feature_flags ORDER BY key')).rows}));
  app.put('/api/founder/ops/feature-flags/:key',{preHandler:authenticateFounder},async(request,reply)=>{
    const key=String(request.params.key||'').trim().toLowerCase().replace(/[^a-z0-9_.-]/g,'').slice(0,100),why=needReason(request.body),state=String(request.body?.state||'off');
    if(!key||!FLAG_STATES.has(state))return reply.code(400).send({error:'Invalid feature key/state.'});
    const before=await one('SELECT * FROM founder_feature_flags WHERE key=$1',[key]);
    const {rows}=await db.query(`INSERT INTO founder_feature_flags(key,label,description,state,configuration,updated_by)
      VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(key) DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description,
      state=EXCLUDED.state,configuration=EXCLUDED.configuration,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
      [key,String(request.body?.label||before?.label||key).slice(0,160),String(request.body?.description||before?.description||'').slice(0,500),state,JSON.stringify(obj(request.body?.configuration)),request.user.wallet]);
    await audit(request.user.wallet,'feature.update','feature',key,why,before,rows[0]);return {flag:rows[0]};
  });

  app.get('/api/founder/ops/networks',{preHandler:authenticateFounder},async()=>({networks:(await db.query(`SELECT n.chain_id,n.label,n.kind,n.launch_enabled,n.public_enabled,n.factory_address,n.release_id,n.release_manifest_hash,
    n.configuration,COALESCE(c.mode,CASE WHEN n.launch_enabled THEN 'public' ELSE 'disabled' END) mode,c.note,c.updated_by,c.updated_at
    FROM rf26_networks n LEFT JOIN founder_network_controls c USING(chain_id)
    ORDER BY CASE WHEN n.chain_id=1 THEN 0 WHEN n.chain_id=11155111 THEN 1 ELSE 2 END,n.label`)).rows}));

  app.put('/api/founder/ops/networks/:chainId',{preHandler:authenticateFounder},async(request,reply)=>{
    const chainId=Number(request.params.chainId),mode=String(request.body?.mode||''),why=needReason(request.body);
    if(!Number.isSafeInteger(chainId)||!MODES.has(mode))return reply.code(400).send({error:'Invalid chain/mode.'});
    const client=await db.connect();
    try{
      await client.query('BEGIN');const current=(await client.query('SELECT * FROM rf26_networks WHERE chain_id=$1 FOR UPDATE',[chainId])).rows[0];
      if(!current){await client.query('ROLLBACK');return reply.code(404).send({error:'Network not found.'});}
      const prior=(await client.query('SELECT * FROM founder_network_controls WHERE chain_id=$1',[chainId])).rows[0]||null;
      const publicEnabled=Boolean(request.body?.publicEnabled);
      if(publicEnabled){
        if(current.kind!=='production'||mode!=='public')throw Object.assign(new Error('Public discovery requires a production network in Public deployment mode.'),{statusCode:400});
        if(!current.launch_enabled||!current.factory_address||!current.release_id||!current.release_manifest_hash)throw Object.assign(new Error('Production release identity is incomplete.'),{statusCode:409});
        if(!current.public_enabled&&request.body?.confirmPublic!=='ENABLE PUBLIC DISCOVERY')throw Object.assign(new Error('Type ENABLE PUBLIC DISCOVERY to enable public discovery.'),{statusCode:400});
      }
      await client.query(`INSERT INTO founder_network_controls(chain_id,mode,note,updated_by) VALUES($1,$2,$3,$4)
        ON CONFLICT(chain_id) DO UPDATE SET mode=EXCLUDED.mode,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [chainId,mode,why,request.user.wallet]);
      await client.query('UPDATE rf26_networks SET public_enabled=$2,updated_at=now() WHERE chain_id=$1',[chainId,publicEnabled]);
      const after=(await client.query(`SELECT n.*,c.mode,c.note,c.updated_by,c.updated_at control_updated_at FROM rf26_networks n LEFT JOIN founder_network_controls c USING(chain_id) WHERE n.chain_id=$1`,[chainId])).rows[0];
      await audit(request.user.wallet,'network.policy.update','network',String(chainId),why,{network:current,control:prior},after,client);await client.query('COMMIT');return {network:after};
    }catch(error){await client.query('ROLLBACK');return reply.code(error.statusCode||400).send({error:error.message});}finally{client.release();}
  });

  app.get('/api/founder/ops/runtime',{preHandler:authenticateFounder},async()=>({settings:(await db.query('SELECT * FROM founder_platform_settings ORDER BY key')).rows}));
  app.put('/api/founder/ops/runtime/:key',{preHandler:authenticateFounder},async(request,reply)=>{
    const key=String(request.params.key||''),why=needReason(request.body);if(!RUNTIME_KEYS.has(key))return reply.code(400).send({error:'Unsupported runtime setting.'});
    let value=request.body?.value;if(key==='reserveWarningEth'){value=String(value??'').trim();if(!/^\d+(?:\.\d+)?$/.test(value))return reply.code(400).send({error:'reserveWarningEth must be a non-negative ETH amount.'});}
    else if(typeof value!=='boolean')return reply.code(400).send({error:`${key} must be true or false.`});
    const before=await one('SELECT * FROM founder_platform_settings WHERE key=$1',[key]);
    const {rows}=await db.query(`INSERT INTO founder_platform_settings(key,value,description,updated_by) VALUES($1,$2::jsonb,COALESCE($3,''),$4)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
      [key,JSON.stringify(value),before?.description||'',request.user.wallet]);
    await audit(request.user.wallet,'runtime.update','runtime',key,why,before,rows[0]);return {setting:rows[0]};
  });

  app.get('/api/founder/ops/announcements',{preHandler:authenticateFounder},async()=>({announcements:(await db.query('SELECT * FROM founder_announcements ORDER BY updated_at DESC LIMIT 200')).rows}));
  app.post('/api/founder/ops/announcements',{preHandler:authenticateFounder},async(request,reply)=>{
    const why=needReason(request.body),title=String(request.body?.title||'').trim().slice(0,160),body=String(request.body?.body||'').trim().slice(0,2000),severity=String(request.body?.severity||'info');
    if(!title||!body||!SEVERITIES.has(severity))return reply.code(400).send({error:'Valid title/body/severity required.'});
    const id=crypto.randomUUID(),starts=request.body?.startsAt?new Date(request.body.startsAt).toISOString():null,ends=request.body?.endsAt?new Date(request.body.endsAt).toISOString():null;
    const {rows}=await db.query(`INSERT INTO founder_announcements(id,title,body,severity,enabled,starts_at,ends_at,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,[id,title,body,severity,request.body?.enabled!==false,starts,ends,request.user.wallet]);
    await audit(request.user.wallet,'announcement.create','announcement',id,why,null,rows[0]);return {announcement:rows[0]};
  });
  app.put('/api/founder/ops/announcements/:id',{preHandler:authenticateFounder},async(request,reply)=>{
    const id=String(request.params.id),why=needReason(request.body),before=await one('SELECT * FROM founder_announcements WHERE id=$1',[id]);
    if(!before)return reply.code(404).send({error:'Announcement not found.'});
    const title=String(request.body?.title??before.title).trim().slice(0,160),body=String(request.body?.body??before.body).trim().slice(0,2000),severity=String(request.body?.severity??before.severity);
    if(!title||!body||!SEVERITIES.has(severity))return reply.code(400).send({error:'Invalid announcement.'});
    const starts=request.body?.startsAt===undefined?before.starts_at:(request.body.startsAt?new Date(request.body.startsAt).toISOString():null);
    const ends=request.body?.endsAt===undefined?before.ends_at:(request.body.endsAt?new Date(request.body.endsAt).toISOString():null);
    const {rows}=await db.query(`UPDATE founder_announcements SET title=$2,body=$3,severity=$4,enabled=$5,starts_at=$6,ends_at=$7,updated_by=$8,updated_at=now() WHERE id=$1 RETURNING *`,
      [id,title,body,severity,request.body?.enabled===undefined?before.enabled:Boolean(request.body.enabled),starts,ends,request.user.wallet]);
    await audit(request.user.wallet,'announcement.update','announcement',id,why,before,rows[0]);return {announcement:rows[0]};
  });
  app.delete('/api/founder/ops/announcements/:id',{preHandler:authenticateFounder},async(request,reply)=>{
    const id=String(request.params.id),why=needReason(request.body),before=await one('SELECT * FROM founder_announcements WHERE id=$1',[id]);
    if(!before)return reply.code(404).send({error:'Announcement not found.'});await db.query('DELETE FROM founder_announcements WHERE id=$1',[id]);await audit(request.user.wallet,'announcement.delete','announcement',id,why,before,null);return {ok:true};
  });

  app.get('/api/founder/ops/audit',{preHandler:authenticateFounder},async request=>{
    const q=String(request.query?.q||'').trim().slice(0,160),values=[],where=[];
    if(q){values.push(`%${q}%`);where.push(`(founder_wallet ILIKE $1 OR action ILIKE $1 OR subject_type ILIKE $1 OR COALESCE(subject_id,'') ILIKE $1 OR COALESCE(reason,'') ILIKE $1)`);}
    return {entries:(await db.query(`SELECT id,founder_wallet,action,subject_type,subject_id,reason,before_state,after_state,created_at
      FROM founder_admin_audit ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY created_at DESC LIMIT 500`,values)).rows};
  });

  app.get('/api/founder/ops/collections',{preHandler:authenticateFounder},async request=>{
    const chainId=request.query?.chainId?Number(request.query.chainId):null,q=String(request.query?.q||'').trim().slice(0,160),values=[],where=[];
    if(chainId){values.push(chainId);where.push(`c.chain_id=$${values.length}`);}if(q){values.push(`%${q}%`);where.push(`(c.contract_address ILIKE $${values.length} OR c.owner_wallet ILIKE $${values.length} OR COALESCE(p.name,'') ILIKE $${values.length})`);}
    return {collections:(await db.query(`SELECT c.chain_id,c.contract_address,c.owner_wallet,c.project_id,c.created_at,c.updated_at,p.name project_name,
      d.status deployment_status,d.architecture,d.provenance,pub.listed,pub.featured,pub.slug FROM collections c
      LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN rf26_deployments d USING(chain_id,contract_address)
      LEFT JOIN rf26_publications pub USING(chain_id,contract_address) ${where.length?`WHERE ${where.join(' AND ')}`:''}
      ORDER BY c.updated_at DESC LIMIT 500`,values)).rows};
  });

  app.get('/api/founder/ops/collections/:chainId/:contract/diagnostic',{preHandler:authenticateFounder},async(request,reply)=>{
    const chainId=Number(request.params.chainId);let address;try{address=getAddress(request.params.contract);}catch{return reply.code(400).send({error:'Invalid collection address.'});}
    const [network,cloud]=await Promise.all([networkControl(chainId),one(`SELECT c.*,d.status deployment_status,d.architecture,d.factory_address deployment_factory,d.provenance,
      p.name project_name,pub.listed,pub.featured,pub.slug FROM collections c LEFT JOIN rf26_deployments d USING(chain_id,contract_address)
      LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN rf26_publications pub USING(chain_id,contract_address)
      WHERE c.chain_id=$1 AND lower(c.contract_address)=lower($2)`,[chainId,address])]);
    if(!network)return reply.code(404).send({error:'Network not registered.'});
    const provider=providerFor(chainId),code=await provider.getCode(address),warnings=[];let onchain=null;
    if(!code||code==='0x')warnings.push('No contract code exists at this address.');
    else{
      const c=new Contract(address,DIAG_ABI,provider),calls=await Promise.allSettled([c.name(),c.symbol(),c.factory(),c.creator(),c.controller(),c.dataContract(),c.mintPhases(),c.forgeReserve(),c.feePolicy(),c.totalMinted(),c.maxSupply(),c.pendingSupply()]);
      const v=i=>calls[i].status==='fulfilled'?calls[i].value:null;
      onchain={name:v(0),symbol:v(1),factory:v(2),creator:v(3),controller:v(4),dataContract:v(5),mintPhases:v(6),forgeReserve:v(7),feePolicy:v(8),
        totalMinted:v(9)==null?null:Number(v(9)),maxSupply:v(10)==null?null:Number(v(10)),pendingSupply:v(11)==null?null:Number(v(11))};
      if(onchain.factory&&network.factory_address&&String(onchain.factory).toLowerCase()!==String(network.factory_address).toLowerCase())warnings.push('Collection Factory does not match the active network release.');
      if(cloud?.owner_wallet&&onchain.creator&&String(cloud.owner_wallet).toLowerCase()!==String(onchain.creator).toLowerCase())warnings.push('Cloud owner does not match onchain creator.');
      if(onchain.pendingSupply!=null&&onchain.pendingSupply!==0)warnings.push(`pendingSupply=${onchain.pendingSupply}.`);
    }
    return {chainId,contract:address,network,cloud:cloud||null,onchain,warnings,checkedAt:new Date().toISOString()};
  });

  app.get('/api/founder/ops/operations',{preHandler:authenticateFounder},async()=>{
    const {rows:nets}=await db.query('SELECT chain_id,label,factory_address FROM rf26_networks ORDER BY chain_id'),rpc=[];
    for(const row of nets){const x={chainId:Number(row.chain_id),label:row.label,rpcOk:false,blockNumber:null,factoryCode:false,error:null};try{const p=providerFor(x.chainId);x.blockNumber=await p.getBlockNumber();x.rpcOk=true;if(row.factory_address){const code=await p.getCode(row.factory_address);x.factoryCode=Boolean(code&&code!=='0x');}}catch(error){x.error=error.shortMessage||error.message;}rpc.push(x);}
    const [now,p,c,a,d]=await Promise.all([one('SELECT now() now'),one('SELECT COUNT(*)::int count FROM projects'),one('SELECT COUNT(*)::int count FROM collections'),
      one(`SELECT COUNT(*)::int count,COALESCE(SUM(size_bytes),0)::bigint bytes FROM assets WHERE status='ready'`),db.query('SELECT status,COUNT(*)::int count FROM rf26_deployments GROUP BY status ORDER BY status')]);
    return {database:{ok:Boolean(now?.now),now:now?.now||null},rpc,counts:{projects:Number(p?.count||0),collections:Number(c?.count||0),assets:Number(a?.count||0),assetBytes:Number(a?.bytes||0)},
      deploymentStatuses:d.rows,runtime:await runtimeSettings(),checkedAt:new Date().toISOString()};
  });
}
