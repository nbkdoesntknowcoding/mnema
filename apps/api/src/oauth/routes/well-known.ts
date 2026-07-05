/**
 * OAuth 2.1 well-known discovery endpoints.
 *
 *   GET /.well-known/oauth-authorization-server  (RFC 8414)
 *   GET /.well-known/oauth-protected-resource    (RFC 9728)
 *   GET /.well-known/jwks.json
 *
 * These three are what claude.ai fetches before initiating the OAuth dance.
 * The PRM endpoint is also served by the existing mcp/protected-resource.ts
 * (Phase 2.1 placeholder). Once this plugin is registered, the OAuth routes
 * take over and the placeholder responses are superseded.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../../config/env.js';
import { getJwks } from '../keys.js';

export async function wellKnownRoutes(app: FastifyInstance): Promise<void> {
  const issuer = config.OAUTH_ISSUER;

  // RFC 8414 — Authorization Server Metadata
  app.get(
    '/.well-known/oauth-authorization-server',
    { config: { mcpRoute: true } },
    async (_req, reply) => {
      reply.header('Cache-Control', 'public, max-age=300');
      return {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        userinfo_endpoint: `${issuer}/oauth/userinfo`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,

        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],

        scopes_supported: ['workspace:read', 'workspace:write', 'offline_access'],

        // RFC 8707 — Resource Indicators
        resource_parameter_supported: true,

        service_documentation: 'https://mnema.app/docs/connect',
        ui_locales_supported: ['en'],
      };
    },
  );

  // RFC 9728 — Protected Resource Metadata (replaces placeholder in mcp/protected-resource.ts)
  const prmBody = {
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    scopes_supported: ['workspace:read', 'workspace:write'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://mnema.app/docs/mcp-reference',
  };

  app.get(
    '/.well-known/oauth-protected-resource',
    { config: { mcpRoute: true } },
    async (_req, reply) => {
      reply.header('Cache-Control', 'public, max-age=60');
      return prmBody;
    },
  );

  app.get(
    '/.well-known/oauth-protected-resource/mcp',
    { config: { mcpRoute: true } },
    async (_req, reply) => {
      reply.header('Cache-Control', 'public, max-age=60');
      return prmBody;
    },
  );

  // JWKS — public keys for token verification
  app.get(
    '/.well-known/jwks.json',
    { config: { mcpRoute: true } },
    async (_req, reply) => {
      reply.header('Cache-Control', 'public, max-age=3600');
      return getJwks();
    },
  );
}
