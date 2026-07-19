import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { SignJWT } from 'jose';
import { z } from 'zod';
import { config } from '../config/env.js';
import { mcpTokens, workspaceMembers } from '../db/schema.js';
import { withSystemPrivilege } from '../db/with-system-privilege.js';
import { withTenant } from '../db/with-tenant.js';
import { scopesForRole } from '../lib/scopes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secret = new TextEncoder().encode(config.JWT_SECRET);

const createSchema = z.object({
  name: z.string().min(1).max(100).default('Claude Desktop'),
  // Optional subset of scopes the caller wants on this token.
  // If omitted, all scopes allowed by the caller's role are granted.
  // Requested scopes are capped to what the role allows — cannot escalate.
  requested_scopes: z.array(z.string().min(1).max(64)).optional(),
});

export const mcpTokenRoutes: FastifyPluginAsync = async (app) => {
  // List active (non-revoked) tokens for this workspace.
  // Returns metadata only — the raw JWT is never stored and never returned here.
  app.get('/api/mcp-tokens', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const rows = await withTenant(req.auth.tenant_id, async (tx) => {
      return await tx
        // snake_case keys to match the POST response and the web TokenRow type.
        // Returning camelCase here made the connections page render
        // "Invalid Date · No expiry" for every token (it reads created_at /
        // expires_at / last_used_at) even though the rows carry real values.
        .select({
          id: mcpTokens.id,
          name: mcpTokens.name,
          scopes: mcpTokens.scopes,
          expires_at: mcpTokens.expiresAt,
          last_used_at: mcpTokens.lastUsedAt,
          created_at: mcpTokens.createdAt,
        })
        .from(mcpTokens)
        .where(
          and(
            eq(mcpTokens.workspaceId, req.auth!.tenant_id),
            isNull(mcpTokens.revokedAt),
          ),
        )
        .orderBy(mcpTokens.createdAt);
    });

    return { tokens: rows };
  });

  // Issue a new long-lived MCP token.
  // Returns the raw JWT exactly once — caller must copy it immediately.
  app.post('/api/mcp-tokens', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }

    const auth = req.auth;

    // Resolve the caller's workspace role to determine which scopes to grant.
    // Fall back to viewer-level scopes if the membership row is missing.
    const [membership] = await withSystemPrivilege((tx) =>
      tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.userId, auth.sub),
            eq(workspaceMembers.workspaceId, auth.tenant_id),
          ),
        )
        .limit(1),
    );
    const allowedScopes = scopesForRole(membership?.role ?? 'viewer');

    // If the caller requested specific scopes, cap them to what their role allows.
    // docs:read is always included regardless (minimum viable token).
    const scopes: string[] = parsed.data.requested_scopes
      ? [
          'docs:read',
          ...parsed.data.requested_scopes.filter(
            (s) => s !== 'docs:read' && allowedScopes.includes(s),
          ),
        ]
      : allowedScopes;

    // Insert the metadata row first so we can capture the generated jti.
    const row = await withTenant(auth.tenant_id, async (tx) => {
      const inserted = await tx
        .insert(mcpTokens)
        .values({
          workspaceId: auth.tenant_id,
          userId: auth.sub,
          name: parsed.data.name,
          scopes,
          // 90-day expiry: long enough to be useful, short enough to rotate.
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        })
        .returning();
      return inserted[0]!;
    });

    // Sign a JWT using the same secret / issuer / audience as the app JWT,
    // with scopes determined by the caller's workspace role.
    const jwt = await new SignJWT({
      sub: auth.sub,
      tenant_id: auth.tenant_id,
      email: auth.email,
      scopes,
      jti: row.jti,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(config.JWT_ISSUER)
      // MCP audience — accepted by verifyMcpToken alongside the REST audience.
      .setAudience(config.JWT_AUDIENCE_MCP ?? `${config.JWT_AUDIENCE}/mcp`)
      .setExpirationTime('90d')
      .sign(secret);

    return reply.code(201).send({
      token: {
        id: row.id,
        name: row.name,
        scopes: row.scopes,
        expires_at: row.expiresAt,
        created_at: row.createdAt,
      },
      // Raw JWT — shown once. Store it; we cannot recover it.
      jwt,
    });
  });

  // Revoke a token by ID.
  app.delete<{ Params: { id: string } }>('/api/mcp-tokens/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'bad_id' });

    await withTenant(req.auth.tenant_id, async (tx) => {
      await tx
        .update(mcpTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(mcpTokens.id, id),
            eq(mcpTokens.workspaceId, req.auth!.tenant_id),
            isNull(mcpTokens.revokedAt),
          ),
        );
    });

    return reply.code(204).send();
  });
};
