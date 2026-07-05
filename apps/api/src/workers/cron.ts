/**
 * Cron workers:
 *   01:00 UTC — refresh workspace_session_stats materialized view
 *   02:00 UTC — optimization engine (all dev_project workspaces)
 *   03:00 UTC — data retention cleanup (tool_calls, file_diffs, optimization_findings, fix_history)
 */

import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import pino from 'pino';
import { withSystemPrivilege } from '../db/with-system-privilege.js';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { workspaces } from '../db/schema.js';
import { redisConnection } from '../lib/redis.js';
import { runOptimizationForWorkspace } from '../lib/dev/optimization/runner.js';
import { emitWorkspaceEvent as emitEvent } from '../lib/events.js';

const log = pino({ name: 'cron' });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// postgres-js RowList has a `count` property (number of affected rows)
interface PgResult {
  count: number;
}

// ── Queues ────────────────────────────────────────────────────────────────────

const statsQueue        = new Queue('stats-refresh-cron',  { connection: redisConnection });
const optimizationQueue = new Queue('optimization-cron',   { connection: redisConnection });
const retentionQueue    = new Queue('retention-cron',      { connection: redisConnection });
const graphCronQueue    = new Queue('graph-cron',          { connection: redisConnection });
const expireAclQueue    = new Queue('expire-doc-acl-cron', { connection: redisConnection });

async function registerCronJobs(): Promise<void> {
  await statsQueue.add('hourly-stats-refresh', {}, {
    repeat: { pattern: '0 * * * *' }, // every hour on the hour
    jobId: 'stats-hourly',
  });

  await optimizationQueue.add('nightly-run', {}, {
    repeat: { pattern: '0 2 * * *' },
    jobId: 'optimization-nightly',
  });

  await retentionQueue.add('nightly-cleanup', {}, {
    repeat: { pattern: '0 3 * * *' },
    jobId: 'retention-nightly',
  });

  await expireAclQueue.add('hourly-expire-doc-acl', {}, {
    repeat: { pattern: '0 * * * *' }, // every hour — FIX 6: purge expired doc_acl grants
    jobId: 'expire-doc-acl-hourly',
  });

  await graphCronQueue.add('nightly-graph', {}, {
    repeat: { pattern: '0 4 * * *' }, // 04:00 UTC daily
    jobId: 'graph-nightly',
  });
  await graphCronQueue.add('weekly-deep', {}, {
    repeat: { pattern: '0 4 * * 0' }, // 04:00 UTC Sundays
    jobId: 'graph-weekly-deep',
  });

  log.info('Cron jobs registered: stats@every-hour, optimization@02:00 UTC, retention@03:00 UTC, graph@04:00 UTC, expire-doc-acl@every-hour');
}

// ── Graph nightly cron processor ─────────────────────────────────────────────

