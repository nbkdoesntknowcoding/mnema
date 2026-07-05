/**
 * GET /api/entitlements — the current workspace's effective tier + unlocked
 * features, for the settings "activated state" display (CL-1). Core route.
 */
import type { FastifyPluginAsync } from 'fastify';
import { resolveEntitlements } from '../lib/entitlements.js';

export const entitlementsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/entitlements', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const ent = await resolveEntitlements(req.auth.tenant_id);
    return reply.send({
      tier: ent.tier,
      registered: ent.tier !== 'unregistered',
      features: [...ent.features].sort(),
      readOnly: ent.readOnly,
      source: ent.source,
    });
  });
};
