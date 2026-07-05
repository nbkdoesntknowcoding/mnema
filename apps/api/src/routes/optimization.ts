import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { withTenant } from '../db/with-tenant.js';
import { optimizationFindings, fixHistory } from '../db/schema.js';
import { requireDevProjectMode } from '../plugins/dev-mode.js';
import { runOptimizationForWorkspace } from '../lib/dev/optimization/runner.js';

// In-memory rate limiter: workspace_id → last manual run timestamps
const manualRunLog = new Map<string, number[]>();

function isRateLimited(workspaceId: string): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const runs = (manualRunLog.get(workspaceId) ?? []).filter((t) => t > oneHourAgo);
  if (runs.length >= 3) return true;
  runs.push(now);
  manualRunLog.set(workspaceId, runs);
  return false;
}

export const optimizationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireDevProjectMode);

  // GET /api/optimization/findings
  app.get('/api/optimization/findings', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const q = (req.query as Record<string, string>) ?? {};
    const limit = Math.min(Number(q.limit ?? 20), 100);
    const cursor = q.cursor ?? null;
    const showDismissed = q.dismissed === 'true';

    const filters: ReturnType<typeof eq>[] = [eq(optimizationFindings.workspaceId, req.auth.tenant_id)];
    if (!showDismissed) {
      filters.push(eq(optimizationFindings.dismissed, false));
    }
    if (q.rule) filters.push(eq(optimizationFindings.rule, q.rule));
    if (q.applied !== undefined) {
      filters.push(eq(optimizationFindings.applied, q.applied === 'true'));
    }
    if (cursor) {
      filters.push(
        sql`${optimizationFindings.createdAt} < (SELECT created_at FROM optimization_findings WHERE id = ${cursor})` as ReturnType<typeof eq>,
      );
    }

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select()
        .from(optimizationFindings)
        .where(and(...filters))
        .orderBy(desc(optimizationFindings.roiScore), desc(optimizationFindings.createdAt))
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const countFilters: ReturnType<typeof eq>[] = [
      eq(optimizationFindings.workspaceId, req.auth.tenant_id),
    ];
    if (!showDismissed) {
      countFilters.push(eq(optimizationFindings.dismissed, false));
    }

    const [totalRow] = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({ total: count() })
        .from(optimizationFindings)
        .where(and(...countFilters)),
    );

    return { findings: page, total: totalRow?.total ?? 0, next_cursor: hasMore ? page[page.length - 1]!.id : null };
  });

  // POST /api/optimization/findings/:id/apply
  app.post('/api/optimization/findings/:id/apply', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select()
        .from(optimizationFindings)
        .where(and(
          eq(optimizationFindings.id, id),
          eq(optimizationFindings.workspaceId, req.auth!.tenant_id),
        ))
        .limit(1),
    );
    const finding = rows[0];
    if (!finding) return reply.code(404).send({ error: 'finding not found' });

    await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .update(optimizationFindings)
        .set({ applied: true, appliedAt: new Date() })
        .where(eq(optimizationFindings.id, id)),
    );

    // If finding has a taskId, append suggestion to task description
    if (finding.taskId) {
      const taskId = finding.taskId;
      const suggestedAction = finding.suggestedAction;
      const tenantId = req.auth.tenant_id;
      await withTenant(tenantId, (tx) =>
        tx.execute(sql`
          UPDATE tasks
          SET description = COALESCE(description, '') || ${'\n\n---\n**Optimization applied:** ' + suggestedAction}
          WHERE id = ${taskId}
            AND workspace_id = ${tenantId}
        `),
      );
    }

    return { ok: true };
  });

  // POST /api/optimization/findings/:id/dismiss
  app.post('/api/optimization/findings/:id/dismiss', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .update(optimizationFindings)
        .set({ dismissed: true })
        .where(and(
          eq(optimizationFindings.id, id),
          eq(optimizationFindings.workspaceId, req.auth!.tenant_id),
        )),
    );

    return { ok: true };
  });

  // POST /api/optimization/run — manual trigger (rate limited: 3/hr)
  app.post('/api/optimization/run', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    if (isRateLimited(req.auth.tenant_id)) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Max 3 manual runs per hour. Try again later.' });
    }

    const newFindings = await runOptimizationForWorkspace(req.auth.tenant_id);
    return { newFindings };
  });

  // GET /api/fix-history
  app.get('/api/fix-history', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const q = (req.query as Record<string, string>) ?? {};

    const filters: ReturnType<typeof eq>[] = [eq(fixHistory.workspaceId, req.auth.tenant_id)];
    if (q.taskId) filters.push(eq(fixHistory.taskId, q.taskId));
    if (q.status) filters.push(eq(fixHistory.status, q.status));

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select()
        .from(fixHistory)
        .where(and(...filters))
        .orderBy(desc(fixHistory.scheduledAt))
        .limit(100),
    );

    return { fixHistory: rows };
  });
};
