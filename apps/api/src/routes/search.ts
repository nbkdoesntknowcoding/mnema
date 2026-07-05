/**
 * App search — cookie/session-auth doc search for the in-app command palette / search bar.
 * Reuses the same searchDocs (RRF hybrid keyword+semantic, MD2 temporal decision ranking) the MCP
 * tool and public API use, scoped to the caller's workspace via withTenant inside searchDocs.
 *
 * GET /api/search?q=<query>&mode=hybrid|keyword|semantic&limit=<n>
 */
import type { FastifyPluginAsync } from 'fastify';
import { searchDocs } from '../mcp/tools/search-docs.js';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/search', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const qs = (req.query as Record<string, string>) ?? {};
    const q = (qs.q ?? '').trim();
    const limit = Math.min(Math.max(Number(qs.limit ?? 12) || 12, 1), 50);
    const mode = (['hybrid', 'keyword', 'semantic'].includes(qs.mode ?? '') ? qs.mode : 'hybrid') as
      'hybrid' | 'keyword' | 'semantic';
    if (!q) return reply.send({ results: [] });

    // searchDocs only reads ctx.tenant_id (it scopes the query via withTenant). Build the minimal
    // context from the session, same shape the public API uses.
    const ctx = { tenant_id: req.auth.tenant_id, scopes: ['docs:read'], sessionId: 'app-search' } as never;
    const result = await searchDocs(ctx, { query: q, limit, mode });

    return reply.send({
      results: result.results.map((r) => ({
        id: r.id,
        title: r.title,
        path: r.path,
        snippet: r.snippet,
        match_type: r.match_type,
        project_name: r.project_name ?? null,
        decision_status: r.decision_status ?? null,
        updated_at: r.updated_at,
      })),
    });
  });
};
