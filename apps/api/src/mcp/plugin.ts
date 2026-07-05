import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { requireOAuthBearer } from '../oauth/middleware/require-bearer.js';
import { checkSubscriptionGate } from '../plugins/subscription.js';
import { isWorkspaceSuspended } from '../lib/suspended.js';
import { mcpConfig } from './config.js';
// protectedResourceRoutes removed — well-known routes now live in oauth/routes/well-known.ts
import { McpForbiddenError } from './scope.js';
import { createMcpServer } from './server.js';
import { handleStreamableHttp } from './transport.js';
import { and } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { tenantScopeStore } from '../db/with-tenant.js';
import { mcpTokens, meetingParticipants, meetings, participantAliases, users, workspaceMembers, workspaces } from '../db/schema.js';

// Meeting identity. Headers an act-as key sets per request to name the participant
// currently asking. The server resolves to a workspace user and enforces that
// user's access. Lower-case — Fastify normalizes header names. Email is tried
// first (calendar-matched attendees); name is the fallback (saved alias) for
// attendees with no resolvable email.
const ACT_AS_EMAIL_HEADER = 'x-mnema-act-as-email';
const ACT_AS_NAME_HEADER = 'x-mnema-act-as-name';
// When the asking participant is the meeting HOST and couldn't be resolved by email
// or alias, fall back to the act-as key's creator (the organizer who owns the bot).
// This guarantees the meeting organizer always gets their own access even without a
// calendar email or a saved alias. (Phase 4 will validate the host claim server-side.)
const ACT_AS_HOST_HEADER = 'x-mnema-act-as-host';
// Phase 4: names the live meeting so the asserted identity can be validated against
// Recall's signature-verified roster.
const MEETING_ID_HEADER = 'x-mnema-meeting-id';

// A guest (a meeting attendee with no matching Mnema user) must get NOTHING from
// the knowledge base. Scoping the session to this impossible project makes the RLS
// predicate app_can_see_project() false for every row (it requires project_id to
// equal this id, and nothing — not even unfiled/NULL — matches). Pure deny.
const GUEST_DENY_PROJECT = '00000000-0000-0000-0000-000000000000';

/**
 * Resolve an asserted participant email to a user who is a member of `workspaceId`.
 * Returns null if the email isn't a Mnema user in this workspace (→ treated as a
 * guest). Bounded to the key's workspace so an act-as key can never reach users of
 * another tenant.
 */
async function resolveActAsUser(
  workspaceId: string,
  email: string,
): Promise<string | null> {
  const rows = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, users.id),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .where(eq(users.email, email.trim())) // users.email is citext → case-insensitive
    .limit(1);
  return rows[0]?.userId ?? null;
}

/**
 * Fallback resolution: map a participant's display NAME to a workspace user via a
 * saved alias (participant_aliases). Used for attendees with no resolvable email.
 * Bounded to the key's workspace. Returns null if no alias exists (→ guest).
 */
async function resolveActAsAlias(
  workspaceId: string,
  name: string,
): Promise<string | null> {
  const rows = await db
    .select({ userId: participantAliases.userId })
    .from(participantAliases)
    .where(
      and(
        eq(participantAliases.workspaceId, workspaceId),
        eq(participantAliases.displayName, name.trim()), // citext → case-insensitive
      ),
    )
    .limit(1);
  return rows[0]?.userId ?? null;
}

/**
 * Phase 4 anti-impersonation: confirm an act-as resolution is backed by Recall's
 * signature-verified roster for the named meeting. Fail-safe, not fail-closed:
 *   • host fallback (the key's own creator) → always trusted (their key, their access);
 *   • no verified roster captured at all     → allow (nothing to validate against);
 *   • a verified roster DOES exist           → the email/name identity must be in it.
 * Unknown meeting → false. Bounded to the key's workspace so a meeting id from another
 * tenant can't be replayed.
 */
