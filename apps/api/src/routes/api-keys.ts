/**
 * API key management routes.
 *
 * GET    /api/api-keys         — list keys (never returns hash or plaintext)
 * POST   /api/api-keys         — create key, returns plaintext ONCE
 * DELETE /api/api-keys/:id     — soft-revoke key
 */

import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { withTenant } from '../db/with-tenant.js';
import { apiKeys } from '../db/schema.js';
import { generateApiKey, validateScopes } from '../lib/api-keys.js';

export const apiKeysRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/api-keys — list all non-revoked keys for the workspace
  app.get('/api/api-keys', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({
          id:          apiKeys.id,
          name:        apiKeys.name,
          prefix:      apiKeys.keyPrefix,
          scopes:      apiKeys.scopes,
          lastUsedAt:  apiKeys.lastUsedAt,
          expiresAt:   apiKeys.expiresAt,
          createdAt:   apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(and(
          eq(apiKeys.workspaceId, req.auth!.tenant_id),
          isNull(apiKeys.revokedAt),
        ))
        .orderBy(apiKeys.createdAt),
    );

    return rows;
  });

  // POST /api/api-keys — create a new API key
  app.post('/api/api-keys', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const body = (req.body ?? {}) as {
      name?: string;
      scopes?: string[];
      expiresAt?: string;
    };

    if (!body.name || body.name.trim().length === 0) {
      return reply.code(400).send({ error: 'name is required' });
    }

    const { plaintext, hash, prefix } = generateApiKey();
    const scopes = validateScopes(body.scopes);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

    const [created] = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .insert(apiKeys)
        .values({
          workspaceId: req.auth!.tenant_id,
          createdBy:   req.auth!.sub,
          name:        body.name!.trim(),
          keyHash:     hash,
          keyPrefix:   prefix,
          scopes,
          expiresAt:   expiresAt ?? undefined,
        })
        .returning({
          id:         apiKeys.id,
          name:       apiKeys.name,
          prefix:     apiKeys.keyPrefix,
          scopes:     apiKeys.scopes,
          expiresAt:  apiKeys.expiresAt,
          createdAt:  apiKeys.createdAt,
        }),
    );

    return reply.code(201).send({ key: created, plaintext });
  });

  // DELETE /api/api-keys/:id — soft-revoke
  app.delete('/api/api-keys/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const [revoked] = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(apiKeys.id, id),
          eq(apiKeys.workspaceId, req.auth!.tenant_id),
          isNull(apiKeys.revokedAt),
        ))
        .returning({ id: apiKeys.id }),
    );

    if (!revoked) {
      return reply.code(404).send({ error: 'key_not_found' });
    }

    return { ok: true };
  });
};
