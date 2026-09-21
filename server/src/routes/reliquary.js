import { getAddress } from 'ethers';
import { db, one } from '../lib/db.js';
import { authenticate } from '../lib/auth.js';
import {
  cachedStats,
  ensureReliquaryProfile,
  listReliquaryNfts,
  recordConfirmedMint,
  refreshReliquary,
  scopedCachedStats,
  tokenMetadata,
  walletOwnsCanonicalToken,
} from '../lib/reliquary-index.js';

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;
const RESERVED = new Set([
  'admin','administrator','api','creator','dashboard','founder','help','howto','mint','official',
  'relic','relicforge','reliquary','root','staff','studio','support','system','treasury',
]);

const PUBLIC_REFRESH_STALE_MS = 5 * 60_000;
const RELIQUARY_REFRESHES = new Map();
const DEFAULT_PUBLIC_VISIBILITY = Object.freeze({
  showWallet: true,
  showBio: true,
  showPfp: true,
  showStats: true,
  showMintSpend: true,
  showNfts: true,
  showTestnet: false,
});

function normalizePublicVisibility(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const [key, fallback] of Object.entries(DEFAULT_PUBLIC_VISIBILITY)) {
    normalized[key] = Object.prototype.hasOwnProperty.call(source, key)
      ? Boolean(source[key])
      : fallback;
  }
  return normalized;
}

function filterPublicStats(stats, visibility) {
  if (!stats || typeof stats !== 'object') return null;
  const filtered = { ...stats };
  if (!visibility.showMintSpend) delete filtered.nativeValueSpentWei;
  if (!visibility.showTestnet) {
    delete filtered.testnet;
  } else if (filtered.testnet && typeof filtered.testnet === 'object') {
    filtered.testnet = { ...filtered.testnet };
    if (!visibility.showMintSpend) delete filtered.testnet.nativeValueSpentWei;
  }
  return filtered;
}

function publicChainDataVisible(visibility) {
  return Boolean(visibility.showStats || visibility.showNfts);
}

function refreshIsStale(row) {
  const refreshed = row?.stats_refreshed_at ? new Date(row.stats_refreshed_at).getTime() : 0;
  return !refreshed || Date.now() - refreshed >= PUBLIC_REFRESH_STALE_MS;
}

function refreshSingleFlight(walletInput) {
  const wallet = norm(walletInput);
  const active = RELIQUARY_REFRESHES.get(wallet);
  if (active) return active;

  const promise = refreshReliquary(wallet)
    .finally(() => {
      if (RELIQUARY_REFRESHES.get(wallet) === promise) RELIQUARY_REFRESHES.delete(wallet);
    });
  RELIQUARY_REFRESHES.set(wallet, promise);
  return promise;
}

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

