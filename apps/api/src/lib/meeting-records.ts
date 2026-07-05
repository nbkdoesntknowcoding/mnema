/**
 * Aspect 6 / M1 — episodic meeting-record store: create / read / delete, with the record's
 * graph representation (the meeting node + discrete `decision` nodes) and right-to-be-
 * forgotten deletion of those semantic nodes.
 *
 * Distinct from meetings.summary: meeting_records is the durable EPISODIC store the M2
 * consolidation worker writes and the M3 brief assembler reads. acl_scope is set on write
 * (project else workspace least-privilege). Idempotent on meeting_id so re-running M2 for the
 * same meeting updates rather than duplicates. Participant/task graph edges are already wired
 * onto the shared `meeting` node by syncMeetingNode (lib/graph/meeting-graph.ts); M1 adds the
 * genuinely-missing piece — discrete `decision` nodes (meeting ──decided──▶ decision) — so
 * decisions are queryable/traversable, not just jsonb strings.
 */
import { and, eq, inArray, like } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.js';
import { recordDecision } from './decisions.js';

const { meetingRecords, graphNodes, graphEdges, docs } = schema;

// Accepts the top-level db or a transaction (both are PostgresJsDatabase-compatible).
type Tx = PostgresJsDatabase<typeof schema>;

export interface MeetingRecordInput {
  meetingId: string;
  projectId?: string | null;
  title?: string | null;
  participants?: Array<{ name?: string | null; email?: string | null; userId?: string | null }>;
  startedAt?: Date | null;
  endedAt?: Date | null;
  summary?: string | null;
  decisions?: string[];
  actionItems?: Array<{ text: string; owner?: string | null }>;
  commitments?: schema.MeetingCommitment[];
  sourceRefs?: Record<string, unknown>;
}

/** Least-privilege scope the record's spoken content may surface in. Pure. */
export function deriveAclScope(projectId: string | null | undefined, workspaceId: string): string {
  return projectId ? `project:${projectId}` : `workspace:${workspaceId}`;
}

/**
 * M2 consolidation mapping (pure): the meeting-end worker's already-extracted summary
 * (keyPoints / decisions / actionItems) → a MeetingRecordInput. commitments are the action
 * items that named an owner. No LLM here — the extraction already happened in the worker.
 */
export function recordInputFromSummary(
  meeting: {
    id: string; projectId: string | null; title: string | null;
    startedAt: Date | null; endedAt: Date | null; postMeetingDocId?: string | null;
  },
  summary: { keyPoints: string[]; decisions: string[]; actionItems: Array<{ text: string; owner?: string | null }> } | null,
  participants: Array<{ name?: string | null; email?: string | null; userId?: string | null }>,
): MeetingRecordInput {
  const actionItems = summary?.actionItems ?? [];
  return {
    meetingId: meeting.id,
    projectId: meeting.projectId,
    title: meeting.title,
    participants,
    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    summary: summary && summary.keyPoints.length ? summary.keyPoints.join(' ') : null,
    decisions: summary?.decisions ?? [],
    actionItems,
    commitments: actionItems
      .filter((a) => a.owner && a.owner.trim())
      .map((a) => ({ who: a.owner!.trim(), what: a.text })),
    sourceRefs: { postMeetingDocId: meeting.postMeetingDocId ?? null, transcript: 'meeting_transcripts' },
  };
}

// ── minimal idempotent graph helpers (mirrors meeting-graph.ts) ──────────────────
async function upsertNode(
  tx: Tx, workspaceId: string, entityType: string, entityId: string, label: string,
  projectId: string | null = null, summary?: string,
): Promise<string> {
  const [existing] = await tx.select({ id: graphNodes.id }).from(graphNodes)
    .where(and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.entityType, entityType), eq(graphNodes.entityId, entityId)))
    .limit(1);
  if (existing) {
    await tx.update(graphNodes).set({ label, projectId, ...(summary ? { summary } : {}), updatedAt: new Date() }).where(eq(graphNodes.id, existing.id));
    return existing.id;
  }
  const [row] = await tx.insert(graphNodes)
    .values({ workspaceId, entityType, entityId, label, summary, projectId, extractionPass: 'structural' })
    .returning({ id: graphNodes.id });
  return row!.id;
}

