import IORedis from 'ioredis';
import { config } from '../../config/env.js';

/**
 * Redis sliding-window rate limiter for `/api/complete`.
 *
 * Two layers, both checked independently:
 *   1. Per-user: 60 requests/min + 1000 requests/day. Catches sustained
 *      abuse without flagging normal burst typing.
 *   2. Per-tenant daily budget: a flat counter tracked per UTC day. One
 *      "unit" ≈ $0.0001 of Gemini Flash-Lite cost; the default 50,000-unit
 *      ceiling = $5/tenant/day.
 *
 * Implementation note — fail-open on Redis hiccups: a transient Redis
 * outage shouldn't make the editor feel broken. We log + allow and let
 * Phase 5 add proper alerting / dead-letter behaviour. The cost ceiling
 * is the actual cost-protection invariant; rate-limit is UX-protection.
 *
 * Sliding-window via sorted set:
 *   ZREMRANGEBYSCORE key 0 (now - windowMs)   — drop expired
 *   ZCARD key                                  — count remaining
 *   ZADD key now `${now}:${random}`            — record this hit
 *
 * The `${now}:${random}` member format avoids ZADD collisions when two
 * requests arrive in the same millisecond (which absolutely happens
 * under fast typing).
 */

const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the most-restrictive window has space. Null when allowed. */
  retryAfterSec: number | null;
  reason?: 'user_per_min' | 'user_per_day' | 'tenant_daily_budget';
}

async function checkSlidingWindow(
  key: string,
  windowSec: number,
  limit: number,
): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - windowSec * 1000;
  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, cutoff);
    pipeline.zcard(key);
    const results = await pipeline.exec();
    if (!results) return true;
    const count = (results[1]?.[1] as number) ?? 0;
    return count < limit;
  } catch {
    // Fail-open on Redis blip.
    return true;
  }
}

async function recordHit(key: string, windowSec: number): Promise<void> {
  const now = Date.now();
  try {
    const pipeline = redis.pipeline();
    pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
    // Generous TTL so the key is GC'd if the user goes quiet.
    pipeline.expire(key, windowSec + 60);
    await pipeline.exec();
  } catch {
    // Fail-silent on record — counter drift on hiccup is acceptable.
  }
}

export async function checkRateLimits(opts: {
  userId: string;
  tenantId: string;
}): Promise<RateLimitResult> {
  const userMinKey = `ratelimit:user:${opts.userId}:min`;
  const userDayKey = `ratelimit:user:${opts.userId}:day`;
  const tenantBudgetKey = `ratelimit:tenant:${opts.tenantId}:budget:${utcDateString()}`;

  const [minOk, dayOk, budgetUnits] = await Promise.all([
    checkSlidingWindow(userMinKey, 60, config.RATE_LIMIT_USER_PER_MIN),
    checkSlidingWindow(userDayKey, 86400, config.RATE_LIMIT_USER_PER_DAY),
    redis
      .get(tenantBudgetKey)
      .then((v) => Number(v ?? '0'))
      .catch(() => 0),
  ]);

  if (!minOk) {
    return { allowed: false, retryAfterSec: 60, reason: 'user_per_min' };
  }
  if (!dayOk) {
    return {
      allowed: false,
      retryAfterSec: secondsUntilUtcMidnight(),
      reason: 'user_per_day',
    };
  }
  if (budgetUnits >= config.RATE_LIMIT_TENANT_DAILY_UNITS) {
    return {
      allowed: false,
      retryAfterSec: secondsUntilUtcMidnight(),
      reason: 'tenant_daily_budget',
    };
  }

  return { allowed: true, retryAfterSec: null };
}

export async function recordRequest(opts: {
  userId: string;
  tenantId: string;
}): Promise<void> {
  const userMinKey = `ratelimit:user:${opts.userId}:min`;
  const userDayKey = `ratelimit:user:${opts.userId}:day`;
  const tenantBudgetKey = `ratelimit:tenant:${opts.tenantId}:budget:${utcDateString()}`;

  // Coarse cost-tracking: increment by 1 per request. Phase 5 may refine
  // to per-completion token-cost reads from the SDK response.
  await Promise.all([
    recordHit(userMinKey, 60),
    recordHit(userDayKey, 86400),
    redis
      .incr(tenantBudgetKey)
      // Guard against orphan keys — TTL slightly past day-end so the
      // counter survives short clock skew but is GC'd within a couple hours.
      .then(() => redis.expire(tenantBudgetKey, 86400 + 3600))
      .catch(() => undefined),
  ]);
}

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return Math.max(1, Math.floor((midnight.getTime() - now.getTime()) / 1000));
}
