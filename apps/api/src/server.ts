import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { config } from './config/env.js';
import { initSentry, Sentry } from './lib/sentry.js';
import { redis } from './plugins/redis.js';

// Initialise Sentry before anything else — no-op when SENTRY_DSN is unset.
initSentry();
import { oauthPlugin } from './oauth/plugin.js';
import { mcpPlugin } from './mcp/plugin.js';
import { authPlugin } from './plugins/auth.js';
import { loggerOptions } from './plugins/logger.js';
import { authRoutes } from './routes/auth.js';
import { commentsRoutes } from './routes/comments.js';
import { completeRoutes } from './routes/complete.js';
import { docReadStateRoutes } from './routes/doc-read-state.js';
import { docVersionsRoutes } from './routes/doc-versions.js';
import { docsRoutes } from './routes/docs.js';
import { decisionApprovalsRoutes } from './routes/decision-approvals.js';
import { searchRoutes } from './routes/search.js';
import { foldersRoutes } from './routes/folders.js';
import { mcpTokenRoutes } from './routes/mcp-tokens.js';
import { flowsRoutes } from './routes/flows.js';
import { communityRoutes } from './routes/community.js';
import { healthRoutes } from './routes/health.js';
import { invitationsRoutes } from './routes/invitations.js';
import { membersRoutes } from './routes/members.js';
import { calendarRoutes } from './routes/calendar.js';
import { notificationsRoutes } from './routes/notifications.js';
import { workspacesRoutes } from './routes/workspaces.js';
import { byokRoutes } from './routes/byok.js';
import { entitlementsRoutes } from './routes/entitlements.js';
import { licensesRoutes } from './routes/licenses.js';
import { tasksRoutes } from './routes/tasks.js';
import { hooksRoutes } from './routes/hooks.js';
import { sessionsRoutes } from './routes/sessions.js';
import { devRoutes } from './routes/dev.js';
import { optimizationRoutes } from './routes/optimization.js';
import { devSearchRoutes } from './routes/dev-search.js';
import { setSessionRoutes } from './routes/_internal/set-session.js';
import { authLocalRoutes } from './routes/auth-local.js';
import { waitlistRoutes } from './routes/_internal/waitlist.js';
import { joinWorkspaceRoutes } from './routes/_internal/join-workspace.js';
import { requestJoinRoutes } from './routes/_internal/request-join.js';
import { joinRequestRoutes } from './routes/join-requests.js';
import { acceptInvitePendingRoutes } from './routes/_internal/accept-invite-pending.js';
import { apiKeysRoutes } from './routes/api-keys.js';
import { publicV1Routes } from './routes/public/v1.js';
import { openApiRoutes } from './routes/public/openapi.js';
import { geminiRoutes } from './routes/public/gemini.js';
import { installRoutes } from './routes/public/install.js';
import { projectsRoutes } from './routes/projects.js';
import { documentFilesRoutes } from './routes/document-files.js';
import { onlyofficeRoutes } from './routes/onlyoffice.js';
import { loadEeApi, preloadEeMcp } from './lib/load-ee.js';

const app = Fastify({ logger: loggerOptions });

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  // Origins driven by CORS_ORIGINS env var. Defaults cover local dev (5173,
  // 5175 for worktree, 6274 for MCP Inspector). Production adds the Vercel
  // domain via that env var — no code change needed.
  //
  // MCP routes (/mcp, /mcp/http) use wildcard origin (*) so ChatGPT Business,
  // OpenAI Codex, and other remote AI clients can reach them. Every MCP
  // request is independently authenticated via Bearer token — CORS only
  // controls whether the browser forwards the preflight, so wildcard here
  // does not weaken auth.
  // Allow all origins — each route enforces its own auth:
  //   /api/* — cookie/JWT session (enforced by authPlugin preHandler)
  //   /mcp, /mcp/http — Bearer token (enforced by requireOAuthBearer)
  // Reflecting the request Origin (origin: true) is safe because every request
  // requires a valid token regardless of where it came from.
  origin: true,
  credentials: true,
});
await app.register(sensible);

