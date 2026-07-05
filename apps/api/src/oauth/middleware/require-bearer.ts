/**
 * OAuth Bearer token validation for MCP endpoints.
 *
 * Priority order (A.4 — Universal Compatibility):
 *   1. mnema_api_xxx prefix → static API key table (ChatGPT, Codex, REST clients)
 *   2. RS256 JWT → OAuth 2.1 access token (claude.ai, Phase A)
 *   3. HS256 JWT → legacy app JWT (Claude Desktop via mcp-remote)
 *
 * The resolved auth context is attached to req.oauth for downstream handlers.
 * The workspace_id becomes the RLS tenant for all DB queries.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../config/env.js';
import { verifyOAuthAccessToken, type OAuthJwtPayload } from '../jwt.js';
import { verifyMcpToken } from '../../mcp/auth.js';
import { resolveApiKey, expandApiKeyScopes } from '../../lib/api-keys.js';

export interface OAuthContext {
  userId: string;
  workspaceId: string;
  /** Stage B: set ONLY for a project-scoped API key — hard-bounds the session
   *  (and the meeting bot) to this one project. null = workspace-wide. */
  projectId: string | null;
  /** Meeting identity (Phase 1): true only for an act-as key. When set, the MCP
   *  boundary resolves the X-Mnema-Act-As-Email header → a workspace user and
   *  enforces that user's access per request (per-asker meeting scoping). */
  actAsUser: boolean;
  scope: string[];
  clientId: string;
  jti: string | null;
  tokenType: 'api_key' | 'oauth' | 'legacy';
}

declare module 'fastify' {
  interface FastifyRequest {
    oauth?: OAuthContext;
  }
}

export async function requireOAuthBearer(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = req.headers.authorization;

  if (!auth?.startsWith('Bearer ')) {
    reply.header(
      'WWW-Authenticate',
      `Bearer realm="mnema-mcp", ` +
      `resource_metadata="${config.OAUTH_ISSUER}/.well-known/oauth-protected-resource"`,
    );
    reply.status(401).send({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized', data: { protected_resource: `${config.OAUTH_ISSUER}/.well-known/oauth-protected-resource` } },
      id: null,
    });
    return;
  }

  const token = auth.slice(7);

  // 1. Static API key (mnema_api_ prefix) — used by ChatGPT, Codex, REST clients
  if (token.startsWith('mnema_api_')) {
    const apiKeyCtx = await resolveApiKey(token);
    if (apiKeyCtx) {
      req.oauth = {
        userId: apiKeyCtx.userId,
        workspaceId: apiKeyCtx.workspaceId,
        // Project-scoped key → hard-bounds this session (the meeting bot) to one project.
        projectId: apiKeyCtx.projectId,
        actAsUser: apiKeyCtx.actAsUser,
        scope: expandApiKeyScopes(apiKeyCtx.scopes),
        clientId: 'api-key',
        jti: null,
        tokenType: 'api_key',
      };
      return;
    }
    // Known prefix but key not found/revoked → 401 immediately (no further attempts)
    reply.status(401).send({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized', data: { reason: 'api_key_invalid_or_revoked' } },
      id: null,
    });
    return;
  }

  // 2. Try OAuth RS256 token
  const oauthResult = await verifyOAuthAccessToken(token, `${config.OAUTH_ISSUER}/mcp`);
  if (oauthResult.valid) {
    const p = oauthResult.payload as OAuthJwtPayload;
    // Expand external OAuth scopes → internal capability scopes used by tool
    // requireScope() checks. workspace:read covers all read tools; workspace:write
    // covers all write tools. This keeps the public OAuth surface simple while
    // the internal scope strings stay descriptive.
    const rawScopes = p.scope.split(' ');
    const expanded = new Set(rawScopes);
    if (expanded.has('workspace:read')) {
      expanded.add('docs:read');
      expanded.add('flows:read');
    }
    if (expanded.has('workspace:write')) {
      expanded.add('docs:write');
      expanded.add('flows:write');
    }
    req.oauth = {
      userId: p.sub,
      workspaceId: p.workspace_id,
      projectId: null, // OAuth tokens are workspace-wide; per-user RLS bounds them.
      actAsUser: false,
      scope: [...expanded],
      clientId: p.client_id,
      jti: p.jti ?? null,
      tokenType: 'oauth',
    };
    return;
  }

  // 2. Fall back to legacy HS256 app JWT (Claude Desktop via mcp-remote)
  try {
    const legacyCtx = await verifyMcpToken(token);
    req.oauth = {
      userId: legacyCtx.user_id,
      workspaceId: legacyCtx.tenant_id,
      projectId: null,
      actAsUser: false,
      scope: legacyCtx.scopes,
      clientId: 'claude-desktop-legacy',
      jti: legacyCtx.jwt_id,
      tokenType: 'legacy',
    };
    return;
  } catch {
    // Both verifications failed
  }

  reply.header(
    'WWW-Authenticate',
    `Bearer realm="mnema-mcp", error="invalid_token", ` +
    `resource_metadata="${config.OAUTH_ISSUER}/.well-known/oauth-protected-resource"`,
  );
  reply.status(401).send({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized' },
    id: null,
  });
}
