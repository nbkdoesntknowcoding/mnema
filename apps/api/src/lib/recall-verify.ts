/**
 * Verify that a webhook / websocket-upgrade request genuinely came from Recall.ai.
 *
 * Recall signs every request (once a workspace verification secret exists) with
 * Svix-style headers: webhook-id, webhook-timestamp, webhook-signature. The
 * signature is HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` keyed by the
 * base64-decoded secret (the part after the `whsec_` prefix), base64-encoded, and
 * may carry multiple space-separated `v1,<sig>` values (during secret rotation).
 *
 * Ported from Recall's official `verifyRequestFromRecall` reference. Returns a
 * boolean (callers 400 on false) instead of throwing.
 */
import crypto from 'crypto';

type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  // Fastify lower-cases header names. Accept the svix-* aliases too.
  const v = headers[name] ?? headers[name.replace('webhook-', 'svix-')];
  return Array.isArray(v) ? v[0] : v;
}

export function verifyRecallRequest(args: {
  secret: string | undefined;
  headers: HeaderBag;
  payload: string | null;
}): boolean {
  const { secret, headers, payload } = args;
  if (!secret || !secret.startsWith('whsec_')) return false;

  const msgId = header(headers, 'webhook-id');
  const msgTimestamp = header(headers, 'webhook-timestamp');
  const msgSignature = header(headers, 'webhook-signature');
  if (!msgId || !msgTimestamp || !msgSignature) return false;

  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const toSign = `${msgId}.${msgTimestamp}.${payload ?? ''}`;
  const expected = crypto.createHmac('sha256', key).update(toSign).digest('base64');
  const expectedBytes = Buffer.from(expected, 'base64');

  for (const versioned of msgSignature.split(' ')) {
    const [version, signature] = versioned.split(',');
    if (version !== 'v1' || !signature) continue;
    const sigBytes = Buffer.from(signature, 'base64');
    if (
      sigBytes.length === expectedBytes.length &&
      crypto.timingSafeEqual(new Uint8Array(expectedBytes), new Uint8Array(sigBytes))
    ) {
      return true;
    }
  }
  return false;
}
