import type { FastifyPluginAsync } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { commentThreads, comments, docs } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { getUserRole, RoleError, requireRole } from '../lib/role.js';

/**
 * Phase 4.2 — comments + threaded replies.
 *
 * Two-table model: `comment_threads` carries the Yjs anchor (start + end
 * RelativePositions, serialized as bytea) and the resolved state; `comments`
 * holds the original body plus any replies. Resolution is a per-thread flag,
 * not per-comment, mirroring the design system spec.
 *
 * Role gates:
 *   - viewer: can list threads + read replies
 *   - editor: can create threads, reply, resolve / unresolve
 *   - owner:  can additionally delete any comment (everyone can delete their own)
 *
 * Anchors are passed in/out base64-encoded so the JSON transport stays clean;
 * the bytes themselves are opaque to the server — only the client (which has
 * the Y.Doc) can resolve them back to a position.
 */

const createThreadSchema = z.object({
  doc_id: z.string().uuid(),
  anchor_start: z.string().min(1),
  anchor_end: z.string().min(1),
  body: z.string().min(1).max(5000),
});

const createReplySchema = z.object({
  thread_id: z.string().uuid(),
  body: z.string().min(1).max(5000),
});

const listQuerySchema = z.object({
  doc_id: z.string().uuid(),
  include_resolved: z.enum(['true', 'false']).optional(),
});

const patchThreadParamsSchema = z.object({ id: z.string().uuid() });
const patchThreadBodySchema = z.object({ resolved: z.boolean() });

const deleteCommentParamsSchema = z.object({ id: z.string().uuid() });

