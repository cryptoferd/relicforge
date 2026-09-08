import { getAddress } from 'ethers';
import { db, one } from './db.js';
import { tokenMetadata, walletOwnsCanonicalToken } from './reliquary-index.js';

const ZERO='0x0000000000000000000000000000000000000000';
const key=(chainId,contract)=>`${Number(chainId)}:${String(contract||'').toLowerCase()}`;
async function allowed(chainId,contract){
  return Boolean(await one('SELECT 1 FROM rf26_public_collections WHERE chain_id=$1 AND contract_address=$2',
    [Number(chainId),String(contract||'').toLowerCase()]));
}
async function allowedSet(items){
  const references=items.map(row=>({chain_id:Number(row.chainId??row.chain_id),contract_address:String((row.contract??row.contract_address)||'').toLowerCase()}))
    .filter(row=>Number.isSafeInteger(row.chain_id)&&/^0x[0-9a-f]{40}$/.test(row.contract_address));
  if(!references.length)return new Set();
  const {rows}=await db.query(`SELECT DISTINCT p.chain_id,p.contract_address
    FROM rf26_public_collections p
    JOIN jsonb_to_recordset($1::jsonb) AS r(chain_id bigint,contract_address text)
    ON r.chain_id=p.chain_id AND r.contract_address=p.contract_address`,[JSON.stringify(references)]);
  return new Set(rows.map(row=>key(row.chain_id,row.contract_address)));
}
async function publicStats(wallet){
  const [mint,holding,creator,chains]=await Promise.all([
    one(`SELECT COALESCE(sum(m.quantity),0)::text AS total_mints,count(*)::int AS mint_transactions,
      count(DISTINCT(m.chain_id,m.contract_address))::int AS collections_minted,
      COALESCE(sum(m.native_value_wei),0)::text AS native_value_spent_wei,
      COALESCE(sum(m.platform_fee_wei),0)::text AS platform_fees_generated_wei,
      COALESCE(sum(m.quantity) FILTER(WHERE m.fee_mode=1),0)::text AS sponsored_mints,
      COALESCE(sum(m.quantity) FILTER(WHERE m.fee_mode=2),0)::text AS minter_supported_mints,
      min(m.block_time) AS first_mint_at
      FROM reliquary_mint_activity m JOIN rf26_public_collections p USING(chain_id,contract_address)
      WHERE m.wallet=$1`,[wallet]),
    one(`WITH latest AS (
      SELECT DISTINCT ON(t.chain_id,t.contract_address,t.token_id)
        t.chain_id,t.contract_address,t.token_id,t.to_wallet,t.block_time
      FROM reliquary_transfer_activity t JOIN rf26_public_collections p USING(chain_id,contract_address)
      WHERE t.wallet=$1
      ORDER BY t.chain_id,t.contract_address,t.token_id,t.block_number DESC,t.log_index DESC
    ) SELECT count(*) FILTER(WHERE to_wallet=$1)::int AS nfts_held,
      COALESCE(max(EXTRACT(EPOCH FROM(now()-block_time))/86400) FILTER(WHERE to_wallet=$1),0) AS longest_hold_days,
      COALESCE(avg(EXTRACT(EPOCH FROM(now()-block_time))/86400) FILTER(WHERE to_wallet=$1),0) AS average_hold_days
      FROM latest`,[wallet]),
    one(`SELECT count(*)::int AS collections_created FROM rf26_public_collections WHERE owner_wallet=$1`,[wallet]),
    db.query(`SELECT DISTINCT chain_id FROM (
      SELECT m.chain_id FROM reliquary_mint_activity m JOIN rf26_public_collections p USING(chain_id,contract_address) WHERE m.wallet=$1
      UNION SELECT t.chain_id FROM reliquary_transfer_activity t JOIN rf26_public_collections p USING(chain_id,contract_address) WHERE t.wallet=$1
      UNION SELECT chain_id FROM rf26_public_collections WHERE owner_wallet=$1
    ) q`,[wallet])
  ]);
  return {
    totalMints:Number(mint?.total_mints||0),mintTransactions:Number(mint?.mint_transactions||0),
    collectionsMinted:Number(mint?.collections_minted||0),nftsHeld:Number(holding?.nfts_held||0),
    chainsUsed:chains.rows.length,nativeValueSpentWei:String(mint?.native_value_spent_wei||'0'),
    platformFeesGeneratedWei:String(mint?.platform_fees_generated_wei||'0'),
    sponsoredMints:Number(mint?.sponsored_mints||0),minterSupportedMints:Number(mint?.minter_supported_mints||0),
    firstMintAt:mint?.first_mint_at||null,collectionsCreated:Number(creator?.collections_created||0),
    creatorCollectionMints:null,longestCurrentHoldDays:Math.floor(Number(holding?.longest_hold_days||0)),
    averageCurrentHoldDays:Math.floor(Number(holding?.average_hold_days||0)),
    coverage:{model:'public-production-collections',partial:true}
  };
}
async function publicPfp(profile){
  const p=profile?.pfp;
  if(!p?.valid||!await allowed(p.chainId,p.contract))return null;
  if(!await walletOwnsCanonicalToken(profile.wallet,p.chainId,p.contract,p.tokenId).catch(()=>false))return null;
  return p;
}
async function publicNfts(wallet,mode,limit){
  const count=Number(limit);const take=Number.isSafeInteger(count)?Math.min(100,Math.max(1,count)):48;
  const minted=mode==='minted';
  const sql=minted?`WITH minted AS (
      SELECT t.chain_id,t.contract_address,t.token_id,min(t.block_time) AS minted_at
      FROM reliquary_transfer_activity t JOIN rf26_public_collections p USING(chain_id,contract_address)
      WHERE t.wallet=$1 AND t.from_wallet=$2 AND t.to_wallet=$1
      GROUP BY t.chain_id,t.contract_address,t.token_id
    ),latest AS (
      SELECT DISTINCT ON(chain_id,contract_address,token_id)
        chain_id,contract_address,token_id,to_wallet,block_time
      FROM reliquary_transfer_activity WHERE wallet=$1
      ORDER BY chain_id,contract_address,token_id,block_number DESC,log_index DESC
    ) SELECT m.chain_id,m.contract_address,m.token_id,m.minted_at,(l.to_wallet=$1) AS owned,l.block_time AS acquired_at
      FROM minted m LEFT JOIN latest l USING(chain_id,contract_address,token_id)
      ORDER BY m.minted_at DESC NULLS LAST LIMIT $3`
    :`WITH latest AS (
      SELECT DISTINCT ON(t.chain_id,t.contract_address,t.token_id)
        t.chain_id,t.contract_address,t.token_id,t.to_wallet,t.block_time
      FROM reliquary_transfer_activity t JOIN rf26_public_collections p USING(chain_id,contract_address)
      WHERE t.wallet=$1
      ORDER BY t.chain_id,t.contract_address,t.token_id,t.block_number DESC,t.log_index DESC
    ) SELECT l.chain_id,l.contract_address,l.token_id,l.block_time AS acquired_at,
      EXISTS(SELECT 1 FROM reliquary_transfer_activity m WHERE m.wallet=$1
        AND m.chain_id=l.chain_id AND m.contract_address=l.contract_address AND m.token_id=l.token_id
        AND m.from_wallet=$2 AND m.to_wallet=$1) AS minted_by_wallet,true AS owned
      FROM latest l WHERE l.to_wallet=$1 ORDER BY l.block_time DESC NULLS LAST LIMIT $3`;
  const {rows}=await db.query(sql,[wallet,ZERO,take]);
  return Promise.all(rows.map(async row=>{
    let metadata=null;
    try{metadata=await tokenMetadata(Number(row.chain_id),row.contract_address,row.token_id);}catch(_){}
    return {chainId:Number(row.chain_id),contract:getAddress(row.contract_address),tokenId:String(row.token_id),
      owned:Boolean(row.owned),mintedByWallet:minted||Boolean(row.minted_by_wallet),
      mintedAt:row.minted_at||null,acquiredAt:row.acquired_at||null,metadata};
  }));
}
export function installRf26PublicGuards(app){
  // Exact public routes, not an arbitrary global response rewrite. The private
  // /me and authorized project endpoints are intentionally untouched.
  app.addHook('onRoute',options=>{
    const methods=Array.isArray(options.method)?options.method:[options.method];
    if(!methods.includes('GET'))return;
    const url=options.url;
    if(url==='/api/rc47b/upcoming'){
      const original=options.handler;
      options.handler=async function(request,reply){
        const response=await original.call(this,request,reply);
        if(reply.sent||!response?.mints)return response;
        const allowedKeys=await allowedSet(response.mints);
        return {...response,mints:response.mints.filter(row=>allowedKeys.has(key(row.chainId,row.contract)))};
      };
    }
    if(url==='/api/reliquary/u/:username'){
      const original=options.handler;
      options.handler=async function(request,reply){
        const response=await original.call(this,request,reply);
        if(reply.sent||!response?.profile)return response;
        const profile=response.profile;
        return {...response,profile:{...profile,pfp:await publicPfp(profile),stats:await publicStats(profile.wallet),
          statsRefreshedAt:null}};
      };
    }
    if(url==='/api/reliquary/u/:username/nfts'){
      options.handler=async function(request,reply){
        const row=await one('SELECT wallet,username FROM reliquary_profiles WHERE lower(username)=lower($1)',[request.params.username]);
        if(!row?.username)return reply.code(404).send({error:'Reliquary profile not found.'});
        const mode=request.query?.mode==='owned'?'owned':'minted';
        return {mode,nfts:await publicNfts(row.wallet,mode,request.query?.limit)};
      };
    }
    if(url==='/api/reliquary/nft/:chainId/:contract/:tokenId'){
      const original=options.handler;
      options.handler=async function(request,reply){
        if(!await allowed(request.params.chainId,request.params.contract))
          return reply.code(404).send({error:'NFT not found in a public collection.'});
        return original.call(this,request,reply);
      };
    }
  });
}
