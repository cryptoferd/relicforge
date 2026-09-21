import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { getAddress, verifyMessage } from 'ethers';
import { one, db } from './db.js';

const secretText = process.env.SESSION_SECRET || '';
if (secretText.length < 24) throw new Error('SESSION_SECRET must be at least 24 characters.');
const secret = new TextEncoder().encode(secretText);
const issuer = 'relicforge-cloud';

const founderWallets = new Set(
  String(process.env.FOUNDER_WALLETS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => normalizeWallet(value))
);

export function isFounderWallet(wallet) {
  try { return founderWallets.has(normalizeWallet(wallet)); } catch { return false; }
}

export function normalizeWallet(value) {
  return getAddress(String(value || '')).toLowerCase();
}

export async function createChallenge(walletInput) {
  const wallet = normalizeWallet(walletInput);
  const nonce = crypto.randomBytes(18).toString('hex');
  const issued = new Date();
  const expires = new Date(issued.getTime() + 10 * 60_000);
  const domain = process.env.AUTH_DOMAIN || 'RelicForge';
  const uri = process.env.AUTH_URI || 'https://relicforge.xyz';
  const message = `${domain} Cloud Sign-In\\n\\nSign this message to access your private RelicForge projects. This does not submit a transaction or cost gas.\\n\\nWallet: ${getAddress(wallet)}\\nURI: ${uri}\\nNonce: ${nonce}\\nIssued At: ${issued.toISOString()}\\nExpiration Time: ${expires.toISOString()}`;

  // Keep multiple active challenges for the same wallet. A wallet-primary-keyed
  // nonce row allows one tab/page to invalidate another tab/page's challenge.
  await db.query('DELETE FROM auth_challenges_v2 WHERE expires_at < now()');
  await db.query(
    `INSERT INTO auth_challenges_v2(wallet, nonce, message, expires_at)
     VALUES($1,$2,$3,$4)`,
    [wallet, nonce, message, expires]
  );

  // Bound storage and verification work if a client repeatedly asks for challenges
  // without completing sign-in.
  await db.query(
    `DELETE FROM auth_challenges_v2
     WHERE wallet=$1
       AND nonce NOT IN (
         SELECT nonce
         FROM auth_challenges_v2
         WHERE wallet=$1 AND expires_at >= now()
         ORDER BY created_at DESC
         LIMIT 8
       )`,
    [wallet]
  );

  return { wallet: getAddress(wallet), nonce, message, expiresAt: expires.toISOString() };
}

export async function verifyChallenge(walletInput, signature) {
  const wallet = normalizeWallet(walletInput);
  await db.query('DELETE FROM auth_challenges_v2 WHERE expires_at < now()');

  const { rows } = await db.query(
    `SELECT nonce,message,expires_at
     FROM auth_challenges_v2
     WHERE wallet=$1 AND expires_at >= now()
     ORDER BY created_at DESC
     LIMIT 8`,
    [wallet]
  );

  if (!rows.length) throw new Error('No active sign-in challenge.');

  let matched = null;
  for (const row of rows) {
    try {
      const recovered = normalizeWallet(verifyMessage(row.message, signature));
      if (recovered === wallet) {
        matched = row;
        break;
      }
    } catch {}
  }

  if (!matched) throw new Error('Signature does not match the requested wallet.');

  // Consume only the challenge that produced this signature. Other tabs keep
  // their own independent active challenges.
  await db.query(
    'DELETE FROM auth_challenges_v2 WHERE wallet=$1 AND nonce=$2',
    [wallet, matched.nonce]
  );

  const token = await new SignJWT({ wallet })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setSubject(wallet)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret);
  return { token, wallet: getAddress(wallet), expiresIn: 43_200, isFounder: isFounderWallet(wallet) };
}

export async function authenticate(request, reply) {
  const header = String(request.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return reply.code(401).send({ error: 'Authentication required.' });
  try {
    const { payload } = await jwtVerify(header.slice(7), secret, { issuer });
    const wallet = normalizeWallet(payload.wallet || payload.sub);
    request.user = { wallet, isFounder: isFounderWallet(wallet) };
  } catch {
    return reply.code(401).send({ error: 'Session expired or invalid.' });
  }
}

export async function authenticateFounder(request, reply) {
  await authenticate(request, reply);
  if (reply.sent) return;
  if (!request.user?.isFounder) return reply.code(403).send({ error: 'Founder access required.' });
}