export const commentsRoutes: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------------------
  // POST /api/comment-threads — create a new thread + its first comment.
  // -------------------------------------------------------------------------
  app.post('/api/comment-threads', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'editor');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    const parsed = createThreadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      // The docs RLS will filter to this tenant; the .limit(1) is just a
      // small optimization on the existence check.
      const docRows = await tx
        .select({ id: docs.id })
        .from(docs)
        .where(eq(docs.id, parsed.data.doc_id))
        .limit(1);
      if (docRows.length === 0) return { error: 'doc_not_found' as const };

      const [thread] = await tx
        .insert(commentThreads)
        .values({
          workspaceId: req.auth!.tenant_id,
          docId: parsed.data.doc_id,
          anchorStart: new Uint8Array(Buffer.from(parsed.data.anchor_start, 'base64')),
          anchorEnd: new Uint8Array(Buffer.from(parsed.data.anchor_end, 'base64')),
          createdBy: req.auth!.sub,
        })
        .returning();

      const [comment] = await tx
        .insert(comments)
        .values({
          threadId: thread!.id,
          body: parsed.data.body,
          authorId: req.auth!.sub,
        })
        .returning();

      return { thread: thread!, comment: comment! };
    });

    if ('error' in result) return reply.code(404).send({ error: result.error });

    return {
      thread: {
        id: result.thread.id,
        doc_id: parsed.data.doc_id,
        anchor_start: parsed.data.anchor_start,
        anchor_end: parsed.data.anchor_end,
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        created_by: req.auth.sub,
        created_at: result.thread.createdAt.toISOString(),
        updated_at: result.thread.updatedAt.toISOString(),
        comments: [
          {
            id: result.comment.id,
            body: result.comment.body,
            author_id: req.auth.sub,
            created_at: result.comment.createdAt.toISOString(),
            edited_at: null,
          },
        ],
      },
    };
  });

  // -------------------------------------------------------------------------
  // POST /api/comments — reply to an existing thread.
  // -------------------------------------------------------------------------
  app.post('/api/comments', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'editor');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    const parsed = createReplySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const threadRows = await tx
        .select({ id: commentThreads.id })
        .from(commentThreads)
        .where(eq(commentThreads.id, parsed.data.thread_id))
        .limit(1);
      if (threadRows.length === 0) return { error: 'thread_not_found' as const };

      const [comment] = await tx
        .insert(comments)
        .values({
          threadId: parsed.data.thread_id,
          body: parsed.data.body,
          authorId: req.auth!.sub,
        })
        .returning();

      // Bump updated_at so list ordering by recent activity is sensible.
      await tx
        .update(commentThreads)
        .set({ updatedAt: new Date() })
        .where(eq(commentThreads.id, parsed.data.thread_id));

      return { comment: comment! };
    });

    if ('error' in result) return reply.code(404).send({ error: result.error });

    return {
      comment: {
        id: result.comment.id,
        thread_id: parsed.data.thread_id,
        body: result.comment.body,
        author_id: req.auth.sub,
        created_at: result.comment.createdAt.toISOString(),
        edited_at: null,
      },
    };
  });

  // -------------------------------------------------------------------------
  // GET /api/comment-threads?doc_id=...&include_resolved=true|false
  //
  // Default filters out resolved threads. Two-query shape (threads + then
  // their comments by `thread_id IN (...)`) keeps the JSON marshalling
  // straightforward and avoids the N+1 you'd get with a per-thread fetch.
  // -------------------------------------------------------------------------
  app.get('/api/comment-threads', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'viewer');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const includeResolved = parsed.data.include_resolved === 'true';

    const rows = await withTenant(req.auth.tenant_id, async (tx) => {
      const threadRows = await tx
        .select({
          id: commentThreads.id,
          docId: commentThreads.docId,
          anchorStart: commentThreads.anchorStart,
          anchorEnd: commentThreads.anchorEnd,
          resolved: commentThreads.resolved,
          resolvedBy: commentThreads.resolvedBy,
          resolvedAt: commentThreads.resolvedAt,
          createdBy: commentThreads.createdBy,
          createdAt: commentThreads.createdAt,
          updatedAt: commentThreads.updatedAt,
        })
        .from(commentThreads)
        .where(
          includeResolved
            ? eq(commentThreads.docId, parsed.data.doc_id)
            : and(
                eq(commentThreads.docId, parsed.data.doc_id),
                eq(commentThreads.resolved, false),
              ),
        )
        .orderBy(commentThreads.createdAt);

      if (threadRows.length === 0) return [];

      const threadIds = threadRows.map((t) => t.id);
      const commentRows = await tx
        .select({
          id: comments.id,
          threadId: comments.threadId,
          body: comments.body,
          authorId: comments.authorId,
          createdAt: comments.createdAt,
          editedAt: comments.editedAt,
        })
        .from(comments)
        .where(inArray(comments.threadId, threadIds))
        .orderBy(comments.createdAt);

      return threadRows.map((t) => ({
        id: t.id,
        doc_id: t.docId,
        anchor_start: Buffer.from(t.anchorStart).toString('base64'),
        anchor_end: Buffer.from(t.anchorEnd).toString('base64'),
        resolved: t.resolved,
        resolved_by: t.resolvedBy,
        resolved_at: t.resolvedAt?.toISOString() ?? null,
        created_by: t.createdBy,
        created_at: t.createdAt.toISOString(),
        updated_at: t.updatedAt.toISOString(),
        comments: commentRows
          .filter((c) => c.threadId === t.id)
          .map((c) => ({
            id: c.id,
            body: c.body,
            author_id: c.authorId,
            created_at: c.createdAt.toISOString(),
            edited_at: c.editedAt?.toISOString() ?? null,
          })),
      }));
    });

    return { threads: rows };
  });

  // -------------------------------------------------------------------------
  // PATCH /api/comment-threads/:id — resolve / unresolve.
  // -------------------------------------------------------------------------
  app.patch('/api/comment-threads/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      await requireRole(req, 'editor');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    const params = patchThreadParamsSchema.safeParse(req.params);
    const body = patchThreadBodySchema.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'bad_request' });

    const updated = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .update(commentThreads)
        .set({
          resolved: body.data.resolved,
          resolvedBy: body.data.resolved ? req.auth!.sub : null,
          resolvedAt: body.data.resolved ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(commentThreads.id, params.data.id))
        .returning(),
    );

    if (updated.length === 0) return reply.code(404).send({ error: 'not_found' });
    const t = updated[0]!;
    return {
      thread: {
        id: t.id,
        resolved: t.resolved,
        resolved_by: t.resolvedBy,
        resolved_at: t.resolvedAt?.toISOString() ?? null,
        updated_at: t.updatedAt.toISOString(),
      },
    };
  });

  // -------------------------------------------------------------------------
  // DELETE /api/comments/:id
  //
  // Author can delete their own comment. Owner can delete anyone's.
  // If the deleted comment was the last in its thread, the thread itself
  // is removed (no point keeping an empty anchored thread).
  // -------------------------------------------------------------------------
  app.delete('/api/comments/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    // Minimum bar: must be at least a viewer in this workspace, otherwise
    // they shouldn't see the comment id either.
    try {
      await requireRole(req, 'viewer');
    } catch (err) {
      if (err instanceof RoleError) return reply.code(err.status).send({ error: err.reason });
      throw err;
    }

    const params = deleteCommentParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'bad_request' });

    const requesterRole = await getUserRole(req.auth.sub, req.auth.tenant_id);

    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const rows = await tx
        .select({
          id: comments.id,
          authorId: comments.authorId,
          threadId: comments.threadId,
        })
        .from(comments)
        .where(eq(comments.id, params.data.id))
        .limit(1);
      if (rows.length === 0) return { error: 'not_found' as const };

      const row = rows[0]!;
      if (row.authorId !== req.auth!.sub && requesterRole !== 'owner') {
        return { error: 'forbidden' as const };
      }

      await tx.delete(comments).where(eq(comments.id, params.data.id));

      const remaining = await tx
        .select({ id: comments.id })
        .from(comments)
        .where(eq(comments.threadId, row.threadId))
        .limit(1);
      if (remaining.length === 0) {
        await tx.delete(commentThreads).where(eq(commentThreads.id, row.threadId));
      }
      return { ok: true as const };
    });

    if ('error' in result) {
      const status = result.error === 'forbidden' ? 403 : 404;
      return reply.code(status).send({ error: result.error });
    }
    return { deleted: true };
  });
};
