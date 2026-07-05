/**
 * verify-decision-approvals.ts — Phase-3b Sprint-2 DB gate (STEP 4 confirm + STEP 5 reject).
 *
 *   VERIFY_WS=<workspaceId> node apps/api/dist/scripts/verify-decision-approvals.js
 *
 * Asserts:
 *   4a confirm w/ still-current target → new current, old historical, supersedes edge (via applySupersede)
 *   4b STALE target (already historical before confirm) → new current, stale target UNTOUCHED, no edge (skip)
 *   5  reject → node 'rejected' + doc SOFT-deleted (deleted_at set, row still exists), approval 'rejected'
 * Writes throwaway [P3B-TEST] decisions and DELETES them at the end.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { graphNodes, graphEdges, docs, decisionApprovals, workspaceMembers } from '../db/schema.js';
import { recordDecision } from '../lib/decisions.js';
import { confirmDecisionApproval, rejectDecisionApproval } from '../lib/decision-approvals.js';

const WS = process.env.VERIFY_WS;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const nodeById = (id: string) => db.query.graphNodes.findFirst({ where: eq(graphNodes.id, id) });
async function edge(from: string, to: string, type: string) {
  const [e] = await db.select({ id: graphEdges.id }).from(graphEdges)
    .where(and(eq(graphEdges.fromNodeId, from), eq(graphEdges.toNodeId, to), eq(graphEdges.edgeType, type))).limit(1);
  return e;
}

async function main(): Promise<void> {
  if (!WS) { console.error('FATAL: set VERIFY_WS=<workspaceId>'); process.exit(2); }
  const nodeIds: string[] = [];
  const docIds: string[] = [];
  const t = Date.now();
  // resolvedBy is an FK to users — use a real workspace member.
  const [member] = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, WS)).limit(1);
  const resolver = member?.userId ?? null;

  async function mkApproval(nodeId: string, docId: string, target: string | null): Promise<string> {
    const [a] = await db.insert(decisionApprovals).values({
      workspaceId: WS!, decisionNodeId: nodeId, docId, proposerId: resolver,
      meetingId: null, supersedesTarget: target, status: 'pending',
    }).returning({ id: decisionApprovals.id });
    return a!.id;
  }

  try {
    // ── 4a — confirm with a still-current supersede target ──
    const base = await recordDecision(WS, { decisionText: `[P3B-TEST ${t}] base current A` });
    const prop = await recordDecision(WS, { decisionText: `[P3B-TEST ${t}] proposed superseding base A`, status: 'proposed', supersedes: base.nodeId });
    nodeIds.push(base.nodeId, prop.nodeId); docIds.push(base.docId, prop.docId);
    const appr = await mkApproval(prop.nodeId, prop.docId, base.nodeId);
    const r = await confirmDecisionApproval(WS, appr, resolver!);
    check('4a: confirmed → new decision is current', (await nodeById(prop.nodeId))?.status === 'current');
    check('4a: old decision flipped to historical', (await nodeById(base.nodeId))?.status === 'historical');
    check('4a: supersedes edge written (via applySupersede)', !!(await edge(prop.nodeId, base.nodeId, 'supersedes')));
    check('4a: result reports supersedeApplied', r.supersedeApplied === base.nodeId);
    check('4a: approval marked confirmed', (await db.query.decisionApprovals.findFirst({ where: eq(decisionApprovals.id, appr) }))?.status === 'confirmed');

    // ── 4b — STALE target: it was already superseded (historical) before confirm ──
    const base2 = await recordDecision(WS, { decisionText: `[P3B-TEST ${t}] base current B` });
    const prop2 = await recordDecision(WS, { decisionText: `[P3B-TEST ${t}] proposed superseding base B`, status: 'proposed', supersedes: base2.nodeId });
    nodeIds.push(base2.nodeId, prop2.nodeId); docIds.push(base2.docId, prop2.docId);
    const appr2 = await mkApproval(prop2.nodeId, prop2.docId, base2.nodeId);
    await db.update(graphNodes).set({ status: 'historical' }).where(eq(graphNodes.id, base2.nodeId)); // simulate stale
    const r2 = await confirmDecisionApproval(WS, appr2, resolver!);
    check('4b: stale-target confirm still makes the new decision current', (await nodeById(prop2.nodeId))?.status === 'current');
    check('4b: stale target left UNTOUCHED (still historical, not double-flipped)', (await nodeById(base2.nodeId))?.status === 'historical');
    check('4b: NO supersedes edge written on a stale target (skipped, not corrupted)', !(await edge(prop2.nodeId, base2.nodeId, 'supersedes')));
    check('4b: result reports supersedeSkipped (not applied)', r2.supersedeSkipped === base2.nodeId && !r2.supersedeApplied);

    // ── 5 — reject = tombstone + SOFT-delete the doc ──
    const prop3 = await recordDecision(WS, { decisionText: `[P3B-TEST ${t}] proposed to be rejected` });
    // make it proposed (recordDecision default is current; re-record as proposed to set status)
    await db.update(graphNodes).set({ status: 'proposed' }).where(eq(graphNodes.id, prop3.nodeId));
    nodeIds.push(prop3.nodeId); docIds.push(prop3.docId);
    const appr3 = await mkApproval(prop3.nodeId, prop3.docId, null);
    await rejectDecisionApproval(WS, appr3, resolver!);
    check('5: rejected → decision node status=rejected', (await nodeById(prop3.nodeId))?.status === 'rejected');
    const rdoc = await db.query.docs.findFirst({ where: eq(docs.id, prop3.docId) });
    check('5: decision doc SOFT-deleted (deleted_at set)', !!rdoc?.deletedAt);
    check('5: doc row still EXISTS (tombstone, not hard delete)', !!rdoc);
    check('5: approval marked rejected', (await db.query.decisionApprovals.findFirst({ where: eq(decisionApprovals.id, appr3) }))?.status === 'rejected');

    console.log('\nDECISION-APPROVALS GATE:', fails.length ? `FAILED (${fails.join(', ')})` : 'ALL PASS');
  } finally {
    if (nodeIds.length) {
      await db.delete(graphEdges).where(inArray(graphEdges.fromNodeId, nodeIds));
      await db.delete(graphEdges).where(inArray(graphEdges.toNodeId, nodeIds));
      await db.delete(graphNodes).where(inArray(graphNodes.id, nodeIds)); // cascades decision_approvals
    }
    if (docIds.length) {
      await db.delete(graphNodes).where(and(eq(graphNodes.workspaceId, WS!), eq(graphNodes.entityType, 'doc'), inArray(graphNodes.entityId, docIds)));
      await db.delete(docs).where(inArray(docs.id, docIds));
    }
    console.log('(cleaned up throwaway [P3B-TEST] decisions)');
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
