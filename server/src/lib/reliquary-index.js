import { Contract, Interface, ZeroAddress, getAddress, id } from 'ethers';
import { db, one } from './db.js';
import { collectionFor, providerFor } from './rpc.js';

const TRANSFER_TOPIC = id('Transfer(address,address,uint256)');
const PLATFORM_FEE_TOPIC = id('PlatformFeeAccrued(address,uint32,uint256)');
const ZERO = ZeroAddress.toLowerCase();
const MINT_IFACE = new Interface([
  'function mint(uint32 phaseId,uint32 quantity,uint32 allowance,bytes32[] proof)',
  'event PlatformFeeAccrued(address indexed payer,uint32 quantity,uint256 amount)',
]);
const FACTORY_ABI = ['function isRelicForgeCollection(address) view returns (bool)'];
const CANONICAL_CACHE = new Map();
const TOKEN_CACHE = new Map();
const TOKEN_CACHE_MS = 10 * 60_000;
const CANONICAL_CACHE_MS = 60 * 60_000;
const MAX_COLLECTIONS_PER_REFRESH = 250;
const START_PADDING_MS = 30 * 24 * 60 * 60_000;
const LOG_CHUNK = 250_000;

function norm(value) {
  return getAddress(String(value || '')).toLowerCase();
}

function topicAddress(value) {
  return `0x${norm(value).slice(2).padStart(64, '0')}`;
}

function addressFromTopic(value) {
  return norm(`0x${String(value || '').slice(-40)}`);
}

function logIndex(log) {
  return Number(log.index ?? log.logIndex ?? 0);
}

function tokenIdFromLog(log) {
  return BigInt(log.topics?.[3] || 0).toString();
}

function isoFromBlock(block) {
  return block?.timestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return out;
}

async function canonicalV1(chainId, contractAddress) {
  const chain = Number(chainId);
  const contract = norm(contractAddress);
  const key = `${chain}:${contract}`;
  const cached = CANONICAL_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value = false;
  try {
    const collection = collectionFor(chain, contract);
    const factoryAddress = norm(await collection.factory());
    const factory = new Contract(factoryAddress, FACTORY_ABI, providerFor(chain));
    value = Boolean(await factory.isRelicForgeCollection(contract));
  } catch {
    value = false;
  }
  CANONICAL_CACHE.set(key, { value, expiresAt: Date.now() + CANONICAL_CACHE_MS });
  return value;
}

async function blockAtOrBefore(provider, targetMs, latestBlock = null) {
  const latest = latestBlock ?? await provider.getBlockNumber();
  const latestData = await provider.getBlock(latest);
  if (!latestData || Number(latestData.timestamp) * 1000 <= targetMs) return latest;

  let low = 0;
  let high = latest;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const block = await provider.getBlock(mid);
    if (!block) {
      high = mid - 1;
      continue;
    }
    const ms = Number(block.timestamp) * 1000;
    if (ms <= targetMs) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

async function getLogsAdaptive(provider, filter, fromBlock, toBlock) {
  if (fromBlock > toBlock) return [];
  const results = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK) {
    const end = Math.min(toBlock, start + LOG_CHUNK - 1);
    try {
      results.push(...await provider.getLogs({ ...filter, fromBlock: start, toBlock: end }));
    } catch (error) {
      const span = end - start;
      if (span <= 2_000) throw error;
      const middle = Math.floor((start + end) / 2);
      results.push(...await getLogsAdaptive(provider, filter, start, middle));
      results.push(...await getLogsAdaptive(provider, filter, middle + 1, end));
    }
  }
  return results;
}

async function knownCollections() {
  const { rows } = await db.query(
    `SELECT chain_id,contract_address,owner_wallet,created_at
     FROM collections
     ORDER BY created_at ASC
     LIMIT $1`,
    [MAX_COLLECTIONS_PER_REFRESH]
  );
  return rows;
}

async function feeModeFor(chainId, contractAddress) {
  try {
    return Number(await collectionFor(chainId, contractAddress).platformFeeMode());
  } catch {
    return 0;
  }
}