async function upsertEdge(tx: Tx, workspaceId: string, fromNodeId: string, toNodeId: string, edgeType: string, weight = 1.0): Promise<void> {
  await tx.insert(graphEdges)
    .values({ workspaceId, fromNodeId, toNodeId, edgeType, provenance: 'EXTRACTED', confidenceScore: 1.0, weight })
    .onConflictDoNothing();
}


/**
 * Create (or idempotently update) the episodic record for a meeting, set acl_scope, and wire
 * its graph: the meeting node + a discrete `decision` node per decision (meeting→decided→
 * decision). Returns the record id. Stale decision nodes (from a previous, longer decision
 * list for the same meeting) are pruned so re-consolidation stays clean.
 */
/** A proposed decision recordDecision produced for a meeting — surfaced so the worker can raise a
 *  decision_approvals row (it has the meeting/approver context this fn doesn't). */
export interface ProposedDecisionRef { nodeId: string; docId: string; supersedeDeferred?: string; }

export async function createMeetingRecord(
  tx: Tx, workspaceId: string, input: MeetingRecordInput,
): Promise<{ recordId: string; proposed: ProposedDecisionRef[] }> {
  const aclScope = deriveAclScope(input.projectId ?? null, workspaceId);
  const decisions = (input.decisions ?? []).map((d) => String(d).trim()).filter(Boolean);
  const values = {
    workspaceId,
    meetingId: input.meetingId,
    projectId: input.projectId ?? null,
    title: input.title ?? null,
    participants: input.participants ?? [],
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    summary: input.summary ?? null,
    decisions,
    actionItems: input.actionItems ?? [],
    commitments: input.commitments ?? [],
    aclScope,
    sourceRefs: input.sourceRefs ?? {},
  };
  const [rec] = await tx.insert(meetingRecords).values(values)
    .onConflictDoUpdate({
      target: meetingRecords.meetingId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: meetingRecords.id });

  // Graph: meeting node + project edge + discrete decision nodes.
  const meetingNode = await upsertNode(tx, workspaceId, 'meeting', input.meetingId, input.title || 'Meeting', input.projectId ?? null);
  if (input.projectId) {
    const projNode = await upsertNode(tx, workspaceId, 'project', input.projectId, 'Project', input.projectId);
    await upsertEdge(tx, workspaceId, meetingNode, projNode, 'belongs_to');
  }
  // Phase 3a: meeting decisions converge onto recordDecision as PROPOSED (human-verify gate).
  // gpt-4o-mini infers these off the transcript, so they must NOT auto-become current or supersede
  // a real decision. recordDecision gives each a doc + umbrella bridge + embedding and lands it
  // 'proposed' (recorded, retrievable-as-proposed, never spoken as settled) — replacing the old
  // inline 'current' insert. We still attribute it to the meeting (meeting ──decided──▶ decision).
  // recordDecision uses the module `db`; createMeetingRecord is called with `db` (no open tx), so
  // these interleave on the same pool safely.
  const decidedAt = input.endedAt ?? input.startedAt ?? new Date();
  const proposed: ProposedDecisionRef[] = [];
  for (const text of decisions) {
    const res = await recordDecision(workspaceId, {
      decisionText: text, projectId: input.projectId ?? null, status: 'proposed',
      decidedIn: input.meetingId, decidedAt,
    });
    await upsertEdge(tx, workspaceId, meetingNode, res.nodeId, 'decided', 1.5);
    proposed.push({ nodeId: res.nodeId, docId: res.docId, supersedeDeferred: res.supersedeDeferred });
  }
  // Drop any legacy meeting-indexed decision nodes (the pre-converge `${meetingId}:decision:${i}`
  // scheme) so re-consolidation is clean — converged decisions are keyed by recordDecision's
  // content hash, not by meeting index.
  await deleteDecisionNodes(tx, workspaceId, input.meetingId, 0);

  return { recordId: rec!.id, proposed };
}

/** Read the episodic record by record id or meeting id (workspace-scoped). */
export async function getMeetingRecord(
  tx: Tx, workspaceId: string, by: { id?: string; meetingId?: string },
) {
  if (!by.id && !by.meetingId) return null;
  const [rec] = await tx.select().from(meetingRecords).where(and(
    eq(meetingRecords.workspaceId, workspaceId),
    by.id ? eq(meetingRecords.id, by.id) : eq(meetingRecords.meetingId, by.meetingId!),
  )).limit(1);
  return rec ?? null;
}

