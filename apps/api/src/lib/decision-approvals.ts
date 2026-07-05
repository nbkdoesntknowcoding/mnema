/**
 * Phase 3b — the decision confirm/reject side-effects (sibling to the doc-ACL approval path).
 *
 * Confirm: flip the proposed decision → current, then apply the DEFERRED supersede (the target 3a
 * stashed) IF it's still current — else SKIP (stale-safe, never corrupt the chain). Reject:
 * tombstone the decision (status='rejected') + soft-delete its doc so it's invisible to retrieval.
 *
 * The supersede is applied via the SAME applySupersede recordDecision uses (one implementation,
 * two callers — record-time and confirm-time).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { decisionApprovals, graphNodes, docs } from '../db/schema.js';
import { applySupersede, supersedeTargetStillApplicable } from './decisions.js';

export interface ResolveResult {
  status: 'confirmed' | 'rejected';
  decisionNodeId: string;
  supersedeApplied?: string;   // confirm: the old decision flipped to historical
  supersedeSkipped?: string;   // confirm: stashed target was stale (already not current) → skipped
}

async function loadPending(workspaceId: string, approvalId: string) {
  const appr = await db.query.decisionApprovals.findFirst({
    where: and(eq(decisionApprovals.workspaceId, workspaceId), eq(decisionApprovals.id, approvalId)),
  });
  if (!appr) throw new Error('approval not found');
  if (appr.status !== 'pending') throw new Error('approval already resolved');
  return appr;
}

/** Confirm: proposed→current + stale-safe deferred supersede. */
export async function confirmDecisionApproval(
  workspaceId: string, approvalId: string, resolverId: string,
): Promise<ResolveResult> {
  const appr = await loadPending(workspaceId, approvalId);

  // 1. flip the decision node proposed → current
  await db.update(graphNodes).set({ status: 'current', updatedAt: new Date() }).where(eq(graphNodes.id, appr.decisionNodeId));

  // 2. apply the deferred supersede, stale-safe: only if the stashed target is still current
  let supersedeApplied: string | undefined;
  let supersedeSkipped: string | undefined;
  if (appr.supersedesTarget) {
    if (await supersedeTargetStillApplicable(workspaceId, appr.supersedesTarget)) {
      await applySupersede(workspaceId, appr.decisionNodeId, appr.supersedesTarget);
      supersedeApplied = appr.supersedesTarget;
    } else {
      supersedeSkipped = appr.supersedesTarget;   // already superseded/rejected/gone → leave it
    }
  }

  // 3. mark the approval confirmed
  await db.update(decisionApprovals)
    .set({ status: 'confirmed', resolvedBy: resolverId, resolvedAt: new Date() })
    .where(eq(decisionApprovals.id, approvalId));

  return { status: 'confirmed', decisionNodeId: appr.decisionNodeId, supersedeApplied, supersedeSkipped };
}

/** Reject: tombstone (status='rejected') + soft-delete the decision doc (invisible to retrieval).
 *  Recoverable, NOT a hard delete. */
export async function rejectDecisionApproval(
  workspaceId: string, approvalId: string, resolverId: string,
): Promise<ResolveResult> {
  const appr = await loadPending(workspaceId, approvalId);

  await db.update(graphNodes).set({ status: 'rejected', updatedAt: new Date() }).where(eq(graphNodes.id, appr.decisionNodeId));
  if (appr.docId) {
    // soft-delete (tombstone) — search_docs filters deleted_at IS NULL, so the rejected decision's
    // doc never enters retrieval (the primary invisibility mechanism).
    await db.update(docs).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(docs.id, appr.docId));
  }
  await db.update(decisionApprovals)
    .set({ status: 'rejected', resolvedBy: resolverId, resolvedAt: new Date() })
    .where(eq(decisionApprovals.id, approvalId));

  return { status: 'rejected', decisionNodeId: appr.decisionNodeId };
}
