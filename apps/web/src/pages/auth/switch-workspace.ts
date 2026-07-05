import type { APIRoute } from 'astro';
import { getSession, setSession } from '../../lib/session.ts';

/**
 * Web-side wrapper for /api/auth/switch-workspace.
 *
 * The API endpoint sets the boppl_jwt cookie, but the canonical tenant_id
 * that drives server-side rendering lives in the sealed boppl_session
 * cookie (read by middleware.ts on every /app request). Hitting the API
 * directly leaves the sealed session pointing at the old workspace, so
 * after a reload the user sees their previous tenant's content.
 *
 * This endpoint forwards the request, then re-seals the session with the
 * new tenant_id and JWT before the browser reloads.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSession(cookies);
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.text();

  const apiUrl =
    (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';
  const apiRes = await fetch(`${apiUrl}/api/auth/switch-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `boppl_jwt=${session.jwt}`,
    },
    body,
  });

  const text = await apiRes.text();
  if (!apiRes.ok) {
    return new Response(text, {
      status: apiRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = JSON.parse(text) as {
    workspace: { id: string; slug: string; name: string };
    jwt: string;
  };

  // Re-seal the session with the new tenant + JWT. Keep the rest
  // (user_id, email, workos_user_id, access_token) intact — those don't
  // change on a workspace switch.
  await setSession(cookies, {
    ...session,
    tenant_id: result.workspace.id,
    jwt: result.jwt,
  });

  return new Response(JSON.stringify({ workspace: result.workspace }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