async function validateAgainstRoster(
  workspaceId: string,
  recallBotId: string | undefined,
  resolvedUserId: string,
  viaHost: boolean,
): Promise<boolean> {
  if (!recallBotId) return false;
  const meeting = await db.query.meetings.findFirst({
    where: and(eq(meetings.recallBotId, recallBotId), eq(meetings.workspaceId, workspaceId)),
  });
  if (!meeting) return false;

  // The act-as key's own creator (resolved via the host fallback) is inherently trusted
  // — it's their key and their own access. Never lock the organizer out of their own bot
  // over roster capture, which is best-effort and often empty.
  if (viaHost) return true;

  // Anti-impersonation only has meaning when Recall actually gave us a verified roster.
  // If there are NO verified participants for this meeting (Recall provided none — the
  // common case for ad-hoc /join bots), there is nothing to validate against, so degrade
  // to allow rather than denying the speaker all knowledge.
  const anyVerified = await db
    .select({ id: meetingParticipants.id })
    .from(meetingParticipants)
    .where(and(eq(meetingParticipants.meetingId, meeting.id), eq(meetingParticipants.verified, true)))
    .limit(1);
  if (anyVerified.length === 0) return true;

  // A verified roster exists → require the resolved identity to be one of its members.
  const match = await db
    .select({ id: meetingParticipants.id })
    .from(meetingParticipants)
    .where(
      and(
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.verified, true),
        eq(meetingParticipants.resolvedUserId, resolvedUserId),
      ),
    )
    .limit(1);
  return match.length > 0;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Marker for routes that belong to the MCP plugin. The app's auth
     * preHandler reads this and bails out — MCP auth is enforced inside
     * this plugin, not by the cookie/JWT middleware that fronts /api/*.
     */
    mcpRoute?: boolean;
  }
}

/**
 * Build a JSON-RPC-shaped 401 response with an RFC 9728 WWW-Authenticate
 * challenge pointing at our protected-resource metadata document. Per the
 * MCP spec, errors on the `/mcp` endpoint should be JSON-RPC error envelopes
 * (not Fastify's default `{error, reason}` shape) so MCP clients can parse
 * them with the same code path that handles `tools/call` errors.
 */
function send401(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .header(
      'WWW-Authenticate',
      `Bearer realm="${mcpConfig.serverName}", error="invalid_token", resource_metadata="${mcpConfig.protectedResourceMetadataUrl}"`,
    )
    .send({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized',
        data: { protected_resource: mcpConfig.protectedResourceMetadataUrl },
      },
      id: null,
    });
}

import type { FastifyRequest } from 'fastify';

/**
 * CORS headers added to every MCP response so remote clients
 * (Claude web/desktop, ChatGPT Business, OpenAI API, Codex) can reach the endpoint.
 *
 * Reflect the request Origin rather than '*': the global @fastify/cors sets
 * Access-Control-Allow-Credentials: true, and a browser will REJECT a credentialed
 * response whose Allow-Origin is '*' (surfacing as net::ERR_FAILED). Every request
 * is still independently authenticated via Bearer token; CORS only governs whether
 * the browser hands the response back to the client.
 */
function addMcpCorsHeaders(req: FastifyRequest, reply: FastifyReply): void {
  reply
    .header('Access-Control-Allow-Origin', req.headers.origin ?? '*')
    .header('Vary', 'Origin')
    .header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
}

/**
 * Shared handler for both POST /mcp and POST /mcp/http.
 *
 * /mcp  — legacy path, kept for Claude Desktop, Cursor, Cline, mcp-remote
 * /mcp/http — standard Streamable HTTP path required by ChatGPT Business,
 *             Codex, and any client following the 2025-11-05 MCP spec
 */
