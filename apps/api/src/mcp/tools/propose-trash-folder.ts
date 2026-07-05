/**
 * MCP tool: `propose_trash_folder`.
 *
 * Phase 10 Chunk 2 — model-facing half of the trash-folder write-preview.
 * Computes the cascade counts (docs + subfolders in the subtree) WITHOUT
 * trashing anything, issues a signed proposal_token, and returns a preview.
 * The actual trash only happens when the user clicks Approve in the iframe.
 *
 * Visibility: ["model"]. Companion: commit_trash_folder (["app"]).
 *
 * Gate: requireWriteScope → live role check → validate folder → cascade count
 *       → issue token. No audit here (audit happens in commit_trash_folder).
 */

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { folders, workspaceMembers } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { hashContent, issueProposalToken } from '../apps/proposal-token.js';

const WRITE_ROLES = new Set(['owner', 'editor']);

export const PROPOSE_TRASH_FOLDER_TOOL_NAME = 'propose_trash_folder';

export const PROPOSE_TRASH_FOLDER_TOOL_SPEC = {
  name: PROPOSE_TRASH_FOLDER_TOOL_NAME,
  description: [
    'Propose trashing a folder (and ALL its subfolders and docs) and open an',
    'interactive preview panel showing the cascade impact.',
    '',
    'This is the way to trash a folder when the user asks to delete one.',
    'The preview shows how many docs and subfolders will be trashed — the',
    'commit only fires when the user clicks Approve.',
    '',
    'Nothing is permanently deleted; everything is restorable for 30 days.',
    'REQUIRES: workspace:write scope.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      folder_id: {
        type: 'string',
        description: 'UUID of the folder to trash.',
      },
    },
    required: ['folder_id'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: true, title: 'Propose trashing a folder (with preview)' },
};

const argsSchema = z.object({
  folder_id: z.string().uuid(),
}).strict();

export interface ProposeTrashFolderResult {
  content: string;
  structuredContent: Record<string, unknown>;
  error?: string;
  message?: string;
}

export async function proposeTrashFolder(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<ProposeTrashFolderResult> {
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
      message: 'Only workspace owners, admins, and editors can trash folders.',
    };
  }

  // Validate folder exists and is not already trashed.
  const folderRows = await withTenant(ctx.tenant_id, (tx) =>
    tx.select({ id: folders.id, name: folders.name, deletedAt: folders.deletedAt })
      .from(folders)
      .where(eq(folders.id, args.folder_id))
      .limit(1),
  );
  if (folderRows.length === 0) {
    return {
      content: `Error: folder ${args.folder_id} not found.`,
      structuredContent: {},
      error: 'folder_not_found',
      message: `Folder ${args.folder_id} not found in this workspace.`,
    };
  }
  if (folderRows[0]!.deletedAt !== null) {
    return {
      content: `Error: folder ${args.folder_id} is already trashed.`,
      structuredContent: {},
      error: 'already_trashed',
      message: `Folder ${args.folder_id} is already in Trash.`,
    };
  }
  const folderName = folderRows[0]!.name ?? 'Untitled folder';

  // Cascade counts via recursive CTEs (same subtree walk as trash_folder).
  // postgres-js returns execute() results as a row array.
  const { docCount, subfolderCount } = await withTenant(ctx.tenant_id, async (tx) => {
    const docRes = (await tx.execute(sql`
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
      SELECT COUNT(*)::text AS doc_count FROM docs
      WHERE folder_id IN (SELECT id FROM subtree)
        AND deleted_at IS NULL
    `)) as unknown as Array<{ doc_count: string }>;

    const subRes = (await tx.execute(sql`
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
      SELECT COUNT(*)::text AS subfolder_count FROM subtree
      WHERE id <> ${args.folder_id}
    `)) as unknown as Array<{ subfolder_count: string }>;

    return {
      docCount: Number(docRes[0]?.doc_count ?? 0),
      subfolderCount: Number(subRes[0]?.subfolder_count ?? 0),
    };
  });

  // cascade_hash binds the impact the user is approving.
  const cascadeHash = hashContent(`${args.folder_id}:${docCount}:${subfolderCount}`);

  const { token } = issueProposalToken({
    u: ctx.user_id,
    w: ctx.tenant_id,
    d: '',
    op: 'trash_folder',
    h: cascadeHash,
    f: args.folder_id,
  });

  const structuredContent: Record<string, unknown> = {
    commit_tool: 'commit_trash_folder',
    preview: {
      kind: 'trash_folder',
      folder_name: folderName,
      doc_count: docCount,
      subfolder_count: subfolderCount,
      restore_days: 30,
    },
    proposal_token: token,
  };

  const contentSummary =
    `Proposed: trash folder "${folderName}" (${docCount} docs, ${subfolderCount} subfolders). ` +
    'Awaiting user approval.';

  return { content: contentSummary, structuredContent };
}
