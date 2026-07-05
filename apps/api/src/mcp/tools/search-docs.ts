import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { annotateSearchResult } from '../../lib/search-hooks.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireScope } from '../scope.js';
import { withAudit } from './audit.js';
import { embedQuery } from './query-embedding.js';

/**
 * MCP tool: `search_docs` — Phase 3.2 multi-mode (keyword | semantic | hybrid).
 *
 * The `mode` enum was introduced in 2.4 with one value (`"keyword"`) so 3.2
 * could grow it without changing the tool signature claude.ai already learned.
 * `"hybrid"` is now the default — it composes both signals via Reciprocal
 * Rank Fusion (RRF, k=60) in pure SQL inside one CTE.
 *
 * Why RRF over weighted-sum fusion: keyword scores (`ts_rank_cd`) and
 * semantic scores (cosine distance) live in different distributions; the
 * "right" α to blend them varies per query type. RRF only cares about
 * rank position, doesn't need tuning, and composes cleanly with future
 * signals (recency, tags). It's the IR-literature consensus.
 *
 * Why `DISTINCT ON (doc_id)` on the semantic side: a single doc can have
 * multiple matching chunks. Without collapsing, those chunks each
 * contribute an RRF term and the doc unfairly outranks docs with one
 * strong hit. We keep the chunk with the smallest cosine distance.
 */
export const SEARCH_DOCS_TOOL = {
  name: 'search_docs',
  description: [
    'Searches docs in the current workspace by keyword, semantic similarity, or a hybrid of both. Use this when the user mentions a topic, term, or concept and you do not already know which doc to fetch.',
    '',
    'Use this when:',
    ' - The user asks "what do we have on X", "find docs about Y", "search for Z"',
    ' - You need to discover relevant docs before fetching content',
    ' - You are answering a question and need to ground it in our docs',
    '',
    'Do NOT use this when:',
    ' - You already know the doc id or path — call get_doc directly',
    ' - The user wants a directory listing — call list_docs',
    '',
    'Modes:',
    ' - "hybrid" (default, recommended): Combines keyword and semantic search using Reciprocal Rank Fusion. Best for almost all queries — handles both specific terms and conceptual questions.',
    ' - "keyword": Postgres full-text search only. Use when the user gives an exact term (an error code, a proper noun, a specific phrase) and you want lexical precision over semantic similarity.',
    ' - "semantic": pgvector cosine similarity only. Use for purely conceptual queries where the exact words might not appear in the docs (e.g., "how do we handle rate limiting" against a doc that calls it "throttling").',
    '',
    'Results include rank, match_type ("title" / "body" / "both" / "chunk"), and a snippet with <mark> tags around hits (keyword) or the matching chunk text (semantic/hybrid). For semantic/hybrid hits, the heading_path field shows which section of the doc matched.',
    '',
    'Quote multi-word phrases in keyword mode to require exact-order matches. Negation supported via "-term".',
    '',
    'Typical latency: 50-150ms warm cache, 200-400ms cold cache for semantic/hybrid.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        description:
          'The search query. Free-form text. Quotes and -negation supported in keyword mode.',
      },
      mode: {
        type: 'string',
        enum: ['hybrid', 'keyword', 'semantic'],
        description:
          'Search mode. Defaults to "hybrid". Pick "keyword" for exact terms, "semantic" for conceptual queries, "hybrid" for everything else.',
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 20,
        description: 'Maximum results to return. Defaults to 10.',
      },
      project_id: {
        type: 'string',
        description: 'Optional project UUID — restrict results to docs in that project.',
      },
      folder_id: {
        type: 'string',
        description: 'Optional folder UUID — restrict results to docs in that folder.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'Search documents by keyword or semantic similarity' },
};

const argsSchema = z.object({
  query: z
    .string()
    .min(1)
    .refine((q) => q.trim().length > 0, {
      message: 'Query cannot be empty or whitespace-only',
    }),
  mode: z.enum(['hybrid', 'keyword', 'semantic']).optional().default('hybrid'),
  limit: z.number().int().min(1).max(20).optional().default(10),
  // Accept a project SLUG or a UUID (consistent with list_project_tasks). Resolved to a UUID
  // in searchDocs before scoping — previously this required a UUID and rejected a slug with a
  // raw "Invalid uuid", which is exactly what the model passes when it names a project.
  project_id: z.string().optional(),
  folder_id: z.string().uuid().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a project identifier (UUID or slug) to its UUID within this tenant, RLS-scoped.
 *  Returns null when no matching project is visible (caller then searches unscoped). */
async function resolveProjectId(ctx: McpAuthContext, identifier?: string): Promise<string | null> {
  const id = (identifier ?? '').trim();
  if (!id) return null;
  if (UUID_RE.test(id)) return id;
  const { projects } = await import('../../db/schema.js');
  const { eq, and } = await import('drizzle-orm');
  const rows = await withTenant(ctx.tenant_id, (tx) =>
    tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, ctx.tenant_id), eq(projects.slug, id)))
      .limit(1),
  );
  return rows[0]?.id ?? null;
}

