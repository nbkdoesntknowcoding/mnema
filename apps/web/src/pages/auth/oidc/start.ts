/**
 * GET /auth/oidc/start — Phase 4 generic OIDC login (company tier). Discovers the
 * issuer's authorization endpoint and redirects the browser to it with a CSRF
 * state cookie. Configure OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_REDIRECT_URI.
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ cookies }) => {
  const issuer = (process.env.OIDC_ISSUER_URL ?? import.meta.env.OIDC_ISSUER_URL) as string | undefined;
  const clientId = (process.env.OIDC_CLIENT_ID ?? import.meta.env.OIDC_CLIENT_ID) as string | undefined;
  const redirectUri = (process.env.OIDC_REDIRECT_URI ?? import.meta.env.OIDC_REDIRECT_URI) as string | undefined;
  if (!issuer || !clientId || !redirectUri) {
    return new Response('OIDC is not configured', { status: 500 });
  }

  const discovery = (await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { authorization_endpoint?: string } | null;
  if (!discovery?.authorization_endpoint) {
    return new Response('OIDC discovery failed', { status: 502 });
  }

  const state = crypto.randomUUID();
  cookies.set('oidc_state', state, { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 600 });

  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);

  return new Response(null, { status: 302, headers: { Location: authUrl.toString() } });
};
