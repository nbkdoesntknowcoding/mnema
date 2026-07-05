/**
 * MCP tool: `commit_trash_folder`.
 *
 * Phase 10 Chunk 2 — the UI-facing (app-only) half of the trash-folder
 * write-preview pattern. Called exclusively by the write-preview iframe's
 * Approve button — NEVER by the model (visibility: ["app"]).
 *
 * Validates the proposal_token then delegates to the existing 9.3 trashFolder
 * internal (which runs its own scope / role / audit / cascade transaction).
 *
 * Gate: requireWriteScope → validate token → live role check → trashFolder
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { redeemProposalToken } from '../apps/proposal-token.js';
import { trashFolder } from './trash-folder.js';

const WRITE_ROLES = new Set(['owner', 'editor']);

export const COMMIT_TRASH_FOLDER_TOOL_NAME = 'commit_trash_folder';

export const COMMIT_TRASH_FOLDER_TOOL_SPEC = {
  name: COMMIT_TRASH_FOLDER_TOOL_NAME,
  description: [
    'Commit a previously proposed folder-trash. Called ONLY by the write-preview',
    'UI (Approve button). This tool is not visible to or callable by the model.',
    'Validates the proposal_token then runs the cascade trash through the',
    'existing 9.3 gate chain.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      proposal_token: {
        type: 'string',
        description: 'The signed proposal token from the propose_trash_folder result.',
      },
    },
    required: ['proposal_token'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: true, title: 'Commit a proposed folder-trash (UI only)' },
};

const argsSchema = z.object({
  proposal_token: z.string().min(1),
}).strict();

export interface CommitTrashFolderResult {
  committed?: boolean;
  folder_id?: string;
  operation?: string;
  error?: string;
  message?: string;
}

export async function commitTrashFolder(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<CommitTrashFolderResult> {
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
      message: 'Only workspace owners, admins, and editors can trash folders.',
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
  if (payload.op !== 'trash_folder' || !payload.f) {
    return {
      error: 'wrong_operation',
      message: 'This proposal token is not a trash_folder proposal.',
    };
  }

  const result = await trashFolder(ctx, {
    folder_id: payload.f,
    idempotency_key: `commit:${payload.n}`,
    user_confirmed: true,
  });
  if (result.error) return { error: result.error, message: result.message };

  return { committed: true, folder_id: payload.f, operation: 'trash_folder' };
}
