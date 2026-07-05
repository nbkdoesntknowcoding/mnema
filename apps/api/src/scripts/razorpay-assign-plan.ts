import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaces } from '../db/schema.js';
import { PLANS, type PlanKey } from '../lib/razorpay/products.js';

// Admin CLI: manually override a workspace's plan (bypasses Razorpay).
// The next real webhook will overwrite this assignment.

async function main(): Promise<void> {
  const [, , workspaceId, planArg] = process.argv;
  if (!workspaceId || !planArg) {
    console.error('Usage: pnpm razorpay:assign-plan <workspace_id> <free|pro|team>');
    process.exit(1);
  }
  if (!(planArg in PLANS)) {
    console.error(`Unknown plan: ${planArg}. Must be one of: ${Object.keys(PLANS).join(', ')}`);
    process.exit(1);
  }
  const plan = planArg as PlanKey;

  // subscriptionStatus lives in the subscriptions table, not on workspaces.
  // This script only patches the plan column for emergency overrides.
  const result = await db
    .update(workspaces)
    .set({ plan })
    .where(eq(workspaces.id, workspaceId))
    .returning({ id: workspaces.id, slug: workspaces.slug });

  if (result.length === 0) {
    console.error(`Workspace ${workspaceId} not found`);
    process.exit(1);
  }

  console.log(`[razorpay-assign-plan] workspace ${result[0]!.slug} (${result[0]!.id}) set to plan=${plan}`);
  console.log('Note: this bypasses Razorpay. The next real webhook will overwrite this assignment.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// STRIPE: ENABLE WHEN APPROVED
// Replace with stripe-assign-plan.ts using stripe.subscriptions.*
