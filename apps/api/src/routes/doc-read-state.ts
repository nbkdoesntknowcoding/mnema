import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { docReadState, docs } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { RoleError, requireRole } from '../lib/role.js';
import { eq } from 'drizzle-orm';

/**
 * Phase 4.2 — doc read state.
 *
 * Per (user_id, doc_id) last-seen timestamp. Drives the "unread comments"
 * dot in the doc list. The unread-counts query joins docs ↔ comment_threads
 * ↔ comments ↔ doc_read_state and only counts comments authored by someone
 * other than the requester (so your own replies don't mark a doc unread for
 * you on the next page load).
 */

const markReadSchema = z.object({
  doc_id: z.string().uuid(),
});

export const docReadStateRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/doc-read-state/mark-read', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'viewer');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    const parsed = markReadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const ok = await withTenant(req.auth.tenant_id, async (tx) => {
      // RLS will hide the doc if it's in another tenant; verify visibility
      // before we touch the upsert so cross-tenant probes get a clean 404.
      const docRows = await tx
        .select({ id: docs.id })
        .from(docs)
        .where(eq(docs.id, parsed.data.doc_id))
        .limit(1);
      if (docRows.length === 0) return false;

      await tx
        .insert(docReadState)
        .values({
          userId: req.auth!.sub,
          docId: parsed.data.doc_id,
          workspaceId: req.auth!.tenant_id,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [docReadState.userId, docReadState.docId],
          set: { lastSeenAt: new Date() },
        });
      return true;
    });

    if (!ok) return reply.code(404).send({ error: 'doc_not_found' });
    return { ok: true };
  });

  app.get('/api/doc-read-state/unread-counts', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'viewer');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    const result = await withTenant(req.auth.tenant_id, async (tx) =>
      tx.execute(sql`
        SELECT
          d.id::text AS doc_id,
          COUNT(DISTINCT c.id)::int AS unread_comment_count
        FROM docs d
        INNER JOIN comment_threads ct
          ON ct.doc_id = d.id AND ct.resolved = false
        INNER JOIN comments c
          ON c.thread_id = ct.id
        LEFT JOIN doc_read_state drs
          ON drs.doc_id = d.id AND drs.user_id = ${req.auth!.sub}
        WHERE d.deleted_at IS NULL
          AND c.created_at > COALESCE(drs.last_seen_at, '1970-01-01'::timestamptz)
          AND c.author_id <> ${req.auth!.sub}
        GROUP BY d.id
        HAVING COUNT(DISTINCT c.id) > 0
      `),
    );

    const rows = result as unknown as Array<{ doc_id: string; unread_comment_count: number }>;
    return {
      unread: rows.map((r) => ({
        doc_id: r.doc_id,
        unread_comment_count: Number(r.unread_comment_count),
      })),
    };
  });
};
