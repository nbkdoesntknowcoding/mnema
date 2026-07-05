import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { subscriptions, users, workspaceMembers, workspaces } from '../../db/schema.js';
import { planKeyFromRazorpayPlanId } from './plan-state.js';
import { planSlugFromPlanId } from './plans.js';
import { emailQueue } from '../../queue/email.js';

/** Look up the workspace owner's email — filtered by role='owner'. */
async function getWorkspaceOwnerEmail(workspaceId: string): Promise<string | null> {
  const rows = await db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.role, 'owner'),
    ))
    .limit(1);
  return rows[0]?.email ?? null;
}

export interface RazorpaySubscriptionEntity {
  id: string;
  status: string;
  plan_id: string;
  customer_id: string;
  quantity: number;
  current_start?: number;
  current_end?: number;
  charge_at?: number;
  ended_at?: number;
  notes?: {
    workspace_id?: string;
    plan_slug?: string;
    billing_cycle?: string;
    billing_currency?: string;
    [key: string]: string | undefined;
  };
}

export interface RazorpayWebhookEvent {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    subscription: {
      entity: RazorpaySubscriptionEntity;
    };
    /** Present on subscription.charged events alongside the subscription entity. */
    payment?: {
      entity: {
        id: string;
        amount: number; // in paise (divide by 100 for rupees)
        currency: string;
        status: string;
      };
    };
  };
  created_at: number;
}

// Razorpay doesn't provide stable top-level event IDs, so we derive one
// from the entity ID + event name + created_at timestamp.
export function computeEventId(event: RazorpayWebhookEvent): string {
  const sub = event.payload.subscription.entity;
  return `${event.event}:${sub.id}:${event.created_at}`;
}

async function upsertSubscription(
  event: RazorpayWebhookEvent,
  workspaceId: string,
  planKey: string,
): Promise<void> {
  const sub = event.payload.subscription.entity;
  const periodStart = sub.current_start != null ? new Date(sub.current_start * 1000) : null;
  const periodEnd = sub.current_end != null ? new Date(sub.current_end * 1000) : null;
  const canceledAt = sub.ended_at != null ? new Date(sub.ended_at * 1000) : null;

  const currency = (sub.notes?.billing_currency ?? 'INR') as 'INR' | 'USD';
  const cycle = (sub.notes?.billing_cycle ?? 'monthly') as 'monthly' | 'annual';
  const billableSeats = sub.quantity ?? 1;

  await db.insert(subscriptions).values({
    workspaceId,
    razorpaySubscriptionId: sub.id,
    razorpayCustomerId: sub.customer_id || null,
    status: sub.status,
    planId: sub.plan_id,
    planKey,
    quantity: billableSeats,
    currency,
    cycle,
    billableSeats,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    canceledAt,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: subscriptions.razorpaySubscriptionId,
    set: {
      status: sub.status,
      planId: sub.plan_id,
      planKey,
      quantity: billableSeats,
      currency,
      cycle,
      billableSeats,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      canceledAt,
      updatedAt: new Date(),
    },
  });
}

async function findWorkspaceBySubscription(subscriptionId: string): Promise<string | null> {
  const rows = await db.select({ workspaceId: subscriptions.workspaceId })
    .from(subscriptions)
    .where(eq(subscriptions.razorpaySubscriptionId, subscriptionId))
    .limit(1);
  return rows[0]?.workspaceId ?? null;
}

