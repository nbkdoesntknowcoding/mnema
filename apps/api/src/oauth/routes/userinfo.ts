/**
 * GET /oauth/userinfo — UserInfo endpoint.
 *
 * Returns basic profile for the authenticated user.
 * Requires a valid OAuth Bearer token.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { config } from '../../config/env.js';
import { verifyOAuthAccessToken } from '../jwt.js';

export async function userinfoRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/oauth/userinfo',
    { config: { mcpRoute: true } },
    async (req, reply) => {
      const auth = req.headers.authorization;
      if (!auth?.startsWith('Bearer ')) {
        return reply.status(401).header('WWW-Authenticate', 'Bearer realm="mnema"').send({ error: 'unauthorized' });
      }
      const token = auth.slice(7);
      const result = await verifyOAuthAccessToken(token, `${config.OAUTH_ISSUER}/mcp`);
      if (!result.valid) {
        return reply.status(401).send({ error: 'invalid_token' });
      }

      const [user] = await db
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, result.payload.sub))
        .limit(1);

      if (!user) return reply.status(404).send({ error: 'user_not_found' });

      return {
        sub: user.id,
        email: user.email,
        name: user.displayName ?? user.email,
        workspace_id: result.payload.workspace_id,
      };
    },
  );
}
