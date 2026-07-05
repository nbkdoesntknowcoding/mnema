/**
 * POST /auth/send-magic-link
 *
 * Calls WorkOS userManagement.sendMagicAuthCode to send a 6-digit OTP to
 * the user's email. The user then enters it on /auth/verify-code.
 */
import type { APIRoute } from 'astro';
import { workos } from '../../lib/workos.ts';
import { enforceRateLimit } from '../../lib/rate-limit.ts';

export const POST: APIRoute = async ({ request }) => {
  // Rate limit: 5 requests per 15 minutes per IP
  const rateLimitResponse = await enforceRateLimit(request, 'magic-link', 5, 900);
  if (rateLimitResponse) return rateLimitResponse;

  let email: string;
  try {
    const body = await request.json() as { email?: string };
    email = (body.email ?? '').trim().toLowerCase();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'invalid_email' }, 400);
  }

  try {
    await workos.userManagement.sendMagicAuthCode({ email });
    return json({ ok: true }, 200);
  } catch (err) {
    console.error('[send-magic-link] WorkOS error:', err);
    return json({ error: 'send_failed' }, 500);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
