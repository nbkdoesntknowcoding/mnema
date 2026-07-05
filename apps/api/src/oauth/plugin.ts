/**
 * OAuth 2.1 Authorization Server — Fastify plugin.
 *
 * Registers all OAuth routes:
 *   /.well-known/oauth-authorization-server   (RFC 8414)
 *   /.well-known/oauth-protected-resource     (RFC 9728)
 *   /.well-known/jwks.json
 *   /oauth/authorize  (GET + POST approve/deny)
 *   /oauth/callback   (WorkOS callback)
 *   /oauth/token
 *   /oauth/register   (RFC 7591 DCR)
 *   /oauth/revoke     (RFC 7009)
 *   /oauth/userinfo
 *
 * Also pre-warms the keypair cache at startup so the first request
 * doesn't pay the file-read cost.
 */
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import formBody from '@fastify/formbody';
import { loadKeyPair } from './keys.js';
import { wellKnownRoutes } from './routes/well-known.js';
import { registerRoute } from './routes/register.js';
import { authorizeRoutes } from './routes/authorize.js';
import { tokenRoute } from './routes/token.js';
import { revokeRoute } from './routes/revoke.js';
import { userinfoRoute } from './routes/userinfo.js';

export const oauthPlugin: FastifyPluginAsync = fp(async (app) => {
  // RFC 6749 §4.1.3: token endpoint MUST accept application/x-www-form-urlencoded
  await app.register(formBody);

  // Pre-warm keypair cache at startup — catches missing key files early
  await loadKeyPair();

  await app.register(wellKnownRoutes);
  await app.register(registerRoute);
  await app.register(authorizeRoutes);
  await app.register(tokenRoute);
  await app.register(revokeRoute);
  await app.register(userinfoRoute);

  app.log.info('oauth: Authorization Server routes registered');
});
