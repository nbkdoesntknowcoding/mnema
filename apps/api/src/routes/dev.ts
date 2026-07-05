/**
 * Dev/AgentLens REST API routes — Phase 2.
 *
 * All routes require:
 *   - valid session cookie / JWT (req.auth)
 *   - workspace.mode === 'dev_project' (requireDevProjectMode)
 *
 * GET  /api/dev/budget         — get workspace budget config
 * PUT  /api/dev/budget         — upsert budget config
 * GET  /api/dev/cost-summary   — aggregated cost summary (same as MCP tool)
 * GET  /api/dev/cost-daily     — 30-day daily cost breakdown
 */

import { and, asc, desc, eq, gte, sql, sum } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { agentSessions, budgetConfigs } from '../db/schema.js';
import { requireDevProjectMode } from '../plugins/dev-mode.js';
import { withTenant } from '../db/with-tenant.js';

const budgetUpdateSchema = z.object({
  dailyBudgetUsd:    z.number().positive().optional().nullable(),
  monthlyBudgetUsd:  z.number().positive().optional().nullable(),
  alertThresholdPct: z.number().int().min(1).max(100).optional(),
  slackWebhookUrl:   z.string().url().optional().nullable(),
  discordWebhookUrl: z.string().url().optional().nullable(),
});

