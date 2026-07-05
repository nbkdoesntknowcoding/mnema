/**
 * Task CRUD + status transition routes — Phase 1 AgentLens Task Layer.
 *
 * All routes require:
 *   1. Authentication (JWT)
 *   2. workspace.mode === 'dev_project' (enforced by requireDevProjectMode)
 *
 * Status machine:
 *   backlog ──/start──→ in_progress ──/review──→ review ──/complete──→ done
 *                           │                                ↑
 *                           └──/block──→ audit_fix ──/start──┘
 *   done ──/reopen──→ backlog
 *   audit_fix ──/reopen──→ backlog
 *
 * Board order: each status column has an independent boardOrder sequence.
 * Lower = higher on the board. On creation, boardOrder = MAX + 1 in that column.
 */

import { and, asc, desc, eq, gt, isNull, max, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { agentSessions, tasks } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { requireDevProjectMode } from '../plugins/dev-mode.js';
import { emitWorkspaceEvent } from '../lib/events.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const createTaskSchema = z.object({
  title:            z.string().min(1).max(200),
  description:      z.string().max(8000).optional(),
  priority:         z.enum(['low', 'medium', 'high', 'critical']).optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  tags:             z.array(z.string().max(50)).max(20).optional(),
  docId:            z.string().uuid().optional(),
  projectId:        z.string().uuid().optional().nullable(),
});

const updateTaskSchema = z.object({
  title:            z.string().min(1).max(200).optional(),
  description:      z.string().max(8000).optional(),
  priority:         z.enum(['low', 'medium', 'high', 'critical']).optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  tags:             z.array(z.string().max(50)).max(20).optional(),
  githubPrUrl:      z.string().url().optional().nullable(),
  assignedMemberId: z.string().uuid().optional().nullable(),
  docId:            z.string().uuid().optional().nullable(),
  projectId:        z.string().uuid().optional().nullable(),
  // Status changes are NOT allowed via PATCH — use dedicated transition endpoints
});

