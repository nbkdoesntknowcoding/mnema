/**
 * Free plan usage limits.
 *
 * Free workspaces (no active subscription) are capped at:
 *   - 50 docs  (non-deleted)
 *   - 5 flows  (non-deleted)
 *
 * These helpers are called from route handlers. They return false (continue)
 * or send a 402 and return true (caller should return after calling).
 *
 * Paid workspaces (any active subscription) bypass limits entirely.
 */

import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { docs, flows, subscriptions } from '../db/schema.js';
import { ACTIVE_STATUSES } from './subscription.js';

const FREE_DOC_LIMIT = 50;
const FREE_FLOW_LIMIT = 5;

/** True if this workspace has an active paid subscription. */
async function hasPaidSubscription(workspaceId: string): Promise<boolean> {
  // Read the NEWEST subscription row (a workspace accumulates rows on every
  // plan change/upgrade; older ones become cancelled). Must match
  // checkSubscriptionGate's desc(createdAt) ordering — reading the oldest row
  // wrongly treated upgraded Business workspaces as free.
  const sub = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return sub.length > 0 && ACTIVE_STATUSES.has(sub[0]!.status as never);
}

/**
 * Call at the top of POST /api/docs.
 *
 * Returns true if a 402 was sent (caller should `return`).
 * Returns false if the request may proceed.
 */
export async function enforceFreeDocLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
): Promise<boolean> {
  if (await hasPaidSubscription(workspaceId)) return false;

  const rows = await db
    .select({ c: count() })
    .from(docs)
    .where(and(eq(docs.workspaceId, workspaceId), isNull(docs.deletedAt)));

  const docCount = Number(rows[0]?.c ?? 0);
  if (docCount < FREE_DOC_LIMIT) return false;

  reply.code(402).send({
    error: 'free_plan_limit',
    resource: 'docs',
    limit: FREE_DOC_LIMIT,
    count: docCount,
    message: `Free plan is limited to ${FREE_DOC_LIMIT} docs. Upgrade to create more.`,
  });
  return true;
}

/**
 * Call at the top of POST /api/flows/publish (or wherever flows are created).
 *
 * Returns true if a 402 was sent (caller should `return`).
 * Returns false if the request may proceed.
 */
export async function enforceFreeFlowLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
): Promise<boolean> {
  if (await hasPaidSubscription(workspaceId)) return false;

  const rows = await db
    .select({ c: count() })
    .from(flows)
    .where(and(eq(flows.workspaceId, workspaceId), isNull(flows.deletedAt)));

  const flowCount = Number(rows[0]?.c ?? 0);
  if (flowCount < FREE_FLOW_LIMIT) return false;

  reply.code(402).send({
    error: 'free_plan_limit',
    resource: 'flows',
    limit: FREE_FLOW_LIMIT,
    count: flowCount,
    message: `Free plan is limited to ${FREE_FLOW_LIMIT} flows. Upgrade to create more.`,
  });
  return true;
}
