/**
 * Project CRUD routes — Sprint 3 Chunks D.1 + D.2
 *
 * Available in BOTH knowledge and dev_project workspace modes.
 * project_id is nullable everywhere — existing workspaces without projects
 * continue to work exactly as before.
 *
 * Routes:
 *   GET  /api/projects               list active/all projects with task counts
 *   POST /api/projects               create + auto-folder + slug generation
 *   GET  /api/projects/:idOrSlug     single project (UUID or slug)
 *   PATCH /api/projects/:id          partial update
 *   DELETE /api/projects/:id         soft-archive (status = 'archived')
 *   GET  /api/projects/:id/tasks     tasks filtered to this project
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { folders, projectMembers, projects, tasks, users, workspaceMembers, workspaces } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { requireProjectRole, RoleError } from '../lib/role.js';

// ── helpers ───────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

async function uniqueProjectSlug(
  base: string,
  workspaceId: string,
): Promise<string> {
  let slug = base;
  let n = 2;
  while (true) {
    const existing = await db.query.projects.findFirst({
      where: and(
        eq(projects.slug, slug),
        eq(projects.workspaceId, workspaceId),
      ),
    });
    if (!existing) break;
    slug = `${base}-${n++}`;
  }
  return slug;
}

// ── zod schemas ───────────────────────────────────────────────────────────────

const createProjectSchema = z.object({
  name:          z.string().min(1).max(200),
  description:   z.string().max(2000).nullable().optional(),
  color:         z.string().max(20).optional(),
  icon:          z.string().max(50).optional(),
  githubRepoUrl: z.string().url().nullable().optional().or(z.literal('')),
}).passthrough(); // folderIds and other extra fields are handled separately

const addMemberSchema = z.object({
  email: z.string().email(),
  role:  z.enum(['viewer', 'editor', 'admin']).default('viewer'),
});

const updateMemberSchema = z.object({
  role: z.enum(['viewer', 'editor', 'admin']),
});

const updateProjectSchema = z.object({
  name:          z.string().min(1).max(200).optional(),
  description:   z.string().max(2000).nullable().optional(),
  color:         z.string().max(20).optional(),
  icon:          z.string().max(50).optional(),
  status:        z.enum(['active', 'paused', 'completed', 'archived']).optional(),
  githubRepoUrl: z.string().url().nullable().optional().or(z.literal('')),
}).passthrough(); // allow extra fields like folderIds to be ignored

// ── task-counts helper (raw SQL for speed) ────────────────────────────────────

async function taskCountsForProject(
  workspaceId: string,
  projectId: string,
): Promise<Record<string, number>> {
  const rows = await db.execute(
    sql`SELECT status, COUNT(*)::int AS cnt
        FROM tasks
        WHERE workspace_id = ${workspaceId}::uuid
          AND project_id = ${projectId}::uuid
        GROUP BY status`,
  );
  const counts: Record<string, number> = {};
  for (const r of rows as unknown as { status: string; cnt: number }[]) {
    counts[r.status] = r.cnt;
  }
  return counts;
}

async function taskCountsForAllProjects(
  workspaceId: string,
): Promise<Record<string, Record<string, number>>> {
  const rows = await db.execute(
    sql`SELECT project_id::text, status, COUNT(*)::int AS cnt
        FROM tasks
        WHERE workspace_id = ${workspaceId}::uuid
          AND project_id IS NOT NULL
        GROUP BY project_id, status`,
  );
  const map: Record<string, Record<string, number>> = {};
  for (const r of rows as unknown as { project_id: string; status: string; cnt: number }[]) {
    if (!map[r.project_id]) map[r.project_id] = {};
    map[r.project_id]![r.status] = r.cnt;
  }
  return map;
}

// ── plugin ────────────────────────────────────────────────────────────────────

export const projectsRoutes: FastifyPluginAsync = async (app) => {

  // ── GET /api/projects ──────────────────────────────────────────────────────
  app.get('/api/projects', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const q = (req.query as Record<string, string>) ?? {};
    const statusFilter = q.status ?? 'active';

    const rows = await withTenant(req.auth.tenant_id, async (tx) => {
      return tx
        .select()
        .from(projects)
        .where(
          statusFilter === 'all'
            ? eq(projects.workspaceId, req.auth!.tenant_id)
            : and(
                eq(projects.workspaceId, req.auth!.tenant_id),
                eq(projects.status, statusFilter),
              ),
        )
        .orderBy(asc(projects.boardOrder), asc(projects.createdAt));
    });

    const countsMap = await taskCountsForAllProjects(req.auth.tenant_id);

    const result = rows.map((p) => ({
      ...p,
      taskCounts: countsMap[p.id] ?? {},
    }));

    return reply.send({ projects: result });
  });

  // ── POST /api/projects ─────────────────────────────────────────────────────
  app.post('/api/projects', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    }
    const { name, description, color, icon, githubRepoUrl } = parsed.data;

    // Slug generation
    const baseSlug = toSlug(name);
    const slug = await uniqueProjectSlug(baseSlug, req.auth.tenant_id);

    // Fetch workspace to determine mode
    const ws = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, req.auth.tenant_id),
    });
    const mode = ws?.mode ?? 'knowledge';

    // Create project
    const inserted = await withTenant(req.auth.tenant_id, async (tx) => {
      return tx
        .insert(projects)
        .values({
          workspaceId:   req.auth!.tenant_id,
          name,
          slug,
          description:   description ?? null,
          color:         color ?? '#52525b',
          icon:          icon ?? 'folder',
          githubRepoUrl: githubRepoUrl || null,
          status:        'active',
          boardOrder:    0,
        })
        .returning();
    });
    const project = inserted[0];
    if (!project) return reply.code(500).send({ error: 'insert_failed' });

    // Auto-create project folders
    const folderNames =
      mode === 'dev_project'
        ? [`${name} — Specs`, `${name} — Build Prompts`, `${name} — Decisions`]
        : [`${name} — Specs`, `${name} — Decisions`];

    await withTenant(req.auth.tenant_id, async (tx) => {
      await tx.insert(folders).values(
        folderNames.map((folderName) => ({
          workspaceId: req.auth!.tenant_id,
          name:        folderName,
          projectId:   project.id,
        })),
      );
    });

    return reply.code(201).send({ project });
  });

  // ── GET /api/projects/:idOrSlug ────────────────────────────────────────────
  app.get('/api/projects/:idOrSlug', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const { idOrSlug } = req.params as { idOrSlug: string };
    const isUuid = UUID_RE.test(idOrSlug);

    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.workspaceId, req.auth.tenant_id),
        isUuid
          ? eq(projects.id, idOrSlug)
          : eq(projects.slug, idOrSlug),
      ),
    });

    if (!project) return reply.code(404).send({ error: 'not_found' });

    // Fetch project folders
    const projectFolders = await db
      .select()
      .from(folders)
      .where(
        and(
          eq(folders.workspaceId, req.auth.tenant_id),
          eq(folders.projectId, project.id),
        ),
      )
      .orderBy(asc(folders.name));

    const taskCounts = await taskCountsForProject(req.auth.tenant_id, project.id);

    return reply.send({ project: { ...project, taskCounts }, folders: projectFolders });
  });

  // ── PATCH /api/projects/:id ────────────────────────────────────────────────
  app.patch('/api/projects/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid_id' });

    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    }

    const existing = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), eq(projects.workspaceId, req.auth.tenant_id)),
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    const { name, description, color, icon, status, githubRepoUrl } = parsed.data;
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (color !== undefined) updateData.color = color;
    if (icon !== undefined) updateData.icon = icon;
    if (status !== undefined) updateData.status = status;
    if (githubRepoUrl !== undefined) updateData.githubRepoUrl = githubRepoUrl || null;

    const [updated] = await withTenant(req.auth.tenant_id, async (tx) => {
      return tx
        .update(projects)
        .set(updateData)
        .where(and(eq(projects.id, id), eq(projects.workspaceId, req.auth!.tenant_id)))
        .returning();
    });

    return reply.send({ project: updated });
  });

  // ── DELETE /api/projects/:id (soft-archive) ────────────────────────────────
  app.delete('/api/projects/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid_id' });

    const existing = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), eq(projects.workspaceId, req.auth.tenant_id)),
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    // Soft-archive: tasks RETAIN their project_id (no cascade delete)
    await withTenant(req.auth.tenant_id, async (tx) => {
      await tx
        .update(projects)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(projects.id, id), eq(projects.workspaceId, req.auth!.tenant_id)));
    });

    return reply.send({ ok: true });
  });

  // ── GET /api/projects/:id/tasks ────────────────────────────────────────────
  app.get('/api/projects/:id/tasks', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid_id' });

    const q = (req.query as Record<string, string>) ?? {};
    const status = q.status;

    const rows = await withTenant(req.auth.tenant_id, async (tx) => {
      return tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, req.auth!.tenant_id),
            eq(tasks.projectId, id),
            status ? eq(tasks.status, status) : undefined,
          ),
        )
        .orderBy(asc(tasks.boardOrder), desc(tasks.createdAt));
    });

    return reply.send({ tasks: rows, total: rows.length });
  });

  // ── Stage B5: project membership / access control ──────────────────────────
  // Helper: confirm the project exists in the tenant (else 404, no leak).
  async function projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const p = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.workspaceId, tenantId)),
    });
    return !!p;
  }

  function handleRoleError(err: unknown, reply: import('fastify').FastifyReply): boolean {
    if (err instanceof RoleError) {
      reply.code(err.status).send({ error: err.reason });
      return true;
    }
    return false;
  }

  // ── GET /api/projects/:id/members — list explicit project members ──────────
  // Any project member (viewer+) — and, via the admin bypass, any workspace
  // owner/admin (NOT editors, narrowed in migration 0051) — can see who has access.
  app.get('/api/projects/:id/members', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid_id' });
    if (!(await projectExists(req.auth.tenant_id, id))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      await requireProjectRole(req, id, 'viewer');
    } catch (err) {
      if (handleRoleError(err, reply)) return;
      throw err;
    }

    const rows = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .select({
          userId:      projectMembers.userId,
          role:        projectMembers.role,
          email:       users.email,
          displayName: users.displayName,
          joinedAt:    projectMembers.joinedAt,
        })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(eq(projectMembers.projectId, id))
        .orderBy(projectMembers.joinedAt),
    );
    return reply.send({ members: rows });
  });

  // ── POST /api/projects/:id/members — grant access by email. Admin-only. ────
  // The target MUST already be a workspace member; project access is a
  // narrowing of workspace access, never a way to add outsiders.
  app.post('/api/projects/:id/members', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid_id' });
    if (!(await projectExists(req.auth.tenant_id, id))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      await requireProjectRole(req, id, 'admin');
    } catch (err) {
      if (handleRoleError(err, reply)) return;
      throw err;
    }

    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    }
    const { email, role } = parsed.data;

    // Resolve the email to a user who is a member of THIS workspace.
    const target = await db
      .select({ userId: users.id })
      .from(users)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.userId, users.id),
          eq(workspaceMembers.workspaceId, req.auth.tenant_id),
        ),
      )
      .where(eq(users.email, email))
      .limit(1);

    const targetUserId = target[0]?.userId;
    if (!targetUserId) {
      return reply.code(400).send({ error: 'not_a_workspace_member' });
    }

    const [member] = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .insert(projectMembers)
        .values({
          projectId:   id,
          userId:      targetUserId,
          workspaceId: req.auth!.tenant_id,
          role,
        })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set:    { role },
        })
        .returning(),
    );

    return reply.code(201).send({ member });
  });

  // ── PATCH /api/projects/:id/members/:userId — change role. Admin-only. ─────
  app.patch('/api/projects/:id/members/:userId', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id, userId } = req.params as { id: string; userId: string };
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid_id' });
    if (!(await projectExists(req.auth.tenant_id, id))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      await requireProjectRole(req, id, 'admin');
    } catch (err) {
      if (handleRoleError(err, reply)) return;
      throw err;
    }

    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', issues: parsed.error.issues });
    }

    const updated = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .update(projectMembers)
        .set({ role: parsed.data.role })
        .where(
          and(
            eq(projectMembers.projectId, id),
            eq(projectMembers.userId, userId),
            eq(projectMembers.workspaceId, req.auth!.tenant_id),
          ),
        )
        .returning(),
    );

    if (updated.length === 0) return reply.code(404).send({ error: 'not_a_project_member' });
    return reply.send({ member: updated[0] });
  });

  // ── DELETE /api/projects/:id/members/:userId — revoke access. Admin-only. ──
  app.delete('/api/projects/:id/members/:userId', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id, userId } = req.params as { id: string; userId: string };
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid_id' });
    if (!(await projectExists(req.auth.tenant_id, id))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      await requireProjectRole(req, id, 'admin');
    } catch (err) {
      if (handleRoleError(err, reply)) return;
      throw err;
    }

    const removed = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, id),
            eq(projectMembers.userId, userId),
            eq(projectMembers.workspaceId, req.auth!.tenant_id),
          ),
        )
        .returning(),
    );

    if (removed.length === 0) return reply.code(404).send({ error: 'not_a_project_member' });
    return reply.send({ removed: true });
  });
};