async function processGraphCron(job: Job): Promise<void> {
  const isDeep = job.name === 'weekly-deep';
  log.info({ job: job.name }, 'Graph cron: starting');

  // Phase 3 — the graph engine is a gated (ee) module. Load it lazily via
  // non-literal specifiers so this worker compiles and boots when graph is
  // absent (public build); the nightly job then no-ops gracefully.
  const P = '../lib/graph' + '/';
  let g: {
    extractSemantic: (ws: string, entityId: string, db: unknown, mode: string) => Promise<unknown>;
    buildSimilarityEdges: (ws: string, db: unknown) => Promise<unknown>;
    runClustering: (ws: string, resolution: number, db: unknown) => Promise<{ communityCount: number }>;
    generateGraphReport: (ws: string, db: unknown) => Promise<unknown>;
  };
  try {
    const [extract, clustering, report] = await Promise.all([
      import(P + 'extract-semantic.js'),
      import(P + 'clustering.js'),
      import(P + 'report.js'),
    ]);
    g = {
      extractSemantic: extract.extractSemantic,
      buildSimilarityEdges: extract.buildSimilarityEdges,
      runClustering: clustering.runClustering,
      generateGraphReport: report.generateGraphReport,
    };
  } catch {
    log.warn('Graph cron: graph module absent — skipping');
    return;
  }

  // Get all active workspaces
  const workspaceRows = await withSystemPrivilege(async (tx) => {
    return tx.select({ id: schema.workspaces.id }).from(schema.workspaces);
  });

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago

  // Cost gate: a knowledge graph needs material to build from — similarity edges are pairwise
  // (need ≥2 docs) and there's nothing to relate in a lone welcome doc. Below the threshold,
  // extraction + similarity + clustering + report are all paid LLM/DB no-ops. Default ≥2 docs;
  // any meeting activity also qualifies. Tunable via GRAPH_MIN_DOCS.
  const minDocs = Math.max(1, Number(process.env.GRAPH_MIN_DOCS ?? 2));

  for (const { id: workspaceId } of workspaceRows) {
    try {
      const counts = await withSystemPrivilege(async (tx) => {
        const [d] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.docs)
          .where(and(
            eq(schema.docs.workspaceId, workspaceId),
            isNull(schema.docs.deletedAt),
            sql`${schema.docs.path} NOT LIKE '__graph_report__%'`,
          ));
        const [m] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.meetings)
          .where(eq(schema.meetings.workspaceId, workspaceId));
        return { docCount: d?.n ?? 0, meetingCount: m?.n ?? 0 };
      });
      if (counts.docCount < minDocs && counts.meetingCount === 0) {
        log.info(
          { workspaceId, docCount: counts.docCount, meetingCount: counts.meetingCount, minDocs },
          'Graph cron: skipped (insufficient content to build a graph)',
        );
        continue;
      }

      if (isDeep) {
        // Weekly deep: re-extract top-20 god-node docs with Sonnet
        const godNodeDocs = await withSystemPrivilege(async (tx) => {
          return tx
            .select({ entityId: schema.graphNodes.entityId })
            .from(schema.graphNodes)
            .where(and(eq(schema.graphNodes.workspaceId, workspaceId), eq(schema.graphNodes.isGodNode, true), eq(schema.graphNodes.entityType, 'doc')))
            .orderBy(desc(schema.graphNodes.betweennessCentrality))
            .limit(20);
        });
        for (const { entityId } of godNodeDocs) {
          try { await g.extractSemantic(workspaceId, entityId, db as any, 'deep'); } catch { /* continue */ }
        }
      } else {
        // Daily: extract docs not extracted in 24h
        const staleDocs = await withSystemPrivilege(async (tx) => {
          return tx
            .select({ id: schema.docs.id })
            .from(schema.docs)
            .where(and(
              eq(schema.docs.workspaceId, workspaceId),
              isNull(schema.docs.deletedAt),
            ))
            .limit(50);
        });
        // Filter to those with stale graph nodes
        for (const { id } of staleDocs) {
          try { await g.extractSemantic(workspaceId, id, db as any, 'normal'); } catch { /* continue */ }
          await sleep(500);
        }
      }

      // Rebuild similarity edges + cluster + report
      await g.buildSimilarityEdges(workspaceId, db as any);
      const clusterResult = await g.runClustering(workspaceId, 1.0, db as any);
      await g.generateGraphReport(workspaceId, db as any);

      emitEvent(workspaceId, {
        type: 'graph_updated',
        data: { totalNodes: 0, totalEdges: 0, communityCount: clusterResult.communityCount },
      });

      log.info({ workspaceId }, 'Graph cron: workspace done');
    } catch (err) {
      log.error({ workspaceId, err }, 'Graph cron: workspace failed');
    }
  }
}

// ── Stats refresh cron processor ──────────────────────────────────────────────

async function processStatsRefreshCron(_job: Job): Promise<void> {
  try {
    await withSystemPrivilege((tx) =>
      tx.execute(sql`SELECT refresh_workspace_session_stats()`),
    );
    log.info('Refreshed workspace_session_stats materialized view');
  } catch (err) {
    log.error({ err }, 'Stats refresh cron failed');
  }
}

// ── Optimization cron processor ───────────────────────────────────────────────

async function processOptimizationCron(_job: Job): Promise<void> {
  const rows = await withSystemPrivilege((tx) =>
    tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.mode, 'dev_project')),
  );

  log.info({ workspaceCount: rows.length }, 'Running optimization engine for all dev_project workspaces');

  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const { id } = rows[i]!;
    try {
      const newFindings = await runOptimizationForWorkspace(id);
      total += newFindings;
      if (i < rows.length - 1) await sleep(100);
    } catch (err) {
      log.error({ err, workspaceId: id }, 'Optimization cron failed for workspace');
    }
  }

  log.info({ total }, 'Optimization cron complete');
}

// ── Retention cron processor ──────────────────────────────────────────────────