/** Build an extra WHERE fragment scoping by project/folder (on the docs alias `d`). */
function scopeClause(projectId?: string, folderId?: string): SQL {
  const parts: SQL[] = [];
  if (projectId) parts.push(sql`AND d.project_id = ${projectId}::uuid`);
  if (folderId) parts.push(sql`AND d.folder_id = ${folderId}::uuid`);
  return parts.length ? sql.join(parts, sql` `) : sql``;
}

export type Mode = 'hybrid' | 'keyword' | 'semantic';

export interface SearchHit {
  id: string;
  title: string;
  path: string;
  updated_at: string;
  rank: number;
  match_type: 'title' | 'body' | 'both' | 'chunk';
  snippet: string;
  heading_path?: string;
  // Which project this doc belongs to (null = unfiled/workspace-wide). Lets the caller
  // distinguish results across projects and answer about the right one.
  project_id?: string | null;
  project_name?: string | null;
  // MD2 temporal signal — set ONLY on decision-doc hits (a recorded decision's doc). Lets the
  // caller prefer the current decision and label a superseded one; absent on every other hit.
  decision_status?: 'current' | 'historical' | 'proposed' | 'rejected' | null;
  decided_at?: string | null;
}

/** Attach each hit's project (id + name) in one lookup, so results are never mixed up
 *  across projects. Mutates the result in place. */
async function attachProjects(ctx: McpAuthContext, result: SearchResult): Promise<void> {
  const ids = [...new Set(result.results.map((h) => h.id))];
  if (ids.length === 0) return;
  const rows = await withTenant(ctx.tenant_id, (tx) =>
    tx.execute<{ id: string; project_id: string | null; project_name: string | null }>(sql`
      SELECT d.id, d.project_id, p.name AS project_name
      FROM docs d
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
    `),
  );
  const map = new Map<string, { project_id: string | null; project_name: string | null }>();
  for (const r of rows as unknown as Array<{ id: string; project_id: string | null; project_name: string | null }>) {
    map.set(r.id, { project_id: r.project_id, project_name: r.project_name });
  }
  for (const h of result.results) {
    const m = map.get(h.id);
    h.project_id = m?.project_id ?? null;
    h.project_name = m?.project_name ?? null;
  }
}

export interface SearchResult {
  query: string;
  mode: Mode;
  results: SearchHit[];
}

