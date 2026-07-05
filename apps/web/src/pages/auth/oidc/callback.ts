/**
 * GET /auth/oidc/callback — Phase 4 OIDC redirect handler. Exchanges the code for
 * tokens over the back-channel (confidential client + client_secret), reads the
 * verified email from userinfo / the id_token, bootstraps the Mnema session via
 * /api/_internal/federated-login, and seals the session cookie.
 *
 * The id_token signature is verified against the IdP JWKS (issuer/audience/expiry
 * enforced) before any claim is trusted; userinfo only supplements the profile.
 */
import type { APIRoute } from 'astro';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { setSession } from '../../../lib/session.ts';

const API_URL = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

export const GET: APIRoute = async ({ url, cookies }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const savedState = cookies.get('oidc_state')?.value;
  if (!code || !state || !savedState || state !== savedState) return redirect('/login?error=oidc_state');
  cookies.delete('oidc_state', { path: '/' });

  const issuer = (process.env.OIDC_ISSUER_URL ?? import.meta.env.OIDC_ISSUER_URL) as string;
  const clientId = (process.env.OIDC_CLIENT_ID ?? import.meta.env.OIDC_CLIENT_ID) as string;
  const clientSecret = (process.env.OIDC_CLIENT_SECRET ?? import.meta.env.OIDC_CLIENT_SECRET) as string;
  const redirectUri = (process.env.OIDC_REDIRECT_URI ?? import.meta.env.OIDC_REDIRECT_URI) as string;

  const discovery = (await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as {
      token_endpoint?: string;
      userinfo_endpoint?: string;
      jwks_uri?: string;
      issuer?: string;
    } | null;
  if (!discovery?.token_endpoint) return redirect('/login?error=oidc_discovery');

  const tokenRes = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenRes.ok) return redirect('/login?error=oidc_token');
  const tokens = (await tokenRes.json()) as { access_token?: string; id_token?: string };

  let email: string | null = null;
  let name: string | null = null;

  // Authoritative identity: verify the id_token signature against the IdP JWKS.
  // jwtVerify also enforces iss (issuer), aud (our client_id), and exp.
  if (tokens.id_token) {
    if (!discovery.jwks_uri || !discovery.issuer) return redirect('/login?error=oidc_discovery');
    try {
      const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: discovery.issuer,
        audience: clientId,
      });
      email = (payload.email as string | undefined) ?? null;
      name = (payload.name as string | undefined) ?? null;
    } catch {
      return redirect('/login?error=oidc_idtoken_invalid');
    }
  }

  // Supplement (or, for the rare IdP that returns no id_token, source) the profile
  // from userinfo — itself fetched over TLS with the access token.
  if ((!email || !name) && discovery.userinfo_endpoint && tokens.access_token) {
    const ui = (await fetch(discovery.userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as { email?: string; name?: string } | null;
    email = email ?? ui?.email ?? null;
    name = name ?? ui?.name ?? null;
  }
  if (!email) return redirect('/login?error=oidc_no_email');

  const resp = await fetch(`${API_URL}/api/_internal/federated-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ internal_secret: (process.env.API_INTERNAL_SECRET ?? import.meta.env.API_INTERNAL_SECRET), email: email.toLowerCase(), display_name: name }),
  });
  if (!resp.ok) return redirect('/login?error=oidc_bootstrap');
  const data = (await resp.json()) as { user_id?: string; tenant_id?: string; jwt?: string };
  if (!data.user_id || !data.tenant_id || !data.jwt) return redirect('/login?error=oidc_bootstrap');

  await setSession(cookies, {
    user_id: data.user_id,
    email: email.toLowerCase(),
    tenant_id: data.tenant_id,
    workos_user_id: '',
    access_token: tokens.access_token ?? '',
    jwt: data.jwt,
  });

  // MCP OAuth bridge: if the user started from a Claude/Cursor connect flow,
  // /auth/local stashed the request_id — resume the consent screen with the JWT.
  const oauthRequestId = cookies.get('oauth_request_id')?.value;
  if (oauthRequestId && /^[0-9a-f-]{36}$/.test(oauthRequestId)) {
    cookies.delete('oauth_request_id', { path: '/' });
    return redirect(
      `${API_URL}/oauth/resume?request_id=${encodeURIComponent(oauthRequestId)}&proof=${encodeURIComponent(data.jwt)}`,
    );
  }
  return redirect('/app');
};
