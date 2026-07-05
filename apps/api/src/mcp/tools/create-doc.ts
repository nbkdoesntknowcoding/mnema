/**
 * MCP tool: `create_doc`.
 *
 * Phase 9.2 — creates a new document in the workspace, then initialises its
 * live Yjs state via the collab IPC path.
 *
 * Gate sequence per the 9.2 spec:
 *   requireWriteScope → user_confirmed → idempotency → live role check
 *     → insert doc row → initLiveDoc → withAudit → return doc metadata
 *
 * Hard rules:
 *  - Content seeding goes through the Yjs IPC path (initLiveDoc).
 *  - Direct SQL is only used for the metadata row (id, title, path, etc.).
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { initLiveDoc } from '../../collab/writeback.js';
import { docs, folders, workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { withTenant } from '../../db/with-tenant.js';
import { contentHash, emptyYjsState } from '../../lib/yjs.js';
import type { McpAuthContext } from '../auth.js';
import { extractAnchors, type AnchorEntry } from '../anchors.js';
import { requireWriteScope } from '../scope.js';
import { withAudit } from './audit.js';

// ── Idempotency cache ────────────────────────────────────────────────────────
const idempotencyCache = new Map<string, { docId: string; expiry: number }>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

function checkIdempotencyKey(key: string): { docId: string } | null {
  const entry = idempotencyCache.get(key);
  if (entry === undefined) return null;
  if (Date.now() > entry.expiry) {
    idempotencyCache.delete(key);
    return null;
  }
  return { docId: entry.docId };
}

function recordIdempotencyKey(key: string, docId: string): void {
  if (idempotencyCache.size > 10_000) {
    const now = Date.now();
    for (const [k, e] of idempotencyCache) {
      if (e.expiry < now) idempotencyCache.delete(k);
    }
  }
  idempotencyCache.set(key, { docId, expiry: Date.now() + IDEMPOTENCY_TTL_MS });
}

// ── Roles that may write ─────────────────────────────────────────────────────
const WRITE_ROLES = new Set(['owner', 'editor']);

// ── Tool spec ────────────────────────────────────────────────────────────────

export const CREATE_DOC_TOOL = {
  name: 'create_doc',
  description: [
    'Creates a new document in the current workspace and optionally seeds it with',
    'Markdown content. Returns the new doc id, path, title, and initial anchors.',
    '',
    'SAFETY — this tool creates workspace content. Required before calling:',
    '  1. Show the user exactly what you are about to create (title + content).',
    '  2. Ask: "Should I create this doc?" and wait for their reply.',
    '  3. Only after they say yes, call with user_confirmed=true.',
    'Never set user_confirmed=true without an explicit "yes" in this conversation.',
    '',
    'REQUIRES:',
    '  - workspace:write scope in your token (owner / admin / editor only)',
    '',
    'Arguments:',
    '  title           — Title for the new document.',
    '  markdown        — Optional initial Markdown content.',
    '  folder_id       — Optional UUID of a folder to place the doc in.',
    '  type            — Doc type: "doc" (default), "engineering", "instruction",',
    '                    or "snippet".',
    '  idempotency_key — Caller-chosen unique string. Repeated calls with the same',
    '                    key within 1 hour return the previously-created doc.',
    '  user_confirmed  — Must be true. Gate: show draft → wait for yes → call.',
    '',
    'Returns { doc_id, path, title, anchors } on success.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Title for the new document.',
      },
      markdown: {
        type: 'string',
        description: 'Optional initial Markdown content.',
      },
      folder_id: {
        type: 'string',
        description: 'Optional UUID of an existing folder to place the doc in.',
      },
      type: {
        type: 'string',
        enum: ['doc', 'engineering', 'instruction', 'snippet'],
        description: 'Document type. Defaults to "doc".',
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
    required: ['title', 'idempotency_key', 'user_confirmed'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: false,
    title: 'Create a new document',
  },
};

// ── Zod schema ────────────────────────────────────────────────────────────────

const argsSchema = z
  .object({
    title: z.string().min(1).max(200),
    markdown: z.string().max(200_000).optional(),
    folder_id: z.string().uuid().optional(),
    type: z.enum(['doc', 'engineering', 'instruction', 'snippet']).optional().default('doc'),
    idempotency_key: z.string().min(1).max(128),
    user_confirmed: z.boolean(),
  })
  .strict();

// ── Result type ───────────────────────────────────────────────────────────────

export interface CreateDocResult {
  doc_id?: string;
  path?: string;
  title?: string;
  anchors?: AnchorEntry[];
  error?: string;
  message?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function createDoc(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<CreateDocResult> {
  // 1. Scope check.
  requireWriteScope(ctx);

  const args = argsSchema.parse(rawArgs);

  // 2. User confirmation gate.
  if (!args.user_confirmed) {
    return {
      error: 'user_confirmation_required',
      message:
        'Show the user the title and content you plan to create and wait for their ' +
        'explicit approval before calling with user_confirmed=true.',
    };
  }

  return await withAudit(
    ctx,
    { tool_name: CREATE_DOC_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      // 3. Idempotency check — return previously-created doc if key is reused.
      const iKey = `${ctx.tenant_id}:create:${args.idempotency_key}`;
      const existing = checkIdempotencyKey(iKey);
      if (existing) {
        // Fetch the previously-created doc so we return consistent data.
        const docRows = await withTenant(ctx.tenant_id, (tx) =>
          tx
            .select({
              id: docs.id,
              path: docs.path,
              title: docs.title,
              yjsState: docs.yjsState,
            })
            .from(docs)
            .where(eq(docs.id, existing.docId))
            .limit(1),
        );
        if (docRows.length > 0) {
          const r = docRows[0]!;
          let anchors: AnchorEntry[] = [];
          try {
            if (r.yjsState && r.yjsState.length > 0) anchors = extractAnchors(r.yjsState);
          } catch { /* ignore */ }
          return { doc_id: r.id, path: r.path, title: r.title, anchors };
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
          message: 'Only workspace owners, admins, and editors can create docs.',
        };
      }

      // 5. Insert the doc row.
      const path = `${nanoid(10)}.md`;
      const markdown = args.markdown ?? '';

      const created = await withTenant(ctx.tenant_id, async (tx) => {
        // Hierarchy: inherit the target folder's project (null if unfiled).
        let projectId: string | null = null;
        if (args.folder_id) {
          const f = await tx
            .select({ projectId: folders.projectId })
            .from(folders)
            .where(eq(folders.id, args.folder_id))
            .limit(1);
          projectId = f[0]?.projectId ?? null;
        }
        const inserted = await tx
          .insert(docs)
          .values({
            workspaceId: ctx.tenant_id,
            folderId: args.folder_id ?? null,
            projectId,
            path,
            title: args.title,
            type: args.type,
            markdown,
            yjsState: emptyYjsState(),
            contentHash: contentHash(markdown),
            createdBy: ctx.user_id,
            updatedBy: ctx.user_id,
          })
          .returning({
            id: docs.id,
            path: docs.path,
            title: docs.title,
            yjsState: docs.yjsState,
          });
        const row = inserted[0];
        if (!row) throw new Error('Failed to create doc');
        return row;
      });

      // 6. Seed the live Yjs doc via IPC.
      const ipcCtx = {
        user_id: ctx.user_id,
        tenant_id: ctx.tenant_id,
        email: ctx.email,
        doc_id: created.id,
      };
      await initLiveDoc(created.id, markdown || undefined, ipcCtx);
      // We proceed even if initLiveDoc returns false — the DB row exists and
      // the content will be hydrated the first time a user opens the doc.

      // 7. Record idempotency key on success.
      recordIdempotencyKey(iKey, created.id);

      // 8. Extract anchors from what was just persisted.
      let anchors: AnchorEntry[] = [];
      try {
        if (created.yjsState && created.yjsState.length > 0) {
          anchors = extractAnchors(created.yjsState);
        }
      } catch { /* ignore */ }

      return {
        doc_id: created.id,
        path: created.path,
        title: created.title,
        anchors,
      };
    },
    (result) => ({
      doc_id: result.doc_id ?? null,
      path: result.path ?? null,
      error: result.error ?? null,
    }),
  );
}