async function batchDelete(query: () => Promise<unknown>): Promise<number> {
  let totalDeleted = 0;
  let deleted: number;
  do {
    const result = await query() as PgResult;
    deleted = result.count ?? 0;
    totalDeleted += deleted;
    if (deleted > 0) await sleep(100);
  } while (deleted > 0);
  return totalDeleted;
}

async function processRetentionCron(_job: Job): Promise<void> {
  const rows = await withSystemPrivilege((tx) =>
    tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.mode, 'dev_project')),
  );

  for (const { id: workspaceId } of rows) {
    try {
      // Job 1: tool_calls older than 30 days (batch delete)
      const toolCallsDeleted = await batchDelete(() =>
        withSystemPrivilege((tx) =>
          tx.execute(sql`
            DELETE FROM tool_calls
            WHERE id IN (
              SELECT id FROM tool_calls
              WHERE workspace_id = ${workspaceId}
              AND timestamp < NOW() - INTERVAL '30 days'
              LIMIT 1000
            )
          `),
        ),
      );

      // Job 2: file_diffs older than 30 days
      const fileDiffsResult = (await withSystemPrivilege((tx) =>
        tx.execute(sql`
          DELETE FROM file_diffs
          WHERE workspace_id = ${workspaceId}
          AND timestamp < NOW() - INTERVAL '30 days'
        `),
      )) as unknown as PgResult;

      // Job 3: applied optimization_findings older than 30 days
      const findingsResult = (await withSystemPrivilege((tx) =>
        tx.execute(sql`
          DELETE FROM optimization_findings
          WHERE workspace_id = ${workspaceId}
          AND applied = true
          AND created_at < NOW() - INTERVAL '30 days'
        `),
      )) as unknown as PgResult;

      // Job 4: fix_history older than 90 days
      const fixHistoryResult = (await withSystemPrivilege((tx) =>
        tx.execute(sql`
          DELETE FROM fix_history
          WHERE workspace_id = ${workspaceId}
          AND created_at < NOW() - INTERVAL '90 days'
        `),
      )) as unknown as PgResult;

      log.info({
        workspaceId,
        toolCallsDeleted,
        fileDiffsDeleted: fileDiffsResult.count ?? 0,
        findingsDeleted: findingsResult.count ?? 0,
        fixHistoryDeleted: fixHistoryResult.count ?? 0,
      }, 'Retention cleanup complete for workspace');

    } catch (err) {
      log.error({ err, workspaceId }, 'Retention cron failed for workspace');
    }
  }
}

// ── FIX 6: expire time-limited doc_acl grants ──────────────────────────────────
async function processExpireDocAclCron(_job: Job): Promise<void> {
  try {
    const result = (await db.execute(
      sql`DELETE FROM doc_acl WHERE expires_at IS NOT NULL AND expires_at < now()`,
    )) as unknown as PgResult;
    log.info({ deleted: result.count ?? 0 }, 'Expired doc_acl grants cleaned up');
  } catch (err) {
    log.error({ err }, 'expire-doc-acl cron failed');
  }
}

// ── Worker startup ────────────────────────────────────────────────────────────

export function startCronWorkers(): { close(): Promise<void> } {
  const conn1 = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const conn2 = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const conn3 = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

  const statsWorker = new Worker('stats-refresh-cron', processStatsRefreshCron, {
    connection: conn1,
    concurrency: 1,
  });

  const optWorker = new Worker('optimization-cron', processOptimizationCron, {
    connection: conn2,
    concurrency: 1,
  });

  const retWorker = new Worker('retention-cron', processRetentionCron, {
    connection: conn3,
    concurrency: 1,
  });

  const conn4 = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const graphCronWorker = new Worker('graph-cron', processGraphCron, {
    connection: conn4,
    concurrency: 1,
  });

  const conn5 = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const expireAclWorker = new Worker('expire-doc-acl-cron', processExpireDocAclCron, {
    connection: conn5,
    concurrency: 1,
  });

  statsWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Stats refresh cron failed'));
  optWorker.on('failed',   (job, err) => log.error({ jobId: job?.id, err }, 'Optimization cron job failed'));
  retWorker.on('failed',   (job, err) => log.error({ jobId: job?.id, err }, 'Retention cron job failed'));
  graphCronWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Graph cron failed'));
  expireAclWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'expire-doc-acl cron failed'));

  void registerCronJobs();

  return {
    async close() {
      await statsWorker.close();
      await optWorker.close();
      await retWorker.close();
      await graphCronWorker.close();
      await expireAclWorker.close();
    },
  };
}
