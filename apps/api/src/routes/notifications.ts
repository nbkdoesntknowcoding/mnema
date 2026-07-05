/**
 * Notification routes — read path for Phase 9.5 notifications.
 *
 * notify_members (MCP tool) writes to the notifications table.
 * These routes expose the read path + mark-read for the UI.
 *
 * SSE endpoint: uses DB polling (every 10s) rather than an in-process
 * pub/sub emitter so the MCP tool handler doesn't need to be modified.
 * For multi-process deployments, swap the polling for Redis pub/sub.
 */

import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { notifications } from '../db/schema.js';
import { subscribeWorkspace } from '../lib/events.js';

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/notifications
  // Query: ?unread_only=true&limit=20&cursor=<iso-timestamp>
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/notifications', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const q = (req.query as Record<string, string>) ?? {};
    const limit = Math.min(Number(q.limit ?? 20), 100);
    const unreadOnly = q.unread_only === 'true';
    const cursor = q.cursor ? new Date(q.cursor) : null;

    const filters = [
      eq(notifications.workspaceId, req.auth.tenant_id),
      eq(notifications.recipientId, req.auth.sub),
    ];
    if (unreadOnly) filters.push(isNull(notifications.readAt));
    if (cursor) filters.push(lt(notifications.createdAt, cursor));

    const rows = await db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1); // fetch one extra to determine if there's a next page

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Unread count — always full count regardless of cursor/limit
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.workspaceId, req.auth.tenant_id),
        eq(notifications.recipientId, req.auth.sub),
        isNull(notifications.readAt),
      ));

    return {
      notifications: page,
      unread_count: countRow?.count ?? 0,
      next_cursor: hasMore ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /api/notifications/:id/read — mark a single notification as read
  // ──────────────────────────────────────────────────────────────────────────
  app.patch('/api/notifications/:id/read', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const result = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.id, id),
        eq(notifications.workspaceId, req.auth.tenant_id),
        eq(notifications.recipientId, req.auth.sub),
        isNull(notifications.readAt),
      ))
      .returning({ id: notifications.id });

    if (result.length === 0) {
      // Either not found or already read — both are fine for idempotency
      return { ok: true };
    }
    return { ok: true };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /api/notifications/read-all — mark all unread as read
  // ──────────────────────────────────────────────────────────────────────────
  app.patch('/api/notifications/read-all', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const result = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.workspaceId, req.auth.tenant_id),
        eq(notifications.recipientId, req.auth.sub),
        isNull(notifications.readAt),
      ))
      .returning({ id: notifications.id });

    return { updated: result.length };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/notifications/stream — SSE stream for real-time delivery
  //
  // Polls the DB every 10s for notifications newer than `since`. Sends a
  // ping every 30s to keep the connection alive. Clients reconnect via
  // native SSE behaviour (Last-Event-ID header).
  //
  // For multi-process deployments: swap DB polling for Redis pub/sub on
  // `notifications:{workspaceId}:{userId}` channel.
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/notifications/stream', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const { tenant_id, sub: userId } = req.auth;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    reply.raw.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let since = new Date();
    send('connected', { ok: true });

    // Phase 1 AgentLens: subscribe to in-process task_updated events so the
    // Kanban board gets real-time updates without a separate SSE endpoint.
    const unsubscribeEvents = subscribeWorkspace(tenant_id, (event) => {
      try {
        if (event.type === 'notification') {
          send('notification', event.data);
        } else if (event.type === 'task_updated') {
          send('task_updated', event.data);
        } else if (event.type === 'task_deleted') {
          send('task_deleted', event.data);
        } else if (event.type === 'session_cost_updated') {
          // Phase 2 AgentLens: real-time cost updates
          send('session_cost_updated', event.data);
        } else if (event.type === 'session_started') {
          send('session_started', event.data);
        } else if (event.type === 'session_ended') {
          send('session_ended', event.data);
        } else if (event.type === 'optimization_findings_updated') {
          send('optimization_findings_updated', event.data);
        } else if (event.type === 'graph_updated') {
          send('graph_updated', event.data);
        } else if (event.type === 'graph_node_added') {
          send('graph_node_added', event.data);
        }
      } catch {
        // Client disconnected mid-write — safe to ignore
      }
    });

    // Poll for new notifications every 10s
    const pollInterval = setInterval(async () => {
      try {
        const rows = await db
          .select({
            id: notifications.id,
            kind: notifications.kind,
            title: notifications.title,
            body: notifications.body,
            link: notifications.link,
            readAt: notifications.readAt,
            createdAt: notifications.createdAt,
          })
          .from(notifications)
          .where(and(
            eq(notifications.workspaceId, tenant_id),
            eq(notifications.recipientId, userId),
            // created after the last check
            sql`${notifications.createdAt} > ${since.toISOString()}`,
          ))
          .orderBy(desc(notifications.createdAt))
          .limit(20);

        if (rows.length > 0) {
          since = new Date();
          for (const row of rows.reverse()) {
            send('notification', row);
          }
        }
      } catch (err) {
        req.log.error({ err }, 'SSE notification poll error');
      }
    }, 10_000);

    // Keepalive ping every 30s
    const pingInterval = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 30_000);

    req.raw.on('close', () => {
      clearInterval(pollInterval);
      clearInterval(pingInterval);
      unsubscribeEvents();
    });

    // Keep Fastify from auto-sending a reply
    return reply;
  });
};
