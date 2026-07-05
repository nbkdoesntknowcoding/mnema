/**
 * POST /api/auth/join-workspace
 *
 * Server-side replacement for the client-side calls in join-or-create.astro.
 * Previously the page called the backend _internal endpoints directly from the
 * browser, which broke in production due to CORS and because access_token was
 * intentionally omitted from the client-serialised pendingJson.
 *
 * This endpoint runs server-side so it can:
 *   1. Read the sealed boppl_pending_join cookie (which has access_token).
 *   2. Call the backend with the API_INTERNAL_SECRET (never exposed to client).
 *   3. Set the full session cookie (including access_token) in one step.
 *
 * Body:
 *   { workspace_id: string }                  → domain join (viewer role)
 *   { workspace_id: string, invite_token: string } → invite accept (invited role)
 */
import type { APIRoute } from 'astro';
import {
  getPendingJoinSession,
  clearPendingJoinSession,
  setSession,
} from '../../../lib/session.ts';

const BACKEND =
  (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

export const POST: APIRoute = async ({ request, cookies }) => {
  // ── Require a valid pending-join session ─────────────────────────────────
  const pending = await getPendingJoinSession(cookies);
  if (!pending) {
    return new Response(JSON.stringify({ error: 'no_pending_session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { workspace_id: string; invite_token?: string };
  try {
    body = (await request.json()) as { workspace_id: string; invite_token?: string };
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: 'missing_workspace_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const internalSecret = (process.env.API_INTERNAL_SECRET ?? import.meta.env.API_INTERNAL_SECRET) as string;

  // ── Dispatch to the appropriate backend internal endpoint ─────────────────
  let upstream: Response;
  if (body.invite_token) {
    // Invited user: accept the invitation with the assigned role
    upstream = await fetch(`${BACKEND}/api/_internal/accept-invite-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        internal_secret: internalSecret,
        user_id: pending.user_id,
        invite_token: body.invite_token,
      }),
    });
  } else {
    // Same-domain user who was NOT invited: this is a REQUEST, not an instant join. The backend
    // creates a pending request and notifies the workspace owners/admins — no membership until
    // one of them approves. (Previously this auto-added them as an editor with no approval.)
    upstream = await fetch(`${BACKEND}/api/_internal/request-join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        internal_secret: internalSecret,
        user_id: pending.user_id,
        workspace_id: body.workspace_id,
      }),
    });
  }

  if (!upstream.ok) {
    const err = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    return new Response(JSON.stringify(err), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = (await upstream.json()) as {
    user_id?: string;
    tenant_id?: string;
    jwt?: string;
    requested?: boolean;
    already_member?: boolean;
  };

  // Pending request created — the user does NOT get a session; they wait for approval.
  if (data.requested) {
    return new Response(JSON.stringify({ requested: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { user_id, tenant_id, jwt } = data as { user_id: string; tenant_id: string; jwt: string };

  // ── Seal the full session (including access_token from the pending cookie) ─
  await setSession(cookies, {
    user_id,
    email: pending.email,
    tenant_id,
    workos_user_id: pending.workos_user_id,
    access_token: pending.access_token,
    jwt,
  });
  clearPendingJoinSession(cookies);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