export const devRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireDevProjectMode);

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/dev/budget
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/dev/budget', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const rows = await db
      .select()
      .from(budgetConfigs)
      .where(eq(budgetConfigs.workspaceId, req.auth.tenant_id))
      .limit(1);

    if (!rows[0]) {
      // Return defaults — no budget configured yet
      return {
        workspaceId:       req.auth.tenant_id,
        dailyBudgetUsd:    null,
        monthlyBudgetUsd:  null,
        alertThresholdPct: 80,
        slackWebhookUrl:   null,
        discordWebhookUrl: null,
        lastAlertSentAt:   null,
        configured:        false,
      };
    }

    return { ...rows[0], configured: true };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PUT /api/dev/budget
  // ──────────────────────────────────────────────────────────────────────────
  app.put('/api/dev/budget', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = budgetUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', issues: parsed.error.issues });
    }

    const workspaceId = req.auth.tenant_id;
    const now = new Date();

    const existing = await db
      .select({ id: budgetConfigs.id })
      .from(budgetConfigs)
      .where(eq(budgetConfigs.workspaceId, workspaceId))
      .limit(1);

    if (existing[0]) {
      // Update — only set fields that were provided
      const [updated] = await db
        .update(budgetConfigs)
        .set({
          ...(parsed.data.dailyBudgetUsd    !== undefined ? { dailyBudgetUsd:    parsed.data.dailyBudgetUsd }    : {}),
          ...(parsed.data.monthlyBudgetUsd  !== undefined ? { monthlyBudgetUsd:  parsed.data.monthlyBudgetUsd }  : {}),
          ...(parsed.data.alertThresholdPct !== undefined ? { alertThresholdPct: parsed.data.alertThresholdPct } : {}),
          ...(parsed.data.slackWebhookUrl   !== undefined ? { slackWebhookUrl:   parsed.data.slackWebhookUrl }   : {}),
          ...(parsed.data.discordWebhookUrl !== undefined ? { discordWebhookUrl: parsed.data.discordWebhookUrl } : {}),
          updatedAt: now,
        })
        .where(eq(budgetConfigs.workspaceId, workspaceId))
        .returning();

      return updated;
    } else {
      // Insert
      const [created] = await db
        .insert(budgetConfigs)
        .values({
          workspaceId,
          dailyBudgetUsd:    parsed.data.dailyBudgetUsd ?? null,
          monthlyBudgetUsd:  parsed.data.monthlyBudgetUsd ?? null,
          alertThresholdPct: parsed.data.alertThresholdPct ?? 80,
          slackWebhookUrl:   parsed.data.slackWebhookUrl ?? null,
          discordWebhookUrl: parsed.data.discordWebhookUrl ?? null,
          createdAt:         now,
          updatedAt:         now,
        })
        .returning();

      return created;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/dev/cost-summary
  // Query: ?period=today|week|month|all
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/dev/cost-summary', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const q = (req.query as Record<string, string>) ?? {};
    const period = (['today', 'week', 'month', 'all'] as const).includes(q.period as 'today')
      ? (q.period as 'today' | 'week' | 'month' | 'all')
      : 'today';

    const workspaceId = req.auth.tenant_id;
    let periodStart: Date | null = null;
    const now = new Date();

    if (period === 'today') {
      periodStart = new Date(now);
      periodStart.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const baseFilter = periodStart
      ? and(
          eq(agentSessions.workspaceId, workspaceId),
          gte(agentSessions.startedAt, periodStart),
        )
      : eq(agentSessions.workspaceId, workspaceId);

    const [totals] = await withTenant(workspaceId, (tx) =>
      tx
        .select({
          totalCostUsd:   sum(agentSessions.totalCostUsd),
          totalSessions:  sql<number>`count(*)::int`,
          activeSessions: sql<number>`count(*) FILTER (WHERE status = 'active')::int`,
        })
        .from(agentSessions)
        .where(baseFilter),
    );

    const byDeveloper = await withTenant(workspaceId, (tx) =>
      tx
        .select({
          developerId:  agentSessions.developerId,
          costUsd:      sum(agentSessions.totalCostUsd),
          sessionCount: sql<number>`count(*)::int`,
        })
        .from(agentSessions)
        .where(baseFilter)
        .groupBy(agentSessions.developerId)
        .orderBy(desc(sum(agentSessions.totalCostUsd))),
    );

    const byAgent = await withTenant(workspaceId, (tx) =>
      tx
        .select({
          agent:        agentSessions.agent,
          costUsd:      sum(agentSessions.totalCostUsd),
          sessionCount: sql<number>`count(*)::int`,
        })
        .from(agentSessions)
        .where(baseFilter)
        .groupBy(agentSessions.agent)
        .orderBy(desc(sum(agentSessions.totalCostUsd))),
    );

    // Budget context
    const budgetRow = await db
      .select()
      .from(budgetConfigs)
      .where(eq(budgetConfigs.workspaceId, workspaceId))
      .limit(1);

    const totalCost = Number(totals?.totalCostUsd ?? 0);
    let budgetConfig: { dailyBudgetUsd: number | null; pctUsed: number | null } | null = null;
    if (budgetRow[0]?.dailyBudgetUsd) {
      budgetConfig = {
        dailyBudgetUsd: budgetRow[0].dailyBudgetUsd,
        pctUsed: period === 'today'
          ? Math.round((totalCost / budgetRow[0].dailyBudgetUsd) * 100)
          : null,
      };
    }

    return {
      period,
      totalCostUsd:   totalCost,
      totalSessions:  totals?.totalSessions ?? 0,
      activeSessions: totals?.activeSessions ?? 0,
      byDeveloper:    byDeveloper.map((d) => ({ ...d, costUsd: Number(d.costUsd ?? 0) })),
      byAgent:        byAgent.map((a) => ({ ...a, costUsd: Number(a.costUsd ?? 0) })),
      budgetConfig,
    };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/dev/cost-daily
  // Returns last 30 days ordered ASC, with byAgent breakdown per day
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/dev/cost-daily', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const workspaceId = req.auth.tenant_id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Aggregate by date + agent
    const rows = await withTenant(workspaceId, (tx) =>
      tx
        .select({
          date:    sql<string>`date_trunc('day', started_at)::date::text`,
          agent:   agentSessions.agent,
          costUsd: sum(agentSessions.totalCostUsd),
        })
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.workspaceId, workspaceId),
            gte(agentSessions.startedAt, thirtyDaysAgo),
          ),
        )
        .groupBy(
          sql`date_trunc('day', started_at)::date`,
          agentSessions.agent,
        )
        .orderBy(asc(sql`date_trunc('day', started_at)::date`)),
    );

    // Pivot into { date, costUsd, byAgent } structure
    const dayMap = new Map<string, { date: string; costUsd: number; byAgent: Record<string, number> }>();
    for (const row of rows) {
      const date = row.date;
      if (!dayMap.has(date)) {
        dayMap.set(date, { date, costUsd: 0, byAgent: {} });
      }
      const day = dayMap.get(date)!;
      const cost = Number(row.costUsd ?? 0);
      day.costUsd += cost;
      day.byAgent[row.agent] = (day.byAgent[row.agent] ?? 0) + cost;
    }

    return {
      days: Array.from(dayMap.values()),
    };
  });
};
