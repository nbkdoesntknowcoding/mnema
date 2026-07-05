/**
 * MCP tool: `replace_doc_section`.
 *
 * Phase 9.2 — replaces a named section (heading + its body content) in a live
 * Yjs document via the collab IPC path.
 *
 * Gate sequence per the 9.2 spec:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → doc exists → IPC write → record idempotency key
 *
 * Hard rules:
 *  - MUST NOT write to docs via REST or SQL — Yjs IPC path only.
 *  - MUST require user_confirmed=true.
 *  - MUST gate on workspace:write scope AND live role re-check.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { replaceSectionInLiveDoc } from '../../collab/writeback.js';
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

export const REPLACE_DOC_SECTION_TOOL = {
  name: 'replace_doc_section',
  description: [
    'Replaces a specific section of a document in place. The section is identified',
    'by its anchor id (from get_doc anchors[]). The heading node and all body',
    'blocks up to the next same-or-higher-level heading are replaced atomically.',
    '',
    'SAFETY — this tool destructively replaces existing content. Required before calling:',
    '  1. Call get_doc to read the current content and anchors.',
    '  2. Show the user the current section AND what you plan to write in its place.',
    '  3. Ask for their explicit approval and wait for a "yes".',
    '  4. Only then call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  doc_id          — UUID of the target doc.',
    '  section_anchor  — Anchor id of the heading block to replace (from get_doc).',
    '  markdown        — New Markdown content for this section.',
    '  idempotency_key — Caller-chosen unique string for safe retries.',
    '  user_confirmed  — Must be true.',
    '',
    'Returns { doc_id, applied: true } on success.',
    'Errors: anchor_not_found (anchor no longer exists — re-read the doc),',
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
      section_anchor: {
        type: 'string',
        description: 'Anchor id of the heading block to replace (from get_doc anchors[]).',
      },
      markdown: {
        type: 'string',
        description: 'New Markdown content for this section.',
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
    required: ['doc_id', 'section_anchor', 'markdown', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
    title: 'Replace a document section',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    doc_id: z.string().uuid(),
    section_anchor: z.string().min(1).max(64),
    markdown: z.string().min(1).max(200_000),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface ReplaceSectionResult {
  doc_id?: string;
  applied?: boolean;
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function replaceDocSection(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<ReplaceSectionResult> {
  // 1. Scope check.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the current section content and what you plan to replace it with, ' +
        'then wait for their explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: REPLACE_DOC_SECTION_TOOL.name, args: args as Record<string, unknown> },
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
          message: 'Only workspace owners, admins, and editors can replace doc sections.',
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

      // 6. Write via Yjs IPC.
      const ipcCtx = {
        user_id: ctx.user_id,
        tenant_id: ctx.tenant_id,
        email: ctx.email,
        doc_id: args.doc_id,
      };
      const result = await replaceSectionInLiveDoc(
        args.doc_id,
        args.section_anchor,
        args.markdown,
        ipcCtx,
      );

      if (result === 'anchor_not_found') {
        return {
          error: 'anchor_not_found',
          message:
            'That section no longer exists; re-read the doc for current anchors.',
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
