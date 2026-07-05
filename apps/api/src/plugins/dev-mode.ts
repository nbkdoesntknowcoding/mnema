/**
 * requireDevProjectMode — Fastify preHandler hook.
 *
 * Checks that the JWT-scoped workspace has mode === 'dev_project'.
 * If not, returns 403 with a clear error code.
 *
 * Attach to all /api/tasks routes and all dev MCP tools.
 */

import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { workspaces } from '../db/schema.js';

export async function requireDevProjectMode(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.auth) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }

  // Use the system-level db (not withTenant) because we're reading the workspace
  // row itself — not content scoped to it. This check is auth-gate level.
  const rows = await db
    .select({ mode: workspaces.mode })
    .from(workspaces)
    .where(eq(workspaces.id, req.auth.tenant_id))
    .limit(1);

  const workspace = rows[0];
  if (!workspace) {
    await reply.code(404).send({ error: 'workspace_not_found' });
    return;
  }

  if (workspace.mode !== 'dev_project') {
    await reply.code(403).send({
      error: 'dev_mode_required',
      message: 'This feature is only available in Dev Project workspaces.',
    });
  }
}
