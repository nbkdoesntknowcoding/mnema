import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  notifications, users, workspaceJoinRequests, workspaceMembers, workspaces,
} from '../db/schema.js';
import { withSystemPrivilege } from '../db/with-system-privilege.js';
import { requireRole, RoleError } from '../lib/role.js';
import { emailSender } from '../lib/email.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://mnema.example.com';

/**
 * Owner/admin review of pending same-domain join requests (created by
 * /api/_internal/request-join). Approve chooses the granted role and creates the membership;
 * deny closes the request. Surfaces in the /app/requests inbox.
 */
export const joinRequestRoutes: FastifyPluginAsync = async (app) => {
  function roleGuard(err: unknown, reply: FastifyReply): boolean {
    if (err instanceof RoleError) {
      reply.code(err.status).send({ error: err.reason });
      return true;
    }
    return false;
  }

  // ── GET /api/workspace/join-requests — pending requests for this workspace (admin+). ──
  app.get('/api/workspace/join-requests', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try { await requireRole(req, 'admin'); } catch (e) { if (roleGuard(e, reply)) return; throw e; }

    const rows = await db
      .select({
        id: workspaceJoinRequests.id,
        requester_id: workspaceJoinRequests.requesterId,
        requester_name: users.displayName,
        requester_email: users.email,
        created_at: workspaceJoinRequests.createdAt,
      })
      .from(workspaceJoinRequests)
      .innerJoin(users, eq(users.id, workspaceJoinRequests.requesterId))
      .where(and(
        eq(workspaceJoinRequests.workspaceId, req.auth.tenant_id),
        eq(workspaceJoinRequests.status, 'pending'),
      ))
      .orderBy(desc(workspaceJoinRequests.createdAt));
    return reply.send({ requests: rows });
  });

  // ── POST /api/workspace/join-requests/:id/approve — grant membership at chosen role (admin+). ──
  app.post('/api/workspace/join-requests/:id/approve', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid_id' });
    try { await requireRole(req, 'admin'); } catch (e) { if (roleGuard(e, reply)) return; throw e; }

    const parsed = z.object({ role: z.enum(['viewer', 'editor', 'admin']) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const grantedRole = parsed.data.role;

    // Load the request scoped to this workspace (prevents cross-tenant id guessing).
    const [reqRow] = await db.select().from(workspaceJoinRequests)
      .where(and(
        eq(workspaceJoinRequests.id, id),
        eq(workspaceJoinRequests.workspaceId, req.auth.tenant_id),
      )).limit(1);
    if (!reqRow) return reply.code(404).send({ error: 'not_found' });
    if (reqRow.status !== 'pending') return reply.code(409).send({ error: 'already_reviewed' });

    // Create membership (unless somehow already present) + close the request. System privilege:
    // the requester isn't a member yet, so RLS wouldn't let the tenant context write their row.
    await withSystemPrivilege(async (tx) => {
      await tx.insert(workspaceMembers)
        .values({ workspaceId: reqRow.workspaceId, userId: reqRow.requesterId, role: grantedRole })
        .onConflictDoNothing();
      await tx.update(workspaceJoinRequests)
        .set({ status: 'approved', grantedRole, reviewedBy: req.auth!.sub, reviewedAt: new Date() })
        .where(eq(workspaceJoinRequests.id, id));
    });

    // Notify the requester they're in (best-effort).
    try {
      const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, reqRow.workspaceId)).limit(1);
      const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, reqRow.requesterId)).limit(1);
      await withSystemPrivilege((tx) => tx.insert(notifications).values({
        workspaceId: reqRow.workspaceId,
        recipientId: reqRow.requesterId,
        actorId: req.auth!.sub,
        kind: 'join_approved',
        title: `You're in — ${ws?.name ?? 'the workspace'}`,
        body: `Your request to join was approved (${grantedRole} access).`,
        link: '/app',
      }));
      if (u?.email) {
        await emailSender.send(
          u.email,
          `You've been added to ${ws?.name ?? 'a workspace'}`,
          `<p>Your request to join <strong>${ws?.name ?? 'the workspace'}</strong> was approved with ${grantedRole} access. Open Mnema at ${WEB_BASE_URL}/app</p>`,
        ).catch(() => {});
      }
    } catch { /* non-fatal */ }

    return reply.send({ ok: true, granted_role: grantedRole });
  });

  // ── POST /api/workspace/join-requests/:id/deny — close without granting (admin+). ──
  app.post('/api/workspace/join-requests/:id/deny', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'invalid_id' });
    try { await requireRole(req, 'admin'); } catch (e) { if (roleGuard(e, reply)) return; throw e; }

    const [reqRow] = await db.select().from(workspaceJoinRequests)
      .where(and(
        eq(workspaceJoinRequests.id, id),
        eq(workspaceJoinRequests.workspaceId, req.auth.tenant_id),
      )).limit(1);
    if (!reqRow) return reply.code(404).send({ error: 'not_found' });
    if (reqRow.status !== 'pending') return reply.code(409).send({ error: 'already_reviewed' });

    await withSystemPrivilege((tx) => tx.update(workspaceJoinRequests)
      .set({ status: 'denied', reviewedBy: req.auth!.sub, reviewedAt: new Date() })
      .where(eq(workspaceJoinRequests.id, id)));

    return reply.send({ ok: true });
  });
};
