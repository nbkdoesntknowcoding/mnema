/**
 * MCP tool: `commit_flow_publish`.
 *
 * Phase 10 Chunk 2 — the UI-facing (app-only) half of the flow-publish
 * write-preview pattern. Called exclusively by the write-preview iframe's
 * Approve button — NEVER by the model (visibility: ["app"]).
 *
 * Validates the proposal_token then delegates to the existing 9.4 publishFlow
 * internal (which runs its own scope / role / validation / audit chain).
 *
 * Gate: requireWriteScope → validate token → live role check → publishFlow
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { redeemProposalToken } from '../apps/proposal-token.js';
import { publishFlow } from './publish-flow.js';

const WRITE_ROLES = new Set(['owner', 'editor']);

export const COMMIT_FLOW_PUBLISH_TOOL_NAME = 'commit_flow_publish';

export const COMMIT_FLOW_PUBLISH_TOOL_SPEC = {
  name: COMMIT_FLOW_PUBLISH_TOOL_NAME,
  description: [
    'Commit a previously proposed flow-publish. Called ONLY by the write-preview',
    'UI (Approve button). This tool is not visible to or callable by the model.',
    'Validates the proposal_token then runs the publish through the existing',
    '9.4 gate chain.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      proposal_token: {
        type: 'string',
        description: 'The signed proposal token from the propose_flow_publish result.',
      },
    },
    required: ['proposal_token'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Commit a proposed flow-publish (UI only)' },
};

const argsSchema = z.object({
  proposal_token: z.string().min(1),
}).strict();

export interface CommitFlowPublishResult {
  committed?: boolean;
  flow_id?: string;
  operation?: string;
  published_version_number?: number;
  error?: string;
  message?: string;
}

export async function commitFlowPublish(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<CommitFlowPublishResult> {
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
      error: 'insufficient_role',
      message: 'Only workspace owners, admins, and editors can publish flows.',
    };
  }

  // Validate and redeem the proposal token
  const validation = redeemProposalToken(args.proposal_token, ctx.user_id, ctx.tenant_id);
  if (!validation.ok) {
    return {
      error: validation.reason,
      message: validation.reason === 'token_expired'
        ? 'The preview expired (10-minute limit). Ask Claude to re-propose.'
        : validation.reason === 'token_already_used'
          ? 'This preview has already been committed.'
          : `Token invalid: ${validation.reason}`,
    };
  }

  const { payload } = validation;
  if (payload.op !== 'flow_publish' || !payload.d) {
    return {
      error: 'wrong_operation',
      message: 'This proposal token is not a flow_publish proposal.',
    };
  }

  const result = await publishFlow(ctx, {
    flow_id: payload.d,
    idempotency_key: `commit:${payload.n}`,
    user_confirmed: true,
  });
  if (result.error) return { error: result.error, message: result.message };

  return {
    committed: true,
    flow_id: payload.d,
    operation: 'flow_publish',
    published_version_number: result.published_version_number,
  };
}
