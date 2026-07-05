/**
 * Auth-specific rate limiter using the existing Redis connection.
 *
 * Uses a sliding-window sorted-set approach, identical to the completions
 * rate limiter in routes/complete/rate-limit.ts. Fail-open on Redis hiccup —
 * a transient Redis outage should not block users from signing in.
 *
 * Key format: `ratelimit:auth:{category}:{identifier}`
 * Category examples: 'magic-link', 'verify-otp', 'create-workspace', 'invite'
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from '../plugins/redis.js';

export interface AuthRateLimitConfig {
  /** Discriminates the counter bucket (e.g. 'magic-link', 'create-workspace') */
  category: string;
  /** IP address or user ID */
  identifier: string;
  /** Maximum requests in the window */
  max: number;
  /** Window duration in seconds */
  windowSec: number;
}

/** Returns true if the request should be allowed, false if rate-limited. */
async function checkAndRecord(cfg: AuthRateLimitConfig): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const key = `ratelimit:auth:${cfg.category}:${cfg.identifier}`;
  const now = Date.now();
  const cutoff = now - cfg.windowSec * 1000;

  try {
    const pipeline = redis.pipeline();
    // Drop expired entries
    pipeline.zremrangebyscore(key, 0, cutoff);
    // Count remaining
    pipeline.zcard(key);
    // Record this request
    pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
    // TTL so keys GC when user goes quiet
    pipeline.expire(key, cfg.windowSec + 60);

    const results = await pipeline.exec();
    if (!results) return { allowed: true, retryAfterSec: 0 };

    const count = (results[1]?.[1] as number) ?? 0;
    // count is BEFORE we recorded this request, so >= max means over limit
    if (count >= cfg.max) {
      return { allowed: false, retryAfterSec: Math.ceil(cfg.windowSec / 60) * 60 };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch {
    // Fail-open — Redis hiccup should not block auth
    return { allowed: true, retryAfterSec: 0 };
  }
}

/**
 * Express-style preHandler that checks the rate limit and sends 429 if exceeded.
 * Returns true if rate-limited (response already sent), false if allowed.
 */
export async function enforceRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  cfg: Omit<AuthRateLimitConfig, 'identifier'> & { identifier?: string },
): Promise<boolean> {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? 'unknown';
  const identifier = cfg.identifier ?? ip;

  const { allowed, retryAfterSec } = await checkAndRecord({ ...cfg, identifier });

  if (!allowed) {
    const windowMinutes = Math.ceil(cfg.windowSec / 60);
    reply.code(429).send({
      error: 'too_many_requests',
      message: `Too many attempts. Try again in ${windowMinutes} minute${windowMinutes === 1 ? '' : 's'}.`,
      retryAfter: retryAfterSec,
    });
    return true;
  }

  return false;
}
