/**
 * MCP tool: `update_flow_node`.
 *
 * Phase 9.4 — updates an existing node's data (and optionally title/position)
 * in the flow draft. Decision-integrity is re-validated on every update.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → resolve flow + draft version → locate node by client_node_id
 *     → validate new data (kind-specific + decision integrity)
 *     → UPDATE flow_node in draft
 *     → withAudit → return { client_node_id, flow_id, draft_version_id }
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getOrCreateDraftVersion } from '../../flows/draft.js';
import { flowNodes, flows, workspaceMembers } from '../../db/schema.js';
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

// ── Validation (same rules as add_flow_node) ──────────────────────────────────
function validateDecisionData(data: Record<string, unknown>): string | null {
  if (!data.branches || typeof data.branches !== 'object' || Array.isArray(data.branches)) {
    return 'Decision node requires a "branches" object.';
  }
  const branches = data.branches as Record<string, unknown>;
  const branchLabels = Object.keys(branches);
  if (branchLabels.length === 0) return 'Decision node must have at least one branch.';
  for (const label of branchLabels) {
    if (!KEBAB_RE.test(label)) return `Branch label "${label}" must be kebab-case.`;
  }
  if (typeof data.default_branch !== 'string') return 'Decision node requires a "default_branch" string.';
  if (!branchLabels.includes(data.default_branch as string)) {
    return `"default_branch" ("${data.default_branch}") must be one of the declared branch labels: ${branchLabels.join(', ')}.`;
  }
  return null;
}

function validateNodeData(kind: string, data: Record<string, unknown>): string | null {
  switch (kind) {
    case 'doc':
      if (typeof data.doc_id !== 'string' || !data.doc_id) return 'doc node requires a non-empty "doc_id".';
      return null;
    case 'docs':
      if (!Array.isArray(data.doc_ids) || data.doc_ids.length === 0) return 'docs node requires a non-empty "doc_ids" array.';
      return null;
    case 'instruction':
      if (typeof data.text !== 'string' || !data.text.trim()) return 'instruction node requires non-empty "text".';
      return null;
    case 'decision':
      return validateDecisionData(data);
    default:
      return `Unknown node kind "${kind}".`;
  }
}

// ── Tool spec ─────────────────────────────────────────────────────────────────

export const UPDATE_FLOW_NODE_TOOL = {
  name: 'update_flow_node',
  description: [
    'Update an existing node in a flow draft. Replaces the node\'s data (and',
    'optionally title/position). Decision-integrity (kebab branches + default_branch)',
    'is re-validated on every update.',
    '',
    'Call get_flow first to see current node ids and data before updating.',
    '',
    'SAFETY — this tool modifies workspace content. Required before calling:',
    '  1. Show the user what you are about to change.',
    '  2. Ask: "Should I update this node?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    '',
    'REQUIRES: workspace:write scope.',
    '',
    'Returns { client_node_id, flow_id, draft_version_id } on success.',
    'Errors: flow_not_found, node_not_found, malformed_decision, invalid_node_data.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_id: { type: 'string', description: 'UUID of the flow.' },
      client_node_id: { type: 'string', description: 'The client_node_id of the node to update.' },
      data: { type: 'object', description: 'New kind-specific data. Replaces the current data entirely.', additionalProperties: true },
      title: { type: 'string', description: 'Optional new title for the node.' },
      position: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
        description: 'Optional new canvas position.',
      },
      idempotency_key: { type: 'string', description: 'Caller-chosen unique key for safe retries.' },
      user_confirmed: { type: 'boolean', description: 'Must be true. Get explicit user approval first.' },
    },
    required: ['flow_id', 'client_node_id', 'data', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Update a flow node' },
};

const argsSchema = z.object({
  flow_id: z.string().uuid(),
  client_node_id: z.string().min(1).max(64),
  data: z.record(z.unknown()),
  title: z.string().min(1).max(200).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  idempotency_key: z.string().min(1).max(128).default(() => nanoid()),
  user_confirmed: z.boolean(),
}).strict();

export interface UpdateFlowNodeResult {
  client_node_id?: string;
  flow_id?: string;
  draft_version_id?: string;
  error?: string;
  message?: string;
}

export async function updateFlowNode(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<UpdateFlowNodeResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  if (!args.user_confirmed) {
    return { error: 'user_confirmation_required', message: 'Show the user what you plan to change and wait for their explicit approval before calling with user_confirmed=true.' };
  }

  return await withAudit(
    ctx,
    { tool_name: UPDATE_FLOW_NODE_TOOL.name, args: args as Record<string, unknown> },
    async (): Promise<UpdateFlowNodeResult> => {
      const iKey = `${ctx.tenant_id}:update_flow_node:${args.flow_id}:${args.client_node_id}:${args.idempotency_key}`;
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

        // Find the node to update
        const nodeRows = await tx.select({ id: flowNodes.id, kind: flowNodes.kind })
          .from(flowNodes)
          .where(and(eq(flowNodes.flowVersionId, draftVersionId), eq(flowNodes.clientNodeId, args.client_node_id)))
          .limit(1);
        if (nodeRows.length === 0) return { error: 'node_not_found', message: `Node "${args.client_node_id}" not found in draft.` };

        const kind = nodeRows[0]!.kind;

        // Validate the new data
        const dataError = validateNodeData(kind, args.data as Record<string, unknown>);
        if (dataError) {
          return {
            error: kind === 'decision' ? 'malformed_decision' : 'invalid_node_data',
            message: dataError,
          };
        }

        // Build the update payload
        type NodeUpdate = { data: Record<string, unknown>; title?: string; positionX?: number; positionY?: number };
        const updateValues: NodeUpdate = { data: args.data as Record<string, unknown> };
        if (args.title !== undefined) updateValues.title = args.title;
        if (args.position !== undefined) {
          updateValues.positionX = args.position.x;
          updateValues.positionY = args.position.y;
        }

        await tx.update(flowNodes)
          .set(updateValues)
          .where(and(eq(flowNodes.flowVersionId, draftVersionId), eq(flowNodes.clientNodeId, args.client_node_id)));

        return { client_node_id: args.client_node_id, flow_id: args.flow_id, draft_version_id: draftVersionId };
      });

      if (!result.error) recordIKey(iKey);
      return result;
    },
    (r) => ({ client_node_id: r.client_node_id ?? null, flow_id: r.flow_id ?? null, error: r.error ?? null }),
  );
}
