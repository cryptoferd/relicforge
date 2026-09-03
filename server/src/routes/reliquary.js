import { getAddress } from 'ethers';
import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import {
  cachedStats,
  ensureReliquaryProfile,
  listReliquaryNfts,
  recordConfirmedMint,
  refreshReliquary,
  tokenMetadata,
  walletOwnsCanonicalToken,
} from '../lib/reliquary-index.js';

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;
const RESERVED = new Set([
  'admin','administrator','api','creator','dashboard','founder','help','howto','mint','official',
  'relic','relicforge','reliquary','root','staff','studio','support','system','treasury',
]);

function norm(value) {
  return getAddress(String(value || '')).toLowerCase();
}

function username(value) {
  return String(value || '').trim();
}

function cleanBio(value) {
  const bio = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (bio.length > 280) throw Object.assign(new Error('Bio is limited to 280 characters.'), { statusCode: 400 });
  return bio;
}

function validateUsername(value) {
  const candidate = username(value);
  if (!USERNAME_RE.test(candidate)) {
    throw Object.assign(new Error('Username must be 3–24 characters, start with a letter, and use only letters, numbers, or underscores.'), { statusCode: 400 });
  }
  if (RESERVED.has(candidate.toLowerCase())) {
    throw Object.assign(new Error('That username is reserved by Relic Forge.'), { statusCode: 409 });
  }
  return candidate;
}

async function usernameAvailable(candidate, wallet = null) {
  const row = await one('SELECT wallet FROM reliquary_profiles WHERE lower(username)=lower($1)', [candidate]);
  if (!row) return true;
  return wallet ? String(row.wallet).toLowerCase() === String(wallet).toLowerCase() : false;
}

async function livePfp(row) {
  if (!row?.pfp_chain_id || !row?.pfp_contract_address || row?.pfp_token_id == null) return null;
  const owns = await walletOwnsCanonicalToken(
    row.wallet,
    Number(row.pfp_chain_id),
    row.pfp_contract_address,
    row.pfp_token_id
  ).catch(() => false);
  if (!owns) return { valid: false };
  const metadata = await tokenMetadata(
    Number(row.pfp_chain_id),
    row.pfp_contract_address,
    row.pfp_token_id
  ).catch(() => null);
  return {
    valid: true,
    chainId: Number(row.pfp_chain_id),
    contract: String(row.pfp_contract_address).toLowerCase(),
    tokenId: String(row.pfp_token_id),
    metadata,
  };
}