export async function handleSubscriptionActivated(event: RazorpayWebhookEvent): Promise<void> {
  const sub = event.payload.subscription.entity;

  // Resolve plan key: try env-var map first (new system), fall back to DB table
  // (old system), then fall back to the plan_slug stored in subscription notes.
  const planKey =
    planSlugFromPlanId(sub.plan_id) ??
    (await planKeyFromRazorpayPlanId(sub.plan_id)) ??
    sub.notes?.plan_slug ??
    null;
  if (!planKey) {
    console.warn('[razorpay-webhook] plan_id not mapped to a plan key', { plan_id: sub.plan_id });
    return;
  }

  // Resolve workspace: check our subscriptions table first; fall back to
  // notes.workspace_id (set when the subscription was created via our API).
  const wsId =
    (await findWorkspaceBySubscription(sub.id)) ??
    sub.notes?.workspace_id ??
    null;
  if (!wsId) {
    console.warn('[razorpay-webhook] no workspace_id for subscription', { id: sub.id });
    return;
  }

  await upsertSubscription(event, wsId, planKey);

  // Only workspaces.plan exists on workspaces — status/period live in subscriptions.
  // planKey is a plan slug ('individual' | 'team' | 'business'); workspaces.plan is
  // free text, so store the slug verbatim (the previous 'pro'|'team' cast dropped
  // 'business', leaving Business workspaces mislabelled).
  await db.update(workspaces).set({
    plan: planKey,
  }).where(eq(workspaces.id, wsId));

  console.log(`[razorpay-webhook] subscription.activated → workspace ${wsId} plan=${planKey}`);

  // Send payment_successful email to workspace owner (fire-and-forget)
  void getWorkspaceOwnerEmail(wsId).then((email) => {
    if (!email) return;
    const periodEnd = sub.current_end
      ? new Date(sub.current_end * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'next billing cycle';
    return emailQueue.add('payment_successful', {
      type: 'payment_successful',
      to: email,
      params: {
        planName: planKey.charAt(0).toUpperCase() + planKey.slice(1),
        amount: '—',
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        nextBillingDate: periodEnd,
        billingUrl: `${process.env.WEB_BASE_URL ?? 'https://mnema.example.com'}/app/settings/billing`,
      },
    });
  }).catch((err) => console.error('[razorpay-webhook] failed to send payment_successful email', err));
}

export async function handleSubscriptionHalted(event: RazorpayWebhookEvent): Promise<void> {
  const sub = event.payload.subscription.entity;
  const wsId = await findWorkspaceBySubscription(sub.id);
  if (!wsId) return;

  await db.update(subscriptions)
    .set({ status: 'halted', updatedAt: new Date() })
    .where(eq(subscriptions.razorpaySubscriptionId, sub.id));

  console.log(`[razorpay-webhook] subscription.halted → workspace ${wsId} (payment failed)`);

  // Send payment_failed email to workspace owner (fire-and-forget)
  void getWorkspaceOwnerEmail(wsId).then((email) => {
    if (!email) return;
    // Razorpay gives 7 days grace period before halting — access ends at period end
    const gracePeriodEnd = sub.current_end
      ? new Date(sub.current_end * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'end of billing period';
    return emailQueue.add('payment_failed', {
      type: 'payment_failed',
      to: email,
      params: {
        planName: sub.plan_id ? 'Pro' : 'Pro', // plan name resolved from planKey if needed
        amount: '—',
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        gracePeriodEnd,
        updateUrl: `${process.env.WEB_BASE_URL ?? 'https://mnema.example.com'}/app/settings/billing`,
      },
    });
  }).catch((err) => console.error('[razorpay-webhook] failed to send payment_failed email', err));
}

export async function handleSubscriptionCancelled(event: RazorpayWebhookEvent): Promise<void> {
  const sub = event.payload.subscription.entity;
  const wsId = await findWorkspaceBySubscription(sub.id);
  if (!wsId) return;

  // Look up planKey before updating so we can use it in the email
  const planKey = await planKeyFromRazorpayPlanId(sub.plan_id);

  await db.update(subscriptions).set({
    status: 'cancelled',
    canceledAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(subscriptions.razorpaySubscriptionId, sub.id));

  // Only plan exists on workspaces — status/period/subscription live in subscriptions
  await db.update(workspaces).set({
    plan: 'free',
  }).where(eq(workspaces.id, wsId));

  console.log(`[razorpay-webhook] subscription.cancelled → workspace ${wsId} downgraded to free`);

  // Send subscription_cancelled email to workspace owner (fire-and-forget)
  void getWorkspaceOwnerEmail(wsId).then((email) => {
    if (!email) return;
    const accessEnd = sub.ended_at
      ? new Date(sub.ended_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'end of billing period';
    const planName = planKey
      ? planKey.charAt(0).toUpperCase() + planKey.slice(1)
      : 'Pro';
    return emailQueue.add('subscription_cancelled', {
      type: 'subscription_cancelled',
      to: email,
      params: {
        planName,
        accessEndDate: accessEnd,
        reactivateUrl: `${process.env.WEB_BASE_URL ?? 'https://mnema.example.com'}/app/settings/billing`,
      },
    });
  }).catch((err) => console.error('[razorpay-webhook] failed to send subscription_cancelled email', err));
}

export async function handleSubscriptionPaused(event: RazorpayWebhookEvent): Promise<void> {
  const sub = event.payload.subscription.entity;
  const wsId = await findWorkspaceBySubscription(sub.id);
  if (!wsId) return;

  await db.update(subscriptions)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(eq(subscriptions.razorpaySubscriptionId, sub.id));

  console.log(`[razorpay-webhook] subscription.paused → workspace ${wsId}`);
}

/**
 * subscription.charged fires on every successful renewal charge.
 * We update currentPeriodStart/End so the billing page always shows the
 * correct next-renewal date, and fire a payment_successful email.
 */
export async function handleSubscriptionCharged(event: RazorpayWebhookEvent): Promise<void> {
  const sub = event.payload.subscription.entity;
  const wsId = await findWorkspaceBySubscription(sub.id);
  if (!wsId) return;

  const periodStart = sub.current_start != null ? new Date(sub.current_start * 1000) : null;
  const periodEnd = sub.current_end != null ? new Date(sub.current_end * 1000) : null;

  await db.update(subscriptions).set({
    status: sub.status,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    updatedAt: new Date(),
  }).where(eq(subscriptions.razorpaySubscriptionId, sub.id));

  console.log(`[razorpay-webhook] subscription.charged → workspace ${wsId} period updated`);

  // Send payment_successful email (fire-and-forget)
  void getWorkspaceOwnerEmail(wsId).then(async (email) => {
    if (!email) return;
    const planKey = await planKeyFromRazorpayPlanId(sub.plan_id);
    const planName = planKey ? planKey.charAt(0).toUpperCase() + planKey.slice(1) : 'Pro';
    const nextBillingDate = periodEnd
      ? periodEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'next billing cycle';
    // Payment amount from the payment entity (paise → rupees)
    const payment = event.payload.payment?.entity;
    const amount = payment
      ? `₹${(payment.amount / 100).toLocaleString('en-IN')}`
      : '—';
    return emailQueue.add('payment_successful', {
      type: 'payment_successful',
      to: email,
      params: {
        planName,
        amount,
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        nextBillingDate,
        billingUrl: `${process.env.WEB_BASE_URL ?? 'https://mnema.example.com'}/app/settings/billing`,
      },
    });
  }).catch((err) => console.error('[razorpay-webhook] failed to send charged email', err));
}

// STRIPE: ENABLE WHEN APPROVED
// export async function handleSubscriptionEvent(event: Stripe.Event): Promise<void> { ... }
// export async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> { ... }
// export async function handleInvoicePaymentSucceeded(event: Stripe.Event): Promise<void> { ... }
// export async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> { ... }