async function scanCollection(wallet, row, initialBlock) {
  const chainId = Number(row.chain_id);
  const contract = norm(row.contract_address);
  if (!await canonicalV1(chainId, contract)) return { canonical: false, chainId, contract, scanned: false };

  const provider = providerFor(chainId);
  const latest = await provider.getBlockNumber();
  const state = await one(
    `SELECT first_scan_block,last_scanned_block
     FROM reliquary_scan_state
     WHERE wallet=$1 AND chain_id=$2 AND contract_address=$3`,
    [wallet, chainId, contract]
  );
  const first = state ? Number(state.first_scan_block) : Number(initialBlock);
  const overlapStart = state ? Math.max(first, Number(state.last_scanned_block) - 12) : first;
  if (overlapStart > latest) return { canonical: true, chainId, contract, scanned: false };

  const walletTopic = topicAddress(wallet);
  const [incoming, outgoing, feeLogs] = await Promise.all([
    getLogsAdaptive(provider, { address: contract, topics: [TRANSFER_TOPIC, null, walletTopic] }, overlapStart, latest),
    getLogsAdaptive(provider, { address: contract, topics: [TRANSFER_TOPIC, walletTopic] }, overlapStart, latest),
    getLogsAdaptive(provider, { address: contract, topics: [PLATFORM_FEE_TOPIC, walletTopic] }, overlapStart, latest).catch(() => []),
  ]);

  const transferMap = new Map();
  for (const log of [...incoming, ...outgoing]) {
    const key = `${log.transactionHash}:${logIndex(log)}`;
    const from = addressFromTopic(log.topics[1]);
    const to = addressFromTopic(log.topics[2]);
    let direction = 'out';
    if (to === wallet) direction = from === ZERO ? 'mint' : 'in';
    transferMap.set(key, {
      log,
      from,
      to,
      direction,
      tokenId: tokenIdFromLog(log),
    });
  }
  const transfers = [...transferMap.values()];

  const blockNumbers = [...new Set(transfers.map(item => Number(item.log.blockNumber)))];
  const blockRows = await mapLimit(blockNumbers, 6, async number => [number, await provider.getBlock(number)]);
  const blockTimes = new Map(blockRows.map(([number, block]) => [number, isoFromBlock(block)]));

  const feeByTx = new Map();
  for (const log of feeLogs) {
    try {
      const decoded = MINT_IFACE.decodeEventLog('PlatformFeeAccrued', log.data, log.topics);
      feeByTx.set(String(log.transactionHash).toLowerCase(), BigInt(decoded.amount).toString());
    } catch {}
  }

  const mintTransfers = transfers.filter(item => item.direction === 'mint');
  const mintsByTx = new Map();
  for (const item of mintTransfers) {
    const key = String(item.log.transactionHash).toLowerCase();
    const group = mintsByTx.get(key) || [];
    group.push(item);
    mintsByTx.set(key, group);
  }
  const feeMode = await feeModeFor(chainId, contract);
  const mintEntries = await mapLimit([...mintsByTx.entries()], 4, async ([txHash, items]) => {
    const tx = await provider.getTransaction(txHash);
    let phaseId = null;
    try {
      const parsed = tx?.data ? MINT_IFACE.parseTransaction({ data: tx.data, value: tx.value }) : null;
      if (parsed?.name === 'mint') phaseId = Number(parsed.args[0]);
    } catch {}
    const firstItem = items[0];
    return {
      txHash,
      blockNumber: Number(firstItem.log.blockNumber),
      blockTime: blockTimes.get(Number(firstItem.log.blockNumber)) || null,
      phaseId,
      quantity: items.length,
      nativeValueWei: BigInt(tx?.value || 0n).toString(),
      platformFeeWei: feeByTx.get(txHash) || '0',
      feeMode,
    };
  });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM reliquary_transfer_activity
       WHERE wallet=$1 AND chain_id=$2 AND contract_address=$3 AND block_number >= $4`,
      [wallet, chainId, contract, overlapStart]
    );
    await client.query(
      `DELETE FROM reliquary_mint_activity
       WHERE wallet=$1 AND chain_id=$2 AND contract_address=$3 AND block_number >= $4`,
      [wallet, chainId, contract, overlapStart]
    );

    for (const item of transfers) {
      await client.query(
        `INSERT INTO reliquary_transfer_activity
          (chain_id,contract_address,wallet,tx_hash,log_index,block_number,block_time,token_id,from_wallet,to_wallet,direction)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING`,
        [
          chainId, contract, wallet, String(item.log.transactionHash).toLowerCase(), logIndex(item.log),
          Number(item.log.blockNumber), blockTimes.get(Number(item.log.blockNumber)) || null,
          item.tokenId, item.from, item.to, item.direction,
        ]
      );
    }

    for (const mint of mintEntries) {
      await client.query(
        `INSERT INTO reliquary_mint_activity
          (chain_id,contract_address,wallet,tx_hash,block_number,block_time,phase_id,quantity,native_value_wei,platform_fee_wei,fee_mode)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(chain_id,contract_address,wallet,tx_hash) DO UPDATE SET
           block_number=EXCLUDED.block_number,
           block_time=EXCLUDED.block_time,
           phase_id=EXCLUDED.phase_id,
           quantity=EXCLUDED.quantity,
           native_value_wei=EXCLUDED.native_value_wei,
           platform_fee_wei=EXCLUDED.platform_fee_wei,
           fee_mode=EXCLUDED.fee_mode`,
        [
          chainId, contract, wallet, mint.txHash, mint.blockNumber, mint.blockTime, mint.phaseId,
          mint.quantity, mint.nativeValueWei, mint.platformFeeWei, mint.feeMode,
        ]
      );
    }

    await client.query(
      `INSERT INTO reliquary_scan_state(wallet,chain_id,contract_address,first_scan_block,last_scanned_block)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(wallet,chain_id,contract_address) DO UPDATE SET
         last_scanned_block=EXCLUDED.last_scanned_block,
         updated_at=now()`,
      [wallet, chainId, contract, first, latest]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { canonical: true, chainId, contract, scanned: true, transfers: transfers.length, mints: mintEntries.length };
}

async function creatorStats(wallet, networkKind = 'production') {
  const { rows } = await db.query(
    `SELECT c.chain_id,c.contract_address
     FROM collections c
     JOIN rf26_networks n ON n.chain_id=c.chain_id
     WHERE c.owner_wallet=$1 AND n.kind=$2
     ORDER BY c.created_at ASC
     LIMIT 250`,
    [wallet, networkKind]
  );

  const totals = await mapLimit(rows, 6, async row => {
    const chainId = Number(row.chain_id);
    const contract = norm(row.contract_address);
    if (!await canonicalV1(chainId, contract)) return null;
    try {
      return {
        chainId,
        contract,
        totalMinted: Number(await collectionFor(chainId, contract).totalMinted()),
      };
    } catch {
      return { chainId, contract, totalMinted: 0 };
    }
  });
  const valid = totals.filter(Boolean);
  return {
    collectionsCreated: valid.length,
    creatorCollectionMints: valid.reduce((sum, item) => sum + Number(item.totalMinted || 0), 0),
    chains: [...new Set(valid.map(item => item.chainId))],
  };
}

async function statsFromLedger(wallet, coverage = null, networkKind = 'production') {
  const mint = await one(
    `SELECT
       COALESCE(sum(a.quantity),0)::text AS total_mints,
       count(*)::int AS mint_transactions,
       count(DISTINCT (a.chain_id,a.contract_address))::int AS collections_minted,
       count(DISTINCT a.chain_id)::int AS mint_chains,
       COALESCE(sum(a.native_value_wei),0)::text AS native_value_spent_wei,
       COALESCE(sum(a.platform_fee_wei),0)::text AS platform_fees_generated_wei,
       COALESCE(sum(a.quantity) FILTER (WHERE a.fee_mode=1),0)::text AS sponsored_mints,
       COALESCE(sum(a.quantity) FILTER (WHERE a.fee_mode=2),0)::text AS minter_supported_mints,
       min(a.block_time) AS first_mint_at
     FROM reliquary_mint_activity a
     JOIN rf26_networks n ON n.chain_id=a.chain_id
     WHERE a.wallet=$1 AND n.kind=$2`,
    [wallet, networkKind]
  );

  const holding = await one(
    `WITH latest AS (
       SELECT DISTINCT ON (a.chain_id,a.contract_address,a.token_id)
         a.chain_id,a.contract_address,a.token_id,a.to_wallet,a.block_time
       FROM reliquary_transfer_activity a
       JOIN rf26_networks n ON n.chain_id=a.chain_id
       WHERE a.wallet=$1 AND n.kind=$2
       ORDER BY a.chain_id,a.contract_address,a.token_id,a.block_number DESC,a.log_index DESC
     )
     SELECT
       count(*) FILTER (WHERE to_wallet=$1)::int AS nfts_held,
       count(DISTINCT chain_id) FILTER (WHERE to_wallet=$1)::int AS holding_chains,
       COALESCE(max(EXTRACT(EPOCH FROM (now()-block_time))/86400) FILTER (WHERE to_wallet=$1 AND block_time IS NOT NULL),0) AS longest_hold_days,
       COALESCE(avg(EXTRACT(EPOCH FROM (now()-block_time))/86400) FILTER (WHERE to_wallet=$1 AND block_time IS NOT NULL),0) AS average_hold_days
     FROM latest`,
    [wallet, networkKind]
  );

  const creator = await creatorStats(wallet, networkKind);
  const mintChains = Number(mint?.mint_chains || 0);
  const holdingChains = Number(holding?.holding_chains || 0);
  const chainRows = await db.query(
    `SELECT DISTINCT q.chain_id FROM (
       SELECT a.chain_id
       FROM reliquary_mint_activity a
       JOIN rf26_networks n ON n.chain_id=a.chain_id
       WHERE a.wallet=$1 AND n.kind=$2
       UNION
       SELECT a.chain_id
       FROM reliquary_transfer_activity a
       JOIN rf26_networks n ON n.chain_id=a.chain_id
       WHERE a.wallet=$1 AND n.kind=$2
     ) q`,
    [wallet, networkKind]
  );
  const chainSet = new Set(chainRows.rows.map(row => Number(row.chain_id)));
  creator.chains.forEach(chain => chainSet.add(Number(chain)));

  return {
    schema: 'reliquary-stats@2',
    networkKind,
    totalMints: Number(mint?.total_mints || 0),
    mintTransactions: Number(mint?.mint_transactions || 0),
    collectionsMinted: Number(mint?.collections_minted || 0),
    nftsHeld: Number(holding?.nfts_held || 0),
    chainsUsed: chainSet.size || Math.max(mintChains, holdingChains),
    nativeValueSpentWei: String(mint?.native_value_spent_wei || '0'),
    platformFeesGeneratedWei: String(mint?.platform_fees_generated_wei || '0'),
    sponsoredMints: Number(mint?.sponsored_mints || 0),
    minterSupportedMints: Number(mint?.minter_supported_mints || 0),
    firstMintAt: mint?.first_mint_at || null,
    collectionsCreated: creator.collectionsCreated,
    creatorCollectionMints: creator.creatorCollectionMints,
    longestCurrentHoldDays: Math.floor(Number(holding?.longest_hold_days || 0)),
    averageCurrentHoldDays: Math.floor(Number(holding?.average_hold_days || 0)),
    coverage: coverage || null,
  };
}

export async function ensureReliquaryProfile(walletInput) {
  const wallet = norm(walletInput);
  return one(
    `INSERT INTO reliquary_profiles(wallet)
     VALUES($1)
     ON CONFLICT(wallet) DO UPDATE SET wallet=EXCLUDED.wallet
     RETURNING *`,
    [wallet]
  );
}

function scopedCoverage(rows, results, networkPolicies, kind) {
  const scopedRows = rows.filter(row => networkPolicies.get(Number(row.chain_id))?.kind === kind);
  const scopedResults = results.filter(item => networkPolicies.get(Number(item.chainId))?.kind === kind);
  return {
    model: 'canonical-v1-registered-collections',
    networkKind: kind,
    registeredCollections: scopedRows.length,
    canonicalCollections: scopedResults.filter(item => item.canonical).length,
    successfullyScanned: scopedResults.filter(item => item.scanned).length,
    chains: [...new Set(scopedResults.filter(item => item.canonical).map(item => item.chainId))],
    partialFailures: scopedResults.filter(item => item.error || item.rpcUnavailable).length,
  };
}

export async function refreshReliquary(walletInput) {
  const wallet = norm(walletInput);
  await ensureReliquaryProfile(wallet);
  const rows = await knownCollections();

  const byChain = new Map();
  for (const row of rows) {
    const chain = Number(row.chain_id);
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain).push(row);
  }

  const initialByChain = new Map();
  for (const [chainId, chainRows] of byChain.entries()) {
    try {
      const provider = providerFor(chainId);
      const latest = await provider.getBlockNumber();
      const earliest = Math.min(...chainRows.map(row => new Date(row.created_at || Date.now()).getTime()).filter(Number.isFinite));
      const target = (Number.isFinite(earliest) ? earliest : Date.now()) - START_PADDING_MS;
      initialByChain.set(chainId, await blockAtOrBefore(provider, target, latest));
    } catch {
      initialByChain.set(chainId, null);
    }
  }

  const results = [];
  for (const row of rows) {
    const initial = initialByChain.get(Number(row.chain_id));
    if (initial == null) {
      results.push({ canonical: false, chainId: Number(row.chain_id), contract: String(row.contract_address), scanned: false, rpcUnavailable: true });
      continue;
    }
    try {
      results.push(await scanCollection(wallet, row, initial));
    } catch (error) {
      results.push({
        canonical: true,
        chainId: Number(row.chain_id),
        contract: String(row.contract_address),
        scanned: false,
        error: error.shortMessage || error.message,
      });
    }
  }

  const policyRows = await db.query('SELECT chain_id,label,kind FROM rf26_networks');
  const networkPolicies = new Map(policyRows.rows.map(row => [Number(row.chain_id), {
    label: String(row.label || `Chain ${row.chain_id}`),
    kind: row.kind === 'testnet' ? 'testnet' : 'production',
  }]));
  const coverage = scopedCoverage(rows, results, networkPolicies, 'production');
  const testnetCoverage = scopedCoverage(rows, results, networkPolicies, 'testnet');
  const productionStats = await statsFromLedger(wallet, coverage, 'production');
  const testnetStats = await statsFromLedger(wallet, testnetCoverage, 'testnet');
  const stats = { ...productionStats, testnet: testnetStats };

  await db.query(
    `UPDATE reliquary_profiles
     SET stats_cache=$2::jsonb,stats_refreshed_at=now(),updated_at=now()
     WHERE wallet=$1`,
    [wallet, JSON.stringify(stats)]
  );
  return { stats, coverage, testnetCoverage, scans: results };
}

export async function scopedCachedStats(walletInput, existing = null) {
  const wallet = norm(walletInput);
  const cached = existing && typeof existing === 'object' ? existing : null;
  if (cached?.schema === 'reliquary-stats@2' && cached?.testnet?.schema === 'reliquary-stats@2') return cached;

  const productionStats = await statsFromLedger(wallet, null, 'production');
  const testnetStats = await statsFromLedger(wallet, null, 'testnet');
  const stats = { ...productionStats, testnet: testnetStats };
  await db.query(
    `UPDATE reliquary_profiles SET stats_cache=$2::jsonb,updated_at=now() WHERE wallet=$1`,
    [wallet, JSON.stringify(stats)]
  );
  return stats;
}

function safeMedia(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^data:image\//i.test(text)) return text;
  if (/^https:\/\//i.test(text)) return text;
  if (/^ipfs:\/\//i.test(text)) return `https://ipfs.io/ipfs/${text.slice('ipfs://'.length)}`;
  return null;
}

