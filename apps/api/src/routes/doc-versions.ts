import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { docVersions, docs } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { RoleError, requireRole } from '../lib/role.js';
import { requireRegisteredFeature } from '../lib/entitlement-gate.js';
import { writeMarkdownIntoLiveDoc } from '../collab/writeback.js';
import { markdownDiff } from '../lib/markdown-diff.js';

/**
 * Phase 4.2 — doc versions UI surface.
 *
 * Reads from `doc_versions`, the table the collab persistence layer already
 * populates every 50 store events (Phase 1.2 logic). Adds:
 *   - manual snapshots (POST /api/doc-versions)
 *   - line-level diff between any version and current (GET .../diff)
 *   - restore to a prior version (POST .../restore), which writes through the
 *     collab writeback IPC if there's a live session, or directly to the docs
 *     row otherwise. Either path also writes a new "Restored to version N"
 *     snapshot so the restore itself is recoverable.
 */

const listQuerySchema = z.object({
  doc_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const saveSchema = z.object({
  doc_id: z.string().uuid(),
  comment: z.string().min(1).max(200),
});

const restoreSchema = z.object({
  doc_id: z.string().uuid(),
  version: z.number().int().positive(),
});

const diffQuerySchema = z.object({
  doc_id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

export const docVersionsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/doc-versions?doc_id=...&limit=50
  app.get('/api/doc-versions', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'viewer');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    // A3.1 — version-history UI (the sidebar) is a community-registered feature.
    const g = await requireRegisteredFeature(req.auth.tenant_id, 'history');
    if (!g.allowed) return reply.code(402).send({ error: 'entitlement_required', feature: 'history', reason: g.reason });

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    // doc_versions has no RLS itself but rides on docs RLS via the doc_id
    // foreign key. Verify the doc is visible before we trust the version list.
    const rows = await withTenant(req.auth.tenant_id, async (tx) => {
      const docRows = await tx
        .select({ id: docs.id })
        .from(docs)
        .where(eq(docs.id, parsed.data.doc_id))
        .limit(1);
      if (docRows.length === 0) return null;

      return tx
        .select({
          version: docVersions.version,
          comment: docVersions.comment,
          authorId: docVersions.authorId,
          createdAt: docVersions.createdAt,
        })
        .from(docVersions)
        .where(eq(docVersions.docId, parsed.data.doc_id))
        .orderBy(desc(docVersions.version))
        .limit(parsed.data.limit ?? 50);
    });

    if (rows === null) return reply.code(404).send({ error: 'doc_not_found' });

    return {
      versions: rows.map((r) => ({
        version: r.version,
        comment: r.comment,
        author_id: r.authorId,
        created_at: r.createdAt.toISOString(),
      })),
    };
  });

  // POST /api/doc-versions — manual named snapshot
  app.post('/api/doc-versions', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'editor');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const docRows = await tx
        .select({ markdown: docs.markdown, yjsState: docs.yjsState })
        .from(docs)
        .where(and(eq(docs.id, parsed.data.doc_id), isNull(docs.deletedAt)))
        .limit(1);
      if (docRows.length === 0) return { error: 'doc_not_found' as const };

      const nextRows = await tx.execute(
        sql`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM doc_versions WHERE doc_id = ${parsed.data.doc_id}`,
      );
      const versionNum = Number(
        (nextRows[0] as { next: number | string } | undefined)?.next ?? 1,
      );

      const [inserted] = await tx
        .insert(docVersions)
        .values({
          docId: parsed.data.doc_id,
          version: versionNum,
          markdown: docRows[0]!.markdown,
          // yjsState may be null in the DB for older docs (schema says NOT NULL
          // but legacy rows can violate this). Fall back to empty bytea so the
          // insert succeeds; the markdown column is the authoritative content.
          yjsState: docRows[0]!.yjsState ?? new Uint8Array(0),
          authorId: req.auth!.sub,
          comment: parsed.data.comment,
        })
        .returning();

      return { version: inserted! };
    });

    if ('error' in result) return reply.code(404).send({ error: result.error });

    const v = result.version;
    return {
      version: {
        version: v.version,
        comment: v.comment,
        author_id: v.authorId,
        created_at: v.createdAt.toISOString(),
      },
    };
  });

  // GET /api/doc-versions/diff?doc_id=...&version=N
  app.get('/api/doc-versions/diff', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'viewer');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    const g = await requireRegisteredFeature(req.auth.tenant_id, 'history');
    if (!g.allowed) return reply.code(402).send({ error: 'entitlement_required', feature: 'history', reason: g.reason });

    const parsed = diffQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const docRows = await tx
        .select({ markdown: docs.markdown })
        .from(docs)
        .where(eq(docs.id, parsed.data.doc_id))
        .limit(1);
      if (docRows.length === 0) return null;

      const versionRows = await tx
        .select({ markdown: docVersions.markdown })
        .from(docVersions)
        .where(
          and(
            eq(docVersions.docId, parsed.data.doc_id),
            eq(docVersions.version, parsed.data.version),
          ),
        )
        .limit(1);
      if (versionRows.length === 0) return null;

      return {
        versionMarkdown: versionRows[0]!.markdown,
        currentMarkdown: docRows[0]!.markdown,
      };
    });

    if (!result) return reply.code(404).send({ error: 'not_found' });

    const diff = markdownDiff(result.versionMarkdown, result.currentMarkdown);
    return {
      version_markdown: result.versionMarkdown,
      current_markdown: result.currentMarkdown,
      diff,
    };
  });

  // POST /api/doc-versions/restore — replace current doc with a prior version
  app.post('/api/doc-versions/restore', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'editor');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    // A3.1 — restore is a community-registered feature (capture stays unconditional).
    const g = await requireRegisteredFeature(req.auth.tenant_id, 'history');
    if (!g.allowed) return reply.code(402).send({ error: 'entitlement_required', feature: 'history', reason: g.reason });

    const parsed = restoreSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    // doc_versions has no RLS of its own — it inherits tenant scope from the
    // owning doc. Verify the doc is visible to this tenant (the docs RLS
    // policy handles the filter) before reading any versions, otherwise a
    // cross-tenant restore would silently see and "restore" data it can't
    // see in the UI.
    const versionMarkdown = await withTenant(req.auth.tenant_id, async (tx) => {
      const docRows = await tx
        .select({ id: docs.id })
        .from(docs)
        .where(eq(docs.id, parsed.data.doc_id))
        .limit(1);
      if (docRows.length === 0) return null;

      const rows = await tx
        .select({ markdown: docVersions.markdown })
        .from(docVersions)
        .where(
          and(
            eq(docVersions.docId, parsed.data.doc_id),
            eq(docVersions.version, parsed.data.version),
          ),
        )
        .limit(1);
      return rows[0]?.markdown ?? null;
    });

    if (versionMarkdown === null) return reply.code(404).send({ error: 'version_not_found' });

    // Try the live writeback path first. If no Hocuspocus session is open
    // for this doc, fall back to writing the markdown directly into the row
    // — the next collab open will rehydrate from it.
    const wroteToLiveDoc = await writeMarkdownIntoLiveDoc(
      parsed.data.doc_id,
      versionMarkdown,
      {
        user_id: req.auth.sub,
        tenant_id: req.auth.tenant_id,
        email: req.auth.email,
        doc_id: parsed.data.doc_id,
      },
    );

    if (!wroteToLiveDoc) {
      await withTenant(req.auth.tenant_id, async (tx) => {
        await tx
          .update(docs)
          .set({ markdown: versionMarkdown, updatedBy: req.auth!.sub })
          .where(eq(docs.id, parsed.data.doc_id));
      });
    }

    // Auto-snapshot the restoration itself so the action is recoverable.
    // yjs_state is left empty here; collab will hydrate on next open.
    await withTenant(req.auth.tenant_id, async (tx) => {
      const nextRows = await tx.execute(
        sql`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM doc_versions WHERE doc_id = ${parsed.data.doc_id}`,
      );
      const versionNum = Number(
        (nextRows[0] as { next: number | string } | undefined)?.next ?? 1,
      );
      await tx.insert(docVersions).values({
        docId: parsed.data.doc_id,
        version: versionNum,
        markdown: versionMarkdown,
        yjsState: new Uint8Array(0),
        authorId: req.auth!.sub,
        comment: `Restored to version ${parsed.data.version}`,
      });
    });

    return { restored: true, wrote_to_live_doc: wroteToLiveDoc };
  });
};
