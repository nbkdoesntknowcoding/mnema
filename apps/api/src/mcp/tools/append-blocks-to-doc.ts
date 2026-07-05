/**
 * MCP tool: `append_blocks_to_doc`.
 *
 * Phase 9.1 — the first write tool. Appends one or more Markdown blocks to
 * a live Yjs document via the collab IPC path (APPEND semantics, not REPLACE).
 *
 * Gate sequence per the 9.1 spec:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → doc exists → IPC write → record idempotency key
 *
 * Hard rules:
 *  - MUST NOT write to docs via REST or SQL — Yjs IPC path only.
 *  - MUST surface an error if the doc is not live (not open in an editor).
 *  - MUST require user_confirmed=true (user saw the draft and said yes).
 *  - MUST gate on workspace:write scope AND live role re-check.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { appendMarkdownIntoLiveDoc } from '../../collab/writeback.js';
import { docs, workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { withAudit } from './audit.js';

// ── Idempotency cache ────────────────────────────────────────────────────────
// In-memory; resets on restart. Per the 9.1 spec ("in-memory or Redis").
// Key: `${tenant_id}:${doc_id}:${idempotency_key}` → expiry timestamp (ms).
const idempotencyCache = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

function checkIdempotencyKey(key: string): boolean {
  const expiry = idempotencyCache.get(key);
  if (expiry === undefined) return false;
  if (Date.now() > expiry) {
    idempotencyCache.delete(key);
    return false;
  }
  return true; // duplicate
}

function recordIdempotencyKey(key: string): void {
  // Prune expired entries to keep memory bounded.
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

export const APPEND_BLOCKS_TO_DOC_TOOL = {
  name: 'append_blocks_to_doc',
  description: [
    'Appends one or more Markdown blocks to a doc — either at the end or after',
    'a specific anchor block. Uses the live Yjs collab path so connected editors',
    'see the change in real time.',
    '',
    'SAFETY — this tool mutates workspace content. Required before calling:',
    '  1. Show the user exactly what you are about to append (the full markdown).',
    '  2. Ask: "Should I add this to the doc?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  doc_id          — UUID of the target doc (from get_doc or list_docs)',
    '  markdown        — Markdown text to append (paragraphs, headings, lists…)',
    '  after_anchor    — Optional anchor id from get_doc anchors[]. Insert after',
    '                    this block. Omit to append at end of document.',
    '  idempotency_key — Caller-chosen unique string (e.g. a UUID or hash).',
    '                    Repeated calls with the same key within 1 hour are',
    '                    no-ops — safe to retry on network error.',
    '  user_confirmed  — Must be true. Gate: show draft → wait for yes → call.',
    '',
    'Returns { applied: true } on success.',
    'Errors: insufficient_scope, insufficient_role, user_confirmation_required,',
    '        idempotency_duplicate, doc_not_found, write_failed.',
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
        description: 'Markdown content to append.',
      },
      after_anchor: {
        type: 'string',
        description:
          'Optional. Anchor ID (from get_doc anchors[]) of the block after which to insert. Omit to append at document end.',
      },
      idempotency_key: {
        type: 'string',
        description: 'Caller-chosen unique key for safe retries (e.g. a UUID).',
      },
      user_confirmed: {
        type: 'boolean',
        description:
          'Must be true. Show the draft to the user and get their explicit approval before setting this.',
      },
    },
    required: ['doc_id', 'markdown', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
    title: 'Append Markdown blocks to a document',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    doc_id: z.string().uuid(),
    markdown: z.string().min(1).max(50_000),
    after_anchor: z.string().min(1).max(32).optional(),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface AppendBlocksResult {
  applied?: boolean;
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function appendBlocksToDoc(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<AppendBlocksResult> {
  // 1. Scope check — fast path before any DB I/O.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate — reject before audit to avoid noise.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the exact markdown you plan to append and wait for their ' +
        'explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: APPEND_BLOCKS_TO_DOC_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      // 3. Idempotency check — before the write.
      const iKey = `${ctx.tenant_id}:${args.doc_id}:${args.idempotency_key}`;
      if (checkIdempotencyKey(iKey)) {
        return {
          applied: true, // pretend success — safe-retry semantic
          error: 'idempotency_duplicate',
          message: 'This idempotency_key was already used within the past hour.',
        };
      }

      // 4. Live role re-check (defence-in-depth beyond the JWT scope).
      //    The JWT scope is minted at login; a role downgrade since then
      //    would not automatically revoke an existing token.
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
          message: 'Only workspace owners, admins, and editors can append blocks.',
        };
      }

      // 5. Verify the doc exists and is not soft-deleted.
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

      // 6. Write via Yjs IPC (the only permitted write path per Phase 9.1).
      const ipcCtx = {
        user_id: ctx.user_id,
        tenant_id: ctx.tenant_id,
        email: ctx.email,
        doc_id: args.doc_id,
      };
      const result = await appendMarkdownIntoLiveDoc(
        args.doc_id,
        args.markdown,
        ipcCtx,
        args.after_anchor,
      );

      if (!result) {
        return {
          error: 'write_failed',
          message: 'The collab server rejected the write. Check the server logs.',
        };
      }

      // 7. Record idempotency key only on confirmed success.
      recordIdempotencyKey(iKey);
      return { applied: true };
    },
    (result) => ({
      doc_id: args.doc_id,
      applied: result.applied ?? false,
      error: result.error ?? null,
    }),
  );
}
