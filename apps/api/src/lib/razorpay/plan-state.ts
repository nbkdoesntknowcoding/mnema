import { and, eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/index.js';
import { razorpayPlanIds } from '../../db/schema.js';
import type { PlanKey } from './products.js';

export async function planKeyFromRazorpayPlanId(razorpayPlanId: string): Promise<PlanKey | null> {
  const rows = await db.select({ planKey: razorpayPlanIds.planKey })
    .from(razorpayPlanIds)
    .where(and(
      eq(razorpayPlanIds.razorpayPlanId, razorpayPlanId),
      eq(razorpayPlanIds.environment, config.RAZORPAY_ENVIRONMENT),
    ))
    .limit(1);
  return (rows[0]?.planKey as PlanKey | undefined) ?? null;
}

// STRIPE: ENABLE WHEN APPROVED
// export async function planKeyFromPriceId(priceId: string): Promise<PlanKey | null> {
//   const rows = await db.select({ planKey: stripeProductIds.planKey })
//     .from(stripeProductIds)
//     .where(and(
//       eq(stripeProductIds.priceId, priceId),
//       eq(stripeProductIds.environment, config.STRIPE_ENVIRONMENT),
//     ))
//     .limit(1);
//   return (rows[0]?.planKey as PlanKey | undefined) ?? null;
// }