/** Remove a meeting's `decision` graph nodes (entityId index >= fromIndex) and their edges. */
async function deleteDecisionNodes(tx: Tx, workspaceId: string, meetingId: string, fromIndex = 0): Promise<void> {
  const nodes = await tx.select({ id: graphNodes.id, entityId: graphNodes.entityId }).from(graphNodes)
    .where(and(
      eq(graphNodes.workspaceId, workspaceId),
      eq(graphNodes.entityType, 'decision'),
      like(graphNodes.entityId, `${meetingId}:decision:%`),
    ));
  const ids = nodes
    .filter((n) => {
      const idx = Number(n.entityId.split(':').pop());
      return Number.isFinite(idx) && idx >= fromIndex;
    })
    .map((n) => n.id);
  if (ids.length === 0) return;
  await tx.delete(graphEdges).where(inArray(graphEdges.fromNodeId, ids));
  await tx.delete(graphEdges).where(inArray(graphEdges.toNodeId, ids));
  await tx.delete(graphNodes).where(inArray(graphNodes.id, ids));
}

/**
 * Converged (Phase 3a+) meeting decisions are keyed by content hash, not meeting index, so they're
 * identified by `decided_in` (NOT the legacy `meetingId:decision:i` entityId). Right-to-be-forgotten
 * must remove them fully: the decision node + its edges + its decision doc (and the doc graph node).
 * decision_approvals rows cascade off the decision node FK. Pure cleanup; no-op when there are none.
 */
async function deleteConvergedDecisions(tx: Tx, workspaceId: string, meetingId: string): Promise<void> {
  const nodes = await tx.select({ id: graphNodes.id }).from(graphNodes).where(and(
    eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.entityType, 'decision'), eq(graphNodes.decidedIn, meetingId),
  ));
  const ids = nodes.map((n) => n.id);
  if (ids.length === 0) return;
  // the decision docs: each decision node ──documented_by──▶ its doc node (entityId = doc uuid).
  const docEdges = await tx.select({ toNodeId: graphEdges.toNodeId }).from(graphEdges)
    .where(and(inArray(graphEdges.fromNodeId, ids), eq(graphEdges.edgeType, 'documented_by')));
  const docNodeIds = docEdges.map((e) => e.toNodeId);
  let docUuids: string[] = [];
  if (docNodeIds.length) {
    const docNodes = await tx.select({ entityId: graphNodes.entityId }).from(graphNodes)
      .where(and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.entityType, 'doc'), inArray(graphNodes.id, docNodeIds)));
    docUuids = docNodes.map((n) => n.entityId);
  }
  await tx.delete(graphEdges).where(inArray(graphEdges.fromNodeId, ids));
  await tx.delete(graphEdges).where(inArray(graphEdges.toNodeId, ids));
  await tx.delete(graphNodes).where(inArray(graphNodes.id, ids)); // cascades decision_approvals
  if (docUuids.length) {
    await tx.delete(graphNodes).where(and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.entityType, 'doc'), inArray(graphNodes.entityId, docUuids)));
    await tx.delete(docs).where(inArray(docs.id, docUuids));
  }
}

/**
 * Right-to-be-forgotten: delete the episodic record AND its linked semantic nodes (the
 * discrete decision nodes + their edges + decision docs). The shared `meeting` node is left to
 * syncMeetingNode (it represents the meeting, not just this record). Returns true if deleted.
 */
export async function deleteMeetingRecord(tx: Tx, workspaceId: string, recordId: string): Promise<boolean> {
  const rec = await getMeetingRecord(tx, workspaceId, { id: recordId });
  if (!rec) return false;
  await deleteDecisionNodes(tx, workspaceId, rec.meetingId, 0);          // legacy meetingId:decision:i (pre-converge)
  await deleteConvergedDecisions(tx, workspaceId, rec.meetingId);        // converged decision:<hash> + docs
  await tx.delete(meetingRecords).where(and(eq(meetingRecords.workspaceId, workspaceId), eq(meetingRecords.id, recordId)));
  return true;
}
