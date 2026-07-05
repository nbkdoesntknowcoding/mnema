/**
 * Sliding-window rate limiter for Astro API routes.
 *
 * Same Redis sorted-set approach as apps/api/src/routes/complete/rate-limit.ts.
 * Fail-open on Redis hiccup — auth routes must never be blocked by
 * infrastructure outages.
 *
 * Used by: /auth/send-magic-link, /auth/verify-magic
 */

import IORedis from 'ioredis';

const redisUrl = ((process.env.REDIS_URL ?? import.meta.env.REDIS_URL) as string | undefined) ?? 'redis://localhost:6379';

// Lazily-created singleton so we don't open connections during SSR builds.
let _redis: IORedis | null = null;
function getRedis(): IORedis {
  if (!_redis) {
    _redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  }
  return _redis;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export async function checkRateLimit(
  category: string,
  identifier: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const key = `ratelimit:auth:${category}:${identifier}`;
  const now = Date.now();
  const cutoff = now - windowSec * 1000;

  try {
    const redis = getRedis();
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, cutoff);
    pipeline.zcard(key);
    pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
    pipeline.expire(key, windowSec + 60);

    const results = await pipeline.exec();
    if (!results) return { allowed: true, retryAfterSec: 0 };

    const count = (results[1]?.[1] as number) ?? 0;
    if (count >= max) {
      return { allowed: false, retryAfterSec: windowSec };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch {
    // Fail-open — Redis hiccup should not block auth
    return { allowed: true, retryAfterSec: 0 };
  }
}

/** Returns a 429 Response if rate-limited, null otherwise. */
export async function enforceRateLimit(
  request: Request,
  category: string,
  max: number,
  windowSec: number,
): Promise<Response | null> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';

  const { allowed, retryAfterSec } = await checkRateLimit(category, ip, max, windowSec);

  if (!allowed) {
    const windowMinutes = Math.ceil(windowSec / 60);
    return new Response(
      JSON.stringify({
        error: 'too_many_requests',
        message: `Too many attempts. Try again in ${windowMinutes} minute${windowMinutes === 1 ? '' : 's'}.`,
        retryAfter: retryAfterSec,
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': String(retryAfterSec),
        },
      },
    );
  }

  return null;
}
