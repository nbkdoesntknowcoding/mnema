import { and, eq } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { razorpayPlanIds } from '../db/schema.js';
import { razorpay } from '../lib/razorpay/client.js';
import { PLANS } from '../lib/razorpay/products.js';

// IMPORTANT: Razorpay International must be activated on your account to charge in USD.
// Without activation, plan creation will fail with a currency error.
// Contact Razorpay support to enable international payments (USD billing).

async function main(): Promise<void> {
  const environment = config.RAZORPAY_ENVIRONMENT;
  console.log(`[razorpay-bootstrap] Running in ${environment} mode (USD billing)`);

  for (const plan of Object.values(PLANS)) {
    if (!plan.razorpayManaged) {
      console.log(`[razorpay-bootstrap] Skipping ${plan.key} — not Razorpay-managed`);
      continue;
    }

    const existing = await db
      .select()
      .from(razorpayPlanIds)
      .where(
        and(
          eq(razorpayPlanIds.planKey, plan.key as 'pro' | 'team'),
          eq(razorpayPlanIds.environment, environment),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      try {
        // Verify the plan still exists in Razorpay
        await razorpay.plans.fetch(existing[0]!.razorpayPlanId);
        console.log(`[razorpay-bootstrap] ${plan.key}: existing plan ${existing[0]!.razorpayPlanId} verified`);
        continue;
      } catch {
        console.warn(`[razorpay-bootstrap] ${plan.key}: stored plan ID invalid, recreating`);
        await db.delete(razorpayPlanIds).where(
          and(
            eq(razorpayPlanIds.planKey, plan.key as 'pro' | 'team'),
            eq(razorpayPlanIds.environment, environment),
          ),
        );
      }
    }

    // Razorpay amounts are in the smallest currency unit.
    // USD cents: $15.00 = 1500, $25.00 = 2500.
    // NOTE: Razorpay International must be enabled for USD.
    let razorpayPlan: { id: string };
    try {
      razorpayPlan = await (razorpay.plans.create({
        period: 'monthly',
        interval: 1,
        item: {
          name: `Mnema ${plan.displayName}`,
          amount: plan.amountUsdCents!,
          currency: 'USD',
          description: plan.description,
        },
        notes: { plan_key: plan.key, environment },
      }) as Promise<{ id: string }>);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('currency') || msg.includes('USD')) {
        console.error(
          `[razorpay-bootstrap] FAILED: Razorpay International (USD) is not enabled on this account.\n` +
          `Contact Razorpay support to activate international payments before running this script.\n` +
          `Error: ${msg}`,
        );
        process.exit(1);
      }
      throw err;
    }

    await db.insert(razorpayPlanIds).values({
      planKey: plan.key as 'pro' | 'team',
      environment,
      razorpayPlanId: razorpayPlan.id,
    });

    console.log(`[razorpay-bootstrap] ${plan.key}: created plan=${razorpayPlan.id}`);
  }

  console.log('[razorpay-bootstrap] done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[razorpay-bootstrap] failed', err);
  process.exit(1);
});

// STRIPE: ENABLE WHEN APPROVED
// Replace with stripe-bootstrap.ts using stripe.products.create() + stripe.prices.create()
