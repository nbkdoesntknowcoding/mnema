/**
 * MCP tool: `rename_folder`.
 *
 * Phase 9.3 — renames an existing folder.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → validate folder exists in workspace, not trashed
 *     → UPDATE folders SET name, updated_at
 *     → withAudit → return { folder_id, name }
 */

import { and, eq, isNull } from 'drizzle-orm';
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

// ── Roles that may write ─────────────────────────────────────────────────────
const WRITE_ROLES = new Set(['owner', 'editor']);

// ── Tool spec ────────────────────────────────────────────────────────────────

export const RENAME_FOLDER_TOOL = {
  name: 'rename_folder',
  description: [
    'Renames a folder.',
    '',
    'SAFETY — this tool modifies workspace content. Required before calling:',
    '  1. Show the user the current and new folder name.',
    '  2. Ask: "Should I rename this folder?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  folder_id       — UUID of the folder to rename.',
    '  new_name        — New name for the folder (1–200 characters).',
    '  idempotency_key — Caller-chosen unique string for safe retries.',
    '  user_confirmed  — Must be true.',
    '',
    'Returns { folder_id, name } on success.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      folder_id: {
        type: 'string',
        description: 'UUID of the folder to rename.',
      },
      new_name: {
        type: 'string',
        description: 'New name for the folder.',
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
    required: ['folder_id', 'new_name', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: false,
    title: 'Rename a folder',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    folder_id: z.string().uuid(),
    new_name: z.string().min(1).max(200),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface RenameFolderResult {
  folder_id?: string;
  name?: string;
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function renameFolder(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<RenameFolderResult> {
  // 1. Scope check.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the current and new folder name, then wait for their ' +
        'explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: RENAME_FOLDER_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      // 3. Idempotency check.
      const iKey = `${ctx.tenant_id}:rename_folder:${args.folder_id}:${args.idempotency_key}`;
      if (checkIdempotencyKey(iKey)) {
        return {
          folder_id: args.folder_id,
          name: args.new_name,
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
          message: 'Only workspace owners, admins, and editors can rename folders.',
        };
      }

      // 5. Validate folder exists in workspace, not trashed.
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

      // 6. Update the name.
      await withTenant(ctx.tenant_id, (tx) =>
        tx
          .update(folders)
          .set({ name: args.new_name, updatedAt: new Date() })
          .where(and(eq(folders.id, args.folder_id), isNull(folders.deletedAt))),
      );

      // 7. Record idempotency key on success.
      recordIdempotencyKey(iKey);

      return {
        folder_id: args.folder_id,
        name: args.new_name,
      };
    },
    (result) => ({
      folder_id: result.folder_id ?? null,
      name: result.name ?? null,
      error: result.error ?? null,
    }),
  );
}
