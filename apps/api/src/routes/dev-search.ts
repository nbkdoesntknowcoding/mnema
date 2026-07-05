import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { withTenant } from '../db/with-tenant.js';
import { requireDevProjectMode } from '../plugins/dev-mode.js';

interface SearchResult {
  type: 'task' | 'session';
  id: string;
  title: string;
  preview: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface TaskSearchRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  estimated_cost_usd: number | null;
  score: string;
  preview: string;
}

interface SessionSearchRow {
  id: string;
  developer_id: string;
  total_cost_usd: number | null;
  status: string;
  score: string;
  preview: string;
}

export const devSearchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireDevProjectMode);

  app.get('/api/dev/search', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const q = (req.query as Record<string, string>) ?? {};
    const query = (q.q ?? '').trim();
    if (!query) {
      return reply.code(400).send({ error: 'query_required', message: 'q parameter is required' });
    }

    const types = (q.types ?? 'tasks,sessions').split(',').map((t) => t.trim());
    const limit = Math.min(Number(q.limit ?? 20), 100);
    const wid = req.auth.tenant_id;
    // Hierarchy: optional ?project_id= to scope task search to one project.
    const rawProject = q.project_id;
    const projClause =
      rawProject && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawProject)
        ? sql`AND project_id = ${rawProject}::uuid`
        : sql``;

    const results: SearchResult[] = [];

    if (types.includes('tasks')) {
      const taskRows = (await withTenant(wid, (tx) =>
        tx.execute(sql`
          SELECT
            id,
            title,
            status,
            priority,
            estimated_cost_usd,
            ts_rank(fts_vector, websearch_to_tsquery('english', ${query})) as score,
            ts_headline('english',
              COALESCE(title, '') || ' ' || COALESCE(description, ''),
              websearch_to_tsquery('english', ${query}),
              'MaxWords=15, MinWords=5, StartSel=«, StopSel=»'
            ) as preview
          FROM tasks
          WHERE workspace_id = ${wid}
            AND fts_vector @@ websearch_to_tsquery('english', ${query})
            ${projClause}
          ORDER BY score DESC
          LIMIT ${limit}
        `),
      )) as unknown as TaskSearchRow[];

      for (const row of taskRows) {
        results.push({
          type: 'task',
          id: row.id,
          title: row.title,
          preview: row.preview ?? '',
          score: Number(row.score),
          metadata: { status: row.status, priority: row.priority, estimatedCostUsd: row.estimated_cost_usd },
        });
      }
    }

    if (types.includes('sessions')) {
      const sessionRows = (await withTenant(wid, (tx) =>
        tx.execute(sql`
          SELECT
            id,
            developer_id,
            total_cost_usd,
            status,
            ts_rank(fts_vector, websearch_to_tsquery('english', ${query})) as score,
            ts_headline('english',
              COALESCE(developer_id, '') || ' ' || COALESCE(git_branch, '') || ' ' || COALESCE(agent, ''),
              websearch_to_tsquery('english', ${query}),
              'MaxWords=15, MinWords=5, StartSel=«, StopSel=»'
            ) as preview
          FROM agent_sessions
          WHERE workspace_id = ${wid}
            AND fts_vector @@ websearch_to_tsquery('english', ${query})
          ORDER BY score DESC
          LIMIT ${limit}
        `),
      )) as unknown as SessionSearchRow[];

      for (const row of sessionRows) {
        results.push({
          type: 'session',
          id: row.id,
          title: `Session ${row.id.slice(0, 8)} — ${row.developer_id}`,
          preview: row.preview ?? '',
          score: Number(row.score),
          metadata: { developerId: row.developer_id, totalCostUsd: row.total_cost_usd, status: row.status },
        });
      }
    }

    // Sort merged results by score DESC
    results.sort((a, b) => b.score - a.score);

    return { results: results.slice(0, limit), total: results.length };
  });
};
