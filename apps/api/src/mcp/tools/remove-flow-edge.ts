/**
 * MCP tool: `remove_flow_edge`.
 *
 * Phase 9.4 — removes a single edge from the flow draft.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → resolve draft → locate the edge
 *     → DELETE the edge
 *     → withAudit → return { removed: true }
 *
 * destructiveHint: true — deletes graph structure from the draft.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getOrCreateDraftVersion } from '../../flows/draft.js';
import { flowEdges, flows, workspaceMembers } from '../../db/schema.js';
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

export const REMOVE_FLOW_EDGE_TOOL = {
  name: 'remove_flow_edge',
  description: [
    'Remove an edge from a flow draft. The published version stays untouched until',
    'the draft is published via propose_flow_publish.',
    '',
    'For decision-source edges, supply the branch_label to identify which branch',
    'edge to remove. Omit for non-decision source edges.',
    '',
    'SAFETY — this removes graph structure from the draft. Required before calling:',
    '  1. Show the user the edge you are about to remove.',
    '  2. Ask: "Should I remove this edge?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    '',
    'REQUIRES: workspace:write scope.',
    '',
    'Returns { removed: true } on success.',
    'Errors: flow_not_found, edge_not_found.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_id: { type: 'string', description: 'UUID of the flow.' },
      from_node_id: { type: 'string', description: 'client_node_id of the source node.' },
      to_node_id: { type: 'string', description: 'client_node_id of the target node.' },
      branch_label: { type: 'string', description: 'For decision-source edges: which branch edge to remove.' },
      idempotency_key: { type: 'string', description: 'Caller-chosen unique key for safe retries.' },
      user_confirmed: { type: 'boolean', description: 'Must be true. Get explicit user approval first.' },
    },
    required: ['flow_id', 'from_node_id', 'to_node_id', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: true, title: 'Remove a flow edge' },
};

const argsSchema = z.object({
  flow_id: z.string().uuid(),
  from_node_id: z.string().min(1).max(64),
  to_node_id: z.string().min(1).max(64),
  branch_label: z.string().min(1).max(64).optional(),
  idempotency_key: z.string().min(1).max(128).default(() => nanoid()),
  user_confirmed: z.boolean(),
}).strict();

export interface RemoveFlowEdgeResult {
  removed?: boolean;
  flow_id?: string;
  draft_version_id?: string;
  error?: string;
  message?: string;
}

export async function removeFlowEdge(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<RemoveFlowEdgeResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  if (!args.user_confirmed) {
    return { error: 'user_confirmation_required', message: 'Show the user the edge you plan to remove and wait for their explicit approval before calling with user_confirmed=true.' };
  }

  return await withAudit(
    ctx,
    { tool_name: REMOVE_FLOW_EDGE_TOOL.name, args: args as Record<string, unknown> },
    async (): Promise<RemoveFlowEdgeResult> => {
      const iKey = `${ctx.tenant_id}:remove_flow_edge:${args.flow_id}:${args.from_node_id}:${args.to_node_id}:${args.branch_label ?? 'default'}:${args.idempotency_key}`;
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
        const fromSocket = args.branch_label ?? 'default';

        // Confirm edge exists
        const edgeRows = await tx.select({ id: flowEdges.id }).from(flowEdges)
          .where(and(
            eq(flowEdges.flowVersionId, draftVersionId),
            eq(flowEdges.fromNodeId, args.from_node_id),
            eq(flowEdges.toNodeId, args.to_node_id),
            eq(flowEdges.fromSocket, fromSocket),
          )).limit(1);
        if (edgeRows.length === 0) {
          return {
            error: 'edge_not_found',
            message: `No edge from "${args.from_node_id}" to "${args.to_node_id}"${args.branch_label ? ` (branch: ${args.branch_label})` : ''} in draft.`,
          };
        }

        await tx.delete(flowEdges).where(and(
          eq(flowEdges.flowVersionId, draftVersionId),
          eq(flowEdges.fromNodeId, args.from_node_id),
          eq(flowEdges.toNodeId, args.to_node_id),
          eq(flowEdges.fromSocket, fromSocket),
        ));

        return { removed: true, flow_id: args.flow_id, draft_version_id: draftVersionId };
      });

      if (!result.error) recordIKey(iKey);
      return result;
    },
    (r) => ({ removed: r.removed ?? null, flow_id: r.flow_id ?? null, error: r.error ?? null }),
  );
}
