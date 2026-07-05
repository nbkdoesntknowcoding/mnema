/**
 * OAuth 2.1 Authorization Endpoint.
 *
 * GET  /oauth/authorize          — entry: validate params, auth check, consent
 * GET  /oauth/callback           — WorkOS callback: resume after login
 * POST /oauth/authorize/approve  — user clicked Approve
 * POST /oauth/authorize/deny     — user clicked Deny
 *
 * Flow:
 *   1. Client sends user to /oauth/authorize with PKCE + resource indicator
 *   2. If user has a valid boppl_jwt cookie → skip WorkOS login, show consent
 *   3. If no cookie → redirect to WorkOS AuthKit, state=request_id
 *   4. WorkOS calls /oauth/callback with code + state
 *   5. We exchange code → user identity, look up local user, show consent
 *   6. User picks workspace + approves → issue auth code → redirect to client
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  oauthAuthorizationCodes,
  oauthClients,
  oauthConsents,
  oauthPendingAuthRequests,
  users,
  workspaceMembers,
  workspaces,
} from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { JWT_COOKIE_NAME } from '../../plugins/auth.js';
import { signJwt, verifyJwt } from '../../lib/jwt.js';
import { renderConsentScreen, renderErrorPage, renderLoginPage } from '../consent.js';
import { completeWorkOSCallback } from '../workos-bridge.js';
import { config } from '../../config/env.js';

// 15-minute cookie lifetime — just long enough to survive the consent round-trip
const CONSENT_COOKIE_MAX_AGE_SEC = 15 * 60;

const AuthorizeQuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string(),
  redirect_uri: z.string().url(),
  scope: z.string(),
  state: z.string(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
  resource: z.string().url().optional(),
});

export async function authorizeRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /oauth/authorize ────────────────────────────────────────────────
  app.get(
    '/oauth/authorize',
    { config: { mcpRoute: true } },
    async (req, reply) => {
      const parse = AuthorizeQuerySchema.safeParse(req.query);
      if (!parse.success) {
        return renderErrorPage(reply, {
          error: 'invalid_request',
          description: parse.error.issues.map((i) => i.message).join('; '),
        });
      }
      const params = parse.data;

      // Validate client
      const [client] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.id, params.client_id))
        .limit(1);
      if (!client) return renderErrorPage(reply, { error: 'invalid_client' });
      if (!client.redirectUris.includes(params.redirect_uri)) {
        return renderErrorPage(reply, { error: 'invalid_redirect_uri' });
      }

      // Store the pending request
      const requestId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await db.insert(oauthPendingAuthRequests).values({
        id: requestId,
        clientId: params.client_id,
        redirectUri: params.redirect_uri,
        scope: params.scope,
        state: params.state,
        codeChallenge: params.code_challenge,
        codeChallengeMethod: params.code_challenge_method,
        resource: params.resource ?? null,
        expiresAt,
      });

      // Check existing session
      const sessionJwt = (req as any).cookies?.[JWT_COOKIE_NAME];
      if (sessionJwt) {
        try {
          const claims = await verifyJwt(sessionJwt);
          return showConsentScreen(reply, requestId, client.clientName, claims.sub, claims.email);
        } catch {
          // Invalid cookie — fall through to WorkOS login
        }
      }

      // No valid session → send user to the Mnema web app login page.
      // After login the web app calls /oauth/resume to bridge the session back.
      // On self-host (AUTH_PROVIDER=password|oidc) the WorkOS marketing /login
      // page can't authenticate a local account — route to /auth/local instead.
      const loginPath = config.AUTH_PROVIDER === 'workos' ? '/login' : '/auth/local';
      const loginUrl = `${config.WEB_BASE_URL}${loginPath}?oauth_request_id=${encodeURIComponent(requestId)}`;
      return renderLoginPage(reply, { requestId, loginUrl });
    },
  );

  // ── GET /oauth/callback — WorkOS returns here after login ───────────────
  app.get(
    '/oauth/callback',
    { config: { mcpRoute: true } },
    async (req, reply) => {
      const query = req.query as Record<string, string>;
      const { code, state: requestId, error } = query;

      if (error || !code || !requestId) {
        return renderErrorPage(reply, {
          error: 'authentication_failed',
          description: error ?? 'Missing code or state',
        });
      }

      // Exchange code for WorkOS identity
      const identity = await completeWorkOSCallback(code);
      if (!identity) {
        return renderErrorPage(reply, { error: 'authentication_failed', description: 'WorkOS exchange failed' });
      }

      // Look up local user by email
      const [user] = await withSystemPrivilege((tx) =>
        tx.select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.email, identity.email))
          .limit(1),
      );
      if (!user) {
        return renderErrorPage(reply, { error: 'account_not_found', description: 'No Mnema account for this email' });
      }

      // Verify the pending request still exists
      const [pending] = await db
        .select({ clientId: oauthPendingAuthRequests.clientId })
        .from(oauthPendingAuthRequests)
        .where(
          and(
            eq(oauthPendingAuthRequests.id, requestId),
            gt(oauthPendingAuthRequests.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!pending) return renderErrorPage(reply, { error: 'request_expired' });

      const [client] = await db
        .select({ clientName: oauthClients.clientName })
        .from(oauthClients)
        .where(eq(oauthClients.id, pending.clientId))
        .limit(1);
      if (!client) return renderErrorPage(reply, { error: 'invalid_client' });

      // Set a short-lived session cookie so POST /oauth/authorize/approve can
      // verify the user's identity. The user arrived via WorkOS (not the web
      // app login), so no boppl_jwt exists yet. tenant_id is a placeholder —
      // the approve route only reads claims.sub.
      const sessionJwt = await signJwt({
        sub: user.id,
        tenant_id: user.id,   // placeholder; approve only needs sub
        email: user.email,
        scopes: ['oauth:consent'],
      });
      reply.setCookie(JWT_COOKIE_NAME, sessionJwt, {
        path: '/',
        httpOnly: true,
        secure: true,     // tunnel is HTTPS
        sameSite: 'lax',
        maxAge: CONSENT_COOKIE_MAX_AGE_SEC,
      });

      return showConsentScreen(reply, requestId, client.clientName, user.id, user.email);
    },
  );

  // ── POST /oauth/authorize/approve ───────────────────────────────────────
  app.post(
    '/oauth/authorize/approve',
    { config: { mcpRoute: true } },
    async (req, reply) => {
      const body = z.object({
        request_id: z.string(),
        workspace_id: z.string().uuid(),
        scope: z.string(),
      }).safeParse(req.body);

      if (!body.success) {
        return reply.status(400).send({ error: 'invalid_request' });
      }
      const { request_id, workspace_id, scope } = body.data;

      // Load + validate pending request
      const [pending] = await db
        .select()
        .from(oauthPendingAuthRequests)
        .where(
          and(
            eq(oauthPendingAuthRequests.id, request_id),
            gt(oauthPendingAuthRequests.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!pending) {
        return renderErrorPage(reply, { error: 'request_expired_or_invalid' });
      }

      // Verify user identity from session cookie
      const sessionJwt = (req as any).cookies?.[JWT_COOKIE_NAME];
      if (!sessionJwt) return reply.status(401).send({ error: 'unauthenticated' });
      let claims: Awaited<ReturnType<typeof verifyJwt>>;
      try { claims = await verifyJwt(sessionJwt); }
      catch { return reply.status(401).send({ error: 'unauthenticated' }); }

      // Verify user is a member of the chosen workspace
      const [membership] = await withSystemPrivilege((tx) =>
        tx.select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.userId, claims.sub),
              eq(workspaceMembers.workspaceId, workspace_id),
            ),
          )
          .limit(1),
      );
      if (!membership) return reply.status(403).send({ error: 'no_workspace_access' });

      // Phase 9.1: strip workspace:write for viewer roles — they cannot write
      // regardless of what the client requested or the consent form submitted.
      const effectiveScope =
        membership.role === 'viewer'
          ? scope
              .split(' ')
              .filter((s) => s !== 'workspace:write')
              .join(' ')
              .trim()
          : scope;

      // Issue authorization code
      const code = `mnema_ac_${randomBytes(32).toString('base64url')}`;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await db.insert(oauthAuthorizationCodes).values({
        code,
        clientId: pending.clientId,
        userId: claims.sub,
        workspaceId: workspace_id,
        redirectUri: pending.redirectUri,
        scope: effectiveScope,
        resource: pending.resource,
        codeChallenge: pending.codeChallenge,
        codeChallengeMethod: pending.codeChallengeMethod,
        expiresAt,
      });

      // Persist consent so repeat authorizations skip the consent screen
      await withSystemPrivilege((tx) =>
        tx.insert(oauthConsents)
          .values({ userId: claims.sub, workspaceId: workspace_id, clientId: pending.clientId, scope: effectiveScope })
          .onConflictDoUpdate({
            target: [oauthConsents.userId, oauthConsents.workspaceId, oauthConsents.clientId, oauthConsents.scope],
            set: { revokedAt: null, grantedAt: new Date() },
          }),
      );

      // Clean up pending request
      await db.delete(oauthPendingAuthRequests).where(eq(oauthPendingAuthRequests.id, request_id));

      const redirectUrl = new URL(pending.redirectUri);
      redirectUrl.searchParams.set('code', code);
      redirectUrl.searchParams.set('state', pending.state);
      return reply.redirect(redirectUrl.toString(), 303);
    },
  );

  // ── POST /oauth/authorize/deny ──────────────────────────────────────────
  app.post(
    '/oauth/authorize/deny',
    { config: { mcpRoute: true } },
    async (req, reply) => {
      const body = z.object({ request_id: z.string() }).safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: 'invalid_request' });

      const [pending] = await db
        .select()
        .from(oauthPendingAuthRequests)
        .where(eq(oauthPendingAuthRequests.id, body.data.request_id))
        .limit(1);

      await db.delete(oauthPendingAuthRequests).where(eq(oauthPendingAuthRequests.id, body.data.request_id));

      if (pending) {
        const redirectUrl = new URL(pending.redirectUri);
        redirectUrl.searchParams.set('error', 'access_denied');
        redirectUrl.searchParams.set('state', pending.state);
        return reply.redirect(redirectUrl.toString(), 303);
      }
      return renderErrorPage(reply, { error: 'request_not_found' });
    },
  );

  // ── GET /oauth/resume — bridge from Mnema web-app login back to OAuth ─────
  // After the user logs in via mnema.example.com, the web app redirects
  // here with the request_id and the Mnema JWT as `proof`. We validate the JWT,
  // set the boppl_jwt cookie, and show the consent screen directly.
  app.get(
    '/oauth/resume',
    { config: { mcpRoute: true } },
    async (req, reply) => {
      const query = req.query as Record<string, string>;
      const { request_id, proof } = query;
      if (!request_id || !proof) {
        return renderErrorPage(reply, { error: 'invalid_request', description: 'Missing request_id or proof' });
      }

      let claims: Awaited<ReturnType<typeof verifyJwt>>;
      try {
        claims = await verifyJwt(proof);
      } catch {
        return renderErrorPage(reply, { error: 'invalid_proof', description: 'Token is invalid or expired. Please try signing in again.' });
      }

      // Verify the pending OAuth request still exists
      const [pending] = await db
        .select({ clientId: oauthPendingAuthRequests.clientId })
        .from(oauthPendingAuthRequests)
        .where(
          and(
            eq(oauthPendingAuthRequests.id, request_id),
            gt(oauthPendingAuthRequests.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!pending) {
        return renderErrorPage(reply, { error: 'request_expired', description: 'OAuth session expired. Please go back to Claude Desktop and try connecting again.' });
      }

      const [client] = await db
        .select({ clientName: oauthClients.clientName })
        .from(oauthClients)
        .where(eq(oauthClients.id, pending.clientId))
        .limit(1);
      if (!client) return renderErrorPage(reply, { error: 'invalid_client' });

      // Set a short-lived boppl_jwt so the consent POST can verify identity
      reply.setCookie(JWT_COOKIE_NAME, proof, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: CONSENT_COOKIE_MAX_AGE_SEC,
      });

      return showConsentScreen(reply, request_id, client.clientName, claims.sub, claims.email);
    },
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

async function showConsentScreen(
  reply: FastifyReply,
  requestId: string,
  clientName: string,
  userId: string,
  userEmail: string,
): Promise<void> {
  const [pending] = await db
    .select({ scope: oauthPendingAuthRequests.scope, resource: oauthPendingAuthRequests.resource })
    .from(oauthPendingAuthRequests)
    .where(eq(oauthPendingAuthRequests.id, requestId))
    .limit(1);

  const userWorkspaces = await withSystemPrivilege((tx) =>
    tx
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId)),
  );

  renderConsentScreen(reply, {
    requestId,
    clientName,
    userEmail,
    scope: pending?.scope ?? 'workspace:read',
    resource: pending?.resource,
    workspaces: userWorkspaces,
  });
}
