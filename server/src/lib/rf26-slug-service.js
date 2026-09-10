import {
  fail,normalizeSlug,chainId,address,productionPolicy,
  canonicalMintPath,customMintPath,validProvenance,publicTarget
} from './rf26-slug-core.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex64=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const same=(a,b)=>address(a)===address(b);
const hidden=()=>fail('Mint page not found.',404,'NOT_FOUND');
const CONFLICT=()=>fail('This URL has already been claimed.',409,'SLUG_TAKEN');

export const RESOLVE_SQL=`SELECT c.chain_id,c.contract_address,c.owner_wallet,
  p.owner_wallet AS publication_owner,p.slug,p.listed,p.feature_requested,p.featured,
  n.kind,n.public_enabled,n.launch_enabled,n.factory_address,n.release_id,n.release_manifest_hash,
  d.architecture,d.status,d.provenance,d.factory_address AS deployment_factory
  FROM rf26_publications p
  JOIN collections c
    ON c.chain_id=p.chain_id AND c.contract_address=p.contract_address
  JOIN rf26_networks n ON n.chain_id=c.chain_id
  JOIN rf26_deployments d
    ON d.chain_id=c.chain_id AND d.contract_address=c.contract_address
  WHERE p.slug=$1`;

function publication(row,id,contract) {
  return {chainId:id,contract,slug:row?.slug||null,listed:row?.listed===true,
    featureRequested:row?.feature_requested===true,featured:row?.featured===true};
}