const reorderSchema = z.object({
  taskId:   z.string().uuid(),
  newOrder: z.number().int().nonnegative(),
  status:   z.enum(['backlog', 'in_progress', 'review', 'audit_fix', 'done']),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch a task by id within the current tenant, return null if not found. */
async function fetchTask(workspaceId: string, taskId: string) {
  const rows = await withTenant(workspaceId, async (tx) =>
    tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1),
  );
  return rows[0] ?? null;
}

/** Emit a task_updated SSE event after any status transition. */
function emitTaskUpdated(
  workspaceId: string,
  task: typeof tasks.$inferSelect,
  previousStatus: string,
  changedBy: 'agent' | 'user',
  developerId?: string,
): void {
  emitWorkspaceEvent(workspaceId, {
    type: 'task_updated',
    data: { task, previousStatus, changedBy, developerId },
  });
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export const tasksRoutes: FastifyPluginAsync = async (app) => {
  // Apply dev-mode gate to all routes in this plugin
  app.addHook('preHandler', requireDevProjectMode);

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/tasks
  // Query: ?status=backlog&priority=high&limit=50&cursor=<id>
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/tasks', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const q = (req.query as Record<string, string>) ?? {};
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const statusFilter = q.status;
    const priorityFilter = q.priority;
    const cursor = q.cursor as string | undefined;

    const taskRows = await withTenant(req.auth.tenant_id, async (tx) => {
      const filters: ReturnType<typeof eq>[] = [
        eq(tasks.workspaceId, req.auth!.tenant_id),
      ];
      if (statusFilter) filters.push(eq(tasks.status, statusFilter));
      if (priorityFilter) filters.push(eq(tasks.priority, priorityFilter));

      // Cursor pagination: tasks after this id by boardOrder+createdAt
      // Simple approach: use createdAt as cursor for stability
      let query = tx
        .select()
        .from(tasks)
        .where(and(...filters))
        .orderBy(asc(tasks.boardOrder), asc(tasks.createdAt))
        .limit(limit + 1);

      return await query;
    });

    const hasMore = taskRows.length > limit;
    const page = hasMore ? taskRows.slice(0, limit) : taskRows;

    return {
      tasks: page,
      next_cursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/tasks
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/tasks', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', details: parsed.error.issues });
    }

    const workspaceId = req.auth.tenant_id;

    // Get max boardOrder in 'backlog' column to append at the end
    const [maxRow] = await withTenant(workspaceId, async (tx) =>
      tx
        .select({ maxOrder: max(tasks.boardOrder) })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'backlog'))),
    );
    const boardOrder = (maxRow?.maxOrder ?? -1) + 1;

    const [created] = await withTenant(workspaceId, async (tx) =>
      tx
        .insert(tasks)
        .values({
          workspaceId,
          title:            parsed.data.title,
          description:      parsed.data.description ?? null,
          priority:         parsed.data.priority ?? 'medium',
          estimatedCostUsd: parsed.data.estimatedCostUsd ?? null,
          tags:             parsed.data.tags ?? null,
          docId:            parsed.data.docId ?? null,
          projectId:        parsed.data.projectId ?? null,
          status:           'backlog',
          boardOrder,
        })
        .returning(),
    );

    return reply.code(201).send(created);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/tasks/:id
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/api/tasks/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const task = await fetchTask(req.auth.tenant_id, id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    return task;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /api/tasks/:id — update fields (NOT status — use transition endpoints)
  // ──────────────────────────────────────────────────────────────────────────
  app.patch('/api/tasks/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', details: parsed.error.issues });
    }

    const task = await fetchTask(req.auth.tenant_id, id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    const updates: Partial<typeof tasks.$inferInsert> = {};
    if (parsed.data.title !== undefined)            updates.title = parsed.data.title;
    if (parsed.data.description !== undefined)      updates.description = parsed.data.description;
    if (parsed.data.priority !== undefined)         updates.priority = parsed.data.priority;
    if (parsed.data.estimatedCostUsd !== undefined) updates.estimatedCostUsd = parsed.data.estimatedCostUsd;
    if (parsed.data.tags !== undefined)             updates.tags = parsed.data.tags;
    if ('githubPrUrl' in parsed.data)               updates.githubPrUrl = parsed.data.githubPrUrl ?? null;
    if ('assignedMemberId' in parsed.data)          updates.assignedMemberId = parsed.data.assignedMemberId ?? null;
    if ('docId' in parsed.data)                     updates.docId = parsed.data.docId ?? null;
    if ('projectId' in parsed.data)                 updates.projectId = parsed.data.projectId ?? null;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'nothing_to_update' });
    }

    updates.updatedAt = new Date();

    const [updated] = await withTenant(req.auth.tenant_id, async (tx) =>
      tx.update(tasks).set(updates).where(eq(tasks.id, id)).returning(),
    );

    // Emit SSE so the board live-updates when a task is edited
    emitTaskUpdated(req.auth.tenant_id, updated!, task.status, 'user');

    return updated;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // DELETE /api/tasks/:id — hard delete
  // ──────────────────────────────────────────────────────────────────────────
  app.delete('/api/tasks/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const task = await fetchTask(req.auth.tenant_id, id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    await withTenant(req.auth.tenant_id, async (tx) =>
      tx.delete(tasks).where(eq(tasks.id, id)),
    );

    emitWorkspaceEvent(req.auth.tenant_id, {
      type: 'task_deleted',
      data: { taskId: id, workspaceId: req.auth!.tenant_id },
    });

    return { ok: true };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /api/tasks/reorder — drag-to-reorder within a column
  // ──────────────────────────────────────────────────────────────────────────
  app.patch('/api/tasks/reorder', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', details: parsed.error.issues });
    }

    const { taskId, newOrder, status } = parsed.data;
    const workspaceId = req.auth.tenant_id;

    // Fetch all tasks in the column, ordered by current boardOrder
    const columnTasks = await withTenant(workspaceId, async (tx) =>
      tx
        .select({ id: tasks.id, boardOrder: tasks.boardOrder })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, status)))
        .orderBy(asc(tasks.boardOrder)),
    );

    // Remove target task from current position, insert at newOrder
    const without = columnTasks.filter((t) => t.id !== taskId);
    const safeOrder = Math.min(newOrder, without.length);
    without.splice(safeOrder, 0, { id: taskId, boardOrder: safeOrder });

    // Reassign sequential boardOrder values
    await withTenant(workspaceId, async (tx) => {
      for (let i = 0; i < without.length; i++) {
        await tx
          .update(tasks)
          .set({ boardOrder: i, updatedAt: new Date() })
          .where(and(eq(tasks.id, without[i]!.id), eq(tasks.workspaceId, workspaceId)));
      }
    });

    return { ok: true };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STATUS TRANSITION ENDPOINTS
  // Each endpoint enforces the state machine — only valid transitions proceed.
  // ══════════════════════════════════════════════════════════════════════════

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/start  →  backlog | audit_fix  →  in_progress
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/tasks/:id/start', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const body = (req.body as { developerId?: string }) ?? {};

    const task = await fetchTask(req.auth.tenant_id, id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    if (task.status !== 'backlog' && task.status !== 'audit_fix') {
      return reply.code(409).send({
        error: 'invalid_transition',
        message: `Cannot start a task in status '${task.status}'. Expected: backlog or audit_fix.`,
      });
    }

    const previousStatus = task.status;
    const [updated] = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .update(tasks)
        .set({
          status: 'in_progress',
          // Clear blocker state when re-starting from audit_fix
          blockerDescription: null,
          retryFixHint: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id))
        .returning(),
    );

    emitTaskUpdated(req.auth.tenant_id, updated!, previousStatus, 'user', body.developerId);
    return updated;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/review  →  in_progress  →  review
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/tasks/:id/review', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const body = (req.body as { githubPrUrl?: string }) ?? {};

    const task = await fetchTask(req.auth.tenant_id, id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    if (task.status !== 'in_progress') {
      return reply.code(409).send({
        error: 'invalid_transition',
        message: `Cannot move to review from status '${task.status}'. Expected: in_progress.`,
      });
    }

    const previousStatus = task.status;
    const [updated] = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .update(tasks)
        .set({
          status: 'review',
          ...(body.githubPrUrl ? { githubPrUrl: body.githubPrUrl } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id))
        .returning(),
    );

    emitTaskUpdated(req.auth.tenant_id, updated!, previousStatus, 'user');
    return updated;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/complete  →  in_progress | review  →  done
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/tasks/:id/complete', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const body = (req.body as { githubPrUrl?: string }) ?? {};

    const task = await fetchTask(req.auth.tenant_id, id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    if (task.status !== 'in_progress' && task.status !== 'review') {
      return reply.code(409).send({
        error: 'invalid_transition',
        message: `Cannot complete a task in status '${task.status}'. Expected: in_progress or review.`,
      });
    }

    const previousStatus = task.status;
    const [updated] = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .update(tasks)
        .set({
          status: 'done',
          completedAt: new Date(),
          ...(body.githubPrUrl ? { githubPrUrl: body.githubPrUrl } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id))
        .returning(),
    );

    emitTaskUpdated(req.auth.tenant_id, updated!, previousStatus, 'user');

    // Phase 4: dispatch task_completed notification (fire-and-forget)
    const tenantId = req.auth.tenant_id;
    const completedTask = updated!;
    const devId = req.auth.email;
    setImmediate(() => {
      import('../lib/dev/notifications/dispatcher.js').then(({ dispatchWorkspaceNotification }) => {
        dispatchWorkspaceNotification(tenantId, {
          type: 'task_completed',
          task: completedTask,
          developerId: devId ?? 'unknown',
          githubPrUrl: body.githubPrUrl ?? null,
        }).catch(() => {});
      }).catch(() => {});
    });

    return updated;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/block  →  in_progress  →  audit_fix
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/tasks/:id/block', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };
    const body = (req.body as { blockerDescription?: string }) ?? {};

    if (!body.blockerDescription || body.blockerDescription.trim() === '') {
      return reply.code(400).send({
        error: 'blocker_description_required',
        message: 'blockerDescription is required and must not be empty.',
      });
    }

    const task = await fetchTask(req.auth.tenant_id, id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    if (task.status !== 'in_progress') {
      return reply.code(409).send({
        error: 'invalid_transition',
        message: `Cannot block a task in status '${task.status}'. Expected: in_progress.`,
      });
    }

    const previousStatus = task.status;
    const [updated] = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .update(tasks)
        .set({
          status: 'audit_fix',
          blockerDescription: body.blockerDescription,
          retryCount: sql`${tasks.retryCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id))
        .returning(),
    );

    emitTaskUpdated(req.auth.tenant_id, updated!, previousStatus, 'user');

    // Trigger async retry engine + notification (non-blocking)
    const blockedTenantId = req.auth.tenant_id;
    const blockedTask = updated!;
    const blockerDesc = body.blockerDescription!;
    const blockerDev = req.auth.email;
    setImmediate(() => {
      import('../lib/dev/retry/trigger.js').then(({ triggerRetry }) => {
        triggerRetry(blockedTask, blockerDesc).catch((err) =>
          req.log.error({ err }, 'Retry trigger failed'),
        );
      }).catch((err) => req.log.error({ err }, 'Retry trigger import failed'));

      import('../lib/dev/notifications/dispatcher.js').then(({ dispatchWorkspaceNotification }) => {
        dispatchWorkspaceNotification(blockedTenantId, {
          type: 'task_blocked',
          task: blockedTask,
          developerId: blockerDev ?? 'unknown',
          blockerDescription: blockerDesc,
        }).catch(() => {});
      }).catch(() => {});
    });

    return updated;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/tasks/:id/reopen  →  done | audit_fix  →  backlog
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/tasks/:id/reopen', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };

    const task = await fetchTask(req.auth.tenant_id, id);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    if (task.status !== 'done' && task.status !== 'audit_fix') {
      return reply.code(409).send({
        error: 'invalid_transition',
        message: `Cannot reopen a task in status '${task.status}'. Expected: done or audit_fix.`,
      });
    }

    const previousStatus = task.status;

    // Append at the end of the backlog column
    const [maxRow] = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .select({ maxOrder: max(tasks.boardOrder) })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, req.auth!.tenant_id), eq(tasks.status, 'backlog'))),
    );
    const boardOrder = (maxRow?.maxOrder ?? -1) + 1;

    const [updated] = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .update(tasks)
        .set({
          status: 'backlog',
          boardOrder,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id))
        .returning(),
    );

    emitTaskUpdated(req.auth.tenant_id, updated!, previousStatus, 'user');
    return updated;
  });
};
