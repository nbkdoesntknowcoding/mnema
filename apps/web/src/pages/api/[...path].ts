/**
 * API proxy — forwards /api/* browser requests to the backend.
 *
 * Why this exists: client-side components (FlowCanvas, DocSidebar, etc.)
 * call relative /api/* URLs. In local dev, Vite proxies them to
 * localhost:8080. On Vercel there is no proxy, so they 404. This catch-all
 * Astro endpoint runs server-side, extracts the JWT from the iron-session
 * cookie, and forwards the request to PUBLIC_API_URL with the correct
 * Authorization header.
 */
import type { APIRoute } from 'astro';
import { getSession } from '../../lib/session.ts';

const BACKEND = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

const handler: APIRoute = async (context) => {
  const { request, params, cookies } = context;
  const session = await getSession(cookies);

  const path = (params.path as string | undefined) ?? '';
  const url = new URL(request.url);

  // Reconstruct target: backend + /api/ + path + query string
  const target = `${BACKEND}/api/${path}${url.search}`;

  const forwardHeaders: Record<string, string> = {};

  // Forward content-type for mutation requests
  const ct = request.headers.get('content-type');
  if (ct) forwardHeaders['content-type'] = ct;

  // Inject JWT as Bearer token
  if (session?.jwt) {
    forwardHeaders['authorization'] = `Bearer ${session.jwt}`;
  }

  const isBodyMethod = !['GET', 'HEAD'].includes(request.method.toUpperCase());

  const init: RequestInit = {
    method: request.method,
    headers: forwardHeaders,
  };

  if (isBodyMethod) {
    // Multipart/form-data is binary — must use arrayBuffer, not text().
    // For JSON/text payloads text() works fine too, but arrayBuffer is safe
    // for all content types and avoids corrupting binary uploads.
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Backend unreachable: ${msg}`, target }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  // Forward upstream response verbatim
  const responseHeaders: Record<string, string> = {};
  const upstreamCT = upstream.headers.get('content-type') ?? '';
  if (upstreamCT) responseHeaders['content-type'] = upstreamCT;

  // SSE / streaming: pipe body directly — never buffer an infinite stream
  if (upstreamCT.includes('text/event-stream') || upstreamCT.includes('stream')) {
    responseHeaders['cache-control'] = 'no-cache';
    responseHeaders['x-accel-buffering'] = 'no';
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  }

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: upstream.status,
    headers: responseHeaders,
  });
};

// Extend Vercel function timeout to 60s — billing routes make multiple
// Razorpay API calls which can take 5-15s combined, easily hitting the
// default 10s limit and returning an HTML 504 that breaks res.json().
export const maxDuration = 60;

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
