/**
 * MCP tool: `list_folders`.
 *
 * Phase 9.3 — lists folders in the current workspace, optionally filtered by
 * parent_folder_id. Returns each folder with its doc_count and subfolder_count.
 *
 * Gate: requireScope(ctx, 'docs:read') — same as other read tools.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { docs, folders } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireScope } from '../scope.js';
import { withAudit } from './audit.js';

export const LIST_FOLDERS_TOOL = {
  name: 'list_folders',
  description: [
    'Lists folders in the current workspace.',
    '',
    'Use this when:',
    ' - The user asks what folders or collections exist in their workspace',
    ' - You need to find a folder id before creating or moving a doc',
    ' - You want to show the full folder tree',
    '',
    'Supply parent_folder_id to list direct children of a specific folder.',
    'Omit parent_folder_id to list root-level folders only.',
    'Pass include_all: true to return EVERY folder in the workspace (flat list,',
    'regardless of nesting depth) — use this when you need to search for a folder',
    'by name or id without knowing where it sits in the hierarchy.',
    '',
    'Each folder includes doc_count (direct non-trashed docs) and',
    'subfolder_count (direct non-trashed subfolders).',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      parent_folder_id: {
        type: 'string',
        description:
          'UUID of the parent folder to list children of. Omit to list root-level folders.',
      },
      include_all: {
        type: 'boolean',
        description:
          'When true, returns every non-trashed folder in the workspace regardless of nesting. Overrides parent_folder_id.',
      },
      project_id: {
        type: 'string',
        description: 'Optional project UUID — restrict to folders in that project.',
      },
    },
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    title: 'List folders',
  },
};

const argsSchema = z.object({
  parent_folder_id: z.string().uuid().optional(),
  include_all: z.boolean().optional(),
  project_id: z.string().uuid().optional(),
});

export interface ListFoldersResult {
  folders: Array<{
    id: string;
    name: string;
    parent_folder_id: string | null;
    doc_count: number;
    subfolder_count: number;
  }>;
}

export async function listFolders(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<ListFoldersResult> {
  requireScope(ctx, 'docs:read');

  const args = argsSchema.parse(rawArgs);

  return await withAudit(
    ctx,
    { tool_name: LIST_FOLDERS_TOOL.name, args: args as Record<string, unknown> },
    async () =>
      withTenant(ctx.tenant_id, async (tx) => {
        // Build WHERE clause:
        //   include_all=true  → every non-trashed folder (ignore parent filter)
        //   parent_folder_id  → direct children of that folder
        //   default           → root-level folders (parentFolderId IS NULL)
        const parentClause = args.include_all
          ? undefined
          : args.parent_folder_id !== undefined
            ? eq(folders.parentFolderId, args.parent_folder_id)
            : isNull(folders.parentFolderId);
        const projectClause = args.project_id
          ? eq(folders.projectId, args.project_id)
          : undefined;

        const rows = await tx
          .select({
            id: folders.id,
            name: folders.name,
            parentFolderId: folders.parentFolderId,
            // Count direct docs in this folder that are not trashed
            docCount: sql<number>`(
              SELECT COUNT(*)::int FROM docs d
              WHERE d.folder_id = ${folders.id} AND d.deleted_at IS NULL
            )`,
            // Count direct subfolders that are not trashed
            subfolderCount: sql<number>`(
              SELECT COUNT(*)::int FROM folders f2
              WHERE f2.parent_id = ${folders.id} AND f2.deleted_at IS NULL
            )`,
          })
          .from(folders)
          .where(and(isNull(folders.deletedAt), parentClause, projectClause))
          .orderBy(folders.name);

        return {
          folders: rows.map((r) => ({
            id: r.id,
            name: r.name,
            parent_folder_id: r.parentFolderId ?? null,
            doc_count: r.docCount,
            subfolder_count: r.subfolderCount,
          })),
        };
      }),
    (result) => ({ folder_count: result.folders.length }),
  );
}
