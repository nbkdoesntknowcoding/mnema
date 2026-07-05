import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { subscriptions, workspaceMembers, workspaces } from '../db/schema.js';
import { createRazorpayCustomerForWorkspace, getRazorpayCustomerForWorkspace } from '../lib/razorpay/customer.js';
import { requireRole } from '../lib/role.js';
import { countBillableSeats, WRITER_ROLES } from '../lib/billing/seats.js';
import { detectCurrency } from '../lib/billing/currency.js';
import { getPlanId, PLAN_PRICING } from '../lib/razorpay/plans.js';
import type { PlanSlug, BillingCycle } from '../lib/razorpay/plans.js';

const subscribeSchema = z.object({
  plan: z.enum(['individual', 'team', 'business']),
  cycle: z.enum(['monthly', 'annual']).default('monthly'),
});

const cancelSchema = z.object({
  cancelAtPeriodEnd: z.boolean().default(true),
});

// STRIPE: ENABLE WHEN APPROVED
// import { stripe } from '../lib/stripe/client.js';
// import { config } from '../config/env.js';
// import { createStripeCustomerForWorkspace } from '../lib/stripe/customer.js';

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/billing/current', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    await requireRole(req, 'viewer');

    const wsRows = await db.select({ plan: workspaces.plan })
      .from(workspaces)
      .where(eq(workspaces.id, req.auth.tenant_id))
      .limit(1);

    if (wsRows.length === 0) return reply.code(404).send({ error: 'workspace_not_found' });

    // Billing details live in the subscriptions table, not on workspaces
    const subRows = await db.select({
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      razorpayCustomerId: subscriptions.razorpayCustomerId,
    })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, req.auth.tenant_id))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    const sub = subRows[0];
    return {
      plan: wsRows[0]!.plan,
      subscription_status: sub?.status ?? null,
      current_period_end: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancel_at_period_end: sub?.cancelAtPeriodEnd ?? false,
      has_razorpay_customer: Boolean(sub?.razorpayCustomerId),
      // STRIPE: ENABLE WHEN APPROVED
      // has_stripe_customer: Boolean(rows[0]!.stripeCustomerId),
    };
  });

  // -------------------------------------------------------------------------
  // GET /api/billing/status — richer billing status for the pricing page and
  // settings panel. Includes plan, seats, prices, and upgrade URL.
  // -------------------------------------------------------------------------
  app.get('/api/billing/status', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    await requireRole(req, 'viewer');

    const workspaceId = req.auth.tenant_id;
    const currency = detectCurrency(req.headers as Record<string, string | string[] | undefined>);

    // Workspace plan
    const wsRows = await db.select({ plan: workspaces.plan })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (wsRows.length === 0) return reply.code(404).send({ error: 'workspace_not_found' });

    // Most recent subscription
    const subRows = await db.select({
      status: subscriptions.status,
      planKey: subscriptions.planKey,
      cycle: subscriptions.cycle,
      currency: subscriptions.currency,
      billableSeats: subscriptions.billableSeats,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    const sub = subRows[0];

    // Count current seats
    const writerCountRows = await db
      .select({ c: count() })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.role, [...WRITER_ROLES]),
      ));
    const readerCountRows = await db
      .select({ c: count() })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, 'viewer'),
      ));

    const writerSeats = Number(writerCountRows[0]?.c ?? 0);
    const readerSeats = Number(readerCountRows[0]?.c ?? 0);

    // Resolved plan slug — use subscription planKey or default to workspace plan
    const planSlug = (sub?.planKey as PlanSlug | undefined) ?? null;
    const billingCurrency = (sub?.currency as 'INR' | 'USD' | undefined) ?? currency;
    const billingCycle = (sub?.cycle as BillingCycle | undefined) ?? 'monthly';

    // Price lookup
    const prices = planSlug && planSlug in PLAN_PRICING
      ? {
          monthly_usd: PLAN_PRICING[planSlug].usd_monthly,
          annual_usd: PLAN_PRICING[planSlug].usd_annual,
          monthly_inr: PLAN_PRICING[planSlug].inr_monthly,
          annual_inr: PLAN_PRICING[planSlug].inr_annual,
        }
      : null;

    const webBaseUrl = config.WEB_BASE_URL ?? 'https://mnema.example.com';

    return {
      plan: wsRows[0]!.plan,
      subscription_status: sub?.status ?? null,
      plan_slug: planSlug,
      cycle: billingCycle,
      currency: billingCurrency,
      billable_seats: sub?.billableSeats ?? writerSeats,
      writer_seats: writerSeats,
      reader_seats: readerSeats,
      current_period_end: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancel_at_period_end: sub?.cancelAtPeriodEnd ?? false,
      prices,
      upgrade_url: `${webBaseUrl}/app/settings/billing`,
      detected_currency: currency,
    };
  });

  app.post('/api/billing/cancel', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    await requireRole(req, 'owner');

    const parsed = cancelSchema.safeParse(req.body ?? {});
    const cancelAtPeriodEnd = parsed.success ? parsed.data.cancelAtPeriodEnd : true;

    // Get the active subscription for this workspace from the subscriptions table
    const subRows = await db.select({
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
      status: subscriptions.status,
    })
      .from(subscriptions)
      .where(and(
        eq(subscriptions.workspaceId, req.auth.tenant_id),
        inArray(subscriptions.status, ['active', 'trialing', 'created']),
      ))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    if (subRows.length === 0) {
      return reply.code(400).send({ error: 'no_active_subscription' });
    }

    const { razorpaySubscriptionId } = subRows[0]!;

    // Cancel at period end (or immediately) via Razorpay API
    const razorpay = (await import('../lib/razorpay/client.js')).razorpay;
    await razorpay.subscriptions.cancel(razorpaySubscriptionId, cancelAtPeriodEnd);

    await db.update(subscriptions)
      .set({ cancelAtPeriodEnd, updatedAt: new Date() })
      .where(eq(subscriptions.razorpaySubscriptionId, razorpaySubscriptionId));

    return { cancelled: true, cancel_at_period_end: cancelAtPeriodEnd };

    // STRIPE: ENABLE WHEN APPROVED
    // app.post('/api/billing/portal', async (req, reply) => {
    //   const session = await stripe.billingPortal.sessions.create({
    //     customer: customerId,
    //     return_url: config.STRIPE_RETURN_URL,
    //   });
    //   return { url: session.url };
    // });
  });

  // -------------------------------------------------------------------------
  // POST /api/billing/update-payment-method — generate a Razorpay hosted
  // page where the customer can update their saved payment method.
  // -------------------------------------------------------------------------
  app.post('/api/billing/update-payment-method', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    await requireRole(req, 'owner');

    const subRows = await db.select({
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
      razorpayCustomerId: subscriptions.razorpayCustomerId,
    })
      .from(subscriptions)
      .where(and(
        eq(subscriptions.workspaceId, req.auth.tenant_id),
        inArray(subscriptions.status, ['active', 'trialing', 'created', 'halted']),
      ))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    if (subRows.length === 0) {
      return reply.code(400).send({ error: 'no_subscription_found' });
    }

    // Razorpay's "update payment" flow uses a short_url generated via
    // the subscriptions update endpoint with the manage token.
    // The simplest approach: redirect to the Razorpay subscription management page.
    const { razorpaySubscriptionId } = subRows[0]!;
    const razorpay = (await import('../lib/razorpay/client.js')).razorpay;
    const sub = await (razorpay.subscriptions.fetch(razorpaySubscriptionId) as Promise<{ short_url: string }>);

    return {
      manage_url: sub.short_url,
    };
  });

  // -------------------------------------------------------------------------
  // GET /api/billing/payments — payment / invoice history for this workspace.
  // Fetches invoices live from Razorpay (no local mirror needed).
  // -------------------------------------------------------------------------
  app.get('/api/billing/payments', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    await requireRole(req, 'viewer');

    // Find the most recent subscription that has a Razorpay ID
    const subRows = await db.select({
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
    })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, req.auth.tenant_id))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    if (subRows.length === 0) {
      return { invoices: [] };
    }

    const { razorpaySubscriptionId } = subRows[0]!;
    const razorpay = (await import('../lib/razorpay/client.js')).razorpay;

    // Razorpay generates invoices automatically for subscription charges.
    interface RazorpayInvoice {
      id: string;
      date: number;          // Unix timestamp
      description?: string;
      amount_paid: number;   // in paise
      amount_due: number;
      currency: string;
      status: string;        // 'paid' | 'issued' | 'draft' | 'cancelled' | 'expired'
      short_url?: string;    // hosted invoice page (PDF download link)
    }
    interface InvoiceListResponse { items: RazorpayInvoice[]; count: number; }

    let items: RazorpayInvoice[] = [];
    try {
      const result = await (razorpay.invoices.all({
        subscription_id: razorpaySubscriptionId,
        count: 12,
      }) as Promise<InvoiceListResponse>);
      items = result.items ?? [];
    } catch (err) {
      req.log.warn({ err }, 'Failed to fetch Razorpay invoices');
      // Return empty list rather than 500 — UI shows "No payments yet"
      return { invoices: [] };
    }

    const invoices = items.map((inv) => ({
      id: inv.id,
      date: inv.date ? new Date(inv.date * 1000).toISOString() : null,
      description: inv.description ?? 'Subscription charge',
      amount_paid: inv.amount_paid,   // paise — frontend divides by 100
      amount_due: inv.amount_due,
      currency: inv.currency ?? 'INR',
      status: inv.status,
      download_url: inv.short_url ?? null,
    }));

    return { invoices };
  });

  // -------------------------------------------------------------------------
  // POST /api/billing/change-plan — immediate plan change.
  // Cancels current subscription right away, starts a new checkout.
  // The user pays full price for the new plan from day one.
  // -------------------------------------------------------------------------
  app.post('/api/billing/change-plan', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    await requireRole(req, 'owner');

    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', details: parsed.error.flatten() });

    const { plan, cycle } = parsed.data;
    const currency = detectCurrency(req.headers as Record<string, string | string[] | undefined>);

    // Resolve new Razorpay plan_id
    let razorpayPlanId: string;
    try {
      razorpayPlanId = getPlanId(plan as PlanSlug, cycle as BillingCycle, currency);
    } catch (err) {
      req.log.warn({ err, plan, cycle, currency }, 'plan_not_configured');
      return reply.code(400).send({ error: 'plan_not_configured', detail: (err as Error).message });
    }

    const razorpay = (await import('../lib/razorpay/client.js')).razorpay;

    // Cancel current active subscription immediately (not at period end)
    const activeSubs = await db.select({
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
    })
      .from(subscriptions)
      .where(and(
        eq(subscriptions.workspaceId, req.auth.tenant_id),
        inArray(subscriptions.status, ['active', 'trialing', 'created']),
      ))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    if (activeSubs.length > 0) {
      const oldSubId = activeSubs[0]!.razorpaySubscriptionId;
      try {
        await razorpay.subscriptions.cancel(oldSubId, false); // false = immediate
        await db.update(subscriptions)
          .set({ status: 'cancelled', canceledAt: new Date(), updatedAt: new Date() })
          .where(eq(subscriptions.razorpaySubscriptionId, oldSubId));
      } catch (err) {
        req.log.warn({ err, oldSubId }, 'Failed to cancel old subscription during plan change');
        // Continue — create the new subscription anyway
      }
    }

    // Count writer seats and ensure customer exists
    const billableSeats = await countBillableSeats(req.auth.tenant_id);
    let customerId = await getRazorpayCustomerForWorkspace(req.auth.tenant_id);
    if (!customerId) {
      const wsRows = await db.select({ slug: workspaces.slug, name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, req.auth.tenant_id))
        .limit(1);
      if (wsRows.length === 0) return reply.code(404).send({ error: 'workspace_not_found' });
      customerId = await createRazorpayCustomerForWorkspace({
        workspaceId: req.auth.tenant_id,
        workspaceSlug: wsRows[0]!.slug,
        workspaceName: wsRows[0]!.name,
        ownerEmail: req.auth.email,
      });
    }

    const webBaseUrl = config.WEB_BASE_URL ?? 'https://mnema.example.com';
    let subscription: { id: string; short_url: string };
    try {
      subscription = await (razorpay.subscriptions.create({
        plan_id: razorpayPlanId,
        customer_id: customerId,
        quantity: billableSeats,
        total_count: 120,
        notes: {
          workspace_id: req.auth.tenant_id,
          plan_slug: plan,
          billing_cycle: cycle,
          billing_currency: currency,
        },
      } as Parameters<typeof razorpay.subscriptions.create>[0]) as Promise<{ id: string; short_url: string }>);
    } catch (err: unknown) {
      const rzErr = err as { error?: { description?: string; code?: string }; statusCode?: number };
      const detail = rzErr?.error?.description ?? (err instanceof Error ? err.message : String(err));
      req.log.error({ err, plan, cycle, currency }, 'razorpay_change_plan_create_failed');
      return reply.code(502).send({ error: 'payment_provider_error', detail });
    }

    if (!subscription.short_url) {
      return reply.code(502).send({ error: 'payment_provider_error', detail: 'No checkout URL returned. Please try again.' });
    }

    // Persist the new pending subscription so the webhook handler can find it
    try {
      await db.insert(subscriptions).values({
        workspaceId: req.auth.tenant_id,
        razorpaySubscriptionId: subscription.id,
        razorpayCustomerId: customerId,
        status: 'created',
        planId: razorpayPlanId,
        planKey: plan,
        quantity: billableSeats,
        currency,
        cycle,
        billableSeats,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: subscriptions.razorpaySubscriptionId,
        set: { status: 'created', updatedAt: new Date() },
      });
    } catch (err) {
      req.log.warn({ err, subscriptionId: subscription.id }, 'Failed to persist pending subscription row (change-plan)');
    }

    return {
      subscription_id: subscription.id,
      short_url: subscription.short_url,
    };
  });

  // Lazy-create Razorpay customer (called from checkout flow in Phase 5)
  app.post('/api/billing/ensure-customer', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    await requireRole(req, 'owner');

    const wsRows = await db.select({ slug: workspaces.slug, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, req.auth.tenant_id))
      .limit(1);

    if (wsRows.length === 0) return reply.code(404).send({ error: 'workspace_not_found' });

    // Look up existing customer ID from the subscriptions table
    let customerId = await getRazorpayCustomerForWorkspace(req.auth.tenant_id);
    if (!customerId) {
      customerId = await createRazorpayCustomerForWorkspace({
        workspaceId: req.auth.tenant_id,
        workspaceSlug: wsRows[0]!.slug,
        workspaceName: wsRows[0]!.name,
        ownerEmail: req.auth.email,
      });
    }

    return { razorpay_customer_id: customerId };
  });

  // Create a new Razorpay subscription and return the hosted payment link.
  // Detects currency from CF-IPCountry, counts writer seats, resolves plan ID
  // from env vars (populated by create-razorpay-plans.ts).
  app.post('/api/billing/subscribe', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    await requireRole(req, 'owner');

    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', details: parsed.error.flatten() });

    const { plan, cycle } = parsed.data;
    const currency = detectCurrency(req.headers as Record<string, string | string[] | undefined>);

    // Resolve Razorpay plan_id from env vars
    let razorpayPlanId: string;
    try {
      razorpayPlanId = getPlanId(plan as PlanSlug, cycle as BillingCycle, currency);
    } catch (err) {
      req.log.warn({ err, plan, cycle, currency }, 'plan_not_configured');
      return reply.code(400).send({ error: 'plan_not_configured', detail: (err as Error).message });
    }

    // Count writer seats (minimum 1)
    const billableSeats = await countBillableSeats(req.auth.tenant_id);

    // Ensure a Razorpay customer exists for this workspace
    let customerId = await getRazorpayCustomerForWorkspace(req.auth.tenant_id);
    if (!customerId) {
      const wsRows = await db.select({ slug: workspaces.slug, name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, req.auth.tenant_id))
        .limit(1);
      if (wsRows.length === 0) return reply.code(404).send({ error: 'workspace_not_found' });
      customerId = await createRazorpayCustomerForWorkspace({
        workspaceId: req.auth.tenant_id,
        workspaceSlug: wsRows[0]!.slug,
        workspaceName: wsRows[0]!.name,
        ownerEmail: req.auth.email,
      });
    }

    const razorpay = (await import('../lib/razorpay/client.js')).razorpay;
    const webBaseUrl = config.WEB_BASE_URL ?? 'https://mnema.example.com';

    // The Razorpay SDK throws a plain object (not an Error) on API errors:
    // { statusCode, error: { code, description, ... } }
    // Wrap in try/catch to return a clean string error to the frontend.
    let subscription: { id: string; short_url: string };
    try {
      subscription = await (razorpay.subscriptions.create({
        plan_id: razorpayPlanId,
        customer_id: customerId,
        quantity: billableSeats,
        total_count: 120, // up to 10 years — effectively open-ended
        // NOTE: callback_url is NOT accepted by Razorpay subscriptions.create —
        // the post-payment redirect URL must be set in the Razorpay Dashboard
        // under Settings → Checkout Settings → Redirect URL.
        notes: {
          workspace_id: req.auth.tenant_id,
          plan_slug: plan,
          billing_cycle: cycle,
          billing_currency: currency,
        },
      } as Parameters<typeof razorpay.subscriptions.create>[0]) as Promise<{ id: string; short_url: string }>);
    } catch (err: unknown) {
      const rzErr = err as { error?: { description?: string; code?: string }; statusCode?: number };
      const detail = rzErr?.error?.description ?? (err instanceof Error ? err.message : String(err));
      req.log.error({ err, plan, cycle, currency }, 'razorpay_subscription_create_failed');
      return reply.code(502).send({ error: 'payment_provider_error', detail });
    }

    if (!subscription.short_url) {
      req.log.error({ subscription }, 'razorpay_subscription_missing_short_url');
      return reply.code(502).send({ error: 'payment_provider_error', detail: 'No checkout URL returned. Please try again.' });
    }

    // Persist a pending subscription row immediately so the webhook handler
    // can look it up by razorpaySubscriptionId when subscription.activated fires.
    // Without this, findWorkspaceBySubscription() returns null and the handler exits.
    try {
      await db.insert(subscriptions).values({
        workspaceId: req.auth.tenant_id,
        razorpaySubscriptionId: subscription.id,
        razorpayCustomerId: customerId,
        status: 'created',
        planId: razorpayPlanId,
        planKey: plan,
        quantity: billableSeats,
        currency,
        cycle,
        billableSeats,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: subscriptions.razorpaySubscriptionId,
        set: { status: 'created', updatedAt: new Date() },
      });
    } catch (err) {
      // Non-fatal — webhook fallback (notes.workspace_id) handles it if this fails
      req.log.warn({ err, subscriptionId: subscription.id }, 'Failed to persist pending subscription row');
    }

    return {
      subscription_id: subscription.id,
      short_url: subscription.short_url,
    };
  });
};
