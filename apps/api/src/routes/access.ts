import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { apiKeys, credentialUsage, mcpTokens } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';

const USAGE_TYPES = new Set(['api_key', 'mcp_token']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unified Access surface — cross-credential actions. The per-type list/create/
 * revoke routes live in api-keys.ts and mcp-tokens.ts; this adds the "kill
 * everything" action the /app/settings/access page needs when a user believes
 * they're compromised.
 */
export const accessRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/access/revoke-all — revoke every active credential that can reach
  // this workspace: REST API keys + MCP tokens. Returns how many of each were
  // revoked so the UI can confirm.
  app.post('/api/access/revoke-all', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const now = new Date();
    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const keys = await tx
        .update(apiKeys)
        .set({ revokedAt: now })
        .where(and(eq(apiKeys.workspaceId, req.auth!.tenant_id), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id });

      const tokens = await tx
        .update(mcpTokens)
        .set({ revokedAt: now })
        .where(and(eq(mcpTokens.workspaceId, req.auth!.tenant_id), isNull(mcpTokens.revokedAt)))
        .returning({ id: mcpTokens.id });

      return { api_keys: keys.length, connected_apps: tokens.length };
    });

    return reply.send({ revoked: result });
  });

  // GET /api/access/usage?type=api_key|mcp_token&id=<uuid> — the last 20 recorded
  // uses of one credential (rate-limited to ≤1/min at write time), for the Access
  // page's "recent activity" drawer. RLS scopes rows to the caller's workspace,
  // so a credential id from another workspace simply returns nothing.
  app.get('/api/access/usage', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const q = (req.query ?? {}) as { type?: string; id?: string };
    const type = q.type;
    const id = q.id;
    if (!type || !USAGE_TYPES.has(type)) {
      return reply.code(400).send({ error: 'type must be api_key or mcp_token' });
    }
    if (!id || !UUID_RE.test(id)) {
      return reply.code(400).send({ error: 'id must be a credential uuid' });
    }

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({
          ip: credentialUsage.ip,
          path: credentialUsage.path,
          at: credentialUsage.createdAt,
        })
        .from(credentialUsage)
        .where(and(
          eq(credentialUsage.workspaceId, req.auth!.tenant_id),
          eq(credentialUsage.credentialType, type),
          eq(credentialUsage.credentialId, id),
        ))
        .orderBy(desc(credentialUsage.createdAt))
        .limit(20),
    );

    return reply.send({ usage: rows });
  });
};
