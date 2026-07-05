/**
 * Draft version helpers (Phase 9.4).
 *
 * `getOrCreateDraftVersion` is the shared "resolve the editable version"
 * primitive used by every node/edge write tool. It follows the spec from
 * Phase 6.3:
 *
 *   1. If an unpublished (draft) version already exists → return its id.
 *   2. Else clone the published version's nodes + edges into a new
 *      version row (is_published = false, version_number = max + 1).
 *   3. If no published version either (brand-new flow) → return the
 *      empty version that was created by create_flow.
 *
 * All callers pass the same Drizzle transaction (`tx`) they already have
 * open, so the draft resolution and subsequent mutations are atomic.
 */

import { and, desc, eq, max, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { flowEdges, flowNodes, flowVersions, flows } from '../db/schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Resolve (or create) the current draft version for `flowId`.
 * Returns the draft version UUID.
 * Throws if the flow does not exist or is deleted.
 */
export async function getOrCreateDraftVersion(
  flowId: string,
  createdBy: string,
  tx: Tx,
): Promise<string> {
  // 1. Look for an existing unpublished version.
  const draftRows = await tx
    .select({ id: flowVersions.id })
    .from(flowVersions)
    .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.isPublished, false)))
    .orderBy(desc(flowVersions.versionNumber))
    .limit(1);

  if (draftRows.length > 0) return draftRows[0]!.id;

  // 2. No draft — look for a published version to clone from.
  const publishedRows = await tx
    .select({ id: flowVersions.id })
    .from(flowVersions)
    .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.isPublished, true)))
    .orderBy(desc(flowVersions.versionNumber))
    .limit(1);

  // Determine the next version number.
  const maxRow = await tx
    .select({ m: max(flowVersions.versionNumber) })
    .from(flowVersions)
    .where(eq(flowVersions.flowId, flowId));
  const nextVersion = (maxRow[0]?.m ?? 0) + 1;

  // Get workspaceId from the flow row (flow_versions joined through flows).
  const flowRows = await tx
    .select({ workspaceId: flows.workspaceId })
    .from(flows)
    .where(eq(flows.id, flowId))
    .limit(1);
  if (flowRows.length === 0) throw new Error('flow_not_found');
  const workspaceId = flowRows[0]!.workspaceId;

  // Insert the new draft version.
  const inserted = await tx
    .insert(flowVersions)
    .values({
      flowId,
      workspaceId,
      versionNumber: nextVersion,
      isPublished: false,
      createdBy,
    })
    .returning({ id: flowVersions.id });
  const newVersionId = inserted[0]?.id;
  if (!newVersionId) throw new Error('Failed to create draft version');

  // 3. Clone nodes + edges from the published version if one exists.
  if (publishedRows.length > 0) {
    const sourceId = publishedRows[0]!.id;

    const sourceNodes = await tx
      .select()
      .from(flowNodes)
      .where(eq(flowNodes.flowVersionId, sourceId));

    if (sourceNodes.length > 0) {
      await tx.insert(flowNodes).values(
        sourceNodes.map((n) => ({
          flowVersionId: newVersionId,
          clientNodeId: n.clientNodeId,
          kind: n.kind,
          title: n.title,
          positionX: n.positionX,
          positionY: n.positionY,
          data: n.data as Record<string, unknown>,
        })),
      );
    }

    const sourceEdges = await tx
      .select()
      .from(flowEdges)
      .where(eq(flowEdges.flowVersionId, sourceId));

    if (sourceEdges.length > 0) {
      await tx.insert(flowEdges).values(
        sourceEdges.map((e) => ({
          flowVersionId: newVersionId,
          fromNodeId: e.fromNodeId,
          toNodeId: e.toNodeId,
          fromSocket: e.fromSocket,
        })),
      );
    }
  }

  return newVersionId;
}

/**
 * Check whether adding an edge from → to in `versionId` would create a cycle.
 * Walks forward from `toNodeId` using BFS; if `fromNodeId` is reachable,
 * the proposed edge would close a loop → cycle.
 */
export async function wouldCreateFlowCycle(
  versionId: string,
  fromNodeId: string,
  toNodeId: string,
  tx: Tx,
): Promise<boolean> {
  if (fromNodeId === toNodeId) return true; // self-edge is always a cycle

  const visited = new Set<string>();
  const queue: string[] = [toNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === fromNodeId) return true; // reached the source → cycle
    if (visited.has(current)) continue;
    visited.add(current);

    const outgoing = await tx
      .select({ toNodeId: flowEdges.toNodeId })
      .from(flowEdges)
      .where(
        and(
          eq(flowEdges.flowVersionId, versionId),
          eq(flowEdges.fromNodeId, current),
        ),
      );

    for (const e of outgoing) {
      if (!visited.has(e.toNodeId)) queue.push(e.toNodeId);
    }
  }

  return false;
}
