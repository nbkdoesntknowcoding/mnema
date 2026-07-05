/**
 * get_project — Sprint 4 Chunk E.2
 * Available in BOTH workspace modes (knowledge + dev_project).
 */

import { and, asc, eq, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { folders, projects, tasks } from '../../db/schema.js';
import type { McpAuthContext } from '../auth.js';

export const GET_PROJECT_TOOL = {
  name: 'get_project',
  description: [
    'Get full details for a project: metadata, folders, and recent tasks.',
    'Accepts a slug, UUID, or partial name match.',
    'Available in both knowledge and dev_project workspace modes.',
    '',
    'Use this when the user names or asks about a specific project and you need its',
    'folders, recent tasks, and metadata. Do NOT use for a workspace-wide list —',
    'call list_projects.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: {
        type: 'string',
        description: 'Project slug (e.g. "boppl-context-engine"), UUID, or partial name.',
      },
    },
    required: ['project'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'Get project' },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getProject(ctx: McpAuthContext, rawArgs: Record<string, unknown>) {
  const identifier = typeof rawArgs.project === 'string' ? rawArgs.project.trim() : '';
  if (!identifier) {
    return { content: 'project is required.', structuredContent: { error: 'missing_arg' } };
  }

  const isUuid = UUID_RE.test(identifier);

  // Try exact UUID or slug first
  let project = await db.query.projects.findFirst({
    where: and(
      eq(projects.workspaceId, ctx.tenant_id),
      isUuid
        ? eq(projects.id, identifier)
        : eq(projects.slug, identifier),
    ),
  });

  // Fallback: partial name match (case-insensitive)
  if (!project && !isUuid) {
    const allProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, ctx.tenant_id));
    const lower = identifier.toLowerCase();
    project = allProjects.find(
      (p) => p.name.toLowerCase().includes(lower) || p.slug.includes(lower),
    );
  }

  if (!project) {
    return {
      content: `No project found matching "${identifier}".`,
      structuredContent: { error: 'not_found' },
    };
  }

  // Fetch folders
  const projectFolders = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.workspaceId, ctx.tenant_id),
        eq(folders.projectId, project.id),
      ),
    )
    .orderBy(asc(folders.name));

  // Task counts
  const countRows = await db.execute(
    sql`SELECT status, COUNT(*)::int AS cnt
        FROM tasks
        WHERE workspace_id = ${ctx.tenant_id}::uuid
          AND project_id = ${project.id}::uuid
        GROUP BY status`,
  ) as unknown as { status: string; cnt: number }[];

  const taskCounts: Record<string, number> = {};
  for (const r of countRows) taskCounts[r.status] = r.cnt;

  // Recent tasks (up to 5)
  const recentTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, ctx.tenant_id),
        eq(tasks.projectId, project.id),
      ),
    )
    .orderBy(asc(tasks.boardOrder))
    .limit(5);

  const total = Object.values(taskCounts).reduce((a, b) => a + b, 0);
  const folderList = projectFolders.map((f) => `  • ${f.name}`).join('\n') || '  (none)';
  const taskList = recentTasks.map((t) => `  • [${t.status}] ${t.title}`).join('\n') || '  (none)';

  const content = [
    `**${project.name}** (${project.slug})`,
    `Status: ${project.status} · ${total} task${total !== 1 ? 's' : ''}`,
    project.description ? `Description: ${project.description}` : null,
    project.githubRepoUrl ? `GitHub: ${project.githubRepoUrl}` : null,
    `\nFolders:\n${folderList}`,
    `\nRecent tasks:\n${taskList}`,
  ].filter(Boolean).join('\n');

  return {
    content,
    structuredContent: { project: { ...project, taskCounts }, folders: projectFolders, recentTasks },
  };
}