// Global rate-limit — a coarse DoS backstop layered OVER the fine-grained,
// hand-rolled per-route limiters (auth-rate-limit.ts, routes/complete/rate-limit.ts).
// The ceiling is deliberately generous so it never trips legitimate API/MCP/internal
// traffic; it only exists to blunt abusive floods and to satisfy CodeQL's
// js/missing-rate-limiting alert (every route now sits behind a global limiter).
//
// - skipOnError: true  → fail-open; a limiter/Redis fault must never 500 the API.
// - redis: shared client → counters coordinate across replicas (self-hosters with
//   >1 API instance get a single shared budget instead of per-process ceilings).
// - keyGenerator prefers the authenticated subject (per-user budget) and falls back
//   to the client IP for unauthenticated / bearer-only (MCP, _internal) traffic.
// - allowList exempts high-volume server-to-server + real-time paths that have their
//   own auth and traffic characteristics and must not be capped by this coarse gate.
await app.register(rateLimit, {
  global: true,
  max: 1000,
  timeWindow: '1 minute',
  skipOnError: true,
  redis,
  keyGenerator: (req: FastifyRequest) => {
    // Prefer the authenticated subject so one noisy user can't exhaust another's
    // budget; fall back to client IP. NOTE: this plugin runs on the `onRequest`
    // hook, which fires BEFORE authPlugin's `preHandler` populates req.auth, so
    // in practice most requests key by IP today — the sub branch is a
    // forward-safe default if auth ever moves to an onRequest hook. IP keying is
    // the correct behaviour for a coarse DoS backstop regardless.
    const sub = req.auth?.sub;
    return sub ? `user:${sub}` : `ip:${req.ip}`;
  },
  allowList: (req: FastifyRequest) => {
    const url = (req.url.split('?')[0] ?? '/');
    // High-volume / real-time / server-to-server paths with their own auth:
    //   /mcp*            — MCP tool traffic (Bearer-authenticated, bursty)
    //   /api/_internal/* — server-to-server (meeting bot roster, webhooks, sessions)
    //   /api/onlyoffice/ — OnlyOffice document-server callbacks
    //   /api/hooks/      — Claude Code hook Bearer traffic
    //   /health          — liveness/readiness probes
    return (
      url === '/health' ||
      url.startsWith('/mcp') ||
      url.startsWith('/api/_internal/') ||
      url.startsWith('/api/onlyoffice/') ||
      url.startsWith('/api/hooks/')
    );
  },
});

await app.register(authPlugin);
await app.register(healthRoutes);
await app.register(setSessionRoutes);
await app.register(authLocalRoutes);
await app.register(waitlistRoutes);
await app.register(joinWorkspaceRoutes);
await app.register(requestJoinRoutes);
await app.register(joinRequestRoutes);
await app.register(acceptInvitePendingRoutes);
await app.register(authRoutes);
await app.register(docsRoutes);
await app.register(decisionApprovalsRoutes);
await app.register(searchRoutes);
await app.register(foldersRoutes);
await app.register(flowsRoutes);
await app.register(communityRoutes);
await app.register(invitationsRoutes);
await app.register(membersRoutes);
await app.register(calendarRoutes);
await app.register(notificationsRoutes);
await app.register(workspacesRoutes);
await app.register(byokRoutes);
await app.register(entitlementsRoutes);
await app.register(licensesRoutes);
await app.register(tasksRoutes);
await app.register(hooksRoutes);
await app.register(sessionsRoutes);
await app.register(devRoutes);
await app.register(optimizationRoutes);
await app.register(devSearchRoutes);
await app.register(commentsRoutes);
await app.register(docVersionsRoutes);
await app.register(docReadStateRoutes);
await app.register(completeRoutes);
await app.register(mcpTokenRoutes);
await app.register(apiKeysRoutes);
await app.register(publicV1Routes);
await app.register(openApiRoutes);
await app.register(geminiRoutes);
await app.register(installRoutes);
  await app.register(projectsRoutes);
await app.register(documentFilesRoutes);
await app.register(onlyofficeRoutes);
// Phase 3 — mount the enterprise (ee) modules if present (dynamic import, so
// core boots without them in the public build). Per-feature licensing is the
// Phase 2 entitlement gates inside these routes. preloadEeMcp makes the gated
// MCP tools available to the synchronous, per-request createMcpServer.
await preloadEeMcp();
await loadEeApi(app);
await app.register(oauthPlugin);
await app.register(mcpPlugin);

// Forward unhandled errors to Sentry before replying with 500.
app.setErrorHandler((error, request, reply) => {
  Sentry.captureException(error, {
    extra: { url: request.url, method: request.method },
  });
  app.log.error({ err: error, url: request.url }, 'unhandled_error');
  void reply.code(500).send({ error: 'internal_server_error' });
});

const port = config.API_PORT;
try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`API listening on http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} received, shutting down...`);
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
