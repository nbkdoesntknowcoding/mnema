/**
 * POST /auth/local-register — Phase 4 built-in email+password signup (self-host).
 * Creates the account via the API's /api/_internal/password-register (no WorkOS),
 * then seals the session cookie.
 */
import type { APIRoute } from 'astro';
import { setSession } from '../../lib/session.ts';

const API_URL = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

export const POST: APIRoute = async ({ request, cookies }) => {
  let email: string;
  let password: string;
  let displayName: string | null;
  try {
    const body = (await request.json()) as { email?: string; password?: string; display_name?: string };
    email = (body.email ?? '').trim().toLowerCase();
    password = body.password ?? '';
    displayName = (body.display_name ?? '').trim() || null;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!email || !password) return json({ error: 'missing_fields' }, 400);
  if (password.length < 8) return json({ error: 'weak_password' }, 400);

  const internalSecret = (process.env.API_INTERNAL_SECRET ?? import.meta.env.API_INTERNAL_SECRET) as string;
  const resp = await fetch(`${API_URL}/api/_internal/password-register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ internal_secret: internalSecret, email, password, display_name: displayName }),
  });

  if (resp.status === 409) return json({ error: 'account_exists' }, 409);
  if (!resp.ok) {
    console.error('[local-register] password-register failed', resp.status, await resp.text());
    return json({ error: 'signup_failed' }, 500);
  }

  const data = (await resp.json()) as { user_id?: string; tenant_id?: string; jwt?: string };
  if (!data.user_id || !data.tenant_id || !data.jwt) return json({ error: 'signup_failed' }, 500);

  await setSession(cookies, {
    user_id: data.user_id,
    email,
    tenant_id: data.tenant_id,
    workos_user_id: '',
    access_token: '',
    jwt: data.jwt,
  });
  return json({ ok: true }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