export function createSlugService({db,one,networkPolicy,verifyV2,readController}) {
  if(!db?.query||!db?.connect||typeof one!=='function'||typeof networkPolicy!=='function'||
     typeof verifyV2!=='function'||typeof readController!=='function')
    throw new Error('R3B requires the existing database, network, and onchain verification dependencies.');

  async function authorize(id,contract,wallet,{write=false}={}) {
    const requester=address(wallet);
    const row=await one(`SELECT d.*,c.owner_wallet AS collection_owner,c.project_id AS collection_project
      FROM rf26_deployments d JOIN collections c USING(chain_id,contract_address)
      WHERE d.chain_id=$1 AND d.contract_address=$2`,[id,contract]);
    if(!row)throw fail('Register this deployment before configuring its mint URL.',404);
    if(row.architecture!=='v2')throw fail('A verified V2 deployment is required.',409);
    // The immutable creator attribution and the active controller are distinct.
    // Only an authenticated active controller can change publication settings.
    const verified=await verifyV2(id,contract,await networkPolicy(id));
    if(!same(row.owner_wallet,row.collection_owner)||!same(row.owner_wallet,verified.creator))
      throw fail('Deployment creator attribution does not match onchain state.',409);
    if(!same(row.factory_address,verified.factory))
      throw fail('Registered Factory does not match onchain state.',409);
    const controller=address(await readController(id,contract));
    if(controller!==requester)throw fail('Connected wallet is not the active collection controller.',403);
    if(write&&(!verified.sealed||row.status!=='sealed'||!validProvenance(row.provenance)||
       String(row.provenance).toLowerCase()!==String(verified.provenance).toLowerCase()))
      throw fail('Complete and register the sealed onchain artwork before publishing.',409);
    return {row,verified,requester};
  }

  async function availability(raw) {
    const slug=normalizeSlug(raw);
    const claimed=Boolean(await one('SELECT 1 FROM rf26_publications WHERE slug=$1',[slug]));
    const {rows}=await db.query(`SELECT chain_id FROM rf26_networks
      WHERE kind='production' AND launch_enabled=TRUE AND public_enabled=TRUE
        AND factory_address IS NOT NULL AND release_id IS NOT NULL AND release_manifest_hash IS NOT NULL`);
    return {slug,available:!claimed,claimed,productionAvailable:rows.length>0};
  }

  async function getPublication(rawId,rawContract,wallet) {
    const id=chainId(rawId),contract=address(rawContract);
    const {row}=await authorize(id,contract,wallet);
    const p=await one('SELECT * FROM rf26_publications WHERE chain_id=$1 AND contract_address=$2',[id,contract]);
    return {publication:publication(p,id,contract),
      deployment:{chainId:id,contract,projectId:row.project_id,status:row.status,
        architecture:row.architecture,provenance:row.provenance}};
  }

  async function claim(rawId,rawContract,wallet,body) {
    const id=chainId(rawId),contract=address(rawContract);
    const slug=normalizeSlug(body?.slug);
    const policy=productionPolicy(await networkPolicy(id));
    const {row,verified}=await authorize(id,contract,wallet,{write:true});
    if(!same(row.factory_address,policy.factory_address)||!same(verified.factory,policy.factory_address))
      throw fail('Collection Factory is not the active production Factory.',409);
    if(body?.projectId!=null){
      if(typeof body.projectId!=='string'||!UUID.test(body.projectId)||
         String(row.project_id||'').toLowerCase()!==body.projectId.toLowerCase())
        throw fail('Deployment project mismatch.',409);
    }
    // Database owner remains the original creator. Never rewrite owner_wallet to
    // the current controller: doing so would break creator attribution and FK guards.
    const creator=address(row.owner_wallet);
    const client=await db.connect();
    let begun=false;
    try {
      await client.query('BEGIN');begun=true;
      const current=await client.query(`SELECT slug,owner_wallet FROM rf26_publications
        WHERE chain_id=$1 AND contract_address=$2 FOR UPDATE`,[id,contract]);
      if(current.rows[0]?.slug&&current.rows[0].slug!==slug)
        throw fail('This collection already has a permanent mint URL.',409,'SLUG_PERMANENT');
      if(current.rows[0]&&!same(current.rows[0].owner_wallet,creator))
        throw fail('Publication creator mismatch.',409);
      const result=await client.query(`INSERT INTO rf26_publications(chain_id,contract_address,owner_wallet,slug)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(chain_id,contract_address) DO UPDATE SET slug=EXCLUDED.slug
        WHERE rf26_publications.owner_wallet=EXCLUDED.owner_wallet
          AND (rf26_publications.slug IS NULL OR rf26_publications.slug=EXCLUDED.slug)
        RETURNING slug`,[id,contract,creator,slug]);
      if(!result.rows.length)throw fail('This collection already has a permanent mint URL.',409,'SLUG_PERMANENT');
      await client.query('COMMIT');begun=false;
      return {slug,chainId:id,contract,mintPage:customMintPath(slug),permanent:true};
    }catch(error){
      if(begun)await client.query('ROLLBACK');
      if(error.code==='23505')throw CONFLICT();
      throw error;
    }finally{client.release();}
  }

  async function setPublication(rawId,rawContract,wallet,body) {
    const id=chainId(rawId),contract=address(rawContract);
    const policy=productionPolicy(await networkPolicy(id));
    if(typeof body?.listed!=='boolean'||typeof body?.featureRequested!=='boolean')
      throw fail('listed and featureRequested must be booleans.');
    if(Object.hasOwn(body,'featured')||Object.hasOwn(body,'slug'))
      throw fail('Use the dedicated slug endpoint; featured placement is platform-controlled.');
    const {row,verified}=await authorize(id,contract,wallet,{write:true});
    if(!same(row.factory_address,policy.factory_address)||!same(verified.factory,policy.factory_address))
      throw fail('Collection Factory is not the active production Factory.',409);
    const listed=body.listed,requested=listed&&body.featureRequested;
    const client=await db.connect();
    let begun=false;
    try{
      await client.query('BEGIN');begun=true;
      const result=await client.query(`INSERT INTO rf26_publications
        (chain_id,contract_address,owner_wallet,listed,feature_requested)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(chain_id,contract_address) DO UPDATE SET
          listed=EXCLUDED.listed,feature_requested=EXCLUDED.feature_requested,
          featured=CASE WHEN EXCLUDED.listed AND EXCLUDED.feature_requested
            THEN rf26_publications.featured ELSE FALSE END
        WHERE rf26_publications.owner_wallet=EXCLUDED.owner_wallet
        RETURNING *`,[id,contract,address(row.owner_wallet),listed,requested]);
      if(!result.rows.length)throw fail('Publication creator mismatch.',409);
      await client.query('COMMIT');begun=false;
      return {publication:publication(result.rows[0],id,contract)};
    }catch(error){
      if(begun)await client.query('ROLLBACK');
      throw error;
    }finally{client.release();}
  }

  async function resolve(raw) {
    const slug=normalizeSlug(raw);
    const row=await one(RESOLVE_SQL,[slug]);
    if(!row)throw hidden();
    try{return publicTarget(row);}
    catch{throw hidden();}
  }

  return {availability,getPublication,claim,setPublication,resolve};
}
