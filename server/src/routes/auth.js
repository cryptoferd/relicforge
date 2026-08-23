import { createChallenge, verifyChallenge } from '../lib/auth.js';

export default async function authRoutes(app) {
  app.post('/api/auth/challenge', async (request, reply) => {
    try {
      const result = await createChallenge(request.body?.wallet);
      return result;
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  app.post('/api/auth/verify', async (request, reply) => {
    try {
      const result = await verifyChallenge(request.body?.wallet, request.body?.signature);
      return result;
    } catch (error) {
      return reply.code(401).send({ error: error.message });
    }
  });
}
