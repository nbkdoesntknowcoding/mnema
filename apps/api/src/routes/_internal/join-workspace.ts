import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/env.js';
import { db } from '../../db/index.js';
import { users, workspaceMembers, workspaces } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { signJwt } from '../../lib/jwt.js';
import { scopesForRole } from '../../lib/scopes.js';

const bodySchema = z.object({
  internal_secret: z.string(),
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
});

/**
 * POST /api/_internal/join-workspace
 *
 * Called from the join-or-create page when the user picks an existing
 * same-domain workspace. Adds the user as a viewer (owners can promote),
 * mints a JWT scoped to that workspace, and returns the normal session shape.
 *
 * Protected by internal_secret (same API_INTERNAL_SECRET used by set-session).
 */
export const joinWorkspaceRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/_internal/join-workspace', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    if (parsed.data.internal_secret !== config.API_INTERNAL_SECRET) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const { user_id, workspace_id } = parsed.data;

    // Verify user and workspace both exist
    const [userRow] = await withSystemPrivilege((tx) =>
      tx.select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, user_id))
        .limit(1),
    );
    if (!userRow) {
      return reply.code(404).send({ error: 'user_not_found' });
    }

    const [wsRow] = await withSystemPrivilege((tx) =>
      tx.select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, workspace_id))
        .limit(1),
    );
    if (!wsRow) {
      return reply.code(404).send({ error: 'workspace_not_found' });
    }

    // Upsert membership — if they're already a member (unlikely but safe), keep existing role
    const existing = await withSystemPrivilege((tx) =>
      tx.select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.userId, user_id), eq(workspaceMembers.workspaceId, workspace_id)))
        .limit(1),
    );

    let role: string;
    if (existing[0]) {
      role = existing[0].role;
    } else {
      await withSystemPrivilege((tx) =>
        tx.insert(workspaceMembers).values({
          workspaceId: workspace_id,
          userId: user_id,
          role: 'editor',
        }),
      );
      role = 'editor';
    }

    const jwt = await signJwt({
      sub: user_id,
      tenant_id: workspace_id,
      scopes: scopesForRole(role),
      email: userRow.email,
    });

    return { user_id, tenant_id: workspace_id, jwt };
  });
};
