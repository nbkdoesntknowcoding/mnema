/**
 * MCP tool: `move_doc`.
 *
 * Phase 9.3 — moves a document into a folder (or to root if target_folder_id
 * is null). Only touches docs.folder_id — never markdown or yjs_state.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → validate doc exists in workspace, not trashed
 *     → (if target_folder_id) validate folder exists in SAME workspace, not trashed
 *     → UPDATE docs SET folder_id → withAudit → return { doc_id, folder_id }
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { docs, embeddings, folders, workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { withAudit } from './audit.js';

// ── Idempotency cache ────────────────────────────────────────────────────────
const idempotencyCache = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

function checkIdempotencyKey(key: string): boolean {
  const expiry = idempotencyCache.get(key);
  if (expiry === undefined) return false;
  if (Date.now() > expiry) {
    idempotencyCache.delete(key);
    return false;
  }
  return true;
}

function recordIdempotencyKey(key: string): void {
  if (idempotencyCache.size > 10_000) {
    const now = Date.now();
    for (const [k, exp] of idempotencyCache) {
      if (exp < now) idempotencyCache.delete(k);
    }
  }
  idempotencyCache.set(key, Date.now() + IDEMPOTENCY_TTL_MS);
}

// ── Roles that may write ─────────────────────────────────────────────────────
const WRITE_ROLES = new Set(['owner', 'editor']);

// ── Tool spec ────────────────────────────────────────────────────────────────

export const MOVE_DOC_TOOL = {
  name: 'move_doc',
  description: [
    'Moves a document into a folder (or to workspace root if target_folder_id is null).',
    'Only updates the folder assignment — never touches document content.',
    '',
    'SAFETY — this tool reorganises workspace content. Required before calling:',
    '  1. Show the user which doc you are moving and to which folder.',
    '  2. Ask: "Should I move this doc?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  doc_id           — UUID of the doc to move.',
    '  target_folder_id — UUID of the destination folder, or null to move to root.',
    '  idempotency_key  — Caller-chosen unique string for safe retries.',
    '  user_confirmed   — Must be true.',
    '',
    'Returns { doc_id, folder_id } on success.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_id: {
        type: 'string',
        description: 'UUID of the doc to move.',
      },
      target_folder_id: {
        type: ['string', 'null'],
        description: 'UUID of the destination folder, or null to move to workspace root.',
      },
      idempotency_key: {
        type: 'string',
        description: 'Caller-chosen unique key for safe retries (e.g. a UUID).',
      },
      user_confirmed: {
        type: 'boolean',
        description: 'Must be true. Get explicit user approval before setting this.',
      },
    },
    required: ['doc_id', 'target_folder_id', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: false,
    title: 'Move a document to a folder',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    doc_id: z.string().uuid(),
    target_folder_id: z.string().uuid().nullable(),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface MoveDocResult {
  doc_id?: string;
  folder_id?: string | null;
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function moveDoc(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<MoveDocResult> {
  // 1. Scope check.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the doc and target folder you plan to move to, then wait for ' +
        'their explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: MOVE_DOC_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      // 3. Idempotency check.
      const iKey = `${ctx.tenant_id}:move_doc:${args.doc_id}:${args.idempotency_key}`;
      if (checkIdempotencyKey(iKey)) {
        return {
          doc_id: args.doc_id,
          folder_id: args.target_folder_id,
          error: 'idempotency_duplicate',
          message: 'This idempotency_key was already used within the past hour.',
        };
      }

      // 4. Live role re-check.
      const [member] = await withSystemPrivilege((tx) =>
        tx
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.userId, ctx.user_id),
              eq(workspaceMembers.workspaceId, ctx.tenant_id),
            ),
          )
          .limit(1),
      );
      if (!member || !WRITE_ROLES.has(member.role)) {
        return {
          error: 'insufficient_role',
          message: 'Only workspace owners, admins, and editors can move docs.',
        };
      }

      // 5. Validate doc exists in workspace, not trashed.
      const docRows = await withTenant(ctx.tenant_id, (tx) =>
        tx
          .select({ id: docs.id })
          .from(docs)
          .where(and(eq(docs.id, args.doc_id), isNull(docs.deletedAt)))
          .limit(1),
      );
      if (docRows.length === 0) {
        return {
          error: 'doc_not_found',
          message: `Doc ${args.doc_id} not found in this workspace.`,
        };
      }

      // 6. Validate target folder if non-null (must be in same workspace, not trashed),
      //    and capture its project so the doc inherits it.
      let targetProjectId: string | null = null;
      if (args.target_folder_id !== null) {
        const folderRows = await withTenant(ctx.tenant_id, (tx) =>
          tx
            .select({ id: folders.id, projectId: folders.projectId })
            .from(folders)
            .where(
              and(eq(folders.id, args.target_folder_id!), isNull(folders.deletedAt)),
            )
            .limit(1),
        );
        if (folderRows.length === 0) {
          return {
            error: 'folder_not_found',
            message: `Folder ${args.target_folder_id} not found in this workspace.`,
          };
        }
        targetProjectId = folderRows[0]!.projectId ?? null;
      }

      // 7. Update docs.folder_id + project_id (hierarchy), and keep embeddings in sync.
      await withTenant(ctx.tenant_id, async (tx) => {
        await tx
          .update(docs)
          .set({ folderId: args.target_folder_id, projectId: targetProjectId })
          .where(and(eq(docs.id, args.doc_id), isNull(docs.deletedAt)));
        await tx.update(embeddings).set({ projectId: targetProjectId }).where(eq(embeddings.docId, args.doc_id));
      });

      // 8. Record idempotency key on success.
      recordIdempotencyKey(iKey);

      return {
        doc_id: args.doc_id,
        folder_id: args.target_folder_id,
      };
    },
    (result) => ({
      doc_id: result.doc_id ?? null,
      folder_id: result.folder_id ?? null,
      error: result.error ?? null,
    }),
  );
}
