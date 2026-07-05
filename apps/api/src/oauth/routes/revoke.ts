/**
 * POST /oauth/revoke — Token Revocation (RFC 7009).
 *
 * Accepts refresh tokens. Access tokens are short-lived (1h) and
 * not stored server-side, so revocation isn't meaningful for them.
 * Per RFC 7009, unrecognised tokens return 200 OK (no information leakage).
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { oauthRefreshTokens } from '../../db/schema.js';

const RevokeSchema = z.object({
  token: z.string(),
  token_type_hint: z.enum(['refresh_token', 'access_token']).optional(),
  client_id: z.string().optional(),
});

export async function revokeRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/oauth/revoke',
    { config: { mcpRoute: true } },
    async (req, reply) => {
      const parse = RevokeSchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({ error: 'invalid_request' });
      }
      const { token } = parse.data;

      // Try to revoke as a refresh token (access tokens aren't stored)
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await db
        .update(oauthRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthRefreshTokens.tokenHash, tokenHash));

      // RFC 7009: always 200, even if token wasn't found
      return reply.status(200).send({});
    },
  );
}
