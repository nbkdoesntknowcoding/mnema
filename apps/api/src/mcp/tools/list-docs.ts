import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { docs } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireScope } from '../scope.js';
import { withAudit } from './audit.js';
import { decodeCursor, encodeCursor } from './pagination.js';

/**
 * MCP tool: `list_docs`.
 *
 * The description is product copy — it's what Claude reads to decide
 * whether to invoke this vs. `get_doc` vs. `search_docs`. Don't trim it.
 */
export const LIST_DOCS_TOOL = {
  name: 'list_docs',
  description: [
    'Lists documents in the current workspace, ordered by most recently updated.',
    '',
    'Use this when:',
    ' - The user asks "what docs do I have", "list my context", or similar',
    ' - You need to discover what documents exist before fetching content',
    ' - You are showing a directory or table of contents',
    '',
    'Do NOT use this when:',
    ' - The user is searching by topic or keyword — call search_docs instead',
    ' - You already know the doc ID or path — call get_doc directly',
    '',
    'Returns up to 50 docs per call with id, path, title, folder_id, and updated_at.',
    'Supply folder_id to list only docs inside that folder; omit for all docs.',
    'If more docs exist, the response includes a next_cursor to paginate.',
    'Typical latency: under 100ms.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      cursor: {
        type: 'string',
        description: 'Opaque cursor returned by a previous call. Omit on the first call.',
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 50,
        description: 'Maximum number of docs to return. Defaults to 50.',
      },
      folder_id: {
        type: 'string',
        description: 'Optional folder UUID. If supplied, returns only docs inside that folder.',
      },
      project_id: {
        type: 'string',
        description: 'Optional project UUID. If supplied, returns only docs in that project. Results are newest-first.',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'List documents in your workspace' },
};

const argsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  folder_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
});

export interface ListDocsResult {
  docs: Array<{
    id: string;
    path: string;
    title: string;
    folder_id: string | null;
    updated_at: string;
    created_at: string;
  }>;
  next_cursor: string | null;
}

export async function listDocs(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<ListDocsResult> {
  // Scope check FIRST — failing here must throw McpForbiddenError before
  // we touch the audit table or open a DB transaction.
  requireScope(ctx, 'docs:read');

  const args = argsSchema.parse(rawArgs);
  const limit = args.limit ?? 50;
  const cursor = args.cursor ? decodeCursor(args.cursor) : null;

  return await withAudit(
    ctx,
    { tool_name: LIST_DOCS_TOOL.name, args: args as Record<string, unknown> },
    async () =>
      withTenant(ctx.tenant_id, async (tx) => {
        // Stable ordering: (updated_at DESC, id DESC). The cursor encodes
        // the LAST page's last (updated_at_text, id) tuple and we page by
        // strict-less-than using PG's row comparison.
        //
        // Why row-comparison + ::timestamptz cast: the JS Date round-trip
        // truncates updated_at to milliseconds, but the column is stored
        // at microsecond precision. A naïve `eq(updated_at, jsDate)` for
        // the tie-breaker tier never matches because 200.456μs != 200.000ms.
        // We sidestep by carrying updated_at as its PG text representation
        // through the cursor and casting back to timestamptz at compare time
        // — the cast is precision-preserving in both directions.
        const cursorClause = cursor
          ? sql`(${docs.updatedAt}, ${docs.id}) < (${cursor.updated_at}::timestamptz, ${cursor.id}::uuid)`
          : undefined;

        // Fetch limit+1 to detect "has more" without a separate count query.
        const folderClause = args.folder_id
          ? eq(docs.folderId, args.folder_id)
          : undefined;
        const projectClause = args.project_id
          ? eq(docs.projectId, args.project_id)
          : undefined;

        const rows = await tx
          .select({
            id: docs.id,
            path: docs.path,
            title: docs.title,
            folderId: docs.folderId,
            createdAt: docs.createdAt,
            updatedAt: docs.updatedAt,
            // Microsecond-precise text for stable cursor encoding.
            updatedAtText: sql<string>`${docs.updatedAt}::text`,
          })
          .from(docs)
          .where(and(isNull(docs.deletedAt), folderClause, projectClause, cursorClause))
          .orderBy(desc(docs.updatedAt), desc(docs.id))
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1];
        const next_cursor =
          hasMore && last
            ? encodeCursor({ updated_at: last.updatedAtText, id: last.id })
            : null;

        return {
          docs: page.map((r) => ({
            id: r.id,
            path: r.path,
            title: r.title,
            folder_id: r.folderId ?? null,
            // Public response keeps the JS-Date-derived ISO string (millis)
            // — clients don't need microsecond precision; only the cursor
            // round-trip does.
            updated_at: r.updatedAt.toISOString(),
            created_at: r.createdAt.toISOString(),
          })),
          next_cursor,
        };
      }),
    (result) => ({ doc_count: result.docs.length, has_more: result.next_cursor !== null }),
  );
}
