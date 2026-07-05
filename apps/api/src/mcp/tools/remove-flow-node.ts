/**
 * MCP tool: `remove_flow_node`.
 *
 * Phase 9.4 — removes a node from the flow draft AND all edges connected
 * to it (both incoming and outgoing), in a single transaction.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → resolve flow + draft version → locate node
 *     → DELETE node + all connected edges
 *     → withAudit → return { removed_node, removed_edge_count }
 *
 * destructiveHint: true — deletes graph structure from the draft.
 * Draft-only: the published version is untouched until propose_flow_publish.
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getOrCreateDraftVersion } from '../../flows/draft.js';
import { flowEdges, flowNodes, flows, workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { withAudit } from './audit.js';

const WRITE_ROLES = new Set(['owner', 'editor']);

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

export const REMOVE_FLOW_NODE_TOOL = {
  name: 'remove_flow_node',
  description: [
    'Remove a node from a flow draft. Also removes ALL edges connected to it',
    '(both incoming and outgoing). The published version stays untouched until the',
    'draft is published via propose_flow_publish.',
    '',
    'SAFETY — this permanently removes graph structure from the draft.',
    'Required before calling:',
    '  1. Show the user the node and list any edges that will also be removed.',
    '  2. Ask: "Should I remove this node and its edges?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    '',
    'REQUIRES: workspace:write scope.',
    '',
    'Returns { removed_node, removed_edge_count } on success.',
    'Errors: flow_not_found, node_not_found.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_id: { type: 'string', description: 'UUID of the flow.' },
      client_node_id: { type: 'string', description: 'The client_node_id of the node to remove.' },
      idempotency_key: { type: 'string', description: 'Caller-chosen unique key for safe retries.' },
      user_confirmed: { type: 'boolean', description: 'Must be true. Get explicit user approval first.' },
    },
    required: ['flow_id', 'client_node_id', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: true, title: 'Remove a flow node' },
};

const argsSchema = z.object({
  flow_id: z.string().uuid(),
  client_node_id: z.string().min(1).max(64),
  idempotency_key: z.string().min(1).max(128).default(() => nanoid()),
  user_confirmed: z.boolean(),
}).strict();

export interface RemoveFlowNodeResult {
  removed_node?: string;
  removed_edge_count?: number;
  flow_id?: string;
  draft_version_id?: string;
  error?: string;
  message?: string;
}

export async function removeFlowNode(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<RemoveFlowNodeResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  if (!args.user_confirmed) {
    return { error: 'user_confirmation_required', message: 'Describe the node and any edges that will be removed, then wait for explicit user approval before calling with user_confirmed=true.' };
  }

  return await withAudit(
    ctx,
    { tool_name: REMOVE_FLOW_NODE_TOOL.name, args: args as Record<string, unknown> },
    async (): Promise<RemoveFlowNodeResult> => {
      const iKey = `${ctx.tenant_id}:remove_flow_node:${args.flow_id}:${args.client_node_id}:${args.idempotency_key}`;
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

        // Confirm the node exists in this draft
        const nodeRows = await tx.select({ id: flowNodes.id })
          .from(flowNodes)
          .where(and(eq(flowNodes.flowVersionId, draftVersionId), eq(flowNodes.clientNodeId, args.client_node_id)))
          .limit(1);
        if (nodeRows.length === 0) return { error: 'node_not_found', message: `Node "${args.client_node_id}" not found in draft.` };

        // Delete all connected edges first (FK constraint order)
        const deletedEdges = await tx.delete(flowEdges)
          .where(and(
            eq(flowEdges.flowVersionId, draftVersionId),
            or(
              eq(flowEdges.fromNodeId, args.client_node_id),
              eq(flowEdges.toNodeId, args.client_node_id),
            ),
          ))
          .returning({ id: flowEdges.id });

        // Delete the node itself
        await tx.delete(flowNodes)
          .where(and(
            eq(flowNodes.flowVersionId, draftVersionId),
            eq(flowNodes.clientNodeId, args.client_node_id),
          ));

        return {
          removed_node: args.client_node_id,
          removed_edge_count: deletedEdges.length,
          flow_id: args.flow_id,
          draft_version_id: draftVersionId,
        };
      });

      if (!result.error) recordIKey(iKey);
      return result;
    },
    (r) => ({ removed_node: r.removed_node ?? null, removed_edge_count: r.removed_edge_count ?? null, error: r.error ?? null }),
  );
}
