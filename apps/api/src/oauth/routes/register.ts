/**
 * POST /oauth/register — Dynamic Client Registration (RFC 7591).
 *
 * Claude.ai's MCP connector hits this endpoint on first contact to
 * register itself. We issue a public client (PKCE-only, no secret).
 * No approval gate — any client can register, per RFC 7591 intent.
 * Add per-IP rate limits here if abuse is observed.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { oauthClients } from '../../db/schema.js';

const RegisterSchema = z.object({
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
  response_types: z.array(z.enum(['code'])).optional(),
  scope: z.string().optional(),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post']).optional(),
  application_type: z.enum(['web', 'native']).optional(),
  contacts: z.array(z.string()).optional(),
  logo_uri: z.string().url().optional(),
  client_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  tos_uri: z.string().url().optional(),
});

export async function registerRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/oauth/register',
    { config: { mcpRoute: true } },
    async (req, reply) => {
      const parse = RegisterSchema.safeParse(req.body);
      if (!parse.success) {
        return reply.status(400).send({
          error: 'invalid_client_metadata',
          error_description: parse.error.message,
        });
      }
      const data = parse.data;

      const clientId = `mnema_client_${crypto.randomUUID().replace(/-/g, '')}`;

      const [row] = await db
        .insert(oauthClients)
        .values({
          id: clientId,
          clientName: data.client_name,
          redirectUris: data.redirect_uris,
          grantTypes: data.grant_types ?? ['authorization_code', 'refresh_token'],
          responseTypes: data.response_types ?? ['code'],
          scope: data.scope ?? 'workspace:read',
          tokenEndpointAuthMethod: data.token_endpoint_auth_method ?? 'none',
          applicationType: data.application_type ?? 'web',
          registeredVia: 'dynamic',
          metadata: {
            contacts: data.contacts,
            logo_uri: data.logo_uri,
            client_uri: data.client_uri,
            policy_uri: data.policy_uri,
            tos_uri: data.tos_uri,
          },
        })
        .returning();

      if (!row) {
        return reply.status(500).send({ error: 'server_error' });
      }

      return reply.status(201).send({
        client_id: row.id,
        client_name: row.clientName,
        redirect_uris: row.redirectUris,
        grant_types: row.grantTypes,
        response_types: row.responseTypes,
        scope: row.scope,
        token_endpoint_auth_method: row.tokenEndpointAuthMethod,
        application_type: row.applicationType,
        client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      });
    },
  );
}
