/**
 * MCP tool: `trash_folder`.
 *
 * Phase 9.3 — soft-deletes a folder and ALL its descendant folders and docs
 * in a single transaction using recursive CTEs. No hard deletes anywhere.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → validate folder exists in workspace, not already trashed
 *     → ONE transaction:
 *         1. Soft-delete all docs in the subtree (excluding already-trashed)
 *         2. Soft-delete all subtree folders (excluding already-trashed)
 *     → withAudit → return { folder_id, trashed, restorable_until }
 *
 * Hard rules:
 *  - NEVER hard-deletes anything.
 *  - Cascade MUST be in ONE transaction.
 *  - Only touches deleted_at / deleted_by — never docs.markdown or docs.yjs_state.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { folders, workspaceMembers } from '../../db/schema.js';
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

// ── Roles that may trash ─────────────────────────────────────────────────────
const WRITE_ROLES = new Set(['owner', 'editor']);

// ── 30-day restore window ──────────────────────────────────────────────────────
const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// ── Tool spec ────────────────────────────────────────────────────────────────

export const TRASH_FOLDER_TOOL = {
  name: 'trash_folder',
  description: [
    'Moves a folder (and ALL its contents — subfolders and docs) to Trash.',
    'Nothing is permanently deleted; everything can be restored from the Trash UI',
    'in the app for up to 30 days.',
    '',
    'SAFETY — this hides an entire folder tree. Required before calling:',
    '  1. Show the user the folder name and warn that all contents will be trashed.',
    '  2. Ask: "Should I move this folder and all its contents to Trash?" and wait.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  folder_id       — UUID of the folder to trash.',
    '  idempotency_key — Caller-chosen unique string for safe retries.',
    '  user_confirmed  — Must be true.',
    '',
    'Returns { folder_id, trashed: true, restorable_until } on success.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      folder_id: {
        type: 'string',
        description: 'UUID of the folder to trash.',
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
    required: ['folder_id', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
    title: 'Move a folder (and its contents) to Trash',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    folder_id: z.string().uuid(),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface TrashFolderResult {
  folder_id?: string;
  trashed?: boolean;
  restorable_until?: string;
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function trashFolder(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<TrashFolderResult> {
  // 1. Scope check.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the folder name and warn that all subfolders and docs will be ' +
        'trashed, then wait for their explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: TRASH_FOLDER_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      // 3. Idempotency check.
      const iKey = `${ctx.tenant_id}:trash_folder:${args.folder_id}:${args.idempotency_key}`;
      if (checkIdempotencyKey(iKey)) {
        const restorableUntil = new Date(Date.now() + RESTORE_WINDOW_MS).toISOString();
        return {
          folder_id: args.folder_id,
          trashed: true,
          restorable_until: restorableUntil,
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
          message: 'Only workspace owners, admins, and editors can trash folders.',
        };
      }

      // 5. Validate folder exists and is not already trashed.
      const folderRows = await withTenant(ctx.tenant_id, (tx) =>
        tx
          .select({ id: folders.id, deletedAt: folders.deletedAt })
          .from(folders)
          .where(eq(folders.id, args.folder_id))
          .limit(1),
      );
      if (folderRows.length === 0) {
        return {
          error: 'folder_not_found',
          message: `Folder ${args.folder_id} not found in this workspace.`,
        };
      }
      if (folderRows[0]!.deletedAt !== null) {
        return {
          error: 'already_trashed',
          message: `Folder ${args.folder_id} is already in Trash.`,
        };
      }

      const now = new Date();

      // 6. Cascade soft-delete in ONE transaction.
      //    Step 1: soft-delete all docs in the subtree (not already trashed).
      //    Step 2: soft-delete all subtree folders (not already trashed).
      //    Uses RECURSIVE CTEs to walk arbitrary depth.
      //    NEVER touches docs.markdown or docs.yjs_state.
      await withTenant(ctx.tenant_id, async (tx) => {
        // Step 1: soft-delete docs in the entire subtree
        await tx.execute(sql`
          WITH RECURSIVE subtree AS (
            SELECT id FROM folders
            WHERE id = ${args.folder_id}
              AND workspace_id = ${ctx.tenant_id}::uuid
              AND deleted_at IS NULL
            UNION ALL
            SELECT f.id FROM folders f
            JOIN subtree s ON f.parent_id = s.id
            WHERE f.deleted_at IS NULL
          )
          UPDATE docs SET deleted_at = ${now}, deleted_by = ${ctx.user_id}
          WHERE folder_id IN (SELECT id FROM subtree)
            AND deleted_at IS NULL
        `);

        // Step 2: soft-delete all folders in the subtree (including the root)
        await tx.execute(sql`
          WITH RECURSIVE subtree AS (
            SELECT id FROM folders
            WHERE id = ${args.folder_id}
              AND workspace_id = ${ctx.tenant_id}::uuid
              AND deleted_at IS NULL
            UNION ALL
            SELECT f.id FROM folders f
            JOIN subtree s ON f.parent_id = s.id
            WHERE f.deleted_at IS NULL
          )
          UPDATE folders SET deleted_at = ${now}, deleted_by = ${ctx.user_id}
          WHERE id IN (SELECT id FROM subtree)
            AND deleted_at IS NULL
        `);
      });

      // 7. Record idempotency key on success.
      recordIdempotencyKey(iKey);

      const restorableUntil = new Date(now.getTime() + RESTORE_WINDOW_MS).toISOString();
      return {
        folder_id: args.folder_id,
        trashed: true,
        restorable_until: restorableUntil,
      };
    },
    (result) => ({
      folder_id: args.folder_id,
      trashed: result.trashed ?? false,
      error: result.error ?? null,
    }),
  );
}
