/**
 * Credential usage logging.
 *
 * Records when a developer credential (REST API key or MCP token) is used, so
 * the Access page can surface real recent activity + posture. Two hard rules:
 *
 *  1. It must NEVER break the auth path — every write is fire-and-forget and
 *     swallows its own errors.
 *  2. It must NOT flood the table — a busy key hitting us 60×/minute should
 *     produce one row per minute, not sixty. We dedup on a per-credential,
 *     per-minute Redis flag (SET NX), so the DB write only happens on the first
 *     hit of each minute. If Redis is down, we skip logging rather than write
 *     unbounded rows.
 */

import type { FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { credentialUsage } from '../db/schema.js';
import { redis } from '../plugins/redis.js';

export type CredentialType = 'api_key' | 'mcp_token';

/**
 * Best-effort client IP. We aren't behind a trusted proxy config, so read the
 * first hop of X-Forwarded-For (set by our Caddy ingress) and fall back to the
 * socket IP. Never throws.
 */
export function clientIp(req: FastifyRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const first = raw?.split(',')[0]?.trim();
  return first || req.ip || null;
}

/**
 * Record a credential use, rate-limited to ≤1 row per credential per minute.
 * Fire-and-forget: returns immediately, never blocks the request, never throws.
 */
export function logCredentialUse(args: {
  workspaceId: string;
  credentialType: CredentialType;
  credentialId: string;
  ip?: string | null;
  path?: string | null;
}): void {
  const minute = Math.floor(Date.now() / 60_000);
  const dedupKey = `cu:${args.credentialType}:${args.credentialId}:${minute}`;

  // SET NX EX 90 — only the first caller in this minute-window gets 'OK'; the
  // 90s TTL covers clock skew across minute boundaries. Null ⇒ already logged.
  redis
    .set(dedupKey, '1', 'EX', 90, 'NX')
    .then((claimed) => {
      if (claimed === null) return;
      return db
        .insert(credentialUsage)
        .values({
          workspaceId: args.workspaceId,
          credentialType: args.credentialType,
          credentialId: args.credentialId,
          ip: args.ip ?? null,
          path: args.path ?? null,
        });
    })
    .catch(() => {
      // Usage logging is observability, not correctness — never surface errors.
    });
}
