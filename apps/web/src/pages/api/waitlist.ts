/**
 * POST /api/waitlist
 *
 * Server-side proxy for the public waitlist form. Runs on the web server so the
 * internal_secret (API_INTERNAL_SECRET) is never exposed to the browser and
 * there's no cross-origin call from the client. Mirrors api/auth/join-workspace.ts.
 *
 * Body: { email: string, name?: string, company?: string }
 * Forwards to the API's /api/_internal/waitlist with the internal secret.
 */
import type { APIRoute } from 'astro';

const BACKEND =
  (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  let body: { email?: string; name?: string; company?: string };
  try {
    body = (await request.json()) as { email?: string; name?: string; company?: string };
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json({ error: 'invalid_email' }, 400);
  }

  const internalSecret = (process.env.API_INTERNAL_SECRET ?? import.meta.env.API_INTERNAL_SECRET) as string;

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/api/_internal/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        internal_secret: internalSecret,
        email,
        name: (body.name ?? '').trim() || null,
        company: (body.company ?? '').trim() || null,
        source: 'landing',
      }),
    });
  } catch (err) {
    console.error('waitlist proxy: upstream fetch failed', err);
    return json({ error: 'upstream_unreachable' }, 502);
  }

  if (!upstream.ok) {
    const detail = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    console.error('waitlist proxy: upstream error', upstream.status, detail);
    return json({ error: 'upstream_error' }, 502);
  }

  const data = (await upstream.json()) as { ok: boolean; already: boolean };
  return json({ ok: true, already: Boolean(data.already) }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
