import { and, eq, gt, gte, not, sql } from 'drizzle-orm';
import { withSystemPrivilege } from '../../../db/with-system-privilege.js';
import { agentSessions, tasks, workspaceSessionStats } from '../../../db/schema.js';

export type OptimizationRule =
  | 'stall'
  | 'high_retry'
  | 'cost_overrun'
  | 'parallel'
  | 'token_bloat'
  | 'context_wide';

export interface Finding {
  workspaceId: string;
  sessionId?: string;
  taskId?: string;
  rule: OptimizationRule;
  description: string;
  suggestedAction: string;
  roiScore: number;
  metadata: Record<string, unknown>;
}

// Rule: stall — session active but no tool calls in 30+ minutes
export async function stall(workspaceId: string): Promise<Finding[]> {
  const rows = (await withSystemPrivilege((tx) =>
    tx.execute(sql`
      SELECT s.id, s.developer_id,
             MAX(tc.timestamp) as last_activity,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(MAX(tc.timestamp), s.started_at))) / 60 as idle_minutes,
             MAX(tc.tool_name) as last_tool_name
      FROM agent_sessions s
      LEFT JOIN tool_calls tc ON tc.session_id = s.id
      WHERE s.workspace_id = ${workspaceId}
        AND s.status = 'active'
      GROUP BY s.id, s.developer_id, s.started_at
      HAVING COALESCE(MAX(tc.timestamp), s.started_at) < NOW() - INTERVAL '30 minutes'
    `),
  )) as unknown as Array<{ id: string; developer_id: string; idle_minutes: string; last_tool_name: string | null }>;

  return rows.map((row) => {
    const idleMinutes = Math.round(Number(row.idle_minutes));
    return {
      workspaceId,
      sessionId: row.id,
      rule: 'stall' as OptimizationRule,
      description: `Session ${row.id.slice(0, 8)} by ${row.developer_id} has been idle for ${idleMinutes} minutes.`,
      suggestedAction: `Interrupt the session and resume with: 'Summarise progress so far and continue from where you left off.'`,
      roiScore: Math.min(100, idleMinutes * 2),
      metadata: { idleMinutes, developerId: row.developer_id, lastToolName: row.last_tool_name ?? null },
    };
  });
}

// Rule: high_retry — task retried 3+ times and not done
export async function high_retry(workspaceId: string): Promise<Finding[]> {
  const rows = await withSystemPrivilege((tx) =>
    tx
      .select({ id: tasks.id, title: tasks.title, retryCount: tasks.retryCount, blockerDescription: tasks.blockerDescription })
      .from(tasks)
      .where(and(
        eq(tasks.workspaceId, workspaceId),
        gte(tasks.retryCount, 3),
        not(eq(tasks.status, 'done')),
      )),
  );

  return rows.map((row) => ({
    workspaceId,
    taskId: row.id,
    rule: 'high_retry' as OptimizationRule,
    description: `Task '${row.title}' has failed ${row.retryCount} times.`,
    suggestedAction: `Break this task into 2–3 smaller subtasks. The blocker pattern suggests the scope is too large for a single session.`,
    roiScore: Math.min(100, row.retryCount * 20),
    metadata: { retryCount: row.retryCount, lastBlockerDescription: row.blockerDescription, taskTitle: row.title },
  }));
}

// Rule: cost_overrun — completed session cost > 2x workspace median
// Uses materialized view workspace_session_stats (refreshed hourly) for O(1) median lookup.
export async function cost_overrun(workspaceId: string): Promise<Finding[]> {
  // Read from materialized view — fall back to 0 if no stats yet (empty workspace)
  const statsRows = await withSystemPrivilege((tx) =>
    tx
      .select({ medianCostUsd: workspaceSessionStats.medianCostUsd })
      .from(workspaceSessionStats)
      .where(eq(workspaceSessionStats.workspaceId, workspaceId))
      .limit(1),
  );

  const medianCost = statsRows[0]?.medianCostUsd ?? 0;
  if (!medianCost || medianCost === 0) return [];

  const threshold = medianCost * 2;

  const rows = await withSystemPrivilege((tx) =>
    tx
      .select({ id: agentSessions.id, developerId: agentSessions.developerId, totalCostUsd: agentSessions.totalCostUsd })
      .from(agentSessions)
      .where(and(
        eq(agentSessions.workspaceId, workspaceId),
        eq(agentSessions.status, 'completed'),
        gt(agentSessions.totalCostUsd, threshold),
        gt(agentSessions.endedAt, sql`NOW() - INTERVAL '7 days'`),
      )),
  );

  return rows.map((row) => {
    const ratio = (row.totalCostUsd ?? 0) / medianCost;
    return {
      workspaceId,
      sessionId: row.id,
      rule: 'cost_overrun' as OptimizationRule,
      description: `Session ${row.id.slice(0, 8)} cost $${(row.totalCostUsd ?? 0).toFixed(4)}, ${ratio.toFixed(1)}x the workspace median of $${medianCost.toFixed(4)}.`,
      suggestedAction: `Narrow the task scope before the next attempt. Consider splitting into focused subtasks under $${medianCost.toFixed(4)} each.`,
      roiScore: Math.min(100, (ratio - 1) * 50),
      metadata: { actualCostUsd: row.totalCostUsd, medianCostUsd: medianCost, ratio, developerId: row.developerId },
    };
  });
}

