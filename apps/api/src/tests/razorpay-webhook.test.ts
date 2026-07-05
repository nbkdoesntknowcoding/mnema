import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  computeEventId,
  handleSubscriptionActivated,
  handleSubscriptionCancelled,
  handleSubscriptionHalted,
  handleSubscriptionPaused,
  type RazorpayWebhookEvent,
} from '../lib/razorpay/webhook-handlers.js';

// Mock DB and plan-state so unit tests don't need a live database
vi.mock('../db/index.js', () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() } }));
vi.mock('../lib/razorpay/plan-state.js', () => ({ planKeyFromRazorpayPlanId: vi.fn() }));

function makeEvent(
  eventName: string,
  sub: Partial<RazorpayWebhookEvent['payload']['subscription']['entity']> = {},
): RazorpayWebhookEvent {
  return {
    entity: 'event',
    account_id: 'acc_test',
    event: eventName,
    contains: ['subscription'],
    payload: {
      subscription: {
        entity: {
          id: 'sub_test123',
          status: eventName.split('.')[1] ?? 'active',
          plan_id: 'plan_test456',
          customer_id: 'cust_test789',
          quantity: 1,
          current_start: 1700000000,
          current_end: 1702592000,
          ...sub,
        },
      },
    },
    created_at: 1700000001,
  };
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('computeEventId', () => {
  it('produces a stable deterministic ID from event name + sub id + created_at', () => {
    const event = makeEvent('subscription.activated');
    const id1 = computeEventId(event);
    const id2 = computeEventId(event);
    expect(id1).toBe(id2);
    expect(id1).toBe('subscription.activated:sub_test123:1700000001');
  });

  it('differs when event name differs', () => {
    const a = computeEventId(makeEvent('subscription.activated'));
    const b = computeEventId(makeEvent('subscription.halted'));
    expect(a).not.toBe(b);
  });
});

describe('HMAC signature helper', () => {
  it('produces a valid hex digest for known input', () => {
    const body = JSON.stringify({ test: true });
    const secret = 'test_webhook_secret';
    const sig = signPayload(body, secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('handleSubscriptionActivated', () => {
  it('warns and returns without throwing when plan_id is not mapped', async () => {
    const { planKeyFromRazorpayPlanId } = await import('../lib/razorpay/plan-state.js');
    vi.mocked(planKeyFromRazorpayPlanId).mockResolvedValueOnce(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(handleSubscriptionActivated(makeEvent('subscription.activated'))).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[razorpay-webhook] plan_id not mapped to a plan key',
      expect.objectContaining({ plan_id: 'plan_test456' }),
    );
    warnSpy.mockRestore();
  });
});

describe('handleSubscriptionHalted', () => {
  it('resolves without throwing when workspace not found for subscription', async () => {
    const { db } = await import('../db/index.js');
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    await expect(handleSubscriptionHalted(makeEvent('subscription.halted'))).resolves.toBeUndefined();
  });
});

describe('handleSubscriptionCancelled', () => {
  it('resolves without throwing when workspace not found for subscription', async () => {
    const { db } = await import('../db/index.js');
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    await expect(handleSubscriptionCancelled(makeEvent('subscription.cancelled'))).resolves.toBeUndefined();
  });
});

describe('handleSubscriptionPaused', () => {
  it('resolves without throwing when workspace not found for subscription', async () => {
    const { db } = await import('../db/index.js');
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    await expect(handleSubscriptionPaused(makeEvent('subscription.paused'))).resolves.toBeUndefined();
  });
});
