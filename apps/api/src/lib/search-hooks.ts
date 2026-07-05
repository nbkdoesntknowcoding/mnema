/**
 * Phase 3 (Open-Core) — post-search annotation hook.
 *
 * Core search (mcp/tools/search-docs.ts) calls annotateSearchResult after
 * assembling results; a gated module (ee graph) may register an annotator that
 * enriches decision-doc hits with temporal status from the knowledge graph.
 * With no annotator registered, results pass through byte-identical — so core
 * search compiles and runs with the graph module absent.
 *
 * The SearchResult import is type-only (erased at runtime), so there is no
 * runtime cycle with search-docs.
 */
import type { McpAuthContext } from '../mcp/auth.js';
import type { SearchResult } from '../mcp/tools/search-docs.js';

export type SearchAnnotator = (ctx: McpAuthContext, result: SearchResult) => Promise<void>;

let annotator: SearchAnnotator | null = null;

/** Register the post-search annotator (ee graph decision-temporal). Last write wins. */
export function registerSearchAnnotator(fn: SearchAnnotator): void {
  annotator = fn;
}

/** Apply the registered annotator in place, if any. No-op when none is registered. */
export async function annotateSearchResult(ctx: McpAuthContext, result: SearchResult): Promise<void> {
  if (annotator) await annotator(ctx, result);
}
