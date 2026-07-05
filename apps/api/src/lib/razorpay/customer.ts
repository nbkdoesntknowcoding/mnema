import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { subscriptions } from '../../db/schema.js';
import { razorpay } from './client.js';

interface CreateCustomerArgs {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  ownerEmail: string;
}

export async function createRazorpayCustomerForWorkspace(args: CreateCustomerArgs): Promise<string> {
  // Attempt to create. If the customer already exists (fail_existing does not
  // reliably suppress the error in test mode), fall back to a lookup by email.
  try {
    const customer = await (razorpay.customers.create({
      name: args.workspaceName,
      email: args.ownerEmail,
      fail_existing: 0,
      notes: {
        workspace_id: args.workspaceId,
        workspace_slug: args.workspaceSlug,
      },
    }) as Promise<{ id: string }>);
    return customer.id;
  } catch (err: unknown) {
    const rzErr = err as { error?: { description?: string }; statusCode?: number };
    const desc = rzErr?.error?.description ?? '';
    // "Customer already exists for the merchant" → look up the existing record
    if (typeof desc === 'string' && desc.toLowerCase().includes('already exists')) {
      const list = await (razorpay.customers.all({ count: 100 }) as Promise<{ items: { id: string; email: string }[] }>);
      const existing = list.items.find((c) => c.email === args.ownerEmail);
      if (existing) return existing.id;
    }
    // Any other error — re-throw so the route's try/catch formats it properly
    throw err;
  }
}

export async function getRazorpayCustomerForWorkspace(workspaceId: string): Promise<string | null> {
  // Customer ID is stored per-subscription in the subscriptions table.
  // Return the most recent non-null customer ID for this workspace.
  const rows = await db.select({ razorpayCustomerId: subscriptions.razorpayCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return rows[0]?.razorpayCustomerId ?? null;
}

// STRIPE: ENABLE WHEN APPROVED
// export async function createStripeCustomerForWorkspace(args: CreateCustomerArgs): Promise<string> {
//   const customer = await stripe.customers.create({
//     email: args.ownerEmail,
//     name: args.workspaceName,
//     metadata: { workspace_id: args.workspaceId, workspace_slug: args.workspaceSlug },
//   });
//   await db.update(workspaces).set({ stripeCustomerId: customer.id }).where(eq(workspaces.id, args.workspaceId));
//   return customer.id;
// }
