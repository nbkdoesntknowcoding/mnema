/**
 * MCP tool: `replace_doc_body`.
 *
 * Phase 9.2 — replaces the entire body of a live Yjs document via the collab
 * IPC path, with an optimistic-concurrency check via expected_anchors.
 *
 * Gate sequence per the 9.2 spec:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → doc exists → IPC write (with anchor check) → record idempotency key
 *
 * Hard rules:
 *  - MUST NOT write to docs via REST or SQL — Yjs IPC path only.
 *  - MUST require expected_anchors to match current doc state.
 *  - MUST require user_confirmed=true.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { replaceBodyInLiveDoc } from '../../collab/writeback.js';
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

// ── Roles that may write ─────────────────────────────────────────────────────
const WRITE_ROLES = new Set(['owner', 'editor']);

// ── Tool spec ────────────────────────────────────────────────────────────────

export const REPLACE_DOC_BODY_TOOL = {
  name: 'replace_doc_body',
  description: [
    'Replaces the entire body of a document with new Markdown content.',
    'Uses optimistic concurrency: you must supply the expected_anchors list from',
    'your most recent get_doc call. If the doc has changed since you read it,',
    'the call returns doc_changed and you must re-read before retrying.',
    '',
    'SAFETY — this is a full-document replacement. Required before calling:',
    '  1. Call get_doc to read the current content and anchors.',
    '  2. Show the user the COMPLETE new document content.',
    '  3. Ask for their explicit approval and wait for a "yes".',
    '  4. Pass the anchors array from get_doc as expected_anchors.',
    '  5. Only then call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  doc_id           — UUID of the target doc.',
    '  markdown         — Complete new Markdown content for the document.',
    '  expected_anchors — The anchors[] anchor ids from your most recent get_doc call.',
    '                     Used as an optimistic concurrency token.',
    '  idempotency_key  — Caller-chosen unique string for safe retries.',
    '  user_confirmed   — Must be true.',
    '',
    'Returns { doc_id, applied: true } on success.',
    'Errors: doc_changed (doc was modified since you read it — re-read and retry),',
    '        write_failed, insufficient_scope, insufficient_role,',
    '        user_confirmation_required, idempotency_duplicate, doc_not_found.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_id: {
        type: 'string',
        description: 'UUID of the target doc.',
      },
      markdown: {
        type: 'string',
        description: 'Complete new Markdown content for the document.',
      },
      expected_anchors: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The anchors[] anchor ids from your most recent get_doc call. Used as an optimistic concurrency token.',
      },
      idempotency_key: {
        type: 'string',
        description: 'Caller-chosen unique key for safe retries (e.g. a UUID).',
      },
      user_confirmed: {
        type: 'boolean',
        description:
          'Must be true. Show the full new document to the user and get their explicit approval before setting this.',
      },
    },
    required: ['doc_id', 'markdown', 'expected_anchors', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
    title: 'Replace an entire document body',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    doc_id: z.string().uuid(),
    markdown: z.string().min(1).max(200_000),
    expected_anchors: z.array(z.string()),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface ReplaceBodyResult {
  doc_id?: string;
  applied?: boolean;
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function replaceDocBody(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<ReplaceBodyResult> {
  // 1. Scope check.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the complete new document content you plan to write and wait for their ' +
        'explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: REPLACE_DOC_BODY_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      // 3. Idempotency check.
      const iKey = `${ctx.tenant_id}:${args.doc_id}:${args.idempotency_key}`;
      if (checkIdempotencyKey(iKey)) {
        return {
          doc_id: args.doc_id,
          applied: true,
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
          message: 'Only workspace owners, admins, and editors can replace doc bodies.',
        };
      }

      // 5. Verify doc exists and is not soft-deleted.
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

      // 6. Write via Yjs IPC with optimistic concurrency check.
      const ipcCtx = {
        user_id: ctx.user_id,
        tenant_id: ctx.tenant_id,
        email: ctx.email,
        doc_id: args.doc_id,
      };
      const result = await replaceBodyInLiveDoc(
        args.doc_id,
        args.markdown,
        args.expected_anchors,
        ipcCtx,
      );

      if (result === 'doc_changed') {
        return {
          error: 'doc_changed',
          message:
            'The document was modified since you read it. Re-read it and reconcile before replacing.',
        };
      }

      if (!result) {
        return {
          error: 'write_failed',
          message: 'The collab server rejected the write. Check the server logs.',
        };
      }

      // 7. Record idempotency key on success.
      recordIdempotencyKey(iKey);
      return { doc_id: args.doc_id, applied: true };
    },
    (result) => ({
      doc_id: args.doc_id,
      applied: result.applied ?? false,
      error: result.error ?? null,
    }),
  );
}
