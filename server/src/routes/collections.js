import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import { verifyCollectionOwner, collectionFor, providerFor } from '../lib/rpc.js';
import { Contract, getAddress } from 'ethers';
import { deleteObjects } from '../lib/storage.js';
import { networkPolicy } from '../lib/rf26-networks.js';
import { normalizeLegacyMintPage } from '../lib/rf26-mint-page-policy.js';

const MINT_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const V2_COLLECTION_PHASES_ABI = ['function mintPhases() view returns(address)'];
const V2_MINT_PHASES_READ_ABI = ['function phaseCount() view returns(uint32)','function phases(uint32) view returns(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 minted,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled)'];

function normAddress(value) { return String(value || '').toLowerCase(); }
async function v2MintPhases(chainId, collectionAddress) {
  const collection = new Contract(getAddress(collectionAddress), V2_COLLECTION_PHASES_ABI, providerFor(chainId));
  const mintPhasesAddress = getAddress(await collection.mintPhases());
  return { address: mintPhasesAddress, contract: new Contract(mintPhasesAddress, V2_MINT_PHASES_READ_ABI, providerFor(chainId)) };
}

export default async function collectionRoutes(app) {
  app.get('/api/collections', { preHandler: authenticate }, async request => {
    const { rows } = await db.query(
      `SELECT chain_id,contract_address,project_id,mint_page,created_at,updated_at FROM collections WHERE owner_wallet=$1 ORDER BY updated_at DESC LIMIT 500`,
      [request.user.wallet]
    );
    return { collections: rows };
  });

  app.put('/api/collections/:chainId/:contract/mint-page', { preHandler: authenticate }, async (request, reply) => {
    const chainId = Number(request.params.chainId);
    const contract = normAddress(request.params.contract);
    try { await verifyCollectionOwner(chainId, contract, request.user.wallet); }
    catch (error) { return reply.code(403).send({ error: error.message }); }
    const config = normalizeLegacyMintPage(request.body?.config || {}, await networkPolicy(chainId));
    const previous = await one('SELECT mint_page FROM collections WHERE chain_id=$1 AND contract_address=$2 AND owner_wallet=$3', [chainId, contract, request.user.wallet]);
    for (const assetId of [config.collectionImageAssetId, config.bannerImageAssetId].filter(Boolean)) {
      const asset = await one('SELECT id,object_key,content_type,size_bytes,purpose FROM assets WHERE id=$1 AND owner_wallet=$2 AND status=$3', [assetId, request.user.wallet, 'ready']);
      if (!asset) return reply.code(400).send({ error: 'Mint page asset is missing or belongs to another wallet.' });
      if (asset.purpose !== 'mint-page' || !String(asset.content_type || '').toLowerCase().startsWith('image/')) return reply.code(400).send({ error: 'Mint page media must be an uploaded image.' });
      if (Number(asset.size_bytes || 0) > MINT_PAGE_MAX_BYTES) return reply.code(400).send({ error: 'Mint-page images are limited to 2 MB each.' });
    }
    await db.query(
      `INSERT INTO collections(chain_id,contract_address,owner_wallet,project_id,mint_page)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(chain_id,contract_address) DO UPDATE SET owner_wallet=EXCLUDED.owner_wallet,project_id=COALESCE(EXCLUDED.project_id,collections.project_id),mint_page=EXCLUDED.mint_page,updated_at=now()`,
      [chainId, contract, request.user.wallet, request.body?.projectId || null, JSON.stringify(config)]
    );

    // Replacing a banner/image should not leak old objects into the Bucket forever.
    // Keep shared deduplicated mint-page assets while another collection still references them.
    const oldIds = new Set([previous?.mint_page?.collectionImageAssetId, previous?.mint_page?.bannerImageAssetId].filter(Boolean).map(String));
    const newIds = new Set([config.collectionImageAssetId, config.bannerImageAssetId].filter(Boolean).map(String));
    for (const oldId of oldIds) {
      if (newIds.has(oldId)) continue;
      try {
        const stillUsed = await one(
          `SELECT 1 FROM collections
           WHERE owner_wallet=$1 AND NOT (chain_id=$2 AND contract_address=$3)
             AND ((mint_page->>'collectionImageAssetId')=$4 OR (mint_page->>'bannerImageAssetId')=$4)
           LIMIT 1`,
          [request.user.wallet, chainId, contract, oldId]
        );
        if (stillUsed) continue;
        const oldAsset = await one("SELECT object_key FROM assets WHERE id=$1 AND owner_wallet=$2 AND purpose='mint-page'", [oldId, request.user.wallet]);
        if (!oldAsset) continue;
        await deleteObjects([oldAsset.object_key]);
        await db.query("DELETE FROM assets WHERE id=$1 AND owner_wallet=$2 AND purpose='mint-page'", [oldId, request.user.wallet]);
      } catch (error) {
        app.log.warn({ err: error, assetId: oldId }, 'Mint page updated but replaced asset cleanup failed');
      }
    }
    return { ok: true, publishedAt: new Date().toISOString() };
  });

  app.put('/api/collections/:chainId/:contract/whitelist', { preHandler: authenticate, bodyLimit: 25 * 1024 * 1024 }, async (request, reply) => {
    const chainId = Number(request.params.chainId);
    const contract = normAddress(request.params.contract);
    try { await verifyCollectionOwner(chainId, contract, request.user.wallet); }
    catch (error) { return reply.code(403).send({ error: error.message }); }
    const wl = request.body || {};
    const entries = Array.isArray(wl.entries) ? wl.entries : [];
    if (!wl.merkleRoot || entries.length > 250000) return reply.code(400).send({ error: 'Whitelist root required; maximum 250,000 entries per publish.' });
    const onchainRoot = String(await collectionFor(chainId, contract).whitelistRoot()).toLowerCase();
    if (onchainRoot !== String(wl.merkleRoot).toLowerCase()) return reply.code(400).send({ error: 'Published whitelist root does not match the collection whitelistRoot onchain.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO whitelists(chain_id,contract_address,phase_id,merkle_root,source_type,source_chain_id,source_contract,snapshot_block)
         VALUES($1,$2,0,$3,$4,$5,$6,$7)
         ON CONFLICT(chain_id,contract_address,phase_id) DO UPDATE SET merkle_root=EXCLUDED.merkle_root,source_type=EXCLUDED.source_type,source_chain_id=EXCLUDED.source_chain_id,source_contract=EXCLUDED.source_contract,snapshot_block=EXCLUDED.snapshot_block,updated_at=now()`,
        [chainId, contract, String(wl.merkleRoot).toLowerCase(), Number(wl.sourceType || 0), Number(wl.sourceChainId || 0), wl.sourceContract ? normAddress(wl.sourceContract) : null, Number(wl.snapshotBlock || 0)]
      );
      await client.query('DELETE FROM whitelist_entries WHERE chain_id=$1 AND contract_address=$2 AND phase_id=0', [chainId, contract]);
      for (let i = 0; i < entries.length; i += 1000) {
        const chunk = entries.slice(i, i + 1000);
        const values = [];
        const placeholders = chunk.map((entry, index) => {
          const base = index * 6;
          values.push(chainId, contract, 0, normAddress(entry.address), Number(entry.allowance || 0), JSON.stringify(entry.proof || []));
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::jsonb)`;
        });
        if (placeholders.length) await client.query(
          `INSERT INTO whitelist_entries(chain_id,contract_address,phase_id,wallet,allowance,proof) VALUES ${placeholders.join(',')}`,
          values
        );
      }
      await client.query('COMMIT');
      return { ok: true, entries: entries.length };
    } catch (error) {
      await client.query('ROLLBACK');
      return reply.code(400).send({ error: error.message });
    } finally { client.release(); }
  });


  app.get('/api/collections/:chainId/:contract/v2/whitelist/:phaseId', { preHandler: authenticate }, async (request, reply) => {
    const chainId=Number(request.params.chainId);
    const contract=normAddress(request.params.contract);
    const phaseId=Number(request.params.phaseId);
    if(!Number.isInteger(phaseId)||phaseId<1)return reply.code(400).send({error:'Invalid R12-v2 MintPhases stage id.'});
    try { await verifyCollectionOwner(chainId,contract,request.user.wallet); }
    catch(error){ return reply.code(403).send({error:error.message}); }
    let phases,raw;
    try {
      phases=await v2MintPhases(chainId,contract);
      const count=Number(await phases.contract.phaseCount());
      if(phaseId>count)throw new Error(`Stage ${phaseId} does not exist (phaseCount=${count}).`);
      raw=await phases.contract.phases(phaseId);
    } catch(error){ return reply.code(400).send({error:`R12-v2 stage could not be verified: ${error.shortMessage||error.message}`}); }
    const accessType=Number(raw.accessType??raw[7]);
    if(accessType!==1)return reply.code(400).send({error:'Only Approved Wallet stages have editable proof lists.'});
    const onchainRoot=String(raw.merkleRoot??raw[6]).toLowerCase();
    const header=await one(
      'SELECT merkle_root,source_type,source_chain_id,source_contract,snapshot_block,updated_at FROM whitelists WHERE chain_id=$1 AND contract_address=$2 AND phase_id=$3',
      [chainId,contract,phaseId]
    );
    const {rows}=await db.query(
      'SELECT wallet,allowance FROM whitelist_entries WHERE chain_id=$1 AND contract_address=$2 AND phase_id=$3 ORDER BY wallet',
      [chainId,contract,phaseId]
    );
    return {
      published:!!header,
      inSync:!!header && String(header.merkle_root).toLowerCase()===onchainRoot,
      chainId,contract:getAddress(contract),phaseId,mintPhases:phases.address,onchainRoot,
      storedRoot:header?.merkle_root||null,
      sourceType:Number(header?.source_type||0),
      sourceChainId:Number(header?.source_chain_id||0),
      sourceContract:header?.source_contract||null,
      snapshotBlock:Number(header?.snapshot_block||0),
      updatedAt:header?.updated_at||null,
      entries:rows.map(row=>({address:getAddress(row.wallet),allowance:Number(row.allowance||0)})),
    };
  });

  app.put('/api/collections/:chainId/:contract/v2/whitelist/:phaseId', { preHandler: authenticate, bodyLimit: 25 * 1024 * 1024 }, async (request, reply) => {
    const chainId=Number(request.params.chainId);
    const contract=normAddress(request.params.contract);
    const phaseId=Number(request.params.phaseId);
    if(!Number.isInteger(phaseId)||phaseId<1)return reply.code(400).send({error:'Invalid R12-v2 MintPhases stage id.'});
    try { await verifyCollectionOwner(chainId,contract,request.user.wallet); }
    catch(error){ return reply.code(403).send({error:error.message}); }
    let phases,raw;
    try {
      phases=await v2MintPhases(chainId,contract);
      const count=Number(await phases.contract.phaseCount());
      if(phaseId>count)throw new Error(`Stage ${phaseId} does not exist (phaseCount=${count}).`);
      raw=await phases.contract.phases(phaseId);
    } catch(error){ return reply.code(400).send({error:`R12-v2 stage could not be verified: ${error.shortMessage||error.message}`}); }
    const accessType=Number(raw.accessType??raw[7]);
    const onchainRoot=String(raw.merkleRoot??raw[6]).toLowerCase();
    if(accessType!==1)return reply.code(400).send({error:'Only Approved Wallet (Merkle) stages can publish proof tables.'});
    const wl=request.body||{};
    const root=String(wl.merkleRoot||'').toLowerCase();
    if(!/^0x[0-9a-f]{64}$/.test(root)||root!==onchainRoot)return reply.code(400).send({error:'Published root does not match the canonical MintPhases stage root.'});
    const entries=Array.isArray(wl.entries)?wl.entries:[];
    if(entries.length>250000)return reply.code(400).send({error:'Maximum 250,000 Approved Wallet entries per stage.'});
    const normalized=[];
    try {
      for(const entry of entries){
        const wallet=getAddress(entry.address).toLowerCase();
        const allowance=Number(entry.allowance||0);
        const proof=Array.isArray(entry.proof)?entry.proof.map(String):[];
        if(!Number.isInteger(allowance)||allowance<1||allowance>4294967295)throw new Error('Invalid Approved Wallet allowance.');
        if(proof.some(item=>!/^0x[0-9a-fA-F]{64}$/.test(item)))throw new Error('Invalid Merkle proof.');
        normalized.push({wallet,allowance,proof});
      }
    } catch(error){return reply.code(400).send({error:error.message});}
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO whitelists(chain_id,contract_address,phase_id,merkle_root,source_type,source_chain_id,source_contract,snapshot_block)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(chain_id,contract_address,phase_id) DO UPDATE
         SET merkle_root=EXCLUDED.merkle_root,source_type=EXCLUDED.source_type,source_chain_id=EXCLUDED.source_chain_id,source_contract=EXCLUDED.source_contract,snapshot_block=EXCLUDED.snapshot_block,updated_at=now()`,
        [chainId,contract,phaseId,root,Number(wl.sourceType||0),Number(wl.sourceChainId||0),wl.sourceContract?normAddress(wl.sourceContract):null,Number(wl.snapshotBlock||0)]
      );
      await client.query('DELETE FROM whitelist_entries WHERE chain_id=$1 AND contract_address=$2 AND phase_id=$3',[chainId,contract,phaseId]);
      for(let i=0;i<normalized.length;i+=1000){
        const chunk=normalized.slice(i,i+1000),values=[],params=[];
        chunk.forEach((entry,index)=>{const base=index*6;values.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6}::jsonb)`);params.push(chainId,contract,phaseId,entry.wallet,entry.allowance,JSON.stringify(entry.proof));});
        if(values.length)await client.query(`INSERT INTO whitelist_entries(chain_id,contract_address,phase_id,wallet,allowance,proof) VALUES ${values.join(',')}`,params);
      }
      await client.query('COMMIT');
      return {ok:true,phaseId,entries:normalized.length,merkleRoot:root,mintPhases:phases.address};
    } catch(error){await client.query('ROLLBACK');return reply.code(400).send({error:error.message});}
    finally{client.release();}
  });

}