function decodeTokenJson(tokenUri) {
  const uri = String(tokenUri || '');
  try {
    if (/^data:application\/json;base64,/i.test(uri)) {
      return JSON.parse(Buffer.from(uri.split(',')[1] || '', 'base64').toString('utf8'));
    }
    if (/^data:application\/json(?:;charset=[^,]+)?(?:;utf8)?,/i.test(uri)) {
      return JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)));
    }
  } catch {}
  return null;
}

export async function tokenMetadata(chainIdInput, contractInput, tokenIdInput) {
  const chainId = Number(chainIdInput);
  const contract = norm(contractInput);
  const tokenId = BigInt(String(tokenIdInput)).toString();
  const key = `${chainId}:${contract}:${tokenId}`;
  const cached = TOKEN_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const registered = await one(
    'SELECT 1 FROM collections WHERE chain_id=$1 AND contract_address=$2',
    [chainId, contract]
  );
  if (!registered || !await canonicalV1(chainId, contract)) throw Object.assign(new Error('NFT is not from a canonical Relic Forge collection.'), { statusCode: 404 });

  const collection = collectionFor(chainId, contract);
  const [collectionName, tokenUri] = await Promise.all([
    collection.name().catch(() => 'Relic Forge Collection'),
    collection.tokenURI(tokenId),
  ]);
  const decoded = decodeTokenJson(tokenUri);
  const value = {
    chainId,
    contract,
    tokenId,
    collectionName: String(collectionName || 'Relic Forge Collection'),
    name: String(decoded?.name || `${collectionName || 'Relic'} #${tokenId}`),
    image: safeMedia(decoded?.image),
    tokenURI: String(tokenUri || ''),
  };
  TOKEN_CACHE.set(key, { value, expiresAt: Date.now() + TOKEN_CACHE_MS });
  return value;
}

