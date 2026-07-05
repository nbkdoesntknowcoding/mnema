/**
 * MCP tool: `create_flow`.
 *
 * Phase 9.4 — creates a new flow in the workspace with an empty draft
 * version ready for nodes.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → validate slug uniqueness → INSERT flow + empty draft version
 *     → withAudit → return { flow_id, slug, draft_version_id }
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { flowVersions, flows, workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { withAudit } from './audit.js';

// ── Idempotency cache ──────────────────────────────────────────────────────────
const idempotencyCache = new Map<string, { flowId: string; expiry: number }>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;

function checkIdempotencyKey(key: string): { flowId: string } | null {
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { idempotencyCache.delete(key); return null; }
  return { flowId: entry.flowId };
}
function recordIdempotencyKey(key: string, flowId: string): void {
  if (idempotencyCache.size > 10_000) {
    const now = Date.now();
    for (const [k, e] of idempotencyCache) { if (e.expiry < now) idempotencyCache.delete(k); }
  }
  idempotencyCache.set(key, { flowId, expiry: Date.now() + IDEMPOTENCY_TTL_MS });
}

const WRITE_ROLES = new Set(['owner', 'editor']);

// ── Slug helpers ───────────────────────────────────────────────────────────────
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'flow';
}

// ── Tool spec ──────────────────────────────────────────────────────────────────

export const CREATE_FLOW_TOOL = {
  name: 'create_flow',
  description: [
    'Creates a new flow in the workspace with an empty draft version ready for nodes.',
    'Returns the flow id, slug, and draft_version_id.',
    '',
    'SAFETY — this tool creates workspace content. Required before calling:',
    '  1. Show the user the flow name and description you are about to create.',
    '  2. Ask: "Should I create this flow?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  name            — Display name for the flow.',
    '  description     — Optional description.',
    '  slug            — URL slug (auto-generated from name if omitted). Must be unique.',
    '  idempotency_key — Caller-chosen unique string for safe retries.',
    '  user_confirmed  — Must be true.',
    '',
    'Returns { flow_id, slug, draft_version_id } on success.',
    '',
    'CONSTRUCTION PATTERN — follow this every time you build a flow:',
    '  1. After create_flow returns the UUID, immediately call get_flow to render',
    '     the empty canvas for the user.',
    '  2. Elicit nodes conversationally — ask what each step should do before',
    '     calling add_flow_node. One node at a time. Show the full node spec',
    '     (kind, title, content/question/branches) as prose and wait for an',
    '     explicit "yes" before calling with user_confirmed=true.',
    '  3. For DECISION nodes: always display the full question text AND all branch',
    '     labels in prose before calling add_flow_node. Example: "I\'ll add a',
    '     decision node — question: \'Is this an existing customer?\' — branches:',
    '     yes / no. OK to add?" Then wait for approval.',
    '  4. After all nodes are added: call get_flow to render the current graph.',
    '     Let the user see the full node set before connecting anything.',
    '  5. Elicit edges conversationally. For each decision node: elicit its',
    '     outgoing edges immediately and in sequence — do not leave a decision',
    '     node with unconnected branches between turns.',
    '  6. Batch all edge connections: all nodes first, all edges after. Connecting',
    '     as you go produces a broken-looking intermediate graph.',
    '  7. After all edges are connected: call get_flow again for the final canvas',
    '     review.',
    '  8. Call propose_flow_publish — the preview panel opens; the flow publishes',
    '     only on human Approve.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Display name for the new flow.' },
      description: { type: 'string', description: 'Optional description.' },
      slug: { type: 'string', description: 'URL slug. Auto-generated from name if omitted.' },
      idempotency_key: { type: 'string', description: 'Caller-chosen unique key for safe retries.' },
      user_confirmed: { type: 'boolean', description: 'Must be true. Get explicit user approval first.' },
    },
    required: ['name', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Create a flow' },
};

const argsSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  slug: z.string().min(1).max(64).regex(SLUG_RE, 'Slug must be kebab-case').optional(),
  idempotency_key: z.string().min(1).max(128),
  user_confirmed: z.boolean(),
}).strict();

export interface CreateFlowResult {
  flow_id?: string;
  slug?: string;
  draft_version_id?: string;
  error?: string;
  message?: string;
}

export async function createFlow(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<CreateFlowResult> {
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message: 'Show the user the flow name/description and wait for their explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: CREATE_FLOW_TOOL.name, args: args as Record<string, unknown> },
    async (): Promise<CreateFlowResult> => {
      // Idempotency
      const iKey = `${ctx.tenant_id}:create_flow:${args.idempotency_key}`;
      const existing = checkIdempotencyKey(iKey);
      if (existing) {
        return {
          error: 'idempotency_duplicate',
          message: 'This idempotency_key was already used within the past hour.',
          flow_id: existing.flowId,
        };
      }

      // Live role re-check
      const [member] = await withSystemPrivilege((tx) =>
        tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, ctx.user_id), eq(workspaceMembers.workspaceId, ctx.tenant_id)))
          .limit(1),
      );
      if (!member || !WRITE_ROLES.has(member.role)) {
        return { error: 'insufficient_role', message: 'Only workspace owners, admins, and editors can create flows.' };
      }

      // Resolve/validate slug
      const slug = args.slug ?? nameToSlug(args.name);

      // Validate slug uniqueness in workspace
      const slugCheck = await withTenant(ctx.tenant_id, (tx) =>
        tx.select({ id: flows.id }).from(flows)
          .where(and(eq(flows.workspaceId, ctx.tenant_id), eq(flows.slug, slug), isNull(flows.deletedAt)))
          .limit(1),
      );
      if (slugCheck.length > 0) {
        return { error: 'slug_taken', message: `A flow with slug '${slug}' already exists in this workspace.` };
      }

      // Insert flow + empty draft version
      const result = await withTenant(ctx.tenant_id, async (tx) => {
        const [flow] = await tx.insert(flows).values({
          workspaceId: ctx.tenant_id,
          slug,
          name: args.name,
          description: args.description ?? null,
          createdBy: ctx.user_id,
        }).returning({ id: flows.id });
        if (!flow) throw new Error('Failed to create flow');

        const [version] = await tx.insert(flowVersions).values({
          flowId: flow.id,
          workspaceId: ctx.tenant_id,
          versionNumber: 1,
          isPublished: false,
          createdBy: ctx.user_id,
        }).returning({ id: flowVersions.id });
        if (!version) throw new Error('Failed to create draft version');

        return { flow_id: flow.id, slug, draft_version_id: version.id };
      });

      recordIdempotencyKey(iKey, result.flow_id);
      return result;
    },
    (r) => ({ flow_id: r.flow_id ?? null, slug: r.slug ?? null, error: r.error ?? null }),
  );
}
