/**
 * MCP tool: `create_folder`.
 *
 * Phase 9.3 — creates a new folder in the current workspace.
 *
 * Gate sequence:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → (if parent_folder_id) validate parent exists in workspace, not trashed
 *     → INSERT folder → withAudit → return { folder_id, name, parent_folder_id }
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
const idempotencyCache = new Map<string, { folderId: string; expiry: number }>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

function checkIdempotencyKey(key: string): { folderId: string } | null {
  const entry = idempotencyCache.get(key);
  if (entry === undefined) return null;
  if (Date.now() > entry.expiry) {
    idempotencyCache.delete(key);
    return null;
  }
  return { folderId: entry.folderId };
}

function recordIdempotencyKey(key: string, folderId: string): void {
  if (idempotencyCache.size > 10_000) {
    const now = Date.now();
    for (const [k, e] of idempotencyCache) {
      if (e.expiry < now) idempotencyCache.delete(k);
    }
  }
  idempotencyCache.set(key, { folderId, expiry: Date.now() + IDEMPOTENCY_TTL_MS });
}

// ── Roles that may write ─────────────────────────────────────────────────────
const WRITE_ROLES = new Set(['owner', 'editor']);

// ── Tool spec ────────────────────────────────────────────────────────────────

export const CREATE_FOLDER_TOOL = {
  name: 'create_folder',
  description: [
    'Creates a new folder in the current workspace.',
    '',
    'SAFETY — this tool creates workspace content. Required before calling:',
    '  1. Show the user the folder name you are about to create.',
    '  2. Ask: "Should I create this folder?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  name              — Name for the new folder (1–200 characters).',
    '  parent_folder_id  — Optional UUID of a parent folder for nesting.',
    '                      Omit to create at workspace root.',
    '  idempotency_key   — Caller-chosen unique string for safe retries.',
    '  user_confirmed    — Must be true.',
    '',
    'Returns { folder_id, name, parent_folder_id } on success.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'Name for the new folder.',
      },
      parent_folder_id: {
        type: 'string',
        description: 'Optional UUID of a parent folder. Omit for root-level.',
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
    required: ['name', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: false,
    title: 'Create a folder',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    name: z.string().min(1).max(200),
    parent_folder_id: z.string().uuid().optional(),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface CreateFolderResult {
  folder_id?: string;
  name?: string;
  parent_folder_id?: string | null;
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function createFolder(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<CreateFolderResult> {
  // 1. Scope check.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the folder name you plan to create and wait for their ' +
        'explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: CREATE_FOLDER_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      // 3. Idempotency check.
      const iKey = `${ctx.tenant_id}:create_folder:${args.idempotency_key}`;
      const existing = checkIdempotencyKey(iKey);
      if (existing) {
        // Return the previously-created folder.
        const folderRows = await withTenant(ctx.tenant_id, (tx) =>
          tx
            .select({ id: folders.id, name: folders.name, parentFolderId: folders.parentFolderId })
            .from(folders)
            .where(eq(folders.id, existing.folderId))
            .limit(1),
        );
        if (folderRows.length > 0) {
          const r = folderRows[0]!;
          return { folder_id: r.id, name: r.name, parent_folder_id: r.parentFolderId ?? null };
        }
        return {
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
          message: 'Only workspace owners, admins, and editors can create folders.',
        };
      }

      // 5. Validate parent folder if provided.
      if (args.parent_folder_id) {
        const parentRows = await withTenant(ctx.tenant_id, (tx) =>
          tx
            .select({ id: folders.id })
            .from(folders)
            .where(
              and(eq(folders.id, args.parent_folder_id!), isNull(folders.deletedAt)),
            )
            .limit(1),
        );
        if (parentRows.length === 0) {
          return {
            error: 'folder_not_found',
            message: `Parent folder ${args.parent_folder_id} not found in this workspace.`,
          };
        }
      }

      // 6. Insert the folder row.
      const now = new Date();
      const inserted = await withTenant(ctx.tenant_id, (tx) =>
        tx
          .insert(folders)
          .values({
            workspaceId: ctx.tenant_id,
            name: args.name,
            parentFolderId: args.parent_folder_id ?? null,
            createdBy: ctx.user_id,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: folders.id, name: folders.name, parentFolderId: folders.parentFolderId }),
      );

      const row = inserted[0];
      if (!row) {
        return { error: 'insert_failed', message: 'Failed to create folder.' };
      }

      // 7. Record idempotency key on success.
      recordIdempotencyKey(iKey, row.id);

      return {
        folder_id: row.id,
        name: row.name,
        parent_folder_id: row.parentFolderId ?? null,
      };
    },
    (result) => ({
      folder_id: result.folder_id ?? null,
      error: result.error ?? null,
    }),
  );
}