export async function walletOwnsCanonicalToken(walletInput, chainIdInput, contractInput, tokenIdInput) {
  const wallet = norm(walletInput);
  const chainId = Number(chainIdInput);
  const contract = norm(contractInput);
  const tokenId = BigInt(String(tokenIdInput)).toString();
  if (!await canonicalV1(chainId, contract)) return false;
  const registered = await one('SELECT 1 FROM collections WHERE chain_id=$1 AND contract_address=$2', [chainId, contract]);
  if (!registered) return false;
  try {
    return norm(await collectionFor(chainId, contract).ownerOf(tokenId)) === wallet;
  } catch {
    return false;
  }
}

export async function listReliquaryNfts(walletInput, { mode = 'owned', limit = 48, networkKind = 'production' } = {}) {
  const wallet = norm(walletInput);
  const take = Math.min(100, Math.max(1, Number(limit || 48)));
  const kind = networkKind === 'testnet' ? 'testnet' : 'production';
  let rows;

  if (mode === 'minted') {
    const result = await db.query(
      `WITH minted AS (
         SELECT chain_id,contract_address,token_id,min(block_time) AS minted_at
         FROM reliquary_transfer_activity
         WHERE wallet=$1 AND from_wallet=$2 AND to_wallet=$1
         GROUP BY chain_id,contract_address,token_id
       ),
       latest AS (
         SELECT DISTINCT ON (chain_id,contract_address,token_id)
           chain_id,contract_address,token_id,to_wallet,block_time
         FROM reliquary_transfer_activity
         WHERE wallet=$1
         ORDER BY chain_id,contract_address,token_id,block_number DESC,log_index DESC
       )
       SELECT m.chain_id,m.contract_address,m.token_id,m.minted_at,
              (l.to_wallet=$1) AS owned,l.block_time AS acquired_at,
              n.label AS network_label,n.kind AS network_kind
       FROM minted m
       LEFT JOIN latest l USING(chain_id,contract_address,token_id)
       JOIN rf26_networks n ON n.chain_id=m.chain_id
       WHERE n.kind=$4
       ORDER BY m.minted_at DESC NULLS LAST
       LIMIT $3`,
      [wallet, ZERO, take, kind]
    );
    rows = result.rows;
  } else {
    const result = await db.query(
      `WITH latest AS (
         SELECT DISTINCT ON (chain_id,contract_address,token_id)
           chain_id,contract_address,token_id,to_wallet,block_time,block_number,log_index
         FROM reliquary_transfer_activity
         WHERE wallet=$1
         ORDER BY chain_id,contract_address,token_id,block_number DESC,log_index DESC
       )
       SELECT l.chain_id,l.contract_address,l.token_id,l.block_time AS acquired_at,
              EXISTS(
                SELECT 1 FROM reliquary_transfer_activity m
                WHERE m.wallet=$1
                  AND m.chain_id=l.chain_id
                  AND m.contract_address=l.contract_address
                  AND m.token_id=l.token_id
                  AND m.from_wallet=$2
                  AND m.to_wallet=$1
              ) AS minted_by_wallet,
              true AS owned,n.label AS network_label,n.kind AS network_kind
       FROM latest l
       JOIN rf26_networks n ON n.chain_id=l.chain_id
       WHERE l.to_wallet=$1 AND n.kind=$4
       ORDER BY l.block_time DESC NULLS LAST
       LIMIT $3`,
      [wallet, ZERO, take, kind]
    );
    rows = result.rows;
  }

  return mapLimit(rows, 6, async row => {
    let metadata = null;
    try {
      metadata = await tokenMetadata(Number(row.chain_id), row.contract_address, row.token_id);
    } catch {}
    return {
      chainId: Number(row.chain_id),
      contract: norm(row.contract_address),
      tokenId: String(row.token_id),
      owned: Boolean(row.owned),
      mintedByWallet: mode === 'minted' ? true : Boolean(row.minted_by_wallet),
      mintedAt: row.minted_at || null,
      acquiredAt: row.acquired_at || null,
      metadata,
      network: {
        label: String(row.network_label || `Chain ${row.chain_id}`),
        kind: row.network_kind === 'testnet' ? 'testnet' : 'production',
        testnet: row.network_kind === 'testnet',
      },
    };
  });
}

