/**
 * SSE proxy — streams /api/notifications/stream from the backend.
 *
 * The catch-all proxy at /api/[...path].ts uses arrayBuffer() which hangs
 * on infinite streams. This dedicated endpoint pipes the body directly so
 * EventSource clients get a proper streaming connection.
 *
 * Vercel functions time out after maxDuration seconds. The EventSource client
 * auto-reconnects when the connection closes, so this is acceptable.
 */
import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/session.ts';

const BACKEND = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await getSession(cookies);

  const target = `${BACKEND}/api/notifications/stream${url.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: {
        ...(session?.jwt ? { authorization: `Bearer ${session.jwt}` } : {}),
        accept: 'text/event-stream',
        'cache-control': 'no-cache',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      `data: ${JSON.stringify({ error: `Backend unreachable: ${msg}` })}\n\n`,
      { status: 502, headers: { 'content-type': 'text/event-stream' } },
    );
  }

  if (!upstream.body) {
    return new Response('data: {"error":"no body"}\n\n', {
      status: 502,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  // Pipe stream directly — never buffer
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
};

// 60s per invocation — EventSource auto-reconnects when connection closes
export const maxDuration = 60;
