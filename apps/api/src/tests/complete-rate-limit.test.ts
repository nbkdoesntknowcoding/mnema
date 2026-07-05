import IORedis from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config/env.js';
import { checkRateLimits, recordRequest } from '../routes/complete/rate-limit.js';

/**
 * Sliding-window rate-limit correctness for /api/complete.
 *
 * Tests run against the real local Redis. We use unique key prefixes
 * (`rate-test-*`) so we can purge them deterministically before each test
 * without touching production-shaped keys.
 *
 * NOTE: the per-day window holds 1000 by default — we don't try to fill
 * it. The minute window's 60-cap is the one that's cheap to exhaust and
 * still proves the sliding-window logic.
 */

const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

beforeEach(async () => {
  // Sweep our test keys. SCAN is cheaper than KEYS at scale; for the
  // tiny test surface here KEYS is fine and clearer.
  const userKeys = await redis.keys('ratelimit:user:rate-test-*');
  if (userKeys.length > 0) await redis.del(userKeys);
  const tenantKeys = await redis.keys('ratelimit:tenant:rate-test-*');
  if (tenantKeys.length > 0) await redis.del(tenantKeys);
});

afterAll(async () => {
  await redis.quit();
});

describe('rate limit', () => {
  it('allows requests under the minute window', async () => {
    const userId = `rate-test-user-min-${Date.now()}`;
    const tenantId = `rate-test-tenant-min-${Date.now()}`;
    for (let i = 0; i < 5; i += 1) {
      const r = await checkRateLimits({ userId, tenantId });
      expect(r.allowed).toBe(true);
      await recordRequest({ userId, tenantId });
    }
  });

  it('rejects after the minute window is full', async () => {
    const userId = `rate-test-user-burst-${Date.now()}`;
    const tenantId = `rate-test-tenant-burst-${Date.now()}`;
    // Fill exactly to the cap. The check is `< limit` so the limit-th
    // request is still allowed; the (limit + 1)-th must be rejected.
    for (let i = 0; i < config.RATE_LIMIT_USER_PER_MIN; i += 1) {
      const r = await checkRateLimits({ userId, tenantId });
      expect(r.allowed).toBe(true);
      await recordRequest({ userId, tenantId });
    }
    const overLimit = await checkRateLimits({ userId, tenantId });
    expect(overLimit.allowed).toBe(false);
    expect(overLimit.reason).toBe('user_per_min');
    expect(overLimit.retryAfterSec).toBeGreaterThan(0);
  });

  it('rejects when tenant daily budget exceeded', async () => {
    const userId = `rate-test-budget-user-${Date.now()}`;
    const tenantId = `rate-test-budget-tenant-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);
    // Pre-seed the budget counter at the cap. The next checkRateLimits
    // must reject with reason='tenant_daily_budget' regardless of the
    // user-level windows being empty.
    await redis.set(
      `ratelimit:tenant:${tenantId}:budget:${today}`,
      String(config.RATE_LIMIT_TENANT_DAILY_UNITS),
    );
    const r = await checkRateLimits({ userId, tenantId });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('tenant_daily_budget');
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });
});