export async function recordConfirmedMint({ chainId: chainIdInput, contract: contractInput, wallet: walletInput, transactionHash }) {
  const chainId = Number(chainIdInput);
  const contract = norm(contractInput);
  const wallet = norm(walletInput);
  const txHash = String(transactionHash || '').toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw Object.assign(new Error('Invalid mint transaction hash.'), { statusCode: 400 });

  const registered = await one('SELECT 1 FROM collections WHERE chain_id=$1 AND contract_address=$2', [chainId, contract]);
  if (!registered || !await canonicalV1(chainId, contract)) throw Object.assign(new Error('Collection is not a registered canonical Relic Forge collection.'), { statusCode: 404 });

  const provider = providerFor(chainId);
  const [receipt, tx] = await Promise.all([
    provider.getTransactionReceipt(txHash),
    provider.getTransaction(txHash),
  ]);
  if (!receipt || !tx || Number(receipt.status) !== 1) throw Object.assign(new Error('Confirmed successful transaction was not found.'), { statusCode: 400 });
  if (!tx.to || norm(tx.to) !== contract || norm(tx.from) !== wallet) throw Object.assign(new Error('Transaction does not match the reported wallet and collection.'), { statusCode: 400 });

  const mintLogs = receipt.logs.filter(log => {
    if (String(log.address).toLowerCase() !== contract) return false;
    if (String(log.topics?.[0]).toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) return false;
    if (addressFromTopic(log.topics?.[1]) !== ZERO) return false;
    return addressFromTopic(log.topics?.[2]) === wallet;
  });
  if (!mintLogs.length) throw Object.assign(new Error('Transaction did not mint an ERC-721 token to the reported wallet.'), { statusCode: 400 });

  let platformFeeWei = '0';
  for (const log of receipt.logs) {
    if (String(log.address).toLowerCase() !== contract || String(log.topics?.[0]).toLowerCase() !== PLATFORM_FEE_TOPIC.toLowerCase()) continue;
    try {
      const decoded = MINT_IFACE.decodeEventLog('PlatformFeeAccrued', log.data, log.topics);
      if (norm(decoded.payer) === wallet) platformFeeWei = BigInt(decoded.amount).toString();
    } catch {}
  }

  let phaseId = null;
  try {
    const parsed = MINT_IFACE.parseTransaction({ data: tx.data, value: tx.value });
    if (parsed?.name === 'mint') phaseId = Number(parsed.args[0]);
  } catch {}

  const block = await provider.getBlock(receipt.blockNumber);
  const blockTime = isoFromBlock(block);
  const feeMode = await feeModeFor(chainId, contract);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const log of mintLogs) {
      await client.query(
        `INSERT INTO reliquary_transfer_activity
          (chain_id,contract_address,wallet,tx_hash,log_index,block_number,block_time,token_id,from_wallet,to_wallet,direction)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'mint')
         ON CONFLICT DO NOTHING`,
        [
          chainId, contract, wallet, txHash, logIndex(log), Number(receipt.blockNumber), blockTime,
          tokenIdFromLog(log), ZERO, wallet,
        ]
      );
    }
    await client.query(
      `INSERT INTO reliquary_mint_activity
        (chain_id,contract_address,wallet,tx_hash,block_number,block_time,phase_id,quantity,native_value_wei,platform_fee_wei,fee_mode)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(chain_id,contract_address,wallet,tx_hash) DO UPDATE SET
         block_number=EXCLUDED.block_number,
         block_time=EXCLUDED.block_time,
         phase_id=EXCLUDED.phase_id,
         quantity=EXCLUDED.quantity,
         native_value_wei=EXCLUDED.native_value_wei,
         platform_fee_wei=EXCLUDED.platform_fee_wei,
         fee_mode=EXCLUDED.fee_mode`,
      [
        chainId, contract, wallet, txHash, Number(receipt.blockNumber), blockTime, phaseId,
        mintLogs.length, BigInt(tx.value || 0n).toString(), platformFeeWei, feeMode,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { ok: true, quantity: mintLogs.length, blockNumber: Number(receipt.blockNumber) };
}

export async function cachedStats(walletInput) {
  const wallet = norm(walletInput);
  const row = await ensureReliquaryProfile(wallet);
  return {
    stats: row.stats_cache || {},
    statsRefreshedAt: row.stats_refreshed_at || null,
  };
}
