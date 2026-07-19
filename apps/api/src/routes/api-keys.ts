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

  // POST /api/api-keys/:id/rotate — issue a fresh key with the same name +
  // scopes and grace-expire the old one. The old key keeps working for a short
  // grace window so a running script can pick up the new key without downtime;
  // the new plaintext is returned once. Use DELETE for an immediate kill.
  app.post('/api/api-keys/:id/rotate', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const GRACE_MS = 60 * 60 * 1000;   // old key stays valid for 1 hour
    const FRESH_MS = 90 * 24 * 60 * 60 * 1000;
    const now = new Date();

    const out = await withTenant(req.auth.tenant_id, async (tx) => {
      const [old] = await tx
        .select({ name: apiKeys.name, scopes: apiKeys.scopes, expiresAt: apiKeys.expiresAt })
        .from(apiKeys)
        .where(and(
          eq(apiKeys.id, id),
          eq(apiKeys.workspaceId, req.auth!.tenant_id),
          isNull(apiKeys.revokedAt),
        ))
        .limit(1);
      if (!old) return null;

      const { plaintext, hash, prefix } = generateApiKey();
      // Fresh lifetime that mirrors the old key's expiry *policy* (a keyed key
      // gets a fresh 90 days; a never-expiring key stays never-expiring).
      const newExpiresAt = old.expiresAt === null ? null : new Date(now.getTime() + FRESH_MS);

      const [created] = await tx
        .insert(apiKeys)
        .values({
          workspaceId: req.auth!.tenant_id,
          createdBy:   req.auth!.sub,
          name:        old.name,
          keyHash:     hash,
          keyPrefix:   prefix,
          scopes:      old.scopes,
          expiresAt:   newExpiresAt ?? undefined,
        })
        .returning({
          id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.keyPrefix,
          scopes: apiKeys.scopes, expiresAt: apiKeys.expiresAt, createdAt: apiKeys.createdAt,
        });

      // Grace-expire the old key (never extend it — keep an already-sooner expiry).
      const graceUntil = old.expiresAt && old.expiresAt.getTime() < now.getTime() + GRACE_MS
        ? old.expiresAt
        : new Date(now.getTime() + GRACE_MS);
      await tx.update(apiKeys).set({ expiresAt: graceUntil }).where(eq(apiKeys.id, id));

      return { key: created, plaintext, grace_until: graceUntil.toISOString() };
    });

    if (!out) return reply.code(404).send({ error: 'key_not_found' });
    return reply.code(201).send(out);
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
