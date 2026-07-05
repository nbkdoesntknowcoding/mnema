/**
 * MCP tool: `confirm_doc_write`.
 *
 * Phase 10 — the model-facing (chat-only) half of the write-preview pattern.
 * Designed for Claude Code (CLI) and other clients where the MCP Apps
 * `ui/resourceUri` panel does NOT render.
 *
 * Workflow in Claude Code:
 *   1. Model calls `propose_doc_write` → receives proposal_token + preview markdown.
 *   2. Model presents the preview to the user in chat and asks for confirmation.
 *   3. User says "yes" / "approve" / "looks good" in chat.
 *   4. Model calls `confirm_doc_write` with the proposal_token → commit fires.
 *
 * Visibility: ["model"] — the AI calls this tool, NOT the UI.
 * This is the CLI equivalent of `commit_doc_write` (which is ["app"]-only).
 *
 * The underlying commit logic is identical to commit_doc_write: token validation,
 * role check, and dispatch through the existing 9.x Yjs write path.
 *
 * Note: the model MUST obtain explicit user confirmation before calling this
 * tool. Never auto-call without showing the proposed content first.
 */

import { z } from 'zod';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { commitProposedWrite } from './commit-proposed-write.js';
import type { CommitProposedWriteResult } from './commit-proposed-write.js';

export const CONFIRM_DOC_WRITE_TOOL_NAME = 'confirm_doc_write';

export const CONFIRM_DOC_WRITE_TOOL_SPEC = {
  name: CONFIRM_DOC_WRITE_TOOL_NAME,
  description: [
    'Commit a previously proposed write after the user has confirmed it in chat.',
    '',
    'USE THIS TOOL IN CLAUDE CODE / CLI only — in Claude Desktop the write-preview',
    'panel handles approval instead; do not call confirm_doc_write there.',
    '',
    'Workflow:',
    '  1. Call propose_doc_write → receive proposal_token + preview content.',
    '  2. Show the user a clear summary of the proposed change and ask for approval.',
    '  3. Wait for explicit user confirmation ("yes", "approve", "looks good", etc.).',
    '  4. Call confirm_doc_write with the proposal_token to commit.',
    '',
    'DO NOT call this tool automatically — explicit user confirmation is required.',
    'The proposal_token expires after 10 minutes. If expired, call propose_doc_write again.',
    '',
    'Returns: { committed: true, doc_id, operation } on success, or { error, message } on failure.',
    'REQUIRES: workspace:write scope.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      proposal_token: {
        type: 'string',
        description: 'The signed proposal_token from the propose_doc_write result.',
      },
    },
    required: ['proposal_token'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
    title: 'Confirm and commit a proposed doc write (CLI / Claude Code)',
  },
};

const argsSchema = z.object({
  proposal_token: z.string().min(1),
}).strict();

export async function confirmDocWrite(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<CommitProposedWriteResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);
  // Delegate entirely to the shared commit logic — identical gate chain:
  // requireWriteScope → withAudit → live role check → redeemProposalToken
  //   → getProposalContent → dispatch write.
  return commitProposedWrite(ctx, { proposal_token: args.proposal_token });
}
