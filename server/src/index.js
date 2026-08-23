import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import assetRoutes from './routes/assets.js';
import collectionRoutes from './routes/collections.js';
import publicRoutes from './routes/public.js';
import { db } from './lib/db.js';
import { ALCHEMY_EVM_NETWORKS } from './lib/alchemy-networks.js';

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 25 * 1024 * 1024 });
const origins = String(process.env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
if (String(process.env.NODE_ENV || '').toLowerCase() === 'production' && !origins.length) {
  throw new Error('CORS_ORIGINS is required in production.');
}
await app.register(cors, {
  origin(origin, cb) {
    if (!origin || !origins.length || origins.includes(origin)) return cb(null, true);
    cb(new Error('Origin not allowed.'), false);
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['content-type','authorization']
});
await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });

app.get('/health', async () => {
  await db.query('SELECT 1');
  return { ok: true, service: 'relicforge-cloud-api', version: '11.1.0', alchemy: { configured: Boolean(process.env.ALCHEMY_API_KEY), catalogedEvmNetworks: ALCHEMY_EVM_NETWORKS.length } };
});
await app.register(authRoutes);
await app.register(projectRoutes);
await app.register(assetRoutes);
await app.register(collectionRoutes);
await app.register(publicRoutes);

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.code(status).send({ error: status >= 500 ? 'Server error.' : error.message });
});

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: '0.0.0.0' });
