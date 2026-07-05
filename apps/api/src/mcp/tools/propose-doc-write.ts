/**
 * MCP tool: `propose_doc_write`.
 *
 * Phase 10 — the model-facing half of the write-preview pattern. Computes a
 * preview of the proposed write WITHOUT committing, issues a signed
 * proposal_token, and returns structuredContent + the write-preview UI resource
 * URI. The actual commit only happens when the user clicks Approve in the iframe.
 *
 * Visibility: ["model"] — only the AI can call this tool.
 * The companion commit_doc_write is ["app"]-only (UI-triggered only).
 *
 * Operations supported: append, replace_section, replace_body, create, trash_doc.
 *
 * Gate: requireWriteScope → live role check → validate doc + args → issue token
 * Returns: content (short summary), structuredContent (preview + token)
 * No audit here — this is a read-phase (no commit). Audit happens in commit_doc_write.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { docs, folders, workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { hashContent, issueProposalToken, storeProposalContent } from '../apps/proposal-token.js';

const WRITE_ROLES = new Set(['owner', 'editor']);

export const PROPOSE_DOC_WRITE_TOOL_NAME = 'propose_doc_write';

export const PROPOSE_DOC_WRITE_TOOL_SPEC = {
  name: PROPOSE_DOC_WRITE_TOOL_NAME,
  description: [
    'Propose a write to a doc and open an interactive preview panel.',
    '',
    'This is the general doc-write tool — use it whenever the user asks to write or',
    'edit a doc. The proposed content is shown in a preview with Approve/Reject',
    'buttons — the commit only fires when the user clicks Approve.',
    '',
    'Supported operations:',
    '  append          — add blocks at the end of the doc',
    '  replace_section — replace one section (requires section_anchor)',
    '  replace_body    — replace the entire doc body',
    '  create          — create a new doc (doc_id not required)',
    '  trash_doc       — soft-delete a doc',
    '',
    'Returns a summary in content plus a proposal_token. The preview panel',
    'opens automatically in Claude Desktop.',
    '',
    'IN CLAUDE CODE / CLI (no panel visible):',
    '  The panel will not render. Instead:',
    '  1. Show the user the proposed markdown from the result.',
    '  2. Ask the user to confirm ("approve?").',
    '  3. On confirmation, call confirm_doc_write with the proposal_token.',
    '  Do NOT call confirm_doc_write without explicit user approval.',
    '',
    'REQUIRES: workspace:write scope.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['append', 'replace_section', 'replace_body', 'create', 'trash_doc'],
        description: 'The write operation to preview.',
      },
      doc_id: {
        type: 'string',
        description: 'UUID of the target doc (omit for create operation).',
      },
      markdown: {
        type: 'string',
        description: 'The proposed markdown content to write.',
      },
      section_anchor: {
        type: 'string',
        description: 'For replace_section: the anchor id of the section to replace.',
      },
      expected_anchors: {
        type: 'array',
        items: { type: 'string' },
        description: 'For replace_body: optional anchor list for optimistic-concurrency checking.',
      },
      title: {
        type: 'string',
        description: 'For create operation: the new doc title. Use THIS field for the title.',
      },
      folder_id: {
        type: 'string',
        description: 'For create operation: optional UUID of the target folder.',
      },
      doc_name: {
        type: 'string',
        description: 'Deprecated alias of `title` for create (kept for back-compat). Prefer `title`; do not set both.',
      },
    },
    required: ['operation'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Propose a doc write (with preview)' },
};

const argsSchema = z.object({
  operation: z.enum(['append', 'replace_section', 'replace_body', 'create', 'trash_doc']),
  doc_id: z.string().uuid().optional(),
  markdown: z.string().max(100_000).optional(),
  section_anchor: z.string().min(1).max(64).optional(),
  expected_anchors: z.array(z.string()).optional(),
  title: z.string().min(1).max(200).optional(),
  folder_id: z.string().uuid().optional(),
  doc_name: z.string().min(1).max(200).optional(),
}).strict();

export interface ProposeDocWriteResult {
  content: string;
  structuredContent: Record<string, unknown>;
  error?: string;
  message?: string;
}

export async function proposeDocWrite(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<ProposeDocWriteResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  // Live role check
  const [member] = await withSystemPrivilege((tx) =>
    tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, ctx.user_id), eq(workspaceMembers.workspaceId, ctx.tenant_id)))
      .limit(1),
  );
  if (!member || !WRITE_ROLES.has(member.role)) {
    return {
      content: 'Error: insufficient role.',
      structuredContent: {},
      error: 'insufficient_role',
      message: 'Only workspace owners, admins, and editors can write docs.',
    };
  }

  // For operations that target an existing doc, validate it exists
  let docTitle = args.title ?? args.doc_name ?? 'Untitled';
  let beforeContent: string | undefined;
  let fullMarkdown = '';

  if (args.operation !== 'create') {
    if (!args.doc_id) {
      return {
        content: 'Error: doc_id required for this operation.',
        structuredContent: {},
        error: 'missing_doc_id',
      };
    }
    const docRows = await withTenant(ctx.tenant_id, (tx) =>
      tx.select({ id: docs.id, title: docs.title, markdown: docs.markdown })
        .from(docs)
        .where(and(eq(docs.id, args.doc_id!), isNull(docs.deletedAt)))
        .limit(1),
    );
    if (docRows.length === 0) {
      return {
        content: `Error: doc ${args.doc_id} not found.`,
        structuredContent: {},
        error: 'doc_not_found',
      };
    }
    docTitle = docRows[0]!.title ?? 'Untitled';
    fullMarkdown = docRows[0]!.markdown ?? '';
    if (args.operation === 'replace_section') {
      // Known limitation: proper section extraction by anchor requires Yjs.
      // We show the full doc (first 2000 chars) as before-context.
      beforeContent = fullMarkdown.slice(0, 2000) + (fullMarkdown.length > 2000 ? '\n…' : '');
    } else if (args.operation === 'replace_body') {
      beforeContent = fullMarkdown;
    } else if (args.operation === 'trash_doc') {
      beforeContent = fullMarkdown;
    }
  }

  const proposedContent = args.markdown ?? '';
  const contentHash = hashContent(proposedContent);

  // OCC check for replace_body. In Chunk 2 we pass expected_anchors through to
  // the commit (which lets replaceDocBody do the real lost-update guard) and
  // always report anchor_drift: false in the preview.
  // (A proper anchor-version check would compare expected_anchors[0] against
  //  the doc's current markdown sha256 — deferred; the commit-side guard is
  //  the authoritative check.)

  const { token, nonce, exp } = issueProposalToken({
    u: ctx.user_id,
    w: ctx.tenant_id,
    d: args.doc_id ?? '',
    op: args.operation,
    h: contentHash,
    ...(args.section_anchor ? { a: args.section_anchor } : {}),
  });

  // Store proposed content for commit retrieval (in-memory, 10-min TTL)
  storeProposalContent(
    nonce,
    proposedContent,
    exp,
    args.section_anchor,
    args.title ?? args.doc_name,
    args.expected_anchors,
    args.folder_id,
  );

  // Build the operation-specific preview sub-object.
  let preview: Record<string, unknown>;
  switch (args.operation) {
    case 'append':
      preview = {
        kind: 'append',
        doc_title: docTitle,
        new_blocks_markdown: proposedContent,
        after_anchor: null,
      };
      break;
    case 'replace_section':
      preview = {
        kind: 'replace_section',
        doc_title: docTitle,
        section_heading: args.section_anchor ?? 'section',
        before_markdown: beforeContent ?? '',
        after_markdown: proposedContent,
      };
      break;
    case 'replace_body':
      preview = {
        kind: 'replace_body',
        doc_title: docTitle,
        before_markdown: fullMarkdown,
        after_markdown: proposedContent,
        anchor_drift: false,
      };
      break;
    case 'create': {
      let folderName = 'workspace root';
      if (args.folder_id) {
        const folderRows = await withTenant(ctx.tenant_id, (tx) =>
          tx.select({ name: folders.name }).from(folders)
            .where(and(eq(folders.id, args.folder_id!), isNull(folders.deletedAt)))
            .limit(1),
        );
        folderName = folderRows[0]?.name ?? args.folder_id;
      }
      preview = {
        kind: 'create',
        title: args.title ?? args.doc_name ?? 'New Doc',
        folder_name: folderName,
        folder_id: args.folder_id ?? null,
        body_markdown: proposedContent,
      };
      break;
    }
    case 'trash_doc':
      preview = {
        kind: 'trash_doc',
        doc_title: docTitle,
        block_count: (beforeContent?.split('\n') ?? []).length,
        restore_days: 30,
      };
      break;
    default:
      preview = { kind: args.operation };
  }

  const structuredContent: Record<string, unknown> = {
    commit_tool: 'commit_doc_write',
    operation: args.operation,
    doc_id: args.doc_id ?? null,
    doc_title: docTitle,
    preview,
    expected_anchors: args.expected_anchors ?? null,
    proposal_token: token,
    section_anchor: args.section_anchor ?? null,
  };

  const opDescriptions: Record<string, string> = {
    append: `append ${proposedContent.split('\n').filter(Boolean).length} line(s)`,
    replace_section: 'replace a section',
    replace_body: 'replace the entire body',
    create: 'create a new doc',
    trash_doc: 'trash the doc',
  };
  const opDesc = opDescriptions[args.operation] ?? args.operation;
  const contentSummary = `Proposed: ${opDesc} in "${docTitle}". Awaiting user approval in the preview panel.`;

  return { content: contentSummary, structuredContent };
}
