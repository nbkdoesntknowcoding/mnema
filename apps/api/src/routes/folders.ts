import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { docs, embeddings, folders } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  // Phase 6.5: optional parent for nested folders. null/omitted = root.
  parent_id: z.string().uuid().nullable().optional(),
});

const renameSchema = z.object({
  name: z.string().min(1).max(200),
});

const moveFolderSchema = z.object({
  folder_id: z.string().uuid().nullable(),
});

export const foldersRoutes: FastifyPluginAsync = async (app) => {
  // List folders — optionally filtered by parent.
  // ?parent_id=null  → root folders (parent_id IS NULL)
  // ?parent_id=<uuid> → children of that folder
  // (no param)        → all folders (for sidebar counts etc.)
  app.get('/api/folders', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const q = (req.query as Record<string, unknown>) ?? {};
    const rawParent = q.parent_id as string | undefined;
    // Hierarchy: optional ?project_id= to scope the folder list to one project.
    const rawProject = q.project_id as string | undefined;
    const projClause =
      rawProject && UUID_RE.test(rawProject) ? sql`AND f.project_id = ${rawProject}::uuid` : sql``;

    const rows = await withTenant(req.auth.tenant_id, async (tx) => {
      const parentWhere =
        rawParent === 'null'
          ? sql`f.parent_id IS NULL`
          : rawParent && UUID_RE.test(rawParent)
            ? sql`f.parent_id = ${rawParent}::uuid`
            : sql`TRUE`;
      return await tx.execute(
        sql`SELECT f.id, f.name, f.parent_id, f.created_at, f.updated_at,
                   COUNT(d.id)::int AS doc_count,
                   COUNT(cf.id)::int AS subfolder_count
            FROM folders f
            LEFT JOIN docs d ON d.folder_id = f.id AND d.deleted_at IS NULL
            LEFT JOIN folders cf ON cf.parent_id = f.id
            WHERE ${parentWhere} ${projClause}
            GROUP BY f.id, f.name, f.parent_id, f.created_at, f.updated_at
            ORDER BY f.name ASC`,
      );
    });

    return {
      folders: (rows as unknown as Array<{
        id: string;
        name: string;
        parent_id: string | null;
        created_at: string;
        updated_at: string;
        doc_count: number;
        subfolder_count: number;
      }>).map((r) => ({
        id: r.id,
        name: r.name,
        parent_id: r.parent_id ?? null,
        doc_count: Number(r.doc_count) || 0,
        subfolder_count: Number(r.subfolder_count) || 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    };
  });

  // Create a new folder (optionally nested under a parent)
  app.post('/api/folders', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const auth = req.auth;

    const created = await withTenant(auth.tenant_id, async (tx) => {
      const inserted = await tx
        .insert(folders)
        .values({
          workspaceId: auth.tenant_id,
          name: parsed.data.name,
          parentFolderId: parsed.data.parent_id ?? null,
          createdBy: auth.sub,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('Failed to create folder');
      return row;
    });

    return reply.code(201).send({
      folder: {
        id: created.id,
        name: created.name,
        parent_id: created.parentFolderId ?? null,
        doc_count: 0,
        subfolder_count: 0,
        created_at: created.createdAt,
        updated_at: created.updatedAt,
      },
    });
  });

  // Rename a folder
  app.patch<{ Params: { id: string } }>('/api/folders/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'bad_id' });

    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }

    const updated = await withTenant(req.auth.tenant_id, async (tx) => {
      const rows = await tx
        .update(folders)
        .set({ name: parsed.data.name, updatedAt: new Date() })
        .where(eq(folders.id, id))
        .returning();
      return rows[0];
    });

    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { folder: { id: updated.id, name: updated.name } };
  });

  // Link / unlink a folder to/from a project
  // PATCH /api/folders/:id/project  { project_id: "<uuid>" | null }
  app.patch<{ Params: { id: string } }>('/api/folders/:id/project', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'bad_id' });

    const body = req.body as { project_id?: string | null };
    const projectId = body.project_id ?? null;
    if (projectId !== null && !isUuid(projectId)) {
      return reply.code(400).send({ error: 'bad_project_id' });
    }

    const updated = await withTenant(req.auth.tenant_id, async (tx) => {
      const rows = await tx
        .update(folders)
        .set({ projectId, updatedAt: new Date() })
        .where(and(eq(folders.id, id), eq(folders.workspaceId, req.auth!.tenant_id)))
        .returning();
      // Cascade the project to the docs directly in this folder + their embeddings, so
      // project-scoped search/graph stay correct. (Subfolders carry their own projectId.)
      await tx.update(docs).set({ projectId }).where(eq(docs.folderId, id));
      await tx
        .update(embeddings)
        .set({ projectId })
        .where(sql`${embeddings.docId} IN (SELECT id FROM docs WHERE folder_id = ${id})`);
      return rows[0];
    });

    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ folder: { id: updated.id, name: updated.name, projectId: updated.projectId } });
  });

  // Delete a folder (docs inside become unfiled; subfolders become root)
  app.delete<{ Params: { id: string } }>('/api/folders/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'bad_id' });

    await withTenant(req.auth.tenant_id, async (tx) => {
      // Docs directly in this folder become unfiled (FK set-null) → clear their
      // denormalized project too so scoped search doesn't keep stale rows.
      await tx
        .update(embeddings)
        .set({ projectId: null })
        .where(sql`${embeddings.docId} IN (SELECT id FROM docs WHERE folder_id = ${id})`);
      await tx.update(docs).set({ projectId: null }).where(eq(docs.folderId, id));
      await tx.delete(folders).where(eq(folders.id, id));
    });

    return reply.code(204).send();
  });

  // Move a doc into a folder (or unfile it with folder_id: null)
  app.patch<{ Params: { id: string } }>('/api/docs/:id/folder', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'bad_id' });

    const parsed = moveFolderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }

    const updated = await withTenant(req.auth.tenant_id, async (tx) => {
      // Hierarchy: the doc inherits the destination folder's project (null if unfiled).
      let projectId: string | null = null;
      if (parsed.data.folder_id) {
        const f = await tx
          .select({ projectId: folders.projectId })
          .from(folders)
          .where(eq(folders.id, parsed.data.folder_id))
          .limit(1);
        projectId = f[0]?.projectId ?? null;
      }
      const rows = await tx
        .update(docs)
        .set({ folderId: parsed.data.folder_id, projectId })
        .where(and(eq(docs.id, id), isNull(docs.deletedAt)))
        .returning({ id: docs.id, folderId: docs.folderId });
      // Keep embeddings' denormalized project in sync for scoped search.
      await tx.update(embeddings).set({ projectId }).where(eq(embeddings.docId, id));
      return rows[0];
    });

    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { doc: { id: updated.id, folder_id: updated.folderId } };
  });

  // Delete a doc (soft-delete)
  app.delete<{ Params: { id: string } }>('/api/docs/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'bad_id' });

    const updated = await withTenant(req.auth.tenant_id, async (tx) => {
      const rows = await tx
        .update(docs)
        .set({ deletedAt: new Date() })
        .where(and(eq(docs.id, id), isNull(docs.deletedAt)))
        .returning({ id: docs.id });
      return rows[0];
    });

    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });
};
