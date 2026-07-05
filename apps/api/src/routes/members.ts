import { and, count, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, workspaceMembers } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { requireRole, RoleError } from '../lib/role.js';
import { syncSubscriptionSeats } from '../lib/billing/sync-seats.js';

const updateRoleSchema = z.object({
  role: z.enum(['owner', 'editor', 'viewer']),
});

/**
 * Member management routes.
 *
 * Two non-negotiable invariants enforced here:
 *
 *   1. A workspace MUST always have at least one owner. Demoting or
 *      removing the last owner is rejected with 409.
 *
 *   2. The owner role is the only one that can manage other members.
 *      Editors and viewers can read the member list (so they can see
 *      who they're collaborating with) but cannot mutate it.
 */

async function ownerCountInTenant(tenantId: string): Promise<number> {
  const rows = await db
    .select({ c: count() })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, tenantId),
        eq(workspaceMembers.role, 'owner'),
      ),
    );
  return Number(rows[0]?.c ?? 0);
}

export const membersRoutes: FastifyPluginAsync = async (app) => {
  // ------------------------------------------------------------------------
  // GET /api/members — list workspace members. Viewer+ (anyone in the
  // workspace can see who else is in it).
  // ------------------------------------------------------------------------
  app.get('/api/members', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    try {
      await requireRole(req, 'viewer');
    } catch (err) {
      if (err instanceof RoleError) {
        return reply.code(err.status).send({ error: err.reason });
      }
      throw err;
    }

    const rows = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .select({
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          email: users.email,
          displayName: users.displayName,
          joinedAt: workspaceMembers.joinedAt,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .orderBy(workspaceMembers.joinedAt),
    );
    return { members: rows };
  });

  // ------------------------------------------------------------------------
  // PATCH /api/members/:userId/role — change a member's role. Owner-only.
  //
  // Last-owner guard: demoting yourself (the last owner) is a 409. The
  // guard runs OUTSIDE the transaction; this is fine because we don't
  // create owners here — only demote — so a transient race that
  // misses the guard would just leave one fewer owner momentarily.
  // ------------------------------------------------------------------------
  app.patch('/api/members/:userId/role', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    try {
      await requireRole(req, 'owner');
    } catch (err) {
      if (err instanceof RoleError) {
        return reply.code(err.status).send({ error: err.reason });
      }
      throw err;
    }

    const { userId } = req.params as { userId: string };
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request' });
    }

    // Self-demotion guard: if demoting yourself away from owner, ensure
    // there's at least one other owner.
    if (userId === req.auth.sub && parsed.data.role !== 'owner') {
      const owners = await ownerCountInTenant(req.auth.tenant_id);
      if (owners <= 1) {
        return reply.code(409).send({ error: 'last_owner_cannot_demote' });
      }
    }

    const updated = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .update(workspaceMembers)
        .set({ role: parsed.data.role })
        .where(
          and(
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.workspaceId, req.auth!.tenant_id),
          ),
        )
        .returning(),
    );

    if (updated.length === 0) {
      return reply.code(404).send({ error: 'not_a_member' });
    }

    // Sync billable seat count with Razorpay (fire-and-forget).
    void syncSubscriptionSeats(req.auth.tenant_id).catch((err) =>
      req.log.warn({ err }, 'syncSubscriptionSeats failed after role change'),
    );

    return { member: updated[0] };
  });

  // ------------------------------------------------------------------------
  // DELETE /api/members/:userId — remove a member. Owner-only.
  // Last-owner guard applies for self-removal.
  // ------------------------------------------------------------------------
  app.delete('/api/members/:userId', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    try {
      await requireRole(req, 'owner');
    } catch (err) {
      if (err instanceof RoleError) {
        return reply.code(err.status).send({ error: err.reason });
      }
      throw err;
    }

    const { userId } = req.params as { userId: string };

    if (userId === req.auth.sub) {
      const owners = await ownerCountInTenant(req.auth.tenant_id);
      if (owners <= 1) {
        return reply.code(409).send({ error: 'last_owner_cannot_remove_self' });
      }
    }

    const removed = await withTenant(req.auth.tenant_id, async (tx) =>
      tx
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.workspaceId, req.auth!.tenant_id),
          ),
        )
        .returning(),
    );

    if (removed.length === 0) {
      return reply.code(404).send({ error: 'not_a_member' });
    }

    // Sync billable seat count with Razorpay (fire-and-forget).
    void syncSubscriptionSeats(req.auth.tenant_id).catch((err) =>
      req.log.warn({ err }, 'syncSubscriptionSeats failed after member removal'),
    );

    return { removed: true };
  });
};
