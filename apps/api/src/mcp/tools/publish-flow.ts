/**
 * MCP tool: `publish_flow`.
 *
 * Phase 9.4 — promotes the draft version to published, making it the version
 * that `get_flow_step` walks. The draft is validated before promotion:
 *
 *   1. Draft must exist and be non-empty.
 *   2. Exactly one entry node (no incoming edges).
 *   3. Every decision node's declared branches all have outgoing edges.
 *   4. No cycles (re-verified even though connect_flow_nodes prevents them).
 *   5. All nodes are reachable from entry (no orphans).
 *
 * If validation fails, the draft is NOT promoted and the specific error is
 * returned so Claude can fix it.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → resolve draft → run pre-publish validation
 *     → (on pass) mark draft is_published = true → demote prior published
 *       → update flows.published_version_id
 *     → withAudit → return { flow_id, published_version_number }
 */

import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { validateFlow } from '../../lib/flows/validate.js';
import { flowEdges, flowNodes, flowVersions, flows, workspaceMembers } from '../../db/schema.js';
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

// ── Decision branch completeness check (beyond validateFlow) ──────────────────
/**
 * For each decision node, verify that every declared branch label has an
 * outgoing edge in the draft. validateFlow already checks structural integrity
 * (DAG, entry, reachability); this catches "wired half-baked decision nodes".
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

// ── Tool spec ─────────────────────────────────────────────────────────────────

export const PUBLISH_FLOW_TOOL = {
  name: 'publish_flow',
  description: [
    'Publish a flow\'s draft, making it the version that Claude walks via',
    'get_flow_step. Validates the draft is complete and walkable before',
    'publishing:',
    '  - Entry node present (exactly one node with no incoming edges)',
    '  - All decision branches wired (no dangling branch)',
    '  - No cycles (flows are DAGs)',
    '  - All nodes reachable from entry',
    '',
    'A draft that fails validation is NOT published — the specific integrity',
    'error is returned so you can fix it first.',
    '',
    'This changes what anyone walking the flow will see immediately.',
    '',
    'SAFETY — required before calling:',
    '  1. Describe what changed in this version.',
    '  2. Ask: "Should I publish this flow?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    '',
    'REQUIRES: workspace:write scope.',
    '',
    'Returns { flow_id, published_version_number } on success.',
    'Errors: flow_not_found, no_draft, no_entry_node, multiple_entry_nodes,',
    '        incomplete_decision, unreachable_nodes, cycle_detected.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_id: { type: 'string', description: 'UUID of the flow to publish. Use the `uuid` field from list_flows (not the slug `id` field).' },
      publish_message: { type: 'string', description: 'Optional note describing what changed.' },
      idempotency_key: { type: 'string', description: 'Caller-chosen unique key for safe retries.' },
      user_confirmed: { type: 'boolean', description: 'Must be true. Get explicit user approval first.' },
    },
    required: ['flow_id', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Publish a flow' },
};

const argsSchema = z.object({
  flow_id: z.string().uuid(),
  publish_message: z.string().max(2000).optional(),
  idempotency_key: z.string().min(1).max(128),
  user_confirmed: z.boolean(),
}).strict();

export interface PublishFlowResult {
  flow_id?: string;
  published_version_number?: number;
  error?: string;
  message?: string;
  validation_errors?: string[];
}

export async function publishFlow(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<PublishFlowResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  if (!args.user_confirmed) {
    return { error: 'user_confirmation_required', message: 'Describe what changed in this version and wait for explicit user approval before calling with user_confirmed=true.' };
  }

  return await withAudit(
    ctx,
    { tool_name: PUBLISH_FLOW_TOOL.name, args: args as Record<string, unknown> },
    async (): Promise<PublishFlowResult> => {
      const iKey = `${ctx.tenant_id}:publish_flow:${args.flow_id}:${args.idempotency_key}`;
      if (checkIKey(iKey)) return { error: 'idempotency_duplicate', message: 'This idempotency_key was already used within the past hour.' };

      const [member] = await withSystemPrivilege((tx) =>
        tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, ctx.user_id), eq(workspaceMembers.workspaceId, ctx.tenant_id)))
          .limit(1),
      );
      if (!member || !WRITE_ROLES.has(member.role)) {
        return { error: 'insufficient_role', message: 'Only workspace owners, admins, and editors can publish flows.' };
      }

      const result = await withTenant(ctx.tenant_id, async (tx) => {
        // Resolve the flow
        const flowRows = await tx
          .select({ id: flows.id, publishedVersionId: flows.publishedVersionId })
          .from(flows)
          .where(and(eq(flows.id, args.flow_id), isNull(flows.deletedAt)))
          .limit(1);
        if (flowRows.length === 0) return { error: 'flow_not_found', message: `Flow ${args.flow_id} not found.` };

        // Find the draft (latest unpublished version)
        const draftRows = await tx
          .select({ id: flowVersions.id, versionNumber: flowVersions.versionNumber })
          .from(flowVersions)
          .where(and(eq(flowVersions.flowId, args.flow_id), eq(flowVersions.isPublished, false)))
          .orderBy(flowVersions.versionNumber)
          .limit(1);

        if (draftRows.length === 0) {
          return { error: 'no_draft', message: 'No draft version found. Use the node/edge tools to build a draft first.' };
        }
        const draft = draftRows[0]!;

        // Fetch nodes and edges for validation
        const dbNodes = await tx
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

        const dbEdges = await tx
          .select({
            fromNodeId: flowEdges.fromNodeId,
            toNodeId: flowEdges.toNodeId,
            fromSocket: flowEdges.fromSocket,
          })
          .from(flowEdges)
          .where(eq(flowEdges.flowVersionId, draft.id));

        // ── Pre-publish structural validation ─────────────────────────────────
        const validationNodes = dbNodes.map((n) => ({
          client_node_id: n.clientNodeId,
          kind: n.kind as 'doc' | 'docs' | 'instruction' | 'decision',
          title: n.title,
          position_x: n.positionX,
          position_y: n.positionY,
          data: n.data as Record<string, unknown>,
        }));
        const validationEdges = dbEdges.map((e) => ({
          from_node_id: e.fromNodeId,
          to_node_id: e.toNodeId,
          from_socket: e.fromSocket,
        }));

        const validation = validateFlow(validationNodes, validationEdges);
        if (!validation.valid) {
          return {
            error: validation.errors[0]?.code ?? 'validation_failed',
            message: 'Draft failed pre-publish validation. Fix the issues before publishing.',
            validation_errors: validation.errors.map((e) => e.message),
          };
        }

        // ── Decision branch completeness ──────────────────────────────────────
        const branchError = checkDecisionBranchesComplete(
          validationNodes,
          validationEdges.map((e) => ({ from_node_id: e.from_node_id, from_socket: e.from_socket })),
        );
        if (branchError) {
          return {
            error: 'incomplete_decision',
            message: branchError,
          };
        }

        // ── Promote draft → published ─────────────────────────────────────────
        // Demote any currently published version for this flow
        await tx.update(flowVersions)
          .set({ isPublished: false })
          .where(and(
            eq(flowVersions.flowId, args.flow_id),
            eq(flowVersions.isPublished, true),
            ne(flowVersions.id, draft.id),
          ));

        // Mark draft as published (add optional publish message)
        await tx.update(flowVersions)
          .set({ isPublished: true, publishMessage: args.publish_message ?? null })
          .where(eq(flowVersions.id, draft.id));

        // Update the flow's published_version_id pointer
        await tx.update(flows)
          .set({ publishedVersionId: draft.id, updatedAt: new Date() })
          .where(eq(flows.id, args.flow_id));

        return {
          flow_id: args.flow_id,
          published_version_number: draft.versionNumber,
        };
      });

      if (!result.error) recordIKey(iKey);
      return result;
    },
    (r) => ({
      flow_id: r.flow_id ?? null,
      published_version_number: r.published_version_number ?? null,
      error: r.error ?? null,
    }),
  );
}
