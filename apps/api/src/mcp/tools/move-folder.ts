/**
 * MCP tool: `move_folder`.
 *
 * Phase 9.3 — moves a folder to a new parent (or to root). Calls
 * wouldCreateCycle() BEFORE the UPDATE to prevent directed-cycle corruption.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → validate folder exists in workspace, not trashed
 *     → (if new_parent_folder_id) validate it exists in SAME workspace, not trashed
 *     → wouldCreateCycle check
 *     → UPDATE folders SET parent_id → withAudit → return { folder_id, parent_folder_id }
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { wouldCreateCycle } from '../../folders/cycle.js';
import { db } from '../../db/index.js';
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

// ── Roles that may write ─────────────────────────────────────────────────────
const WRITE_ROLES = new Set(['owner', 'editor']);

// ── Tool spec ────────────────────────────────────────────────────────────────

export const MOVE_FOLDER_TOOL = {
  name: 'move_folder',
  description: [
    'Moves a folder to a new parent folder (or to workspace root). Prevents cycles:',
    'you cannot move a folder inside itself or any of its own subfolders.',
    '',
    'SAFETY — this tool reorganises workspace content. Required before calling:',
    '  1. Show the user which folder you are moving and to which parent.',
    '  2. Ask: "Should I move this folder?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  folder_id            — UUID of the folder to move.',
    '  new_parent_folder_id — UUID of the new parent folder, or null for root.',
    '  idempotency_key      — Caller-chosen unique string for safe retries.',
    '  user_confirmed       — Must be true.',
    '',
    'Returns { folder_id, parent_folder_id } on success.',
    'Errors: folder_cycle, folder_not_found, insufficient_scope, insufficient_role.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      folder_id: {
        type: 'string',
        description: 'UUID of the folder to move.',
      },
      new_parent_folder_id: {
        type: ['string', 'null'],
        description: 'UUID of the new parent folder, or null to move to workspace root.',
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
    required: ['folder_id', 'new_parent_folder_id', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: false,
    title: 'Move a folder',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    folder_id: z.string().uuid(),
    new_parent_folder_id: z.string().uuid().nullable(),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface MoveFolderResult {
  folder_id?: string;
  parent_folder_id?: string | null;
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function moveFolder(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<MoveFolderResult> {
  // 1. Scope check.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the folder and new parent you plan to move to, then wait for ' +
        'their explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: MOVE_FOLDER_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      // 3. Idempotency check.
      const iKey = `${ctx.tenant_id}:move_folder:${args.folder_id}:${args.idempotency_key}`;
      if (checkIdempotencyKey(iKey)) {
        return {
          folder_id: args.folder_id,
          parent_folder_id: args.new_parent_folder_id,
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
          message: 'Only workspace owners, admins, and editors can move folders.',
        };
      }

      // 5. Validate the folder being moved exists in workspace, not trashed.
      const folderRows = await withTenant(ctx.tenant_id, (tx) =>
        tx
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.id, args.folder_id), isNull(folders.deletedAt)))
          .limit(1),
      );
      if (folderRows.length === 0) {
        return {
          error: 'folder_not_found',
          message: `Folder ${args.folder_id} not found in this workspace.`,
        };
      }

      // 6. Validate new parent folder if non-null.
      if (args.new_parent_folder_id !== null) {
        const parentRows = await withTenant(ctx.tenant_id, (tx) =>
          tx
            .select({ id: folders.id })
            .from(folders)
            .where(
              and(eq(folders.id, args.new_parent_folder_id!), isNull(folders.deletedAt)),
            )
            .limit(1),
        );
        if (parentRows.length === 0) {
          return {
            error: 'folder_not_found',
            message: `Target folder ${args.new_parent_folder_id} not found in this workspace.`,
          };
        }
      }

      // 7. Cycle check — MUST happen before the UPDATE.
      // Use the raw db (not a tx) so we can walk the full tree outside the
      // withTenant RLS context; the workspaceId filter provides isolation.
      const cycle = await wouldCreateCycle(
        db,
        ctx.tenant_id,
        args.folder_id,
        args.new_parent_folder_id,
      );
      if (cycle) {
        return {
          error: 'folder_cycle',
          message: 'Cannot move a folder inside itself or its own subfolders.',
        };
      }

      // 8. Update parent_id (only this column — never doc content).
      await withTenant(ctx.tenant_id, (tx) =>
        tx
          .update(folders)
          .set({ parentFolderId: args.new_parent_folder_id, updatedAt: new Date() })
          .where(and(eq(folders.id, args.folder_id), isNull(folders.deletedAt))),
      );

      // 9. Record idempotency key on success.
      recordIdempotencyKey(iKey);

      return {
        folder_id: args.folder_id,
        parent_folder_id: args.new_parent_folder_id,
      };
    },
    (result) => ({
      folder_id: result.folder_id ?? null,
      parent_folder_id: result.parent_folder_id ?? null,
      error: result.error ?? null,
    }),
  );
}
