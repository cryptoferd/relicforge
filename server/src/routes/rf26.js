import { Contract, getAddress } from 'ethers';
import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import { verifyCollectionOwner, providerFor } from '../lib/rpc.js';
import { networkPolicy, networkId, assertProductionPublication, assertDeploymentEnabled, normalizeSlug } from '../lib/rf26-networks.js';
import { splitLegacyProject, launchDraft } from '../lib/rf26-project-model.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FACTORY_ABI=['function isRelicForgeCollection(address) view returns(bool)'];
const COLLECTION_ABI=[
  'function factory() view returns(address)',
  'function creator() view returns(address)',
  'function dataContract() view returns(address)',
  'function mintPhases() view returns(address)'
];
const DATA_ABI=[
  'function creator() view returns(address)',
  'function contentSealed() view returns(bool)',
  'function provenanceHash() view returns(bytes32)'
];
const PHASES_ABI=['function collection() view returns(address)'];
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
function uuid(value){if(!UUID.test(String(value||'')))throw fail('Invalid project or draft ID.');return String(value);}
function address(value){return getAddress(String(value||'')).toLowerCase();}
async function access(projectId,requester,write=false){
  const id=uuid(projectId),wallet=address(requester);
  const project=await one('SELECT id,owner_wallet,name,current_version,snapshot FROM projects WHERE id=$1',[id]);
  if(!project)throw fail('Project not found.',404);
  if(address(project.owner_wallet)===wallet)return project;
  if(write)throw fail('Only the project owner may change launch configurations.',403);
  const collaborator=await one('SELECT 1 FROM project_collaborators WHERE project_id=$1 AND wallet=$2',[id,wallet]);
  if(!collaborator)throw fail('Project not found.',404);
  return project;
}
async function deployment(chainId,contract,requester){
  const id=networkId(chainId),addr=address(contract);
  await verifyCollectionOwner(id,addr,requester);
  const row=await one('SELECT * FROM rf26_deployments WHERE chain_id=$1 AND contract_address=$2',[id,addr]);
  if(!row)throw fail('Register this deployment before configuring its public mint page.',404);
  if(address(row.owner_wallet)!==address(requester))throw fail('Deployment owner mismatch.',403);
  return row;
}
function publicDeployment(row){
  return {
    chainId:Number(row.chain_id),contract:getAddress(row.contract_address),
    slug:row.slug||null,listed:Boolean(row.listed),featured:Boolean(row.featured),
    mintPage:`./mint.html?contract=${encodeURIComponent(row.contract_address)}&chain=${row.chain_id}`
  };
}
async function verifyV2(id,contract,policy){
  const provider=providerFor(id);
  if(!policy.factory_address)throw fail('Network Factory is not configured.',409);
  const factoryAddress=address(policy.factory_address);
  const [actualChain,code]=await Promise.all([provider.send('eth_chainId',[]),provider.getCode(contract)]);
  if(Number(BigInt(actualChain))!==id||!code||code==='0x')throw fail('Collection network or deployed code mismatch.',409);
  const collection=new Contract(contract,COLLECTION_ABI,provider);
  const [factory,creator,data,phases]=await Promise.all([
    collection.factory(),collection.creator(),collection.dataContract(),collection.mintPhases()
  ]);
  if(address(factory)!==factoryAddress)throw fail('Collection Factory does not match the selected network.',403);
  const factoryContract=new Contract(factoryAddress,FACTORY_ABI,provider);
  if(!await factoryContract.isRelicForgeCollection(contract))throw fail('Collection is not registered by the configured Factory.',403);
  for(const linked of [data,phases]){
    const code=await provider.getCode(linked);
    if(!code||code==='0x')throw fail('Collection has an invalid onchain data or mint-stage binding.',409);
  }
  const dataContract=new Contract(data,DATA_ABI,provider);
  const phaseContract=new Contract(phases,PHASES_ABI,provider);
  const [dataCreator,sealed,provenance,boundCollection]=await Promise.all([
    dataContract.creator(),dataContract.contentSealed(),dataContract.provenanceHash(),phaseContract.collection()
  ]);
  if(address(dataCreator)!==address(creator)||address(boundCollection)!==address(contract))
    throw fail('Collection, artwork data, and mint-stage bindings do not match.',409);
  return {creator:address(creator),factory:factoryAddress,sealed:Boolean(sealed),provenance:String(provenance).toLowerCase()};
}
export default async function rf26Routes(app){
  app.get('/api/public/forge-networks',async()=>{
    const {rows}=await db.query(`SELECT chain_id,label,kind,launch_enabled,public_enabled,configuration
      FROM rf26_networks ORDER BY CASE WHEN chain_id=1 THEN 0 WHEN chain_id=11155111 THEN 1 ELSE 2 END,label`);
    return {networks:rows.map(row=>({
      chainId:Number(row.chain_id),name:row.label,kind:row.kind,
      launchEnabled:Boolean(row.launch_enabled),publicEnabled:Boolean(row.public_enabled),
      // Public configuration must be explicitly curated. No RPC credentials or secrets.
      currency:'ETH'
    }))};
  });

  app.get('/api/rc26/projects/:id', {preHandler:authenticate},async request=>{
    const project=await access(request.params.id,request.user.wallet);
    const [drafts,deployed]=await Promise.all([
      db.query('SELECT id,name,target_chain_id,settings,revision,created_at,updated_at FROM rf26_project_launch_drafts WHERE project_id=$1 ORDER BY updated_at DESC',[project.id]),
      db.query('SELECT * FROM rf26_deployments WHERE project_id=$1 ORDER BY created_at DESC',[project.id])
    ]);
    return {project:{id:project.id,name:project.name,currentVersion:project.current_version,
      ...splitLegacyProject(project.snapshot||{})},launchDrafts:drafts.rows,deployments:deployed.rows};
  });

  app.put('/api/rc26/projects/:id/launch-drafts/:draftId',{preHandler:authenticate},async(request,reply)=>{
    const project=await access(request.params.id,request.user.wallet,true);
    const draftId=uuid(request.params.draftId);
    const target=request.body?.targetChainId??null;
    const normalized=launchDraft(request.body?.settings||{},target);
    if(normalized.targetChainId!==null)await networkPolicy(normalized.targetChainId);
    const name=String(request.body?.name||'Launch configuration').trim().slice(0,180)||'Launch configuration';
    const expected=request.body?.expectedRevision;
    if(expected!==undefined&&(!Number.isSafeInteger(Number(expected))||Number(expected)<1))
      throw fail('Invalid expected revision.');
    const client=await db.connect();
    try{
      await client.query('BEGIN');
      const current=await client.query('SELECT revision FROM rf26_project_launch_drafts WHERE id=$1 AND project_id=$2 FOR UPDATE',[draftId,project.id]);
      let row;
      if(current.rows.length){
        if(expected!==undefined&&Number(expected)!==Number(current.rows[0].revision))throw fail('A newer launch draft exists. Reload before saving.',409);
        const result=await client.query(`UPDATE rf26_project_launch_drafts
          SET name=$3,target_chain_id=$4,settings=$5::jsonb,revision=revision+1,updated_at=now()
          WHERE id=$1 AND project_id=$2 RETURNING *`,
          [draftId,project.id,name,normalized.targetChainId,JSON.stringify(normalized.settings)]);
        row=result.rows[0];
      }else{
        if(expected!==undefined)throw fail('Launch draft no longer exists.',409);
        const result=await client.query(`INSERT INTO rf26_project_launch_drafts(id,project_id,name,target_chain_id,settings)
          VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *`,
          [draftId,project.id,name,normalized.targetChainId,JSON.stringify(normalized.settings)]);
        row=result.rows[0];
      }
      await client.query('COMMIT');
      return {draft:row};
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  });

  app.post('/api/rc26/deployments',{preHandler:authenticate},async request=>{
    const id=networkId(request.body?.chainId),contract=address(request.body?.contract);
    const policy=assertDeploymentEnabled(await networkPolicy(id));
    const requester=address(request.user.wallet);
    const projectId=request.body?.projectId?uuid(request.body.projectId):null;
    if(projectId)await access(projectId,requester,true);
    const creator=address(await verifyCollectionOwner(id,contract,requester));
    const verified=await verifyV2(id,contract,policy);
    if(creator!==verified.creator)throw fail('Collection creator verification mismatch.',403);
    const provenance=request.body?.provenance||null;
    if(provenance!==null&&!/^0x[0-9a-f]{64}$/i.test(String(provenance)))throw fail('Invalid content fingerprint.');
    if(provenance!==null&&String(provenance).toLowerCase()!==verified.provenance)
      throw fail('Submitted content fingerprint does not match the onchain artwork data.',409);
    const confirmedProvenance=verified.sealed?verified.provenance:null;
    if(verified.sealed&&(!confirmedProvenance||/^0x0{64}$/.test(confirmedProvenance)))
      throw fail('Sealed artwork data has no valid content fingerprint.',409);
    const client=await db.connect();
    try{
      await client.query('BEGIN');
      const existing=await client.query('SELECT owner_wallet,project_id FROM collections WHERE chain_id=$1 AND contract_address=$2 FOR UPDATE',[id,contract]);
      if(existing.rows.length&&address(existing.rows[0].owner_wallet)!==creator)throw fail('Collection is registered to a different creator.',409);
      if(existing.rows.length&&existing.rows[0].project_id&&projectId&&String(existing.rows[0].project_id)!==projectId)
        throw fail('This collection is already associated with another project.',409);
      await client.query(`INSERT INTO collections(chain_id,contract_address,owner_wallet,project_id)
        VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,contract_address) DO UPDATE
        SET project_id=COALESCE(collections.project_id,EXCLUDED.project_id)`,[id,contract,creator,projectId]);
      const result=await client.query(`INSERT INTO rf26_deployments(project_id,chain_id,contract_address,owner_wallet,factory_address,provenance,architecture,status)
        VALUES($1,$2,$3,$4,$5,$6,'v2',$7)
        ON CONFLICT(chain_id,contract_address) DO UPDATE SET
        project_id=COALESCE(rf26_deployments.project_id,EXCLUDED.project_id),
        factory_address=EXCLUDED.factory_address,provenance=COALESCE(rf26_deployments.provenance,EXCLUDED.provenance),
        architecture='v2',
        status=CASE WHEN rf26_deployments.status='sealed' THEN 'sealed' ELSE EXCLUDED.status END,
        updated_at=now()
        RETURNING *`,[projectId,id,contract,creator,verified.factory,confirmedProvenance,verified.sealed?'sealed':'deployed']);
      await client.query('COMMIT');
      return {deployment:result.rows[0]};
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  });

  app.get('/api/rc26/deployments/:chainId/:contract',{preHandler:authenticate},async request=>{
    return {deployment:await deployment(request.params.chainId,request.params.contract,request.user.wallet)};
  });

  app.get('/api/public/mint-slugs/:slug/available',async request=>{
    const slug=normalizeSlug(request.params.slug);
    const row=await one('SELECT 1 FROM rf26_publications WHERE slug=$1',[slug]);
    const {rows}=await db.query("SELECT chain_id FROM rf26_networks WHERE kind='production' AND public_enabled=TRUE");
    return {slug,available:!row&&rows.length>0,productionAvailable:rows.length>0};
  });

  app.put('/api/rc26/deployments/:chainId/:contract/slug',{preHandler:authenticate},async request=>{
    const id=networkId(request.params.chainId),contract=address(request.params.contract);
    const policy=assertProductionPublication(await networkPolicy(id));
    const row=await deployment(id,contract,request.user.wallet);
    if(row.project_id && request.body?.projectId && String(row.project_id)!==String(request.body.projectId))
      throw fail('Deployment project mismatch.',409);
    if(row.architecture!=='v2')throw fail('Custom slugs require a registered V2 production collection.',409);
    await verifyV2(id,contract,policy);
    if(address(row.factory_address)!==address(policy.factory_address))throw fail('Collection Factory is not the active production Factory.',409);
    const slug=normalizeSlug(request.body?.slug);
    const client=await db.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['rf26:slug:'+slug]);
      const current=await client.query('SELECT slug FROM rf26_publications WHERE chain_id=$1 AND contract_address=$2 FOR UPDATE',[id,contract]);
      if(current.rows[0]?.slug&&current.rows[0].slug!==slug)throw fail('This collection already has a permanent slug.',409);
      const result=await client.query(`INSERT INTO rf26_publications(chain_id,contract_address,owner_wallet,slug)
        VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,contract_address) DO UPDATE
        SET slug=EXCLUDED.slug RETURNING slug`,[id,contract,address(request.user.wallet),slug]);
      await client.query('COMMIT');
      return {slug:result.rows[0].slug,chainId:id,contract:getAddress(contract),
        mintPage:`/mint/${slug}`,permanent:true};
    }catch(error){
      await client.query('ROLLBACK');
      if(error.code==='23505')throw fail('This slug has already been claimed.',409);
      throw error;
    }finally{client.release();}
  });

  app.put('/api/rc26/deployments/:chainId/:contract/publication',{preHandler:authenticate},async request=>{
    const id=networkId(request.params.chainId),contract=address(request.params.contract);
    const policy=assertProductionPublication(await networkPolicy(id));
    const row=await deployment(id,contract,request.user.wallet);
    if(row.architecture!=='v2'||address(row.factory_address)!==address(policy.factory_address))
      throw fail('This deployment is not registered under the active production Factory.',409);
    await verifyV2(id,contract,policy);
    if(typeof request.body?.listed!=='boolean'||typeof request.body?.featureRequested!=='boolean')
      throw fail('listed and featureRequested must be booleans.');
    const listed=request.body.listed,featureRequested=listed&&request.body.featureRequested;
    const result=await one(`INSERT INTO rf26_publications(chain_id,contract_address,owner_wallet,listed,feature_requested)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(chain_id,contract_address) DO UPDATE
      SET listed=EXCLUDED.listed,feature_requested=EXCLUDED.feature_requested,
          featured=CASE WHEN EXCLUDED.listed AND EXCLUDED.feature_requested THEN rf26_publications.featured ELSE FALSE END
      RETURNING *`,[id,contract,address(request.user.wallet),listed,featureRequested]);
    return {publication:{chainId:id,contract:getAddress(contract),listed:result.listed,featureRequested:result.feature_requested,
      featured:result.featured,slug:result.slug}};
  });

  app.get('/api/public/mint-slugs/:slug',async(request,reply)=>{
    const slug=normalizeSlug(request.params.slug);
    const row=await one(`SELECT c.chain_id,c.contract_address,p.slug,p.listed,p.featured
      FROM rf26_publications p JOIN collections c USING(chain_id,contract_address)
      JOIN rf26_networks n ON n.chain_id=c.chain_id
      WHERE p.slug=$1 AND n.kind='production' AND n.public_enabled=TRUE
        AND c.owner_wallet=p.owner_wallet`,[slug]);
    reply.header('Cache-Control','public, s-maxage=60');
    if(!row)return reply.code(404).send({error:'Mint page not found.'});
    return publicDeployment(row);
  });
}
