/**
 * Subscription gating middleware.
 *
 * `requireActiveSubscription` prevents access to paid features when a
 * workspace has a halted or cancelled subscription. Free workspaces (no
 * subscription row) are allowed through — their access is capped by rate
 * limits defined in the pricing tier, not by this gate.
 *
 * Only halted (payment failed) / cancelled / paused subscriptions are
 * blocked. A null status means no subscription has ever been created,
 * which is the normal state for a free-plan workspace.
 *
 * Usage (REST routes):
 *   import { requireActiveSubscription } from '../plugins/subscription.js';
 *   const gate = await requireActiveSubscription(req, reply);
 *   if (gate) return; // 402 already sent
 *
 * Usage (MCP plugin / workspaceId-only check):
 *   import { checkSubscriptionGate } from '../plugins/subscription.js';
 *   const result = await checkSubscriptionGate(workspaceId);
 *   if (!result.allowed) { ... send 402 ... }
 */

import { desc, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { subscriptions } from '../db/schema.js';

/** Statuses that mean a once-paid subscription is now in a bad state. */
const BLOCKING_STATUSES = new Set(['halted', 'cancelled', 'paused']);

/** Statuses that represent an active paid subscription. */
export const ACTIVE_STATUSES = new Set(['active', 'trialing', 'created']);

type GateResult =
  | { allowed: true }
  | { allowed: false; status: string | null; message: string };

/**
 * Core gate logic. Queries the most-recent subscription row for the workspace:
 * - No row (free plan): allowed.
 * - Active row: allowed.
 * - Halted / cancelled / paused row: blocked with a descriptive message.
 */
export async function checkSubscriptionGate(workspaceId: string): Promise<GateResult> {
  const rows = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  const status = rows[0]?.status ?? null;

  // Free plan (no subscription row) or an active subscription: allow.
  if (!status || ACTIVE_STATUSES.has(status)) return { allowed: true };

  // Explicit bad state: block.
  const message =
    status === 'halted'
      ? 'Payment failed — please update your payment method to continue.'
      : status === 'paused'
        ? 'Your subscription is paused. Re-activate it from the billing page.'
        : 'Your subscription has ended. Please re-subscribe to continue.';

  return { allowed: false, status, message };
}

/**
 * Fastify request-level guard for `/api/*` routes.
 * Returns true if a 402 was sent (caller should `return`), false if allowed.
 */
export async function requireActiveSubscription(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (!req.auth) {
    reply.code(401).send({ error: 'unauthorized' });
    return true;
  }

  const result = await checkSubscriptionGate(req.auth.tenant_id);
  if (!result.allowed) {
    reply.code(402).send({
      error: 'subscription_required',
      subscription_status: result.status,
      message: result.message,
    });
    return true;
  }

  return false;
}
