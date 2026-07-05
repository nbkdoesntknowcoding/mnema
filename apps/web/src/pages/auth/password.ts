/**
 * POST /auth/password
 *
 * Accepts { email, password }, calls WorkOS authenticateWithPassword,
 * bootstraps a Mnema session, and sets session cookies.
 */
import type { APIRoute } from 'astro';
import { workos } from '../../lib/workos.ts';
import { setSession } from '../../lib/session.ts';

const API_URL = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

export const POST: APIRoute = async ({ request, cookies }) => {
  const oauthRequestId = cookies.get('oauth_request_id')?.value ?? null;
  let email: string;
  let password: string;
  try {
    const body = await request.json() as { email?: string; password?: string };
    email    = (body.email ?? '').trim().toLowerCase();
    password = body.password ?? '';
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  if (!email || !password) {
    return json({ error: 'missing_fields' }, 400);
  }

  let workosResult;
  try {
    workosResult = await workos.userManagement.authenticateWithPassword({
      email,
      password,
      clientId: (process.env.WORKOS_CLIENT_ID ?? import.meta.env.WORKOS_CLIENT_ID) as string,
    });
  } catch (err: unknown) {
    console.error('[password-auth] WorkOS error:', err);
    // WorkOS marks invalid credentials distinctly — surface the right message
    const msg = err instanceof Error ? err.message : String(err);
    const isInvalid = /invalid_credentials|password_incorrect|wrong password/i.test(msg);
    return json({ error: isInvalid ? 'invalid_credentials' : 'auth_failed' }, isInvalid ? 401 : 500);
  }

  const { user, accessToken } = workosResult;
  const displayName = user.firstName
    ? `${user.firstName} ${user.lastName ?? ''}`.trim()
    : null;

  const internalSecret = (process.env.API_INTERNAL_SECRET ?? import.meta.env.API_INTERNAL_SECRET) as string;

  const resp = await fetch(`${API_URL}/api/_internal/set-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      internal_secret: internalSecret,
      email: user.email,
      display_name: displayName,
      workos_user_id: user.id,
    }),
  });

  if (!resp.ok) {
    console.error('[password-auth] set-session failed', resp.status, await resp.text());
    return json({ error: 'bootstrap_failed' }, 500);
  }

  const { user_id, tenant_id, jwt } = (await resp.json()) as {
    user_id: string;
    tenant_id: string;
    jwt: string;
  };

  await setSession(cookies, {
    user_id,
    email: user.email,
    tenant_id,
    workos_user_id: user.id,
    access_token: accessToken,
    jwt,
  });

  // If the user arrived from an MCP OAuth flow, bridge them back to the
  // API consent screen instead of going to /app.
  if (oauthRequestId) {
    cookies.delete('oauth_request_id', { path: '/' });
    const resumeUrl = `${API_URL}/oauth/resume?request_id=${encodeURIComponent(oauthRequestId)}&proof=${encodeURIComponent(jwt)}`;
    return json({ ok: true, resume_url: resumeUrl }, 200);
  }

  return json({ ok: true }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
