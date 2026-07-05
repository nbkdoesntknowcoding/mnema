import type { APIRoute } from 'astro';
import { getSession, setSession } from '../../lib/session.ts';

/**
 * Web-side wrapper for /api/auth/create-workspace. Same rationale as
 * switch-workspace.ts: the API mints a JWT scoped to the new workspace and
 * sets the boppl_jwt cookie, but the sealed boppl_session that drives
 * server-side rendering needs to be re-sealed too.
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
  const apiRes = await fetch(`${apiUrl}/api/auth/create-workspace`, {
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
