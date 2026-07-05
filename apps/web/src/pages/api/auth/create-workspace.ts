/**
 * POST /api/auth/create-workspace
 *
 * Server-side endpoint for the "Create a new workspace" button on the
 * join-or-create page. Previously this called /api/_internal/set-session
 * directly from the browser with the internal secret exposed in the
 * page source — a CORS error in production and a secrets-in-client risk.
 *
 * This endpoint runs server-side so the internal secret stays on the server,
 * and access_token is read from the sealed boppl_pending_join cookie.
 */
import type { APIRoute } from 'astro';
import {
  getPendingJoinSession,
  clearPendingJoinSession,
  setSession,
} from '../../../lib/session.ts';

const BACKEND =
  (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

export const POST: APIRoute = async ({ cookies }) => {
  const pending = await getPendingJoinSession(cookies);
  if (!pending) {
    return new Response(JSON.stringify({ error: 'no_pending_session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const internalSecret = (process.env.API_INTERNAL_SECRET ?? import.meta.env.API_INTERNAL_SECRET) as string;

  const upstream = await fetch(`${BACKEND}/api/_internal/set-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      internal_secret: internalSecret,
      email: pending.email,
      display_name: pending.display_name,
      workos_user_id: pending.workos_user_id,
      force_new_workspace: true,
    }),
  });

  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: 'create_failed' }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { user_id, tenant_id, jwt } = (await upstream.json()) as {
    user_id: string;
    tenant_id: string;
    jwt: string;
  };

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
