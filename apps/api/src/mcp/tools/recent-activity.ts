/**
 * MCP tool: `list_recent_activity`.
 *
 * The single "what changed recently" feed across the whole workspace — a time-sorted union of
 * the most recently touched ENTITIES: docs (created/edited), tasks (created/updated/completed,
 * with status), and meetings (most recent first). Each row carries a real id + title + timestamp
 * + what happened, so the caller names the actual entity instead of guessing, and an empty
 * in-progress task list never reads as "nothing is happening".
 *
 * Grounds "what's the latest / what did we finish / when was the last meeting" questions in real,
 * timestamped entities. Read-only, workspace-scoped (explicit workspace_id filter + withTenant RLS).
 */
import { sql, and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { projects } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';

export const LIST_RECENT_ACTIVITY_TOOL = {
  name: 'list_recent_activity',
  description: [
    'The single "what\'s the latest / what changed recently" feed for the whole workspace — a',
    'time-sorted list of the most recently touched ENTITIES: docs (created or edited), tasks',
    '(created, updated, or completed — with their status), and meetings. Newest first. Each item',
    'has a real id, title, timestamp, and what happened.',
    '',
    'Use this FIRST for: "what\'s the latest", "what did we work on / finish", "what\'s new",',
    '"the latest development in X", "what happened today", "when was the last meeting". It grounds',
    'the answer in real recent entities so you name the actual thing rather than guess — and so an',
    'empty in-progress task list is NEVER read as "nothing is happening" (check what was recently',
    'finished/updated here first). Pass `project` to scope to one project, or `type` (doc | task |',
    'meeting) to one kind.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', minimum: 1, maximum: 50, description: 'Max items to return (default 15).' },
      project: { type: 'string', description: 'Optional project slug or UUID — scope to one project.' },
      type: { type: 'string', enum: ['doc', 'task', 'meeting'], description: 'Optional: only this entity kind.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'Recent activity across docs, tasks, and meetings' },
};

interface ActivityRow {
  kind: 'doc' | 'task' | 'meeting';
  id: string;
  title: string | null;
  action: string | null;
  ts: string;
  project_id: string | null;
}

export async function listRecentActivity(ctx: McpAuthContext, rawArgs: Record<string, unknown>) {
  const ws = ctx.tenant_id;
  const limit = Math.min(Math.max(Math.trunc(Number(rawArgs.limit ?? 15)) || 15, 1), 50);
  const typeFilter = typeof rawArgs.type === 'string' ? rawArgs.type : null;

  // Resolve an optional project slug/uuid → id (scopes tasks + meetings + docs-via-folder).
  let projectId: string | null = null;
  if (typeof rawArgs.project === 'string' && rawArgs.project.trim()) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ident = rawArgs.project.trim();
    const proj = await db.query.projects.findFirst({
      where: and(eq(projects.workspaceId, ws), UUID_RE.test(ident) ? eq(projects.id, ident) : eq(projects.slug, ident)),
    });
    if (!proj) return { content: `No project found matching "${ident}".`, structuredContent: { activity: [] } };
    projectId = proj.id;
  }

  const rows = (await withTenant(ws, async (tx) => {
    const selects = [];

    if (!typeFilter || typeFilter === 'doc') {
      selects.push(sql`
        SELECT 'doc' AS kind, d.id::text AS id, d.title AS title,
               CASE WHEN d.updated_at > d.created_at + interval '3 seconds' THEN 'edited' ELSE 'created' END AS action,
               d.updated_at AS ts, f.project_id AS project_id
        FROM docs d
        LEFT JOIN folders f ON f.id = d.folder_id
        WHERE d.workspace_id = ${ws} AND d.deleted_at IS NULL
          AND d.path NOT LIKE '\\_\\_graph\\_report\\_\\_%'
          ${projectId ? sql`AND f.project_id = ${projectId}` : sql``}`);
    }
    if (!typeFilter || typeFilter === 'task') {
      selects.push(sql`
        SELECT 'task' AS kind, t.id::text AS id, t.title AS title, t.status AS action,
               GREATEST(t.updated_at, COALESCE(t.completed_at, t.updated_at)) AS ts, t.project_id AS project_id
        FROM tasks t
        WHERE t.workspace_id = ${ws}
          ${projectId ? sql`AND t.project_id = ${projectId}` : sql``}`);
    }
    if (!typeFilter || typeFilter === 'meeting') {
      selects.push(sql`
        SELECT 'meeting' AS kind, m.id::text AS id, COALESCE(m.title, 'Meeting') AS title, m.status AS action,
               COALESCE(m.ended_at, m.started_at, m.scheduled_start_at) AS ts, m.project_id AS project_id
        FROM meetings m
        WHERE m.workspace_id = ${ws}
          ${projectId ? sql`AND m.project_id = ${projectId}` : sql``}`);
    }

    const unioned = sql.join(selects, sql` UNION ALL `);
    const q = sql`SELECT kind, id, title, action, ts, project_id::text AS project_id
                  FROM ( ${unioned} ) AS activity
                  WHERE ts IS NOT NULL
                  ORDER BY ts DESC
                  LIMIT ${limit}`;
    return (await tx.execute(q)) as unknown as ActivityRow[];
  })) ?? [];

  if (rows.length === 0) {
    return { content: 'No recent activity found.', structuredContent: { activity: [] } };
  }

  // Spoken-friendly summary lines: "<title> — <kind> <action>, <when>".
  const now = Date.now();
  const rel = (iso: string): string => {
    const diff = Math.max(0, now - new Date(iso).getTime());
    const m = Math.round(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  };
  const lines = rows.map((r) => `${r.title ?? 'Untitled'} — ${r.kind} ${r.action ?? ''}`.trim() + ` (${rel(r.ts)})`);

  return {
    content: `Most recent activity:\n${lines.join('\n')}`,
    structuredContent: { activity: rows },
  };
}