async function handleMcpRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // CORS — applied to all MCP responses so remote clients can reach us.
  addMcpCorsHeaders(req, reply);

  // 1. Origin allowlist (browser CSRF defense). Non-browser clients
  //    (curl, claude.ai's connector backend, ChatGPT) typically omit Origin —
  //    we only enforce the check when the header is present.
  const origin = req.headers.origin;
  if (origin && !mcpConfig.originAllowlist.includes(origin)) {
    req.log.warn({ origin }, 'mcp: rejecting disallowed Origin');
    return reply.code(403).send({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Origin not allowed' },
      id: null,
    });
  }

  // 2. Bearer validation — supports both OAuth RS256 (Phase A) and
  //    legacy HS256 app JWTs (Claude Desktop via mcp-remote).
  await requireOAuthBearer(req, reply);
  if (reply.sent) return; // 401 already sent by requireOAuthBearer

  const oauthCtx = req.oauth!;

  // 3. Subscription gate — blocks halted/cancelled/paused workspaces.
  //    Free-plan workspaces (no subscription row) are allowed through.
  const gate = await checkSubscriptionGate(oauthCtx.workspaceId);
  if (!gate.allowed) {
    return reply.code(402).send({
      jsonrpc: '2.0',
      error: {
        code: -32004,
        message: gate.message,
        data: {
          subscription_status: gate.status,
          billing_url: `${process.env.WEB_BASE_URL ?? 'https://mnema.example.com'}/app/settings/billing`,
        },
      },
      id: null,
    });
  }

  // 3b. Suspension gate (M3 fix) — the REST auth plugin bails before its suspend
  //     check for mcpRoute, so MCP/api-key traffic must re-check here. Otherwise a
  //     suspended workspace's bot/agent keys keep full tool access.
  if (await isWorkspaceSuspended(oauthCtx.workspaceId)) {
    return reply.code(403).send({
      jsonrpc: '2.0',
      error: { code: -32004, message: 'Workspace is suspended. MCP access is disabled.' },
      id: null,
    });
  }

  // 4. Record last-used for legacy mcp_tokens (fire-and-forget).
  if (oauthCtx.tokenType === 'legacy' && oauthCtx.jti) {
    db.update(mcpTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(mcpTokens.jti, oauthCtx.jti))
      .execute()
      .catch(() => { /* non-critical */ });
  }

  // 5. Build per-request auth context for tool handlers.
  // Phase 1 AgentLens: fetch workspace mode so dev tools can be conditionally
  // registered. Fire-and-forget approach: fetch with a short-circuit default.
  let workspaceMode: string | undefined;
  try {
    const wsRows = await db
      .select({ mode: workspaces.mode })
      .from(workspaces)
      .where(eq(workspaces.id, oauthCtx.workspaceId))
      .limit(1);
    workspaceMode = wsRows[0]?.mode;
  } catch {
    // Non-critical — dev tools will just not be registered
    workspaceMode = undefined;
  }

  // Meeting identity (Phase 1): resolve the effective principal for THIS request.
  // For an act-as key, the asking participant is named in the X-Mnema-Act-As-Email
  // header; we resolve it to a workspace user and answer as THEM. No header or an
  // unrecognized email → guest → denied all knowledge (scoped to an impossible
  // project). For every other token, the principal is just the token's own user.
  let effectiveUserId: string | null = oauthCtx.userId;
  let effectiveProjectScope: string | null = oauthCtx.projectId;

  if (oauthCtx.actAsUser) {
    const hdr = (name: string): string | undefined => {
      const raw = req.headers[name];
      return Array.isArray(raw) ? raw[0] : raw;
    };
    const assertedEmail = hdr(ACT_AS_EMAIL_HEADER);
    const assertedName = hdr(ACT_AS_NAME_HEADER);
    const isHost = hdr(ACT_AS_HOST_HEADER) === 'true';

    // Resolution order: email (calendar match) → saved name alias → host falls back
    // to the key's organizer → guest.
    let resolved = assertedEmail
      ? await resolveActAsUser(oauthCtx.workspaceId, assertedEmail)
      : null;
    let resolvedViaHost = false;
    if (!resolved && assertedName) {
      resolved = await resolveActAsAlias(oauthCtx.workspaceId, assertedName);
    }
    if (!resolved && isHost) {
      resolved = oauthCtx.userId; // the act-as key's creator = the organizer
      resolvedViaHost = true;
    }

    // Phase 4: when a workspace verification secret is configured, the asserted
    // identity must be backed by Recall's tamper-proof roster for the named meeting.
    // A leaked key can no longer claim to be someone Recall didn't confirm is present.
    if (resolved && config.RECALL_WEBHOOK_SECRET) {
      const meetingId = hdr(MEETING_ID_HEADER);
      const ok = await validateAgainstRoster(
        oauthCtx.workspaceId, meetingId, resolved, resolvedViaHost,
      );
      if (!ok) {
        req.log.info({ meetingId: meetingId ?? null }, 'mcp: act-as failed roster validation → guest deny');
        resolved = null;
      }
    }

    if (resolved) {
      // Answer as the identified participant — their per-user RLS access applies.
      effectiveUserId = resolved;
      effectiveProjectScope = null;
    } else {
      // Guest / unidentified speaker → no knowledge at all.
      effectiveUserId = null;
      effectiveProjectScope = GUEST_DENY_PROJECT;
      req.log.info(
        { assertedEmail: assertedEmail ?? null, assertedName: assertedName ?? null },
        'mcp: act-as principal unresolved → guest deny',
      );
    }
  }

  const authCtx = {
    user_id: effectiveUserId ?? oauthCtx.userId,
    tenant_id: oauthCtx.workspaceId,
    email: '',  // not available on OAuth tokens; tools don't use it
    scopes: oauthCtx.scope,
    jwt_id: oauthCtx.jti,
    workspaceMode,
    project_id: effectiveProjectScope,
  };

  // 6. Build per-request server with the verified context captured in
  //    its handler closures. This is the only safe place to bind ctx.
  const server = createMcpServer(authCtx);

  // Set the request-scoped tenant scope ONCE here so every withTenant() inside any
  // tool handler inherits the project-aware RLS predicate without touching the 29
  // call sites.
  //   • userId       (= app.user_id)       → per-user project-membership RLS.
  //   • projectScope (= app.project_scope) → set for a project-scoped key (bot bound
  //                  to one project) OR the guest-deny sentinel; short-circuits the
  //                  predicate, ignoring userId.
  //
  // Safe by construction: unfiled docs (project_id NULL) stay visible to every
  // workspace member, and workspace owners/editors are admins (app_is_workspace_admin)
  // who see all projects. Only docs explicitly FILED into a project are restricted
  // to that project's members.
  try {
    await tenantScopeStore.run(
      { userId: effectiveUserId, projectScope: effectiveProjectScope },
      () => handleStreamableHttp(req, reply, server),
    );
  } catch (err) {
    if (err instanceof McpForbiddenError) {
      if (!reply.sent && !reply.raw.headersSent) {
        reply.code(403).send({
          jsonrpc: '2.0',
          error: {
            code: -32002,
            message: 'Forbidden',
            data: { required_scope: err.requiredScope },
          },
          id: null,
        });
      }
      return;
    }
    req.log.error({ err }, 'mcp: transport error');
    if (!reply.sent && !reply.raw.headersSent) {
      reply.code(500).send({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

export const mcpPlugin: FastifyPluginAsync = fp(async (app) => {
  const routeOpts = { config: { mcpRoute: true } };

  // OPTIONS preflight for both endpoints — needed by ChatGPT browser-side calls.
  app.options('/mcp', routeOpts, async (req, reply) => {
    addMcpCorsHeaders(req, reply);
    reply.code(204).send();
  });
  app.options('/mcp/http', routeOpts, async (req, reply) => {
    addMcpCorsHeaders(req, reply);
    reply.code(204).send();
  });

  // GET /mcp — this server speaks Streamable HTTP over POST only (no server-initiated
  // SSE stream), so GET is Method Not Allowed, not Not Found. Return 405 + Allow so
  // spec clients (and directory probes) fall back to POST cleanly instead of treating
  // the endpoint as missing. CORS headers included so browser clients can read it.
  const methodNotAllowed = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    addMcpCorsHeaders(req, reply);
    reply.header('Allow', 'POST, OPTIONS').code(405).send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method Not Allowed — use POST for MCP requests' },
      id: null,
    });
  };
  app.get('/mcp', routeOpts, methodNotAllowed);
  app.get('/mcp/http', routeOpts, methodNotAllowed);

  // POST /mcp — original endpoint, kept for Claude Desktop, Cursor, mcp-remote.
  app.post('/mcp', routeOpts, handleMcpRequest);

  // POST /mcp/http — Streamable HTTP alias required by ChatGPT Business/Enterprise,
  // OpenAI Codex, and any client following the MCP 2025-11-05 spec that expects
  // a dedicated /mcp/http path distinct from the SSE path.
  app.post('/mcp/http', routeOpts, handleMcpRequest);
});
