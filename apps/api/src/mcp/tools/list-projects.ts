/**
 * list_projects — Sprint 4 Chunk E.1
 * Available in BOTH workspace modes (knowledge + dev_project).
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { projects, tasks } from '../../db/schema.js';
import type { McpAuthContext } from '../auth.js';

export const LIST_PROJECTS_TOOL = {
  name: 'list_projects',
  description: [
    'List projects in this workspace with task counts per status.',
    'Default: active projects only. Pass status="all" to include paused/archived.',
    'Available in both knowledge and dev_project workspace modes.',
    '',
    'Use this when the user asks what projects exist or wants an overview, or you',
    'need project ids or task counts before drilling in. Do NOT use for one',
    "project's detail — call get_project.",
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'paused', 'completed', 'archived', 'all'],
        description: "Filter by project status: 'active' (default), 'paused', 'completed', 'archived', or 'all'.",
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'List projects' },
};

const COLOR_CIRCLE: Record<string, string> = {
  '#f0997b': '🟠',
  '#fbbf24': '🟡',
  '#4ade80': '🟢',
  '#a78bfa': '🟣',
  '#60a5fa': '🔵',
  '#f87171': '🔴',
  '#34d399': '🟩',
  '#fb923c': '🟧',
  '#e879f9': '🩷',
  '#52525b': '⬜',
};

function colorCircle(color: string | null | undefined): string {
  // null-safe: a project with a NULL/empty color was crashing the whole tool here
  // (null.toLowerCase() → TypeError → list_projects returned 0 even though the rows exist).
  return COLOR_CIRCLE[(color ?? '').toLowerCase()] ?? '▪️';
}

export async function listProjects(ctx: McpAuthContext, rawArgs: Record<string, unknown>) {
  const statusFilter = typeof rawArgs.status === 'string' ? rawArgs.status : 'active';

  const rows = await db
    .select()
    .from(projects)
    .where(
      statusFilter === 'all'
        ? eq(projects.workspaceId, ctx.tenant_id)
        : and(
            eq(projects.workspaceId, ctx.tenant_id),
            eq(projects.status, statusFilter),
          ),
    )
    .orderBy(asc(projects.boardOrder), asc(projects.createdAt));

  if (rows.length === 0) {
    return {
      content: 'No projects found in this workspace.',
      structuredContent: { projects: [] },
    };
  }

  // Aggregate task counts per project
  const countRows = await db.execute(
    sql`SELECT project_id::text, status, COUNT(*)::int AS cnt
        FROM tasks
        WHERE workspace_id = ${ctx.tenant_id}::uuid
          AND project_id IS NOT NULL
        GROUP BY project_id, status`,
  ) as unknown as { project_id: string; status: string; cnt: number }[];

  const countsMap: Record<string, Record<string, number>> = {};
  for (const r of countRows) {
    if (!countsMap[r.project_id]) countsMap[r.project_id] = {};
    countsMap[r.project_id]![r.status] = r.cnt;
  }

  const projectsWithCounts = rows.map((p) => {
    const tc = countsMap[p.id] ?? {};
    const total = Object.values(tc).reduce((a, b) => a + b, 0);
    const inProgress = tc['in_progress'] ?? 0;
    return { ...p, taskCounts: tc, _total: total, _inProgress: inProgress };
  });

  const lines = projectsWithCounts.map((p) => {
    const circle = colorCircle(p.color);
    const taskNote = p._total > 0
      ? ` — ${p._total} task${p._total !== 1 ? 's' : ''}${p._inProgress > 0 ? `, ${p._inProgress} in progress` : ''}`
      : ' — no tasks';
    return `${circle} ${p.name} (${p.slug})${taskNote}`;
  });

  return {
    content: `Projects in this workspace:\n${lines.join('\n')}`,
    structuredContent: {
      projects: projectsWithCounts.map(({ _total, _inProgress, ...p }) => p),
    },
  };
}