// Rule: parallel — 3+ backlog tasks with same tag
export async function parallel(workspaceId: string): Promise<Finding[]> {
  const tagGroups = (await withSystemPrivilege((tx) =>
    tx.execute(sql`
      SELECT unnest(tags) as tag, array_agg(id) as task_ids, array_agg(title) as task_titles
      FROM tasks
      WHERE workspace_id = ${workspaceId}
        AND status = 'backlog'
        AND tags IS NOT NULL
        AND array_length(tags, 1) > 0
      GROUP BY unnest(tags)
      HAVING count(*) >= 3
    `),
  )) as unknown as Array<{ tag: string; task_ids: string[]; task_titles: string[] }>;

  return tagGroups.map((row) => {
    return {
      workspaceId,
      rule: 'parallel' as OptimizationRule,
      description: `Tasks ${row.task_titles.slice(0, 3).map((t) => `'${t}'`).join(', ')} appear independent and could run in parallel.`,
      suggestedAction: `Run these tasks concurrently in separate git worktrees.\n  Use: git worktree add ../branch-name && cd ../branch-name`,
      roiScore: 40,
      metadata: { taskIds: row.task_ids, taskTitles: row.task_titles, sharedTag: row.tag },
    };
  });
}

// Rule: token_bloat — session input tokens > 2x workspace median
// Uses materialized view for O(1) median lookup.
export async function token_bloat(workspaceId: string): Promise<Finding[]> {
  const statsRows = await withSystemPrivilege((tx) =>
    tx
      .select({ medianInputTokens: workspaceSessionStats.medianInputTokens })
      .from(workspaceSessionStats)
      .where(eq(workspaceSessionStats.workspaceId, workspaceId))
      .limit(1),
  );

  const medianTokens = statsRows[0]?.medianInputTokens ?? 0;
  if (!medianTokens || medianTokens === 0) return [];

  const threshold = medianTokens * 2;

  const rows = await withSystemPrivilege((tx) =>
    tx
      .select({ id: agentSessions.id, totalInputTokens: agentSessions.totalInputTokens })
      .from(agentSessions)
      .where(and(
        eq(agentSessions.workspaceId, workspaceId),
        eq(agentSessions.status, 'completed'),
        gt(agentSessions.totalInputTokens, threshold),
        gt(agentSessions.endedAt, sql`NOW() - INTERVAL '7 days'`),
      )),
  );

  return rows.map((row) => {
    const ratio = row.totalInputTokens / medianTokens;
    return {
      workspaceId,
      sessionId: row.id,
      rule: 'token_bloat' as OptimizationRule,
      description: `Session ${row.id.slice(0, 8)} used ${row.totalInputTokens.toLocaleString()} input tokens, ${ratio.toFixed(1)}x the workspace median.`,
      suggestedAction: `Add context compaction to CLAUDE.md:\n  'At the start of each task, summarise the codebase in under 500 tokens.'`,
      roiScore: Math.min(100, (ratio - 1) * 40),
      metadata: { actualTokens: row.totalInputTokens, medianTokens, ratio, sessionId: row.id },
    };
  });
}

// Rule: context_wide — session modified more than 10 files
export async function context_wide(workspaceId: string): Promise<Finding[]> {
  const rows = await withSystemPrivilege((tx) =>
    tx
      .select({ id: agentSessions.id, filesModifiedCount: agentSessions.filesModifiedCount, taskId: agentSessions.taskId })
      .from(agentSessions)
      .where(and(
        eq(agentSessions.workspaceId, workspaceId),
        gt(agentSessions.filesModifiedCount, 10),
      )),
  );

  return rows.map((row) => ({
    workspaceId,
    sessionId: row.id,
    taskId: row.taskId ?? undefined,
    rule: 'context_wide' as OptimizationRule,
    description: `Session ${row.id.slice(0, 8)} modified ${row.filesModifiedCount} files — likely too broad.`,
    suggestedAction: `Break this into focused subtasks. Each subtask should touch fewer than 5 files. Use 'list the files you expect to change' as your first instruction.`,
    roiScore: Math.min(100, row.filesModifiedCount * 5),
    metadata: { filesModified: row.filesModifiedCount, sessionId: row.id },
  }));
}
