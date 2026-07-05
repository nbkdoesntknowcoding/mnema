/**
 * POST /api/auth/seal-session
 *
 * Client-side counterpart to the server-side session sealing done in
 * callback.astro. Called from the join-or-create page after the user picks
 * a workspace: takes the resolved { user_id, tenant_id, jwt, … } and writes
 * the signed iron-session cookie so subsequent SSR pages see the full session.
 *
 * Also clears the temporary boppl_pending_join cookie.
 */
import type { APIRoute } from 'astro';
import { setSession, clearPendingJoinSession } from '../../../lib/session.ts';

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 });
  }

  const { user_id, email, tenant_id, workos_user_id, access_token, jwt } = body;
  if (
    typeof user_id !== 'string' ||
    typeof email !== 'string' ||
    typeof tenant_id !== 'string' ||
    typeof workos_user_id !== 'string' ||
    typeof access_token !== 'string' ||
    typeof jwt !== 'string'
  ) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400 });
  }

  await setSession(cookies, { user_id, email, tenant_id, workos_user_id, access_token, jwt });
  clearPendingJoinSession(cookies);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
