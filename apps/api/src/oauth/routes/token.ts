/**
 * POST /oauth/token — Token endpoint.
 *
 * Handles:
 *   - authorization_code grant: exchange code + PKCE verifier → access + refresh tokens
 *   - refresh_token grant: rotate refresh token → new access + refresh tokens
 *
 * Never logs raw tokens. Logs jti for correlation.
 * Refresh token rotation is mandatory per OAuth 2.1.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  oauthAuthorizationCodes,
  oauthClients,
  oauthRefreshTokens,
} from '../../db/schema.js';
import { config } from '../../config/env.js';
import { signOAuthAccessToken } from '../jwt.js';
import { verifyPkce } from '../pkce.js';

const AuthCodeGrantSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string(),
  redirect_uri: z.string().url(),
  client_id: z.string(),
  code_verifier: z.string().min(43).max(128),
  resource: z.string().url().optional(),
});

const RefreshGrantSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string(),
  client_id: z.string(),
  scope: z.string().optional(),
});

export async function tokenRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/oauth/token',
    { config: { mcpRoute: true } },
    async (req, reply) => {
      // Support both JSON body and application/x-www-form-urlencoded
      const body = req.body as Record<string, unknown>;

      if (body.grant_type === 'authorization_code') {
        return handleAuthCodeGrant(req, reply, body);
      }
      if (body.grant_type === 'refresh_token') {
        return handleRefreshGrant(req, reply, body);
      }

      return reply.status(400).send({
        error: 'unsupported_grant_type',
        error_description: "grant_type must be 'authorization_code' or 'refresh_token'",
      });
    },
  );
}

async function handleAuthCodeGrant(req: any, reply: any, body: Record<string, unknown>) {
  const parse = AuthCodeGrantSchema.safeParse(body);
  if (!parse.success) {
    return reply.status(400).send({
      error: 'invalid_request',
      error_description: parse.error.message,
    });
  }
  const params = parse.data;

  // Fetch the auth code — must be unused and unexpired
  const [authCode] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(
      and(
        eq(oauthAuthorizationCodes.code, params.code),
        isNull(oauthAuthorizationCodes.usedAt),
        gt(oauthAuthorizationCodes.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!authCode) {
    return reply.status(400).send({ error: 'invalid_grant' });
  }

  if (authCode.clientId !== params.client_id) {
    return reply.status(400).send({ error: 'invalid_grant', error_description: 'client_id mismatch' });
  }
  if (authCode.redirectUri !== params.redirect_uri) {
    return reply.status(400).send({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
  }

  // PKCE verification (critical — must not be skippable)
  if (!verifyPkce(params.code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
    return reply.status(400).send({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }

  // RFC 8707 — resource indicator must match if provided by both
  if (authCode.resource && params.resource && authCode.resource !== params.resource) {
    return reply.status(400).send({ error: 'invalid_target', error_description: 'resource indicator mismatch' });
  }

  const resource = params.resource ?? authCode.resource ?? `${config.OAUTH_ISSUER}/mcp`;

  // Mark code used (one-time)
  await db
    .update(oauthAuthorizationCodes)
    .set({ usedAt: new Date() })
    .where(eq(oauthAuthorizationCodes.code, params.code));

  // Issue access token
  const { token: accessToken } = await signOAuthAccessToken({
    userId: authCode.userId,
    workspaceId: authCode.workspaceId,
    clientId: authCode.clientId,
    scope: authCode.scope,
    resource,
  });

  // Issue refresh token
  const refreshRaw = `mnema_rt_${randomBytes(32).toString('base64url')}`;
  const refreshHash = createHash('sha256').update(refreshRaw).digest('hex');
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(oauthRefreshTokens).values({
    tokenHash: refreshHash,
    clientId: authCode.clientId,
    userId: authCode.userId,
    workspaceId: authCode.workspaceId,
    scope: authCode.scope,
    resource,
    expiresAt: refreshExpiresAt,
  });

  // Update client last_used_at (fire-and-forget)
  db.update(oauthClients)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthClients.id, authCode.clientId))
    .execute()
    .catch(() => {});

  req.log.info({ client_id: authCode.clientId, workspace_id: authCode.workspaceId }, 'oauth: issued access token');

  return reply.send({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: refreshRaw,
    scope: authCode.scope,
  });
}

async function handleRefreshGrant(req: any, reply: any, body: Record<string, unknown>) {
  const parse = RefreshGrantSchema.safeParse(body);
  if (!parse.success) {
    return reply.status(400).send({ error: 'invalid_request', error_description: parse.error.message });
  }
  const params = parse.data;

  const refreshHash = createHash('sha256').update(params.refresh_token).digest('hex');

  const [rt] = await db
    .select()
    .from(oauthRefreshTokens)
    .where(
      and(
        eq(oauthRefreshTokens.tokenHash, refreshHash),
        isNull(oauthRefreshTokens.revokedAt),
        gt(oauthRefreshTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!rt) {
    return reply.status(400).send({ error: 'invalid_grant' });
  }
  if (rt.clientId !== params.client_id) {
    return reply.status(400).send({ error: 'invalid_grant', error_description: 'client_id mismatch' });
  }

  // OAuth 2.1 mandates refresh token rotation — issue new, revoke old, link them
  const newRefreshRaw = `mnema_rt_${randomBytes(32).toString('base64url')}`;
  const newRefreshHash = createHash('sha256').update(newRefreshRaw).digest('hex');
  const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const { token: accessToken } = await signOAuthAccessToken({
    userId: rt.userId,
    workspaceId: rt.workspaceId,
    clientId: rt.clientId,
    scope: rt.scope,
    resource: rt.resource ?? `${config.OAUTH_ISSUER}/mcp`,
  });

  const [newRt] = await db
    .insert(oauthRefreshTokens)
    .values({
      tokenHash: newRefreshHash,
      clientId: rt.clientId,
      userId: rt.userId,
      workspaceId: rt.workspaceId,
      scope: rt.scope,
      resource: rt.resource,
      expiresAt: newExpiresAt,
    })
    .returning({ id: oauthRefreshTokens.id });

  // Revoke old token, record rotation chain
  await db
    .update(oauthRefreshTokens)
    .set({ revokedAt: new Date(), rotatedToId: newRt?.id })
    .where(eq(oauthRefreshTokens.id, rt.id));

  req.log.info({ client_id: rt.clientId, workspace_id: rt.workspaceId }, 'oauth: rotated refresh token');

  return reply.send({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: newRefreshRaw,
    scope: rt.scope,
  });
}
