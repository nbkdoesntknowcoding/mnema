import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { docs } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import { type AnchorEntry, extractAnchors } from '../anchors.js';
import type { McpAuthContext } from '../auth.js';
import { requireScope } from '../scope.js';
import { withAudit } from './audit.js';
import { findSection, parseHeadings } from './section-extract.js';

/**
 * MCP tool: `get_doc_section`.
 *
 * Returns one heading-bounded slice of a doc. Disambiguation is forced —
 * if a heading text matches multiple sections, we return a preview list
 * rather than silently picking the wrong one. Claude calls again with a
 * `breadcrumb > path` to resolve.
 *
 * The description is product copy. Don't trim it.
 */
export const GET_DOC_SECTION_TOOL = {
  name: 'get_doc_section',
  description: [
    'Fetches a single section of a doc identified by a heading. Useful when a doc is long and only one section is relevant — saves token budget vs. fetching the whole doc.',
    '',
    'Use this when:',
    ' - You know the doc id and want only one section of it',
    ' - The user asks "what does X say about Y" where Y is a heading in X',
    ' - You want to quote or summarize a specific named section',
    '',
    'Do NOT use this when:',
    ' - You need the whole doc — call get_doc instead',
    ' - You do not yet know which doc the section lives in — call search_docs first',
    '',
    "Returns the section's markdown content plus its heading breadcrumb path.",
    'If the heading text matches multiple sections in the doc, returns a',
    'disambiguation list with previews — call again with a more specific',
    '"Parent > Heading" path to pick one.',
    'Typical latency: under 100ms.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'The UUID of the doc.' },
      heading: {
        type: 'string',
        description:
          'The heading text or breadcrumb path (e.g., "Setup" or "Overview > Setup").',
      },
    },
    required: ['id', 'heading'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'Fetch a specific section of a document by heading' },
};

const argsSchema = z.object({
  id: z.string().uuid(),
  heading: z.string().min(1),
});

export type GetDocSectionResult =
  | {
      kind: 'single';
      doc_id: string;
      heading_path: string;
      heading_text: string;
      line: number;
      markdown: string;
      /** All block anchors in the document — use with append_blocks_to_doc. */
      anchors: AnchorEntry[];
    }
  | {
      kind: 'multiple_matches';
      doc_id: string;
      query: string;
      matches: Array<{
        heading_path: string;
        heading_text: string;
        line: number;
        preview: string;
      }>;
    }
  | {
      kind: 'not_found';
      doc_id: string;
      query: string;
      available_headings: string[];
    };

export async function getDocSection(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<GetDocSectionResult> {
  requireScope(ctx, 'docs:read');

  const args = argsSchema.parse(rawArgs);

  return await withAudit(
    ctx,
    { tool_name: GET_DOC_SECTION_TOOL.name, args: args as Record<string, unknown> },
    async () =>
      withTenant(ctx.tenant_id, async (tx) => {
        const rows = await tx
          .select({ markdown: docs.markdown, yjsState: docs.yjsState })
          .from(docs)
          .where(and(eq(docs.id, args.id), isNull(docs.deletedAt)))
          .limit(1);

        if (rows.length === 0) {
          throw new Error('Doc not found');
        }

        const { markdown, yjsState } = rows[0]!;

        // Extract block anchors from Yjs state for use with append_blocks_to_doc.
        let anchors: AnchorEntry[] = [];
        try {
          if (yjsState && yjsState.length > 0) {
            anchors = extractAnchors(yjsState);
          }
        } catch {
          // Non-fatal — section content is still returned.
        }

        // Accept either bare heading ("Setup") or breadcrumb ("Overview > Setup").
        // We always match on the LAST segment text, then optionally filter by
        // the breadcrumb suffix when the caller provided one.
        const lastSegment = args.heading.split('>').pop()!.trim();
        const matches = findSection(markdown, lastSegment);

        const filtered = args.heading.includes('>')
          ? matches.filter((m) =>
              m.heading_path.toLowerCase().endsWith(args.heading.toLowerCase().trim()),
            )
          : matches;

        if (filtered.length === 1) {
          const m = filtered[0]!;
          return {
            kind: 'single',
            doc_id: args.id,
            heading_path: m.heading_path,
            heading_text: m.heading_text,
            line: m.line,
            markdown: m.markdown,
            anchors,
          } as const;
        }

        if (filtered.length > 1) {
          return {
            kind: 'multiple_matches',
            doc_id: args.id,
            query: args.heading,
            matches: filtered.map((m) => ({
              heading_path: m.heading_path,
              heading_text: m.heading_text,
              line: m.line,
              preview: m.preview,
            })),
          } as const;
        }

        return {
          kind: 'not_found',
          doc_id: args.id,
          query: args.heading,
          available_headings: parseHeadings(markdown).map((h) =>
            [...h.breadcrumb, h.text].join(' > '),
          ),
        } as const;
      }),
    (result) => ({ outcome: result.kind }),
  );
}
