/**
 * MCP tool: `connect_flow_nodes`.
 *
 * Phase 9.4 — creates an edge from one node to another in the flow draft.
 *
 * Enforces the edge rules from Phase 6.3/6.4:
 *   1. Non-decision nodes: at most ONE outgoing edge → too_many_outputs
 *   2. Non-decision nodes: branch_label must be omitted → unexpected_branch
 *   3. Decision nodes: branch_label is REQUIRED → branch_required
 *   4. Decision nodes: branch_label must be a declared branch → unknown_branch
 *   5. No self-edges, no cycles → flow_cycle
 *   6. Both nodes must exist in the same draft → node_not_found
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → resolve draft → validate both nodes exist
 *     → enforce edge rules + cycle check
 *     → INSERT edge into draft
 *     → withAudit → return { from_node_id, to_node_id, branch_label }
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getOrCreateDraftVersion, wouldCreateFlowCycle } from '../../flows/draft.js';
import { flowEdges, flowNodes, flows, workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { withAudit } from './audit.js';

const WRITE_ROLES = new Set(['owner', 'editor']);
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ── Idempotency ───────────────────────────────────────────────────────────────
const idempotencyCache = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
function checkIKey(key: string): boolean {
  const exp = idempotencyCache.get(key);
  if (!exp) return false;
  if (Date.now() > exp) { idempotencyCache.delete(key); return false; }
  return true;
}
function recordIKey(key: string): void {
  if (idempotencyCache.size > 10_000) {
    const now = Date.now();
    for (const [k, e] of idempotencyCache) { if (e < now) idempotencyCache.delete(k); }
  }
  idempotencyCache.set(key, Date.now() + IDEMPOTENCY_TTL_MS);
}

// ── Tool spec ─────────────────────────────────────────────────────────────────

export const CONNECT_FLOW_NODES_TOOL = {
  name: 'connect_flow_nodes',
  description: [
    'Create an edge from one node to another in a flow draft.',
    '',
    'For a normal (doc/docs/instruction) source node:',
    '  - Omit branch_label — the node gets its single outgoing edge.',
    '  - Adding a second outgoing edge → error: too_many_outputs.',
    '',
    'For a decision source node:',
    '  - Supply branch_label (one of the decision\'s kebab-case branch labels).',
    '  - One edge per branch label; all branches can be connected independently.',
    '  - Missing label → branch_required; bogus label → unknown_branch.',
    '',
    'Cannot create a cycle (flows are DAGs) → error: flow_cycle.',
    '',
    'SAFETY — this tool modifies workspace content. Required before calling:',
    '  1. Show the user which nodes you are connecting.',
    '  2. Ask: "Should I connect these nodes?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    '',
    'REQUIRES: workspace:write scope.',
    '',
    'Returns { from_node_id, to_node_id, branch_label } on success.',
    'Errors: flow_not_found, node_not_found, too_many_outputs, unexpected_branch,',
    '        branch_required, unknown_branch, flow_cycle.',
    '',
    'SEQUENCING — add all nodes first, then connect them. Batch edge creation at',
    'the end of the node phase. Adding edges incrementally (one per node) makes the',
    'in-progress graph look incomplete and harder to review.',
    'Exception: decision node outgoing edges — connect these immediately after',
    'adding the decision node to avoid leaving dangling branches visible in the',
    'canvas.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_id: { type: 'string', description: 'UUID of the flow.' },
      from_node_id: { type: 'string', description: 'client_node_id of the source node.' },
      to_node_id: { type: 'string', description: 'client_node_id of the target node.' },
      branch_label: { type: 'string', description: 'Required if source is a decision node: which branch this edge represents. Omit for non-decision nodes.' },
      idempotency_key: { type: 'string', description: 'Caller-chosen unique key for safe retries.' },
      user_confirmed: { type: 'boolean', description: 'Must be true. Get explicit user approval first.' },
    },
    required: ['flow_id', 'from_node_id', 'to_node_id', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Connect two flow nodes' },
};

const argsSchema = z.object({
  flow_id: z.string().uuid(),
  from_node_id: z.string().min(1).max(64),
  to_node_id: z.string().min(1).max(64),
  branch_label: z.string().min(1).max(64).regex(KEBAB_RE, 'branch_label must be kebab-case').optional(),
  idempotency_key: z.string().min(1).max(128).default(() => nanoid()),
  user_confirmed: z.boolean(),
}).strict();

export interface ConnectFlowNodesResult {
  from_node_id?: string;
  to_node_id?: string;
  branch_label?: string | null;
  flow_id?: string;
  draft_version_id?: string;
  error?: string;
  message?: string;
}

export async function connectFlowNodes(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<ConnectFlowNodesResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  if (!args.user_confirmed) {
    return { error: 'user_confirmation_required', message: 'Show the user which nodes you are connecting and wait for their explicit approval before calling with user_confirmed=true.' };
  }

  if (args.from_node_id === args.to_node_id) {
    return { error: 'flow_cycle', message: 'Cannot connect a node to itself.' };
  }

  return await withAudit(
    ctx,
    { tool_name: CONNECT_FLOW_NODES_TOOL.name, args: args as Record<string, unknown> },
    async (): Promise<ConnectFlowNodesResult> => {
      const iKey = `${ctx.tenant_id}:connect_flow_nodes:${args.flow_id}:${args.from_node_id}:${args.to_node_id}:${args.branch_label ?? 'default'}:${args.idempotency_key}`;
      if (checkIKey(iKey)) return { error: 'idempotency_duplicate', message: 'This idempotency_key was already used within the past hour.' };

      const [member] = await withSystemPrivilege((tx) =>
        tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, ctx.user_id), eq(workspaceMembers.workspaceId, ctx.tenant_id)))
          .limit(1),
      );
      if (!member || !WRITE_ROLES.has(member.role)) {
        return { error: 'insufficient_role', message: 'Only workspace owners, admins, and editors can edit flows.' };
      }

      const result = await withTenant(ctx.tenant_id, async (tx) => {
        const flowRows = await tx.select({ id: flows.id }).from(flows)
          .where(and(eq(flows.id, args.flow_id), isNull(flows.deletedAt))).limit(1);
        if (flowRows.length === 0) return { error: 'flow_not_found', message: `Flow ${args.flow_id} not found.` };

        const draftVersionId = await getOrCreateDraftVersion(args.flow_id, ctx.user_id, tx);

        // Resolve both nodes in the draft
        const nodeRows = await tx
          .select({ clientNodeId: flowNodes.clientNodeId, kind: flowNodes.kind, data: flowNodes.data })
          .from(flowNodes)
          .where(eq(flowNodes.flowVersionId, draftVersionId));

        const nodeMap = new Map(nodeRows.map((n) => [n.clientNodeId, n]));
        const fromNode = nodeMap.get(args.from_node_id);
        const toNode = nodeMap.get(args.to_node_id);

        if (!fromNode) return { error: 'node_not_found', message: `Source node "${args.from_node_id}" not found in draft.` };
        if (!toNode) return { error: 'node_not_found', message: `Target node "${args.to_node_id}" not found in draft.` };

        // ── Edge rule enforcement ──────────────────────────────────────────────

        if (fromNode.kind === 'decision') {
          // Decision nodes: branch_label is required
          if (!args.branch_label) {
            return { error: 'branch_required', message: 'Source is a decision node — supply branch_label (one of its declared branch labels).' };
          }
          // Validate branch_label is a declared branch
          const data = fromNode.data as Record<string, unknown>;
          const branches = (data.branches ?? {}) as Record<string, unknown>;
          const declaredLabels = Object.keys(branches);
          if (!declaredLabels.includes(args.branch_label)) {
            return {
              error: 'unknown_branch',
              message: `Branch label "${args.branch_label}" is not declared on decision node "${args.from_node_id}". Declared: ${declaredLabels.join(', ')}.`,
            };
          }
          // One edge per branch — check for duplicate
          const dupEdge = await tx.select({ id: flowEdges.id }).from(flowEdges)
            .where(and(
              eq(flowEdges.flowVersionId, draftVersionId),
              eq(flowEdges.fromNodeId, args.from_node_id),
              eq(flowEdges.fromSocket, args.branch_label),
            )).limit(1);
          if (dupEdge.length > 0) {
            return { error: 'too_many_outputs', message: `Decision node "${args.from_node_id}" already has an outgoing edge for branch "${args.branch_label}".` };
          }
        } else {
          // Non-decision nodes: branch_label must be omitted
          if (args.branch_label) {
            return { error: 'unexpected_branch', message: `Node "${args.from_node_id}" (kind: ${fromNode.kind}) is not a decision node — do not supply branch_label.` };
          }
          // Single out-edge rule
          const existingOut = await tx.select({ id: flowEdges.id }).from(flowEdges)
            .where(and(eq(flowEdges.flowVersionId, draftVersionId), eq(flowEdges.fromNodeId, args.from_node_id)))
            .limit(1);
          if (existingOut.length > 0) {
            return { error: 'too_many_outputs', message: `Node "${args.from_node_id}" (kind: ${fromNode.kind}) already has one outgoing edge. Non-decision nodes allow at most one outgoing edge.` };
          }
        }

        // ── Cycle check ──────────────────────────────────────────────────────
        const isCycle = await wouldCreateFlowCycle(draftVersionId, args.from_node_id, args.to_node_id, tx);
        if (isCycle) {
          return { error: 'flow_cycle', message: `Adding an edge from "${args.from_node_id}" to "${args.to_node_id}" would create a cycle. Flows must be DAGs.` };
        }

        // ── Insert edge ──────────────────────────────────────────────────────
        const fromSocket = args.branch_label ?? 'default';
        await tx.insert(flowEdges).values({
          flowVersionId: draftVersionId,
          fromNodeId: args.from_node_id,
          toNodeId: args.to_node_id,
          fromSocket,
        });

        return {
          from_node_id: args.from_node_id,
          to_node_id: args.to_node_id,
          branch_label: args.branch_label ?? null,
          flow_id: args.flow_id,
          draft_version_id: draftVersionId,
        };
      });

      if (!result.error) recordIKey(iKey);
      return result;
    },
    (r) => ({ from_node_id: r.from_node_id ?? null, to_node_id: r.to_node_id ?? null, error: r.error ?? null }),
  );
}
