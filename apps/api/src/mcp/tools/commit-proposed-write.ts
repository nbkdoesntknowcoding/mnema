/**
 * MCP tool: `commit_doc_write`.
 *
 * Phase 10 — the UI-facing (app-only) half of the write-preview pattern.
 * Called exclusively by the write-preview iframe's Approve button — NEVER
 * by the model (visibility: ["app"]).
 *
 * Validates the proposal_token (signature, expiry, single-use, workspace/user
 * match) then dispatches the actual write through the existing 9.x Yjs path.
 *
 * Note: the file name stays `commit-proposed-write.ts`; the tool is named
 * `commit_doc_write`.
 *
 * Gate: requireWriteScope → withAudit → validate token → live role check
 *       → getProposalContent → dispatch write
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { withAudit } from './audit.js';
import { redeemProposalToken, getProposalContent } from '../apps/proposal-token.js';
import { recordCapture } from '../../lib/flows/runs.js';
import { appendBlocksToDoc } from './append-blocks-to-doc.js';
import { replaceDocBody } from './replace-doc-body.js';
import { createDoc } from './create-doc.js';
import { trashDoc } from './trash-doc.js';

const WRITE_ROLES = new Set(['owner', 'editor']);

export const COMMIT_DOC_WRITE_TOOL_NAME = 'commit_doc_write';

export const COMMIT_DOC_WRITE_TOOL_SPEC = {
  name: COMMIT_DOC_WRITE_TOOL_NAME,
  description: [
    'Commit a previously proposed write. Called ONLY by the write-preview UI',
    '(Approve button). This tool is not visible to or callable by the model.',
    'Validates the proposal_token then runs the write through the existing',
    '9.x gate chain (scope, live-role, audit).',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      proposal_token: {
        type: 'string',
        description: 'The signed proposal token from the propose_doc_write result.',
      },
    },
    required: ['proposal_token'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Commit a proposed write (UI only)' },
};

const argsSchema = z.object({
  proposal_token: z.string().min(1),
}).strict();

export interface CommitProposedWriteResult {
  committed?: boolean;
  doc_id?: string;
  operation?: string;
  error?: string;
  message?: string;
}

export async function commitProposedWrite(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<CommitProposedWriteResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  return await withAudit(
    ctx,
    { tool_name: COMMIT_DOC_WRITE_TOOL_NAME, args: args as Record<string, unknown> },
    async (): Promise<CommitProposedWriteResult> => {
      // Live role check
      const [member] = await withSystemPrivilege((tx) =>
        tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, ctx.user_id), eq(workspaceMembers.workspaceId, ctx.tenant_id)))
          .limit(1),
      );
      if (!member || !WRITE_ROLES.has(member.role)) {
        return {
          error: 'insufficient_role',
          message: 'Only workspace owners, admins, and editors can commit writes.',
        };
      }

      // Validate and redeem the proposal token
      const validation = redeemProposalToken(args.proposal_token, ctx.user_id, ctx.tenant_id);
      if (!validation.ok) {
        return {
          error: validation.reason,
          message: validation.reason === 'token_expired'
            ? 'The write preview expired (10-minute limit). Ask Claude to re-propose the write.'
            : validation.reason === 'token_already_used'
              ? 'This preview has already been committed.'
              : `Token invalid: ${validation.reason}`,
        };
      }

      const { payload } = validation;

      // Retrieve stored content
      const stored = getProposalContent(payload.n);
      if (!stored && payload.op !== 'trash_doc') {
        return {
          error: 'content_not_found',
          message: 'Proposal content not found — the proposal may have expired. Ask Claude to re-propose.',
        };
      }
      const markdown = stored?.markdown ?? '';

      // Use a deterministic idempotency key derived from the token nonce
      const iKey = `commit:${payload.n}`;

      switch (payload.op) {
        case 'append': {
          if (!payload.d) return { error: 'missing_doc_id' };
          const result = await appendBlocksToDoc(ctx, {
            doc_id: payload.d,
            markdown,
            idempotency_key: iKey,
            user_confirmed: true,
          });
          if (result.error) return { error: result.error, message: result.message };
          return { committed: true, doc_id: payload.d, operation: 'append' };
        }

        case 'replace_section': {
          // section_anchor stored in payload.a (set during propose)
          if (!payload.d) return { error: 'missing_doc_id' };
          if (!payload.a) {
            return {
              error: 'missing_section_anchor',
              message: 'replace_section commit requires a section_anchor in the proposal.',
            };
          }
          // Reuse replaceDocSection via dynamic import to avoid circular dep
          const { replaceDocSection } = await import('./replace-doc-section.js');
          const result = await replaceDocSection(ctx, {
            doc_id: payload.d,
            section_anchor: payload.a,
            markdown,
            idempotency_key: iKey,
            user_confirmed: true,
          });
          if (result.error) return { error: result.error, message: result.message };
          return { committed: true, doc_id: payload.d, operation: 'replace_section' };
        }

        case 'replace_body': {
          if (!payload.d) return { error: 'missing_doc_id' };
          // replace_doc_body requires expected_anchors for optimistic concurrency.
          // We pass through whatever the propose step stored — if non-empty,
          // replaceDocBody's lost-update guard rejects stale anchors.
          const result = await replaceDocBody(ctx, {
            doc_id: payload.d,
            markdown,
            expected_anchors: stored?.expected_anchors ?? [],
            idempotency_key: iKey,
            user_confirmed: true,
          });
          if (result.error) return { error: result.error, message: result.message };
          return { committed: true, doc_id: payload.d, operation: 'replace_body' };
        }

        case 'create': {
          const docName = stored?.doc_name ?? 'New Doc';
          const result = await createDoc(ctx, {
            title: docName,
            markdown,
            idempotency_key: iKey,
            user_confirmed: true,
            ...(stored?.folder_id ? { folder_id: stored.folder_id } : {}),
          });
          if (result.error) return { error: result.error, message: result.message };
          // Gated flow capture: link the freshly-created doc back to its run step.
          if (stored?.flow_capture && result.doc_id) {
            try {
              await recordCapture(ctx, {
                runId: stored.flow_capture.run_id,
                nodeId: stored.flow_capture.node_id,
                docId: result.doc_id,
                docTitle: result.title ?? docName,
              });
            } catch { /* run-linking is best-effort — never fail the commit on it */ }
          }
          return { committed: true, doc_id: result.doc_id, operation: 'create' };
        }

        case 'trash_doc': {
          if (!payload.d) return { error: 'missing_doc_id' };
          const result = await trashDoc(ctx, {
            doc_id: payload.d,
            idempotency_key: iKey,
            user_confirmed: true,
          });
          if (result.error) return { error: result.error, message: result.message };
          return { committed: true, doc_id: payload.d, operation: 'trash_doc' };
        }

        default:
          return {
            error: 'unknown_operation',
            message: `Operation "${payload.op}" not supported.`,
          };
      }
    },
    (r) => ({
      committed: r.committed ?? null,
      doc_id: r.doc_id ?? null,
      operation: r.operation ?? null,
      error: r.error ?? null,
    }),
  );
}
