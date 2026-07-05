/**
 * verify-proposed-decisions.ts — Phase-3a STEP-2 DB gate. Exercises recordDecision's proposed mode
 * + DEFERRED supersede directly (the meeting path doesn't pass `supersedes`, so this is the only
 * caller that hits the deferred branch), and confirms the tool path (status='current') is unchanged.
 *
 * Run in the api container against the live DB:
 *   VERIFY_WS=<workspaceId> VERIFY_PROJECT=<projectId|> tsx src/scripts/verify-proposed-decisions.ts
 *
 * Writes throwaway [P3A-TEST] decisions and DELETES them at the end (nodes + docs + edges).
 */
import { and, eq, inArray, like } from 'drizzle-orm';
import { db } from '../db/index.js';
import { graphNodes, graphEdges, docs, decisionApprovals } from '../db/schema.js';
import { recordDecision } from '../lib/decisions.js';

const WS = process.env.VERIFY_WS;
const PROJECT = process.env.VERIFY_PROJECT || null;

const fails: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
}

async function nodeById(id: string) {
  return db.query.graphNodes.findFirst({ where: eq(graphNodes.id, id) });
}
async function edge(from: string, to: string, type: string) {
  const [e] = await db.select({ id: graphEdges.id }).from(graphEdges)
    .where(and(eq(graphEdges.fromNodeId, from), eq(graphEdges.toNodeId, to), eq(graphEdges.edgeType, type))).limit(1);
  return e;
}

async function main(): Promise<void> {
  if (!WS) { console.error('FATAL: set VERIFY_WS=<workspaceId>'); process.exit(2); }
  const createdNodeIds: string[] = [];
  const createdDocIds: string[] = [];
  const t = Date.now();

  try {
    // ── baseline: a CURRENT decision (tool path) ──
    const base = await recordDecision(WS, { decisionText: `[P3A-TEST ${t}] base current decision`, projectId: PROJECT });
    createdNodeIds.push(base.nodeId); createdDocIds.push(base.docId);
    check('tool path: base decision is current', base.status === 'current');

    // ── STEP 2: PROPOSED decision that claims to supersede the current one ──
    const prop = await recordDecision(WS, {
      decisionText: `[P3A-TEST ${t}] proposed decision superseding base`, projectId: PROJECT,
      status: 'proposed', supersedes: base.nodeId,
    });
    createdNodeIds.push(prop.nodeId); createdDocIds.push(prop.docId);
    const propNode = await nodeById(prop.nodeId);
    const baseAfter = await nodeById(base.nodeId);

    check('(a) proposed node has status=proposed', propNode?.status === 'proposed', `status=${propNode?.status}`);
    check('(a) proposed node STASHED the supersede target', propNode?.supersedes === base.nodeId);
    check('(a) recordDecision reported supersedeDeferred (not applied)', prop.supersedeDeferred === base.nodeId && !prop.supersededOldId);
    check('(b) OLD decision is STILL current (not historical)', baseAfter?.status === 'current', `status=${baseAfter?.status}`);
    check('(b) OLD decision has NO superseded_by', !baseAfter?.supersededBy);
    check('(b) NO supersedes edge written for the proposed decision', !(await edge(prop.nodeId, base.nodeId, 'supersedes')));
    check('(c) proposed node has its documented_by bridge to its doc', !!(await edge(prop.nodeId,
      (await db.select({ id: graphNodes.id }).from(graphNodes)
        .where(and(eq(graphNodes.workspaceId, WS), eq(graphNodes.entityType, 'doc'), eq(graphNodes.entityId, prop.docId))).limit(1))[0]?.id ?? '', 'documented_by')));

    // ── REGRESSION: tool path (current) superseding still applies immediately ──
    const sup = await recordDecision(WS, {
      decisionText: `[P3A-TEST ${t}] current decision superseding base (tool path)`, projectId: PROJECT,
      supersedes: base.nodeId,   // status defaults to 'current'
    });
    createdNodeIds.push(sup.nodeId); createdDocIds.push(sup.docId);
    const baseAfter2 = await nodeById(base.nodeId);
    check('regression: tool-path supersede APPLIES now (new current)', sup.status === 'current' && sup.supersededOldId === base.nodeId);
    check('regression: tool-path supersede flipped OLD → historical', baseAfter2?.status === 'historical');
    check('regression: tool-path wrote the supersedes edge', !!(await edge(sup.nodeId, base.nodeId, 'supersedes')));

    // ── STEP 1: decision_approvals sibling table + partial-unique (one pending per decision) ──
    await db.insert(decisionApprovals).values({
      workspaceId: WS!, decisionNodeId: prop.nodeId, docId: prop.docId,
      proposerId: null, meetingId: null, supersedesTarget: prop.supersedeDeferred ?? null, status: 'pending',
    }).onConflictDoNothing();
    await db.insert(decisionApprovals).values({   // 2nd pending for the SAME decision → must be rejected
      workspaceId: WS!, decisionNodeId: prop.nodeId, status: 'pending',
    }).onConflictDoNothing();
    const appr = await db.select({ id: decisionApprovals.id }).from(decisionApprovals)
      .where(and(eq(decisionApprovals.decisionNodeId, prop.nodeId), eq(decisionApprovals.status, 'pending')));
    check('STEP1: exactly ONE pending decision_approvals row (partial-unique held)', appr.length === 1, `rows=${appr.length}`);

    console.log('\nPROPOSED-DB GATE:', fails.length ? `FAILED (${fails.join(', ')})` : 'ALL PASS');
  } finally {
    // cleanup throwaway test data
    if (createdNodeIds.length) {
      await db.delete(graphEdges).where(inArray(graphEdges.fromNodeId, createdNodeIds));
      await db.delete(graphEdges).where(inArray(graphEdges.toNodeId, createdNodeIds));
      await db.delete(graphNodes).where(inArray(graphNodes.id, createdNodeIds));
    }
    // also drop the auto-created doc graph nodes + the decision docs
    await db.delete(graphNodes).where(and(eq(graphNodes.workspaceId, WS!), eq(graphNodes.entityType, 'doc'), inArray(graphNodes.entityId, createdDocIds)));
    if (createdDocIds.length) await db.delete(docs).where(inArray(docs.id, createdDocIds));
    // belt-and-suspenders: any stray [P3A-TEST] decision docs
    await db.delete(docs).where(and(eq(docs.workspaceId, WS!), like(docs.title, `%[P3A-TEST ${t}]%`)));
    console.log('(cleaned up throwaway [P3A-TEST] decisions)');
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
