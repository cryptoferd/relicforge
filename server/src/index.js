import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import assetRoutes from './routes/assets.js';
import collectionRoutes from './routes/collections.js';
import publicRoutes from './routes/public.js';
import founderRoutes from './routes/founder.js';
import rc47bRoutes from './routes/rc47b.js';
import reliquaryRoutes from './routes/reliquary.js';
import { db } from './lib/db.js';
import { ALCHEMY_EVM_NETWORKS } from './lib/alchemy-networks.js';

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 25 * 1024 * 1024 });

// Project/mint-page artwork is uploaded through this authenticated API instead
// of directly from the browser to the Railway Bucket. This removes Bucket CORS
// from the Studio save path.
app.addContentTypeParser(
  'application/vnd.relicforge.asset',
  { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 },
  (_request, body, done) => done(null, body)
);

const origins = String(process.env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);

function originAllowed(origin) {
  if (!origin || !origins.length) return true;
  if (origins.includes(origin)) return true;

  let candidate;
  try { candidate = new URL(origin); }
  catch { return false; }

  for (const pattern of origins) {
    if (!pattern.includes('*')) continue;

    const stars = (pattern.match(/\*/g) || []).length;
    if (stars !== 1 || !pattern.startsWith('https://')) continue;

    const rawHostPattern = pattern.slice('https://'.length);
    if (!rawHostPattern || rawHostPattern.includes('/') || rawHostPattern.includes('?') || rawHostPattern.includes('#')) continue;
    if (candidate.protocol !== 'https:' || candidate.pathname !== '/' || candidate.search || candidate.hash) continue;

    const pieces = rawHostPattern.split('*');
    if (pieces.length !== 2) continue;

    const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hostRegex = new RegExp(
      '^' + escapeRegex(pieces[0]) + '[a-z0-9-]+' + escapeRegex(pieces[1]) + '$',
      'i'
    );

    if (hostRegex.test(candidate.host)) return true;
  }
  return false;
}

if (String(process.env.NODE_ENV || '').toLowerCase() === 'production' && !origins.length) {
  throw new Error('CORS_ORIGINS is required in production.');
}
await app.register(cors, {
  origin(origin, cb) {
    if (originAllowed(origin)) return cb(null, true);
    cb(new Error('Origin not allowed.'), false);
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['content-type','authorization']
});
await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });

app.get('/health', async () => {
  await db.query('SELECT 1');
  return { ok: true, service: 'relicforge-cloud-api', version: 'rc4.7b', alchemy: { configured: Boolean(process.env.ALCHEMY_API_KEY), catalogedEvmNetworks: ALCHEMY_EVM_NETWORKS.length } };
});
await app.register(authRoutes);
await app.register(projectRoutes);
await app.register(assetRoutes);
await app.register(founderRoutes);
await app.register(collectionRoutes);
await app.register(publicRoutes);
await app.register(rc47bRoutes);
await app.register(reliquaryRoutes);

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.code(status).send({ error: status >= 500 ? 'Server error.' : error.message });
});

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: '0.0.0.0' });
