/**
 * Sessions API routes — Phase 2 AgentLens Execution Tracking.
 *
 * All routes require:
 *   - valid session cookie / JWT (req.auth)
 *   - workspace.mode === 'dev_project' (requireDevProjectMode)
 *
 * GET /api/sessions              — paginated session list with filters
 * GET /api/sessions/:id          — single session detail
 * GET /api/sessions/:id/tool-calls   — tool call timeline
 * GET /api/sessions/:id/file-diffs   — file diff list (no content)
 * GET /api/sessions/:id/file-diffs/:diffId — single diff with content
 * GET /api/sessions/:id/export   — Markdown export (Content-Type: text/markdown)
 */

import { and, asc, desc, eq, gte, inArray, lte, sql, sum } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { agentSessions, fileDiffs, tasks, toolCalls } from '../db/schema.js';
import { requireDevProjectMode } from '../plugins/dev-mode.js';
import { withTenant } from '../db/with-tenant.js';

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  // Apply dev_project gate to all /api/sessions routes
  app.addHook('preHandler', requireDevProjectMode);

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/sessions
  // Query: ?status=active&developerId=alice&agent=claude_code
  //        &limit=20&cursor=<id>&from=<iso-date>&to=<iso-date>
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/sessions', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const q = (req.query as Record<string, string>) ?? {};
    const limit = Math.min(Number(q.limit ?? 20), 100);
    const cursor = q.cursor ?? null;

    const filters: ReturnType<typeof eq>[] = [
      eq(agentSessions.workspaceId, req.auth.tenant_id) as ReturnType<typeof eq>,
    ];

    if (q.status) {
      filters.push(eq(agentSessions.status, q.status) as ReturnType<typeof eq>);
    }
    if (q.developerId) {
      filters.push(eq(agentSessions.developerId, q.developerId) as ReturnType<typeof eq>);
    }
    if (q.agent) {
      filters.push(eq(agentSessions.agent, q.agent) as ReturnType<typeof eq>);
    }
    if (q.from) {
      filters.push(gte(agentSessions.startedAt, new Date(q.from)) as ReturnType<typeof eq>);
    }
    if (q.to) {
      filters.push(lte(agentSessions.startedAt, new Date(q.to)) as ReturnType<typeof eq>);
    }
    if (cursor) {
      // Cursor is the last session id from the previous page
      // Use startedAt desc ordering: sessions started before the cursor session
      filters.push(
        sql`${agentSessions.startedAt} < (SELECT started_at FROM agent_sessions WHERE id = ${cursor})` as unknown as ReturnType<typeof eq>,
      );
    }

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({
          id:             agentSessions.id,
          status:         agentSessions.status,
          developerId:    agentSessions.developerId,
          agent:          agentSessions.agent,
          taskId:         agentSessions.taskId,
          totalCostUsd:   agentSessions.totalCostUsd,
          totalToolCalls: agentSessions.totalToolCalls,
          model:          agentSessions.model,
          gitBranch:      agentSessions.gitBranch,
          startedAt:      agentSessions.startedAt,
          endedAt:        agentSessions.endedAt,
        })
        .from(agentSessions)
        .where(and(...filters))
        .orderBy(desc(agentSessions.startedAt))
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Enrich with task titles
    const taskIds = page.filter((s) => s.taskId).map((s) => s.taskId!);
    const taskTitleMap: Record<string, string> = {};
    if (taskIds.length > 0) {
      const taskRows = await withTenant(req.auth.tenant_id, (tx) =>
        tx
          .select({ id: tasks.id, title: tasks.title })
          .from(tasks)
          .where(inArray(tasks.id, taskIds)),
      );
      for (const t of taskRows) taskTitleMap[t.id] = t.title;
    }

    const sessions = page.map((s) => ({
      ...s,
      taskTitle: s.taskId ? (taskTitleMap[s.taskId] ?? null) : null,
      durationMs: s.endedAt && s.startedAt
        ? s.endedAt.getTime() - s.startedAt.getTime()
        : null,
    }));

    // Totals for the full filtered set (without cursor/limit)
    const totalFilters = filters.filter(
      (f) => !f.toString().includes('started_at <'),
    );
    const [totalsRow] = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({
          count:        sql<number>`count(*)::int`,
          totalCostUsd: sum(agentSessions.totalCostUsd),
        })
        .from(agentSessions)
        .where(and(...totalFilters)),
    );

    return {
      sessions,
      next_cursor: hasMore ? page[page.length - 1]!.id : null,
      totals: {
        count:        totalsRow?.count ?? 0,
        totalCostUsd: Number(totalsRow?.totalCostUsd ?? 0),
      },
    };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/sessions/:id
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/sessions/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select()
        .from(agentSessions)
        .where(and(
          eq(agentSessions.id, id),
          eq(agentSessions.workspaceId, req.auth!.tenant_id),
        ))
        .limit(1),
    );

    const session = rows[0];
    if (!session) return reply.code(404).send({ error: 'session not found' });

    let taskTitle: string | null = null;
    if (session.taskId) {
      const taskRows = await withTenant(req.auth.tenant_id, (tx) =>
        tx
          .select({ title: tasks.title })
          .from(tasks)
          .where(eq(tasks.id, session.taskId!))
          .limit(1),
      );
      taskTitle = taskRows[0]?.title ?? null;
    }

    return {
      ...session,
      taskTitle,
      durationMs: session.endedAt && session.startedAt
        ? session.endedAt.getTime() - session.startedAt.getTime()
        : null,
    };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/sessions/:id/tool-calls
  // Query: ?limit=100&cursor=<id>&include_io=true
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/sessions/:id/tool-calls', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const q = (req.query as Record<string, string>) ?? {};
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const includeIo = q.include_io === 'true';
    const cursor = q.cursor ?? null;

    // Verify session belongs to workspace
    const sessionCheck = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({ id: agentSessions.id })
        .from(agentSessions)
        .where(and(
          eq(agentSessions.id, id),
          eq(agentSessions.workspaceId, req.auth!.tenant_id),
        ))
        .limit(1),
    );
    if (!sessionCheck[0]) return reply.code(404).send({ error: 'session not found' });

    const filters = [
      eq(toolCalls.sessionId, id),
      eq(toolCalls.workspaceId, req.auth.tenant_id),
    ];

    if (cursor) {
      filters.push(
        sql`${toolCalls.timestamp} > (SELECT timestamp FROM tool_calls WHERE id = ${cursor})` as unknown as ReturnType<typeof eq>,
      );
    }

    const columns = {
      id:           toolCalls.id,
      toolName:     toolCalls.toolName,
      filePath:     toolCalls.filePath,
      durationMs:   toolCalls.durationMs,
      isError:      toolCalls.isError,
      errorMessage: toolCalls.errorMessage,
      exitCode:     toolCalls.exitCode,
      inputTokens:  toolCalls.inputTokens,
      outputTokens: toolCalls.outputTokens,
      costUsd:      toolCalls.costUsd,
      timestamp:    toolCalls.timestamp,
      truncated:    toolCalls.truncated,
      ...(includeIo ? {
        inputJson:  toolCalls.inputJson,
        outputJson: toolCalls.outputJson,
      } : {}),
    };

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select(columns)
        .from(toolCalls)
        .where(and(...filters))
        .orderBy(asc(toolCalls.timestamp))
        .limit(limit + 1),
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      toolCalls:   page,
      next_cursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/sessions/:id/file-diffs
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/sessions/:id/file-diffs', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    // Verify session belongs to workspace
    const sessionCheck = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({ id: agentSessions.id })
        .from(agentSessions)
        .where(and(
          eq(agentSessions.id, id),
          eq(agentSessions.workspaceId, req.auth!.tenant_id),
        ))
        .limit(1),
    );
    if (!sessionCheck[0]) return reply.code(404).send({ error: 'session not found' });

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({
          id:           fileDiffs.id,
          filePath:     fileDiffs.filePath,
          linesAdded:   fileDiffs.linesAdded,
          linesRemoved: fileDiffs.linesRemoved,
          truncated:    fileDiffs.truncated,
          toolCallId:   fileDiffs.toolCallId,
          timestamp:    fileDiffs.timestamp,
          // diffContent intentionally excluded — use /file-diffs/:diffId for content
        })
        .from(fileDiffs)
        .where(and(
          eq(fileDiffs.sessionId, id),
          eq(fileDiffs.workspaceId, req.auth!.tenant_id),
        ))
        .orderBy(asc(fileDiffs.timestamp)),
    );

    return { fileDiffs: rows };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/sessions/:id/file-diffs/:diffId — single diff with content
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/sessions/:id/file-diffs/:diffId', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id, diffId } = req.params as { id: string; diffId: string };

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select()
        .from(fileDiffs)
        .where(and(
          eq(fileDiffs.id, diffId),
          eq(fileDiffs.sessionId, id),
          eq(fileDiffs.workspaceId, req.auth!.tenant_id),
        ))
        .limit(1),
    );

    const diff = rows[0];
    if (!diff) return reply.code(404).send({ error: 'diff not found' });

    return diff;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/sessions/:id/export — Markdown export
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/sessions/:id/export', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const sessionRows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select()
        .from(agentSessions)
        .where(and(
          eq(agentSessions.id, id),
          eq(agentSessions.workspaceId, req.auth!.tenant_id),
        ))
        .limit(1),
    );
    const session = sessionRows[0];
    if (!session) return reply.code(404).send({ error: 'session not found' });

    let taskTitle = '';
    if (session.taskId) {
      const taskRows = await withTenant(req.auth.tenant_id, (tx) =>
        tx
          .select({ title: tasks.title })
          .from(tasks)
          .where(eq(tasks.id, session.taskId!))
          .limit(1),
      );
      taskTitle = taskRows[0]?.title ?? '';
    }

    const toolCallRows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({
          toolName:  toolCalls.toolName,
          filePath:  toolCalls.filePath,
          durationMs: toolCalls.durationMs,
          isError:   toolCalls.isError,
          timestamp: toolCalls.timestamp,
        })
        .from(toolCalls)
        .where(and(
          eq(toolCalls.sessionId, id),
          eq(toolCalls.workspaceId, req.auth!.tenant_id),
        ))
        .orderBy(asc(toolCalls.timestamp)),
    );

    const diffRows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({
          filePath:     fileDiffs.filePath,
          linesAdded:   fileDiffs.linesAdded,
          linesRemoved: fileDiffs.linesRemoved,
        })
        .from(fileDiffs)
        .where(and(
          eq(fileDiffs.sessionId, id),
          eq(fileDiffs.workspaceId, req.auth!.tenant_id),
        ))
        .orderBy(asc(fileDiffs.timestamp)),
    );

    // Build Markdown
    const durationMs = session.endedAt && session.startedAt
      ? session.endedAt.getTime() - session.startedAt.getTime()
      : null;

    const lines: string[] = [
      `# Session ${id}`,
      '',
      `**Developer:** ${session.developerId} | **Agent:** ${session.agent} | **Started:** ${session.startedAt.toISOString()}`,
      taskTitle ? `**Task:** ${taskTitle}` : '',
      '',
      '## Cost Breakdown',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Total cost | $${session.totalCostUsd.toFixed(6)} |`,
      `| Input tokens | ${(session.totalInputTokens ?? 0).toLocaleString()} |`,
      `| Output tokens | ${(session.totalOutputTokens ?? 0).toLocaleString()} |`,
      `| Tool calls | ${session.totalToolCalls} |`,
      durationMs !== null ? `| Duration | ${Math.round(durationMs / 1000)}s |` : '',
      `| Files modified | ${session.filesModifiedCount ?? 0} |`,
      '',
      '## Timeline',
      '',
    ];

    for (const tc of toolCallRows) {
      const ts = tc.timestamp.toISOString().replace('T', ' ').slice(0, 19);
      const dur = tc.durationMs !== null ? ` (${tc.durationMs}ms)` : '';
      const fp = tc.filePath ? ` — \`${tc.filePath}\`` : '';
      const err = tc.isError ? ' ❌' : '';
      lines.push(`- \`${ts}\` **${tc.toolName}**${dur}${fp}${err}`);
    }

    if (diffRows.length > 0) {
      lines.push('', '## Files changed', '');
      for (const d of diffRows) {
        lines.push(`- \`${d.filePath}\`: +${d.linesAdded ?? 0} / -${d.linesRemoved ?? 0}`);
      }
    }

    const dateStr = (session.startedAt ?? new Date()).toISOString().slice(0, 10);
    const shortId = id.slice(0, 8);

    const { format = 'md' } = req.query as { format?: string };

    // ── JSON export ────────────────────────────────────────────────────────
    if (format === 'json') {
      const payload = {
        session: {
          id: session.id,
          developerId: session.developerId,
          agent: session.agent,
          status: session.status,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          totalCostUsd: session.totalCostUsd,
          totalInputTokens: session.totalInputTokens,
          totalOutputTokens: session.totalOutputTokens,
          totalToolCalls: session.totalToolCalls,
          filesModifiedCount: session.filesModifiedCount,
          taskId: session.taskId,
          taskTitle: taskTitle || undefined,
        },
        toolCalls: toolCallRows.map((tc) => ({
          toolName: tc.toolName,
          filePath: tc.filePath,
          durationMs: tc.durationMs,
          isError: tc.isError,
          timestamp: tc.timestamp,
        })),
        fileDiffs: diffRows.map((d) => ({
          filePath: d.filePath,
          linesAdded: d.linesAdded,
          linesRemoved: d.linesRemoved,
        })),
        exportedAt: new Date().toISOString(),
        exportedBy: 'Mnema AgentLens',
      };
      reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="session-${shortId}-${dateStr}.json"`);
      return reply.send(JSON.stringify(payload, null, 2));
    }

    // ── CSV export ─────────────────────────────────────────────────────────
    if (format === 'csv') {
      const csvLines = [
        'timestamp,tool_name,file_path,duration_ms,is_error',
        ...toolCallRows.map((tc) => {
          const ts  = tc.timestamp.toISOString();
          const fp  = tc.filePath ? `"${tc.filePath.replace(/"/g, '""')}"` : '';
          const dur = tc.durationMs ?? '';
          const err = tc.isError ? 'true' : 'false';
          return `${ts},${tc.toolName},${fp},${dur},${err}`;
        }),
      ];
      const csv = csvLines.join('\n');
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="session-${shortId}-${dateStr}.csv"`);
      return reply.send(csv);
    }

    // ── Markdown export (default) ──────────────────────────────────────────
    lines.push('', `---`, `*Generated by Mnema AgentLens · ${new Date().toISOString().slice(0, 10)}*`);

    const markdown = lines.filter((l) => l !== undefined).join('\n');

    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="session-${shortId}-${dateStr}.md"`);
    return reply.send(markdown);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/sessions/agent-counts — session counts per agent in last 7 days
  // Used by ConnectApps UI to show connection status per AI app.
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/sessions/agent-counts', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const rows = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({
          agent: agentSessions.agent,
          count: sql<number>`count(*)::int`,
        })
        .from(agentSessions)
        .where(and(
          eq(agentSessions.workspaceId, req.auth!.tenant_id),
          sql`${agentSessions.startedAt} > now() - interval '7 days'`,
        ))
        .groupBy(agentSessions.agent),
    );

    return reply.send(rows);
  });
};