async function profilePayload(row, { includeWallet = true } = {}) {
  if (!row) return null;
  return {
    wallet: includeWallet ? row.wallet : undefined,
    username: row.username,
    bio: row.bio || '',
    pfp: await livePfp(row),
    stats: row.stats_cache || {},
    statsRefreshedAt: row.stats_refreshed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default async function reliquaryRoutes(app) {
  app.get('/api/reliquary/username/:username/available', async (request, reply) => {
    let candidate;
    try { candidate = validateUsername(request.params.username); }
    catch (error) { return reply.code(error.statusCode || 400).send({ available: false, error: error.message }); }
    return { username: candidate, available: await usernameAvailable(candidate) };
  });

  app.get('/api/reliquary/me', { preHandler: authenticate }, async request => {
    const row = await ensureReliquaryProfile(request.user.wallet);
    return { profile: await profilePayload(row) };
  });

  app.post('/api/reliquary/me/username', { preHandler: authenticate }, async (request, reply) => {
    const wallet = norm(request.user.wallet);
    const candidate = validateUsername(request.body?.username);
    const existing = await ensureReliquaryProfile(wallet);
    if (existing.username) {
      return reply.code(409).send({ error: 'Your Reliquary username is already set and cannot be changed.' });
    }
    if (!await usernameAvailable(candidate, wallet)) {
      return reply.code(409).send({ error: 'That Reliquary username has already been claimed.' });
    }
    try {
      const row = await one(
        `UPDATE reliquary_profiles
         SET username=$2,updated_at=now()
         WHERE wallet=$1 AND username IS NULL
         RETURNING *`,
        [wallet, candidate]
      );
      if (!row) return reply.code(409).send({ error: 'Your Reliquary username is already set.' });
      return { profile: await profilePayload(row) };
    } catch (error) {
      if (error?.code === '23505') return reply.code(409).send({ error: 'That Reliquary username has already been claimed.' });
      throw error;
    }
  });

  app.patch('/api/reliquary/me', { preHandler: authenticate }, async (request, reply) => {
    const wallet = norm(request.user.wallet);
    if (Object.prototype.hasOwnProperty.call(request.body || {}, 'username')) {
      return reply.code(400).send({ error: 'Username cannot be edited here. Claim it once using the permanent username action.' });
    }
    const current = await ensureReliquaryProfile(wallet);
    const bio = Object.prototype.hasOwnProperty.call(request.body || {}, 'bio')
      ? cleanBio(request.body.bio)
      : current.bio || '';

    let pfpChain = current.pfp_chain_id;
    let pfpContract = current.pfp_contract_address;
    let pfpToken = current.pfp_token_id;

    if (Object.prototype.hasOwnProperty.call(request.body || {}, 'pfp')) {
      const pfp = request.body.pfp;
      if (pfp == null) {
        pfpChain = null;
        pfpContract = null;
        pfpToken = null;
      } else {
        const chainId = Number(pfp.chainId);
        let contract;
        let tokenId;
        try {
          contract = norm(pfp.contract);
          tokenId = BigInt(String(pfp.tokenId)).toString();
        } catch {
          return reply.code(400).send({ error: 'Invalid Reliquary PFP token reference.' });
        }
        if (!Number.isSafeInteger(chainId) || chainId <= 0 || BigInt(tokenId) < 0n) {
          return reply.code(400).send({ error: 'Invalid Reliquary PFP token reference.' });
        }
        if (!await walletOwnsCanonicalToken(wallet, chainId, contract, tokenId)) {
          return reply.code(403).send({ error: 'PFP must be a canonical Relic Forge NFT currently owned by this wallet.' });
        }
        pfpChain = chainId;
        pfpContract = contract;
        pfpToken = tokenId;
      }
    }

    const row = await one(
      `UPDATE reliquary_profiles
       SET bio=$2,pfp_chain_id=$3,pfp_contract_address=$4,pfp_token_id=$5,updated_at=now()
       WHERE wallet=$1
       RETURNING *`,
      [wallet, bio, pfpChain, pfpContract, pfpToken]
    );
    return { profile: await profilePayload(row) };
  });

  app.post('/api/reliquary/me/refresh', { preHandler: authenticate }, async (request, reply) => {
    const wallet = norm(request.user.wallet);
    const current = await ensureReliquaryProfile(wallet);
    const refreshed = current.stats_refreshed_at ? new Date(current.stats_refreshed_at).getTime() : 0;
    if (refreshed && Date.now() - refreshed < 2 * 60_000) {
      const cached = await cachedStats(wallet);
      return { ...cached, throttled: true };
    }
    const result = await refreshReliquary(wallet);
    return {
      stats: result.stats,
      coverage: result.coverage,
      statsRefreshedAt: new Date().toISOString(),
      partialFailures: result.coverage.partialFailures,
    };
  });

  app.get('/api/reliquary/me/nfts', { preHandler: authenticate }, async request => {
    const mode = request.query?.mode === 'minted' ? 'minted' : 'owned';
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 48)));
    return { mode, nfts: await listReliquaryNfts(request.user.wallet, { mode, limit }) };
  });

  app.get('/api/reliquary/u/:username', async (request, reply) => {
    const candidate = username(request.params.username);
    const row = await one('SELECT * FROM reliquary_profiles WHERE lower(username)=lower($1)', [candidate]);
    if (!row?.username) return reply.code(404).send({ error: 'Reliquary profile not found.' });
    return { profile: await profilePayload(row) };
  });

  app.get('/api/reliquary/u/:username/nfts', async (request, reply) => {
    const candidate = username(request.params.username);
    const row = await one('SELECT wallet,username FROM reliquary_profiles WHERE lower(username)=lower($1)', [candidate]);
    if (!row?.username) return reply.code(404).send({ error: 'Reliquary profile not found.' });
    const mode = request.query?.mode === 'owned' ? 'owned' : 'minted';
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 48)));
    return { mode, nfts: await listReliquaryNfts(row.wallet, { mode, limit }) };
  });

  app.get('/api/reliquary/nft/:chainId/:contract/:tokenId', async (request, reply) => {
    try {
      const metadata = await tokenMetadata(
        Number(request.params.chainId),
        request.params.contract,
        request.params.tokenId
      );
      reply.header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return { nft: metadata };
    } catch (error) {
      return reply.code(error.statusCode || 404).send({ error: error.message });
    }
  });

  app.post('/api/reliquary/mint-confirmed', async (request, reply) => {
    const { chainId, contract, wallet, transactionHash } = request.body || {};
    try {
      return await recordConfirmedMint({ chainId, contract, wallet, transactionHash });
    } catch (error) {
      return reply.code(error.statusCode || 400).send({ error: error.message });
    }
  });
}