export async function searchDocs(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<SearchResult> {
  // Scope check FIRST so a forbidden bubbles before audit/DB/Voyage work.
  requireScope(ctx, 'docs:read');

  const args = argsSchema.parse(rawArgs);

  return await withAudit(
    ctx,
    { tool_name: SEARCH_DOCS_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      const resolvedProjectId = await resolveProjectId(ctx, args.project_id);
      const scope = scopeClause(resolvedProjectId ?? undefined, args.folder_id);
      let result: SearchResult;
      switch (args.mode) {
        case 'keyword':
          result = await runKeyword(ctx, args.query, args.limit, scope);
          break;
        case 'semantic':
          result = await runSemantic(ctx, args.query, args.limit, scope);
          break;
        default:
          result = await runHybrid(ctx, args.query, args.limit, scope);
      }
      // Label every hit with its project so the caller never mixes projects.
      await attachProjects(ctx, result);
      // MD2: layer a temporal preference ON TOP of RRF — annotate decision hits with their
      // status/date and float current decisions above the historical ones they superseded.
      // Non-decision hits keep their exact RRF positions (proven byte-identical in the gate).
      await annotateSearchResult(ctx, result);
      return result;
    },
    (result) => ({ mode: result.mode, result_count: result.results.length }),
  );
}

// MD2 decision-temporal annotation was moved to the ee graph module
// (lib/graph/search-annotator.ts) behind registerSearchAnnotator — Phase 3
// Phase-G de-tangle. Core search no longer references graphNodes.

// ---------------------------------------------------------------------------
// Keyword path — unchanged from Phase 2.4 in shape and behavior. Still uses
// websearch_to_tsquery + ts_rank_cd + ts_headline. Title/body match flags
// stay in the response so Claude can reason about lexical confidence.
// ---------------------------------------------------------------------------

interface KeywordRow extends Record<string, unknown> {
  id: string;
  title: string;
  path: string;
  updated_at: Date | string;
  rank: number | string;
  snippet: string;
  title_match: boolean;
  body_match: boolean;
}

async function runKeyword(
  ctx: McpAuthContext,
  query: string,
  limit: number,
  scope: SQL,
): Promise<SearchResult> {
  const result = await withTenant(ctx.tenant_id, async (tx) =>
    tx.execute<KeywordRow>(sql`
      WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsquery)
      SELECT
        d.id, d.title, d.path, d.updated_at,
        ts_rank_cd(d.tsv, q.tsquery) AS rank,
        ts_headline('english', d.markdown, q.tsquery,
          'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=15, MinWords=5'
        ) AS snippet,
        (to_tsvector('english', coalesce(d.title, '')) @@ q.tsquery) AS title_match,
        (to_tsvector('english', coalesce(d.markdown, '')) @@ q.tsquery) AS body_match
      FROM docs d, q
      WHERE d.tsv @@ q.tsquery AND d.deleted_at IS NULL ${scope}
      ORDER BY rank DESC
      LIMIT ${limit}
    `),
  );

  const hits: SearchHit[] = [];
  for (const r of result) {
    const matchType: SearchHit['match_type'] = r.title_match && r.body_match
      ? 'both'
      : r.title_match
        ? 'title'
        : 'body';
    hits.push({
      id: r.id,
      title: r.title,
      path: r.path,
      updated_at: dateToIso(r.updated_at),
      rank: Number(r.rank),
      match_type: matchType,
      snippet: r.snippet,
    });
  }

  return { query, mode: 'keyword', results: hits };
}

// ---------------------------------------------------------------------------
// Semantic path — embed the query (cached), cosine-distance search against
// the HNSW index, collapse to one row per doc via DISTINCT ON.
// ---------------------------------------------------------------------------

interface SemanticRow extends Record<string, unknown> {
  doc_id: string;
  title: string;
  path: string;
  updated_at: Date | string;
  rank: number | string;
  chunk_index: number;
  chunk_text: string;
  heading_path: string | null;
  distance: number | string;
}

async function runSemantic(
  ctx: McpAuthContext,
  query: string,
  limit: number,
  scope: SQL,
): Promise<SearchResult> {
  const vector = await embedQuery(ctx.tenant_id, query);
  const vectorLiteral = formatVectorLiteral(vector);

  const result = await withTenant(ctx.tenant_id, async (tx) =>
    tx.execute<SemanticRow>(sql`
      WITH semantic_results AS (
        SELECT
          e.doc_id, d.title, d.path, d.updated_at,
          ROW_NUMBER() OVER (ORDER BY e.embedding <=> ${vectorLiteral}::vector ASC) AS rank,
          e.chunk_index, e.chunk_text, e.heading_path,
          (e.embedding <=> ${vectorLiteral}::vector) AS distance
        FROM embeddings e
        JOIN docs d ON d.id = e.doc_id
        WHERE d.deleted_at IS NULL ${scope}
        ORDER BY e.embedding <=> ${vectorLiteral}::vector
        LIMIT 50
      )
      SELECT DISTINCT ON (doc_id) *
      FROM semantic_results
      ORDER BY doc_id, distance ASC
      LIMIT ${limit}
    `),
  );

  // DISTINCT ON loses the original distance ordering when grouping by doc_id;
  // restore it so callers see best matches first.
  const rows = [...result].sort(
    (a, b) => Number(a.distance) - Number(b.distance),
  );

  return {
    query,
    mode: 'semantic',
    results: rows.map((r) => ({
      id: r.doc_id,
      title: r.title,
      path: r.path,
      updated_at: dateToIso(r.updated_at),
      // Surface similarity (1 - distance) as `rank` so higher = better,
      // matching keyword's convention. Cosine distance is in [0, 2].
      rank: 1 - Number(r.distance),
      match_type: 'chunk' as const,
      snippet: chunkToSnippet(r.chunk_text),
      heading_path: r.heading_path ?? undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// Hybrid path — keyword + semantic in one CTE, fused via RRF, ordered by
// the fused score. Doc must appear in either side to be in the result.
// ---------------------------------------------------------------------------

interface HybridRow extends Record<string, unknown> {
  doc_id: string;
  title: string;
  path: string;
  updated_at: Date | string;
  rrf_score: number | string;
  in_keyword: boolean;
  in_semantic: boolean;
  keyword_snippet: string | null;
  semantic_chunk_text: string | null;
  semantic_heading_path: string | null;
}

async function runHybrid(
  ctx: McpAuthContext,
  query: string,
  limit: number,
  scope: SQL,
): Promise<SearchResult> {
  const vector = await embedQuery(ctx.tenant_id, query);
  const vectorLiteral = formatVectorLiteral(vector);

  const result = await withTenant(ctx.tenant_id, async (tx) =>
    tx.execute<HybridRow>(sql`
      WITH
        q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsquery),
        keyword_results AS (
          SELECT
            d.id AS doc_id, d.title, d.path, d.updated_at,
            ROW_NUMBER() OVER (ORDER BY ts_rank_cd(d.tsv, q.tsquery) DESC) AS rank,
            ts_headline('english', d.markdown, q.tsquery,
              'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=15, MinWords=5'
            ) AS snippet
          FROM docs d, q
          WHERE d.tsv @@ q.tsquery AND d.deleted_at IS NULL ${scope}
          LIMIT 50
        ),
        semantic_results AS (
          SELECT
            e.doc_id, d.title, d.path, d.updated_at,
            ROW_NUMBER() OVER (ORDER BY e.embedding <=> ${vectorLiteral}::vector ASC) AS rank,
            e.chunk_text, e.heading_path,
            (e.embedding <=> ${vectorLiteral}::vector) AS distance
          FROM embeddings e
          JOIN docs d ON d.id = e.doc_id
          WHERE d.deleted_at IS NULL ${scope}
          ORDER BY e.embedding <=> ${vectorLiteral}::vector
          LIMIT 50
        ),
        semantic_best AS (
          SELECT DISTINCT ON (doc_id) *
          FROM semantic_results
          ORDER BY doc_id, distance ASC
        ),
        fused AS (
          SELECT
            COALESCE(k.doc_id, s.doc_id) AS doc_id,
            COALESCE(k.title, s.title) AS title,
            COALESCE(k.path, s.path) AS path,
            COALESCE(k.updated_at, s.updated_at) AS updated_at,
            COALESCE(1.0 / (60.0 + k.rank), 0) + COALESCE(1.0 / (60.0 + s.rank), 0) AS rrf_score,
            (k.doc_id IS NOT NULL) AS in_keyword,
            (s.doc_id IS NOT NULL) AS in_semantic,
            k.snippet AS keyword_snippet,
            s.chunk_text AS semantic_chunk_text,
            s.heading_path AS semantic_heading_path
          FROM keyword_results k
          FULL OUTER JOIN semantic_best s ON k.doc_id = s.doc_id
        )
      SELECT * FROM fused
      ORDER BY rrf_score DESC
      LIMIT ${limit}
    `),
  );

  const hits: SearchHit[] = [];
  for (const r of result) {
    let snippet = '';
    let heading_path: string | undefined;
    let match_type: SearchHit['match_type'];

    if (r.in_keyword && r.in_semantic) {
      // Prefer the semantic chunk text — richer than ts_headline's
      // 15-word fragments. Fall back to the keyword snippet if the
      // semantic chunk is somehow empty.
      snippet = r.semantic_chunk_text
        ? chunkToSnippet(r.semantic_chunk_text)
        : (r.keyword_snippet ?? '');
      heading_path = r.semantic_heading_path ?? undefined;
      match_type = 'both';
    } else if (r.in_semantic) {
      snippet = r.semantic_chunk_text ? chunkToSnippet(r.semantic_chunk_text) : '';
      heading_path = r.semantic_heading_path ?? undefined;
      match_type = 'chunk';
    } else {
      snippet = r.keyword_snippet ?? '';
      match_type = 'body';
    }

    hits.push({
      id: r.doc_id,
      title: r.title,
      path: r.path,
      updated_at: dateToIso(r.updated_at),
      rank: Number(r.rrf_score),
      match_type,
      snippet,
      heading_path,
    });
  }

  return { query, mode: 'hybrid', results: hits };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateToIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/**
 * Format a JS number array as the pgvector text literal: `[v1,v2,...]`.
 * pgvector parses the cast `'[…]'::vector(N)` reliably; sending the array
 * via Drizzle's parameter binding ensures we never SQL-inject.
 *
 * `toFixed(6)` keeps each component to ~10 chars → ~10KB SQL string at 1024d
 * — well under any practical query-size limit.
 */
function formatVectorLiteral(vec: number[]): string {
  return `[${vec.map((v) => v.toFixed(6)).join(',')}]`;
}

/**
 * Render a chunk's stored text into a search snippet:
 *   - strip the leading heading line (we surface heading_path separately)
 *   - cap at 250 chars with an ellipsis so result payloads stay token-sane
 */
function chunkToSnippet(chunkText: string): string {
  const stripped = chunkText.replace(/^#+\s+.+\n?/, '').trim();
  return stripped.length > 250 ? stripped.slice(0, 247) + '...' : stripped;
}
