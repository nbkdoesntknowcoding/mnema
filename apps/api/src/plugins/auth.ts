import cookie from '@fastify/cookie';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { JwtClaims } from '@boppl/shared';
import { verifyJwt } from '../lib/jwt.js';
import { tenantScopeStore } from '../db/with-tenant.js';
import { isWorkspaceSuspended } from '../lib/suspended.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: JwtClaims;
  }
}

export const JWT_COOKIE_NAME = 'boppl_jwt';

const PUBLIC_ROUTES = new Set<string>([
  '/health',
  '/api/_internal/set-session',
  // Phase 4 built-in email+password auth — called server-side by the web login/
  // signup with API_INTERNAL_SECRET (checked in-handler), no user JWT.
  '/api/_internal/password-login',
  '/api/_internal/password-register',
  '/api/_internal/federated-login',
  '/api/_internal/join-workspace',
  // Pre-launch waitlist capture — called server-side by the web proxy with the
  // internal_secret (API_INTERNAL_SECRET); no user JWT involved.
  '/api/_internal/waitlist',
  // Meeting bot reports its roster here, authenticated with its own mnema_api_ key
  // (resolved inside the handler) rather than a user JWT.
  '/api/_internal/meeting-participants',
  // Phase 1 BYOK — meeting bot resolves the workspace's LLM key at session start,
  // authenticated with its own mnema_api_ Bearer key (resolved in the handler), no user JWT.
  '/api/_internal/meeting-llm-key',
  // Recall posts signature-verified participant events here (verified inside the
  // handler via the workspace secret), no user JWT.
  '/api/_internal/recall-webhook',
  // Phase 4.1 — invitation preview must work BEFORE the invitee signs in,
  // so the accept page can show "X invited you to Y" without forcing
  // auth-first. The endpoint only reveals workspace name + inviter, never
  // tenant-confidential data, so it's safe to expose unauthenticated.
  '/api/invitations/lookup',
]);

// While impersonating (req.auth.imp), these mutations are blocked — a support
// session is read-mostly. Matched against the path; mutating methods only.
const IMPERSONATION_BLOCKED: RegExp[] = [
  /^\/api\/api-keys/,                    // create/revoke API keys
  /^\/api\/mcp-tokens/,                  // MCP tokens
  /^\/api\/members\//,                   // change roles / remove members
  /^\/api\/invitations/,                 // invite / revoke
  /^\/api\/billing\//,                   // subscribe / change-plan / payment
  /^\/api\/razorpay\//,                  // payments
  // H3 fix: doc_acl / org-structure write paths. An impersonator must not be able
  // to mint access grants. NOTE: this is a denylist — if it grows much further,
  // invert to a read-only allowlist so new privileged routes can't be missed.
  /^\/api\/org\/access/,                 // writes doc_acl grants
  /^\/api\/org\/(teams|roles)/,          // org-structure mutations
  /^\/api\/docs\/[^/]+\/request-access/, // file an access request
  /^\/api\/docs\/access-requests\//,     // approve/deny → writes doc_acl
];

function isBlockedWhileImpersonating(method: string, url: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return IMPERSONATION_BLOCKED.some((re) => re.test(url));
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/.exec(header);
  return match?.[1] ?? null;
}

export const authPlugin: FastifyPluginAsync = fp(async (app) => {
  await app.register(cookie);
  app.decorateRequest('auth', undefined);

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0] ?? '/';
    if (PUBLIC_ROUTES.has(url)) return;
    if (!url.startsWith('/api/')) return;
    // MCP routes enforce their own auth (Bearer + JWT in Phase 2.2). The
    // app-login cookie/JWT path here would 401 before the MCP plugin sees
    // the request — bail out for any route flagged mcpRoute.
    if (req.routeOptions?.config?.mcpRoute) return;
    // Hook routes have their own Bearer token auth (hook_token, not JWT).
    if (url.startsWith('/api/hooks/') || url === '/install/claude-hooks.sh') return;
    // Public doc reader — no auth required.
    if (url.startsWith('/api/docs/public/')) return;
    // Community Flows hub (EE) — cross-instance catalog. Browse/import/report are
    // anonymous; publish/unpublish authenticate via a community-license key
    // inside the handler (not the app JWT). Bypass the session-auth gate for all.
    if (url.startsWith('/api/hub/')) return;
    // OnlyOffice — server-to-server calls from OnlyOffice container, no cookie.
    // /callback auth: OnlyOffice JWT signature. /file auth: tenantId query param.
    if (url === '/api/onlyoffice/callback') return;
    if (url.startsWith('/api/onlyoffice/') && url.endsWith('/file')) return;

    const token = req.cookies[JWT_COOKIE_NAME] ?? extractBearer(req.headers.authorization);
    if (!token) {
      return reply.code(401).send({ error: 'unauthorized', reason: 'missing_token' });
    }

    try {
      const claims = await verifyJwt(token);
      req.auth = claims;
      // Admin-suspended workspaces are actually blocked here (not just flagged).
      // Exempt /api/auth/* so a suspended user can still switch workspace / log out,
      // and /api/admin/* so staff are never locked out of the admin center.
      if (
        claims.tenant_id &&
        !url.startsWith('/api/auth/') &&
        !url.startsWith('/api/admin/') &&
        (await isWorkspaceSuspended(claims.tenant_id))
      ) {
        return reply.code(403).send({ error: 'workspace_suspended', reason: 'This workspace has been suspended.' });
      }
      // Read-mostly impersonation: block destructive/account mutations.
      if (claims.imp && isBlockedWhileImpersonating(req.method, url)) {
        return reply.code(403).send({ error: 'impersonation_read_only', reason: 'This action is disabled while impersonating.' });
      }
      // Stage B: set the request-scoped user id so withTenant() inside REST
      // handlers inherits app.user_id → per-user project-membership RLS, the same
      // boundary the MCP path enforces. enterWith (not run) because a preHandler
      // returns before the route handler; it persists for the rest of this
      // request's async context. REST callers are never project-scoped keys, so
      // projectScope stays null. No-op for unfiled docs / workspace admins.
      tenantScopeStore.enterWith({ userId: claims.sub });
    } catch {
      return reply.code(401).send({ error: 'unauthorized', reason: 'invalid_token' });
    }
  });
});
