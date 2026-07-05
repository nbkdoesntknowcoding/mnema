/**
 * MCP tool: `trash_doc`.
 *
 * Phase 9.2 — soft-deletes a document by setting deleted_at / deleted_by on
 * the docs row. This is the ONLY tool permitted to do a direct SQL UPDATE on
 * the docs table, and only on these two metadata columns.
 *
 * Gate sequence per the 9.2 spec:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → doc exists and not trashed → UPDATE deleted_at / deleted_by → withAudit
 *
 * Hard rules:
 *  - Only touches deleted_at and deleted_by — never markdown or yjs_state.
 *  - Direct DB UPDATE is correct here: trash is a metadata flag, not content.
 *  - withTenant ensures the UPDATE is governed by RLS.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { docs, workspaceMembers } from '../../db/schema.js';
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

// ── Roles that may trash docs ─────────────────────────────────────────────────
const WRITE_ROLES = new Set(['owner', 'editor']);

// ── 30-day restore window ──────────────────────────────────────────────────────
const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// ── Tool spec ────────────────────────────────────────────────────────────────

export const TRASH_DOC_TOOL = {
  name: 'trash_doc',
  description: [
    'Moves a document to Trash (soft-delete). The doc is no longer visible in',
    'list_docs, search_docs, or get_doc, but can be restored from the Trash UI',
    'in the app for up to 30 days.',
    '',
    'SAFETY — this hides workspace content. Required before calling:',
    '  1. Show the user the doc title and id you are about to trash.',
    '  2. Ask: "Should I move this to Trash?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  doc_id          — UUID of the doc to trash.',
    '  idempotency_key — Caller-chosen unique string for safe retries.',
    '  user_confirmed  — Must be true.',
    '',
    'Returns { doc_id, trashed: true, restorable_until } on success.',
    'Errors: already_trashed, doc_not_found, insufficient_scope, insufficient_role,',
    '        user_confirmation_required, idempotency_duplicate.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_id: {
        type: 'string',
        description: 'UUID of the doc to trash.',
      },
      idempotency_key: {
        type: 'string',
        description: 'Caller-chosen unique key for safe retries (e.g. a UUID).',
      },
      user_confirmed: {
        type: 'boolean',
        description:
          'Must be true. Show the doc to the user and get their explicit approval before setting this.',
      },
    },
    required: ['doc_id', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
    title: 'Move a document to Trash',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    doc_id: z.string().uuid(),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface TrashDocResult {
  doc_id?: string;
  trashed?: boolean;
  restorable_until?: string;
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function trashDoc(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<TrashDocResult> {
  // 1. Scope check.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the doc title and id you plan to trash, then wait for their ' +
        'explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: TRASH_DOC_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      // 3. Idempotency check.
      const iKey = `${ctx.tenant_id}:trash:${args.doc_id}:${args.idempotency_key}`;
      if (checkIdempotencyKey(iKey)) {
        const restorableUntil = new Date(Date.now() + RESTORE_WINDOW_MS).toISOString();
        return {
          doc_id: args.doc_id,
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
          message: 'Only workspace owners, admins, and editors can trash docs.',
        };
      }

      // 5. Verify doc exists.
      const docRows = await withTenant(ctx.tenant_id, (tx) =>
        tx
          .select({ id: docs.id, deletedAt: docs.deletedAt })
          .from(docs)
          .where(eq(docs.id, args.doc_id))
          .limit(1),
      );
      if (docRows.length === 0) {
        return {
          error: 'doc_not_found',
          message: `Doc ${args.doc_id} not found in this workspace.`,
        };
      }
      if (docRows[0]!.deletedAt !== null) {
        return {
          error: 'already_trashed',
          message: `Doc ${args.doc_id} is already in Trash.`,
        };
      }

      // 6. Soft-delete via direct SQL UPDATE (permitted only here, only on
      //    deleted_at — never on markdown or yjs_state).
      //    withTenant ensures RLS governs the UPDATE.
      const now = new Date();
      await withTenant(ctx.tenant_id, (tx) =>
        tx
          .update(docs)
          .set({ deletedAt: now })
          .where(and(eq(docs.id, args.doc_id), isNull(docs.deletedAt))),
      );

      // 7. Record idempotency key on success.
      recordIdempotencyKey(iKey);

      const restorableUntil = new Date(now.getTime() + RESTORE_WINDOW_MS).toISOString();
      return {
        doc_id: args.doc_id,
        trashed: true,
        restorable_until: restorableUntil,
      };
    },
    (result) => ({
      doc_id: args.doc_id,
      trashed: result.trashed ?? false,
      error: result.error ?? null,
    }),
  );
}
