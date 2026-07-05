/**
 * MCP tool: `propose_flow_publish`.
 *
 * Phase 10 Chunk 2 — model-facing half of the flow-publish write-preview.
 * Validates the draft, computes a node diff vs. the currently published
 * version, issues a signed proposal_token, and returns a preview WITHOUT
 * publishing. The publish only happens when the user clicks Approve.
 *
 * Visibility: ["model"]. Companion: commit_flow_publish (["app"]).
 *
 * Gate: requireWriteScope → live role check → resolve draft → validate
 *       → diff → issue token. No audit here (audit happens in commit).
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { validateFlow } from '../../lib/flows/validate.js';
import { flowEdges, flowNodes, flowVersions, flows, workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { hashContent, issueProposalToken, storeProposalContent } from '../apps/proposal-token.js';

const WRITE_ROLES = new Set(['owner', 'editor']);

export const PROPOSE_FLOW_PUBLISH_TOOL_NAME = 'propose_flow_publish';

export const PROPOSE_FLOW_PUBLISH_TOOL_SPEC = {
  name: PROPOSE_FLOW_PUBLISH_TOOL_NAME,
  description: [
    'Propose publishing a flow\'s draft and open an interactive preview panel.',
    '',
    'This is the way to publish a flow when the user asks to publish one.',
    'The preview shows the validation result and a node-level diff vs. the',
    'currently published version — the publish only fires when the user',
    'clicks Approve.',
    '',
    'A draft that fails validation is NOT proposed — the specific integrity',
    'errors are returned so you can fix them first.',
    'REQUIRES: workspace:write scope.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_id: {
        type: 'string',
        description: 'UUID of the flow to publish. Use the `uuid` field from list_flows (not the slug `id` field).',
      },
      publish_message: {
        type: 'string',
        description: 'Optional note describing what changed.',
      },
    },
    required: ['flow_id'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Propose publishing a flow (with preview)' },
};

const argsSchema = z.object({
  flow_id: z.string().uuid(),
  publish_message: z.string().max(2000).optional(),
}).strict();

export interface ProposeFlowPublishResult {
  content: string;
  structuredContent: Record<string, unknown>;
  error?: string;
  message?: string;
  validation_errors?: string[];
}

// ── Decision branch completeness check (copied from publish-flow.ts) ──────────
/**
 * For each decision node, verify that every declared branch label has an
 * outgoing edge in the draft. validateFlow checks structural integrity (DAG,
 * entry, reachability); this catches "wired half-baked decision nodes".
 */
function checkDecisionBranchesComplete(
  nodes: Array<{ client_node_id: string; kind: string; data: Record<string, unknown> }>,
  edges: Array<{ from_node_id: string; from_socket: string }>,
): string | null {
  for (const node of nodes) {
    if (node.kind !== 'decision') continue;
    const branches = (node.data.branches ?? {}) as Record<string, unknown>;
    const declaredLabels = Object.keys(branches);
    for (const label of declaredLabels) {
      const hasEdge = edges.some(
        (e) => e.from_node_id === node.client_node_id && e.from_socket === label,
      );
      if (!hasEdge) {
        return `Decision node "${node.client_node_id}" is missing an outgoing edge for branch "${label}". All branches must be wired before publishing.`;
      }
    }
  }
  return null;
}

