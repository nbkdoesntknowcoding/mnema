import type { FastifyInstance } from 'fastify';
import { mcpConfig } from './config.js';

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 *
 * claude.ai's MCP connector first hits /.well-known/oauth-protected-resource
 * (or the per-resource variant /.well-known/oauth-protected-resource/mcp)
 * to discover *which* Authorization Server can mint tokens for this MCP
 * server, what scopes it supports, what audience to ask for, and what auth
 * methods are accepted.
 *
 * The two paths are aliased — we serve identical bodies — because the spec
 * permits both (per-resource lookup vs. server-wide). This keeps us
 * compatible with any client that picks either pattern.
 *
 * Phase 2.1: `authorization_servers` is a placeholder. Phase 2.2 swaps it
 * for the WorkOS AuthKit issuer URL once Dynamic Client Registration is
 * wired and a real WorkOS-issued JWT can be verified end-to-end.
 */
export async function protectedResourceRoutes(app: FastifyInstance): Promise<void> {
  const metadata = {
    resource: mcpConfig.resourceUrl,
    authorization_servers: [mcpConfig.authorizationServer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
    resource_documentation: 'https://modelcontextprotocol.io',
  };

  // Mark these as MCP routes so the auth plugin's preHandler doesn't try
  // to enforce app-login session cookies on them. (Belt-and-braces: they
  // also live outside /api/* which the auth plugin already skips.)
  const routeOpts = { config: { mcpRoute: true } };

  app.get('/.well-known/oauth-protected-resource', routeOpts, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return metadata;
  });

  // Per-resource variant — RFC 9728 §3.1.1 allows clients to look up
  // "the resource at this path" by appending the resource path.
  app.get('/.well-known/oauth-protected-resource/mcp', routeOpts, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return metadata;
  });
}
