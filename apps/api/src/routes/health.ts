import type { FastifyInstance } from 'fastify';
import { pingDb } from '../db/index.js';
import { pingRedis } from '../plugins/redis.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const [dbOk, redisOk] = await Promise.all([pingDb(), pingRedis()]);
    const ok = dbOk && redisOk;
    reply.code(ok ? 200 : 503).send({
      status: ok ? 'healthy' : 'degraded',
      services: { database: dbOk, redis: redisOk },
      timestamp: new Date().toISOString(),
    });
  });
}