export async function proposeFlowPublish(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<ProposeFlowPublishResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  // Live role check
  const [member] = await withSystemPrivilege((tx) =>
    tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, ctx.user_id), eq(workspaceMembers.workspaceId, ctx.tenant_id)))
      .limit(1),
  );
  if (!member || !WRITE_ROLES.has(member.role)) {
    return {
      content: 'Error: insufficient role.',
      structuredContent: {},
      error: 'insufficient_role',
      message: 'Only workspace owners, admins, and editors can publish flows.',
    };
  }

  // Resolve flow + draft + nodes/edges + published-version diff.
  const resolved = await withTenant(ctx.tenant_id, async (tx) => {
    const flowRows = await tx
      .select({
        id: flows.id,
        name: flows.name,
        publishedVersionId: flows.publishedVersionId,
      })
      .from(flows)
      .where(and(eq(flows.id, args.flow_id), isNull(flows.deletedAt)))
      .limit(1);
    if (flowRows.length === 0) {
      return { error: 'flow_not_found' as const };
    }
    const flow = flowRows[0]!;

    // Draft = latest unpublished version.
    const draftRows = await tx
      .select({ id: flowVersions.id, versionNumber: flowVersions.versionNumber })
      .from(flowVersions)
      .where(and(eq(flowVersions.flowId, args.flow_id), eq(flowVersions.isPublished, false)))
      .orderBy(flowVersions.versionNumber)
      .limit(1);
    if (draftRows.length === 0) {
      return { error: 'no_draft' as const, flowName: flow.name };
    }
    const draft = draftRows[0]!;

    // Draft nodes + edges.
    const draftNodes = await tx
      .select({
        clientNodeId: flowNodes.clientNodeId,
        kind: flowNodes.kind,
        title: flowNodes.title,
        positionX: flowNodes.positionX,
        positionY: flowNodes.positionY,
        data: flowNodes.data,
      })
      .from(flowNodes)
      .where(eq(flowNodes.flowVersionId, draft.id));

    const draftEdges = await tx
      .select({
        fromNodeId: flowEdges.fromNodeId,
        toNodeId: flowEdges.toNodeId,
        fromSocket: flowEdges.fromSocket,
      })
      .from(flowEdges)
      .where(eq(flowEdges.flowVersionId, draft.id));

    // Published version (for diff + version label), if any.
    let publishedVersionNumber: number | null = null;
    let publishedNodes: Array<{ clientNodeId: string; data: unknown }> = [];
    if (flow.publishedVersionId) {
      const pubRows = await tx
        .select({ versionNumber: flowVersions.versionNumber })
        .from(flowVersions)
        .where(eq(flowVersions.id, flow.publishedVersionId))
        .limit(1);
      publishedVersionNumber = pubRows[0]?.versionNumber ?? null;
      publishedNodes = await tx
        .select({ clientNodeId: flowNodes.clientNodeId, data: flowNodes.data })
        .from(flowNodes)
        .where(eq(flowNodes.flowVersionId, flow.publishedVersionId));
    }

    return {
      flowName: flow.name,
      draft,
      draftNodes,
      draftEdges,
      publishedVersionNumber,
      publishedNodes,
    };
  });

  if (resolved.error === 'flow_not_found') {
    return {
      content: `Error: flow ${args.flow_id} not found.`,
      structuredContent: {},
      error: 'flow_not_found',
      message: `Flow ${args.flow_id} not found in this workspace.`,
    };
  }
  if (resolved.error === 'no_draft') {
    return {
      content: 'Error: no draft version found.',
      structuredContent: {},
      error: 'no_draft',
      message: 'No draft version found. Use the node/edge tools to build a draft first.',
    };
  }

  const { flowName, draft, draftNodes, draftEdges, publishedVersionNumber, publishedNodes } = resolved;

  // ── Validate the draft ──────────────────────────────────────────────────────
  const validationNodes = draftNodes.map((n) => ({
    client_node_id: n.clientNodeId,
    kind: n.kind as 'doc' | 'docs' | 'instruction' | 'decision',
    title: n.title,
    position_x: n.positionX,
    position_y: n.positionY,
    data: n.data as Record<string, unknown>,
  }));
  const validationEdges = draftEdges.map((e) => ({
    from_node_id: e.fromNodeId,
    to_node_id: e.toNodeId,
    from_socket: e.fromSocket,
  }));

  const validation = validateFlow(validationNodes, validationEdges);
  if (!validation.valid) {
    return {
      content: 'Error: draft failed pre-publish validation.',
      structuredContent: {},
      error: validation.errors[0]?.code ?? 'validation_failed',
      message: 'Draft failed pre-publish validation. Fix the issues before publishing.',
      validation_errors: validation.errors.map((e) => e.message),
    };
  }
  const branchError = checkDecisionBranchesComplete(
    validationNodes,
    validationEdges.map((e) => ({ from_node_id: e.from_node_id, from_socket: e.from_socket })),
  );
  if (branchError) {
    return {
      content: 'Error: draft has an incomplete decision node.',
      structuredContent: {},
      error: 'incomplete_decision',
      message: branchError,
      validation_errors: [branchError],
    };
  }

  // ── Node diff vs. published version (keyed by client_node_id) ───────────────
  const pubMap = new Map(publishedNodes.map((n) => [n.clientNodeId, JSON.stringify(n.data ?? null)]));
  const draftMap = new Map(draftNodes.map((n) => [n.clientNodeId, JSON.stringify(n.data ?? null)]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [id, draftData] of draftMap) {
    if (!pubMap.has(id)) {
      added.push(id);
    } else if (pubMap.get(id) !== draftData) {
      changed.push(id);
    }
  }
  for (const id of pubMap.keys()) {
    if (!draftMap.has(id)) removed.push(id);
  }

  // Draft version hash binds the exact draft the user is approving.
  const versionHash = hashContent(`${args.flow_id}:${draft.id}:${draft.versionNumber}`);

  const { token, nonce, exp } = issueProposalToken({
    u: ctx.user_id,
    w: ctx.tenant_id,
    d: args.flow_id,
    op: 'flow_publish',
    h: versionHash,
  });

  // Store an empty content entry so the commit gets the nonce for idempotency.
  storeProposalContent(nonce, '', exp);

  const nodeSummary = `${added.length} added, ${removed.length} removed, ${changed.length} changed`;

  const structuredContent: Record<string, unknown> = {
    commit_tool: 'commit_flow_publish',
    preview: {
      kind: 'flow_publish',
      flow_name: flowName,
      draft_version: draft.versionNumber,
      published_version: publishedVersionNumber,
      node_diff: { added, removed, changed },
      branch_summary: `${draftNodes.length} nodes, ${draftEdges.length} edges`,
      publish_message: args.publish_message ?? null,
    },
    proposal_token: token,
  };

  const contentSummary =
    `Proposed: publish flow "${flowName}" (draft v${draft.versionNumber}). ${nodeSummary}. ` +
    'Awaiting user approval.';

  return { content: contentSummary, structuredContent };
}
