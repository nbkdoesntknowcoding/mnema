/**
 * POST /auth/verify-magic
 *
 * Accepts { email, code } from the verify-code page, calls WorkOS
 * authenticateWithMagicAuth, then bootstraps a Mnema session via
 * the internal set-session endpoint and sets session cookies.
 */
import type { APIRoute } from 'astro';
import { workos } from '../../lib/workos.ts';
import { setSession } from '../../lib/session.ts';
import { enforceRateLimit } from '../../lib/rate-limit.ts';

const API_URL = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

export const POST: APIRoute = async ({ request, cookies }) => {
  // Rate limit: 10 requests per 15 minutes per IP
  const rateLimitResponse = await enforceRateLimit(request, 'verify-otp', 10, 900);
  if (rateLimitResponse) return rateLimitResponse;

  let email: string;
  let code: string;
  try {
    const body = await request.json() as { email?: string; code?: string };
    email = (body.email ?? '').trim().toLowerCase();
    code  = (body.code ?? '').trim();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  if (!email || !code) {
    return json({ error: 'missing_fields' }, 400);
  }

  // Exchange OTP code for WorkOS tokens
  let workosResult;
  try {
    workosResult = await workos.userManagement.authenticateWithMagicAuth({
      code,
      email,
      clientId: (process.env.WORKOS_CLIENT_ID ?? import.meta.env.WORKOS_CLIENT_ID) as string,
    });
  } catch (err) {
    console.error('[verify-magic] WorkOS error:', err);
    // WorkOS returns an error when the code is wrong/expired
    return json({ error: 'invalid_code' }, 401);
  }

  const { user, accessToken } = workosResult;
  const displayName = user.firstName
    ? `${user.firstName} ${user.lastName ?? ''}`.trim()
    : null;

  const internalSecret = (process.env.API_INTERNAL_SECRET ?? import.meta.env.API_INTERNAL_SECRET) as string;

  // Bootstrap Mnema session (creates user if first login)
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
    const text = await resp.text();
    console.error('[verify-magic] set-session failed', resp.status, text);
    const isNoAccount = text.includes('account_not_found');
    return json({ error: isNoAccount ? 'no_account' : 'bootstrap_failed' }, 500);
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
  const oauthRequestId = cookies.get('oauth_request_id')?.value;
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
