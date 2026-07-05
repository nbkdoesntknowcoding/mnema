/**
 * MCP tool: `add_flow_node`.
 *
 * Phase 9.4 — adds a node to a flow draft. Validates kind-specific data
 * (including decision-node branch integrity) before inserting.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → resolve flow + getOrCreateDraftVersion
 *     → validate node data (kind-specific + decision integrity)
 *     → INSERT flow_node into draft
 *     → withAudit → return { client_node_id, flow_id, draft_version_id }
 */

import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
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

// ── Decision data validation ──────────────────────────────────────────────────
function validateDecisionData(data: Record<string, unknown>): string | null {
  if (!data.branches || typeof data.branches !== 'object' || Array.isArray(data.branches)) {
    return 'Decision node requires a "branches" object (e.g. { "yes": null, "no": null }).';
  }
  const branches = data.branches as Record<string, unknown>;
  const branchLabels = Object.keys(branches);
  if (branchLabels.length === 0) {
    return 'Decision node must have at least one branch.';
  }
  for (const label of branchLabels) {
    if (!KEBAB_RE.test(label)) {
      return `Branch label "${label}" must be kebab-case (lowercase letters, digits, hyphens; no leading/trailing hyphens).`;
    }
  }
  if (typeof data.default_branch !== 'string') {
    return 'Decision node requires a "default_branch" string.';
  }
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

export const ADD_FLOW_NODE_TOOL = {
  name: 'add_flow_node',
  description: [
    'Add a node to a flow draft.',
    '',
    'kind is one of: doc, docs, instruction, decision.',
    '  doc:         data = { doc_id: "<uuid>", instruction?: "..." }',
    '  docs:        data = { doc_ids: ["<uuid>", ...], instruction?: "..." }',
    '  instruction: data = { text: "What to do at this step." }',
    '  decision:    data = { question: "...", branches: { "yes": null, "no": null }, default_branch: "yes" }',
    '               Decision branches must be kebab-case labels; default_branch must be one of them.',
    '',
    'SAFETY — this tool creates workspace content. Required before calling:',
    '  1. Show the user the node you are about to add.',
    '  2. Ask: "Should I add this node?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    '',
    'REQUIRES: workspace:write scope.',
    '',
    'Returns { client_node_id, flow_id, draft_version_id } on success.',
    'Errors: flow_not_found, malformed_decision, invalid_node_data, insufficient_role.',
    '',
    'DECISION NODES — special sequencing required:',
    '  The branches object maps kebab-case labels to null (edge targets are set',
    '  separately via connect_flow_nodes). This two-step — node created with branch',
    '  labels, targets added as edges — means a decision node exists briefly with',
    '  unconnected branches. Minimize the window: elicit and add all outgoing edges',
    '  for a decision node before moving to the next node.',
    '  Always show the user the question AND branch labels as prose BEFORE calling.',
    '  Never call with user_confirmed=true on a decision node without explicit',
    '  conversational approval of both the question and the branch labels.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_id: { type: 'string', description: 'UUID of the flow to add a node to.' },
      kind: { type: 'string', enum: ['doc', 'docs', 'instruction', 'decision'], description: 'Node kind.' },
      title: { type: 'string', description: 'Display title for the node.' },
      data: { type: 'object', description: 'Kind-specific data. See tool description for shape per kind.', additionalProperties: true },
      client_node_id: { type: 'string', description: 'Optional stable kebab-case id. Auto-generated if omitted.' },
      position: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
        description: 'Canvas position (optional, defaults to 0,0).',
      },
      idempotency_key: { type: 'string', description: 'Caller-chosen unique key for safe retries.' },
      user_confirmed: { type: 'boolean', description: 'Must be true. Get explicit user approval first.' },
    },
    required: ['flow_id', 'kind', 'title', 'data', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Add a flow node' },
};

const argsSchema = z.object({
  flow_id: z.string().uuid(),
  kind: z.enum(['doc', 'docs', 'instruction', 'decision']),
  title: z.string().min(1).max(200),
  data: z.record(z.unknown()),
  client_node_id: z.string().min(1).max(64).regex(KEBAB_RE, 'client_node_id must be kebab-case').optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  idempotency_key: z.string().min(1).max(128).default(() => nanoid()),
  user_confirmed: z.boolean(),
}).strict();

export interface AddFlowNodeResult {
  client_node_id?: string;
  flow_id?: string;
  draft_version_id?: string;
  error?: string;
  message?: string;
}

export async function addFlowNode(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<AddFlowNodeResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  if (!args.user_confirmed) {
    return { error: 'user_confirmation_required', message: 'Show the user the node details and wait for their explicit approval before calling with user_confirmed=true.' };
  }

  return await withAudit(
    ctx,
    { tool_name: ADD_FLOW_NODE_TOOL.name, args: args as Record<string, unknown> },
    async (): Promise<AddFlowNodeResult> => {
      const iKey = `${ctx.tenant_id}:add_flow_node:${args.flow_id}:${args.idempotency_key}`;
      if (checkIKey(iKey)) return { error: 'idempotency_duplicate', message: 'This idempotency_key was already used within the past hour.' };

      // Live role re-check
      const [member] = await withSystemPrivilege((tx) =>
        tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, ctx.user_id), eq(workspaceMembers.workspaceId, ctx.tenant_id)))
          .limit(1),
      );
      if (!member || !WRITE_ROLES.has(member.role)) {
        return { error: 'insufficient_role', message: 'Only workspace owners, admins, and editors can edit flows.' };
      }

      // Validate node data
      const dataError = validateNodeData(args.kind, args.data as Record<string, unknown>);
      if (dataError) {
        return {
          error: args.kind === 'decision' ? 'malformed_decision' : 'invalid_node_data',
          message: dataError,
        };
      }

      const result = await withTenant(ctx.tenant_id, async (tx) => {
        // Resolve the flow
        const flowRows = await tx.select({ id: flows.id }).from(flows)
          .where(and(eq(flows.id, args.flow_id), isNull(flows.deletedAt))).limit(1);
        if (flowRows.length === 0) return { error: 'flow_not_found', message: `Flow ${args.flow_id} not found.` };

        const draftVersionId = await getOrCreateDraftVersion(args.flow_id, ctx.user_id, tx);
        const clientNodeId = args.client_node_id ?? `node-${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

        // Ensure client_node_id is unique in this draft
        const existing = await tx.select({ id: flowNodes.id }).from(flowNodes)
          .where(and(eq(flowNodes.flowVersionId, draftVersionId), eq(flowNodes.clientNodeId, clientNodeId))).limit(1);
        if (existing.length > 0) return { error: 'node_id_conflict', message: `A node with client_node_id "${clientNodeId}" already exists in this draft.` };

        await tx.insert(flowNodes).values({
          flowVersionId: draftVersionId,
          clientNodeId,
          kind: args.kind,
          title: args.title,
          positionX: args.position?.x ?? 0,
          positionY: args.position?.y ?? 0,
          data: args.data as Record<string, unknown>,
        });

        return { client_node_id: clientNodeId, flow_id: args.flow_id, draft_version_id: draftVersionId };
      });

      if (!result.error) recordIKey(iKey);
      return result;
    },
    (r) => ({ client_node_id: r.client_node_id ?? null, flow_id: r.flow_id ?? null, error: r.error ?? null }),
  );
}
