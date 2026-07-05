/**
 * Seat sync utility.
 *
 * Called after any workspace membership change that could affect the
 * billable seat count (member added, removed, role changed).
 *
 * If the workspace has an active Razorpay subscription, this function
 * recounts billable writers and updates the subscription quantity via
 * the Razorpay API, then stores the new count in our DB.
 *
 * No-op if the workspace is on the free plan (no active subscription).
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { subscriptions } from '../../db/schema.js';
import { countBillableSeats } from './seats.js';

const ACTIVE_STATUSES = ['active', 'trialing', 'created'] as const;

/**
 * Re-count writer seats for the workspace and update the Razorpay
 * subscription quantity if one is active.
 *
 * Safe to call redundantly — it will silently no-op on free workspaces.
 */
export async function syncSubscriptionSeats(workspaceId: string): Promise<void> {
  // Find the most recent active subscription
  const subRows = await db
    .select({
      id: subscriptions.id,
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.workspaceId, workspaceId),
        inArray(subscriptions.status, ACTIVE_STATUSES as unknown as string[]),
      ),
    )
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (subRows.length === 0) return; // free plan — nothing to sync

  const { razorpaySubscriptionId } = subRows[0]!;
  const billableSeats = await countBillableSeats(workspaceId);

  // Update quantity on Razorpay subscription
  const { razorpay } = await import('../razorpay/client.js');
  await (razorpay.subscriptions.update(
    razorpaySubscriptionId,
    { quantity: billableSeats } as Parameters<typeof razorpay.subscriptions.update>[1],
  ) as Promise<unknown>);

  // Persist updated seat count locally
  await db
    .update(subscriptions)
    .set({ billableSeats, quantity: billableSeats, updatedAt: new Date() })
    .where(eq(subscriptions.razorpaySubscriptionId, razorpaySubscriptionId));
}