async function profilePayload(row, { includeWallet = true, publicView = false } = {}) {
  if (!row) return null;
  const publicVisibility = normalizePublicVisibility(row.public_settings);
  const exposeWallet = includeWallet && (!publicView || publicVisibility.showWallet);
  const exposeBio = !publicView || publicVisibility.showBio;
  const exposePfp = !publicView || publicVisibility.showPfp;
  const exposeStats = !publicView || publicVisibility.showStats;

  let stats = null;
  if (exposeStats) {
    stats = await scopedCachedStats(row.wallet, row.stats_cache || {});
    if (publicView) stats = filterPublicStats(stats, publicVisibility);
  }

  return {
    wallet: exposeWallet ? row.wallet : undefined,
    username: row.username,
    bio: exposeBio ? (row.bio || '') : undefined,
    pfp: exposePfp ? await livePfp(row) : null,
    stats,
    statsRefreshedAt: row.stats_refreshed_at || null,
    publicVisibility,
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
    let publicVisibility = normalizePublicVisibility(current.public_settings);

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

    if (Object.prototype.hasOwnProperty.call(request.body || {}, 'publicVisibility')) {
      const incoming = request.body.publicVisibility;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return reply.code(400).send({ error: 'Invalid Reliquary public-visibility settings.' });
      }
      publicVisibility = normalizePublicVisibility({ ...publicVisibility, ...incoming });
    }

    const row = await one(
      `UPDATE reliquary_profiles
       SET bio=$2,pfp_chain_id=$3,pfp_contract_address=$4,pfp_token_id=$5,
           public_settings=$6::jsonb,updated_at=now()
       WHERE wallet=$1
       RETURNING *`,
      [wallet, bio, pfpChain, pfpContract, pfpToken, JSON.stringify(publicVisibility)]
    );
    return { profile: await profilePayload(row) };
  });

  app.post('/api/reliquary/me/refresh', { preHandler: authenticate }, async (request, reply) => {
    const wallet = norm(request.user.wallet);
    const current = await ensureReliquaryProfile(wallet);
    const refreshed = current.stats_refreshed_at ? new Date(current.stats_refreshed_at).getTime() : 0;
    const currentCache = current.stats_cache || {};
    const scopedCacheReady = currentCache?.schema === 'reliquary-stats@2' &&
      currentCache?.testnet?.schema === 'reliquary-stats@2';
    if (scopedCacheReady && refreshed && Date.now() - refreshed < 2 * 60_000) {
      const cached = await cachedStats(wallet);
      return { ...cached, throttled: true };
    }
    const result = await refreshSingleFlight(wallet);
    return {
      stats: result.stats,
      coverage: result.coverage,
      statsRefreshedAt: new Date().toISOString(),
      partialFailures: Number(result.coverage.partialFailures || 0) + Number(result.testnetCoverage?.partialFailures || 0),
    };
  });

  app.get('/api/reliquary/me/nfts', { preHandler: authenticate }, async request => {
    const mode = request.query?.mode === 'minted' ? 'minted' : 'owned';
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 48)));
    const networkKind = request.query?.network === 'testnet' ? 'testnet' : 'production';
    return { mode, networkKind, nfts: await listReliquaryNfts(request.user.wallet, { mode, limit, networkKind }) };
  });

  app.get('/api/reliquary/u/:username', async (request, reply) => {
    const candidate = username(request.params.username);
    const row = await one('SELECT * FROM reliquary_profiles WHERE lower(username)=lower($1)', [candidate]);
    if (!row?.username) return reply.code(404).send({ error: 'Reliquary profile not found.' });

    const visibility = normalizePublicVisibility(row.public_settings);
    const stale = publicChainDataVisible(visibility) && refreshIsStale(row);
    let refreshQueued = false;
    if (stale && String(request.query?.refresh ?? '1') !== '0') {
      refreshQueued = true;
      refreshSingleFlight(row.wallet).catch(error => {
        app.log.warn({ err: error, wallet: row.wallet }, 'Public Reliquary background refresh failed');
      });
    }

    reply.header('Cache-Control', 'no-store');
    return {
      profile: await profilePayload(row, { publicView: true }),
      refresh: {
        stale,
        refreshing: refreshQueued || RELIQUARY_REFRESHES.has(norm(row.wallet)),
        staleAfterSeconds: Math.floor(PUBLIC_REFRESH_STALE_MS / 1000),
      },
    };
  });

  app.get('/api/reliquary/u/:username/nfts', async (request, reply) => {
    const candidate = username(request.params.username);
    const row = await one(
      'SELECT wallet,username,public_settings FROM reliquary_profiles WHERE lower(username)=lower($1)',
      [candidate]
    );
    if (!row?.username) return reply.code(404).send({ error: 'Reliquary profile not found.' });

    const mode = request.query?.mode === 'owned' ? 'owned' : 'minted';
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 48)));
    const networkKind = request.query?.network === 'testnet' ? 'testnet' : 'production';
    const visibility = normalizePublicVisibility(row.public_settings);
    const hidden = !visibility.showNfts || (networkKind === 'testnet' && !visibility.showTestnet);

    reply.header('Cache-Control', 'no-store');
    if (hidden) return { mode, networkKind, hidden: true, nfts: [] };
    return {
      mode,
      networkKind,
      hidden: false,
      nfts: await listReliquaryNfts(row.wallet, { mode, limit, networkKind }),
    };
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
