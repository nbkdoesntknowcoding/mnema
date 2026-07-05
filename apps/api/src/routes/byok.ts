/**
 * Phase 1 (Open-Core BYOK) — workspace LLM key settings API.
 *
 *   GET    /api/settings/byok/llm  (viewer+) — status: present, base_url, model,
 *          plan, and the free-tier meeting cap. NEVER returns the key itself.
 *   PUT    /api/settings/byok/llm  (admin)   — set/rotate { apiKey, baseUrl?, model? }.
 *   DELETE /api/settings/byok/llm  (admin)   — remove.
 *
 * Workspace-scoped via req.auth.tenant_id; admin gating on writes.
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getMeetingCapStatus } from '../lib/meeting-cap.js';
import { requireRole, RoleError } from '../lib/role.js';
import {
  deleteWorkspaceLlmCredential,
  getWorkspaceLlmCredentialMeta,
  setWorkspaceLlmCredential,
} from '../lib/workspace-credentials.js';

const putSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().nullable().optional(),
  model: z.string().min(1).nullable().optional(),
});

function roleGuard(err: unknown, reply: FastifyReply): boolean {
  if (err instanceof RoleError) {
    reply.code(err.status).send({ error: err.reason });
    return true;
  }
  return false;
}

export const byokRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/settings/byok/llm', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try { await requireRole(req, 'viewer'); } catch (e) { if (roleGuard(e, reply)) return; throw e; }
    const meta = await getWorkspaceLlmCredentialMeta(req.auth.tenant_id);
    const cap = await getMeetingCapStatus(req.auth.tenant_id);
    return { ...meta, plan: cap.plan, cap: { used: cap.used, limit: cap.limit, capped: cap.capped } };
  });

  app.put('/api/settings/byok/llm', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try { await requireRole(req, 'admin'); } catch (e) { if (roleGuard(e, reply)) return; throw e; }
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    await setWorkspaceLlmCredential(req.auth.tenant_id, {
      apiKey: parsed.data.apiKey,
      baseUrl: parsed.data.baseUrl ?? null,
      model: parsed.data.model ?? null,
    });
    return { present: true };
  });

  app.delete('/api/settings/byok/llm', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try { await requireRole(req, 'admin'); } catch (e) { if (roleGuard(e, reply)) return; throw e; }
    await deleteWorkspaceLlmCredential(req.auth.tenant_id);
    return { present: false };
  });
};
