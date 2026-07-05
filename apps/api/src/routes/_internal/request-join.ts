import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/env.js';
import {
  notifications, users, workspaceJoinRequests, workspaceMembers, workspaces,
} from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { signJwt } from '../../lib/jwt.js';
import { scopesForRole } from '../../lib/scopes.js';
import { emailSender } from '../../lib/email.js';

const bodySchema = z.object({
  internal_secret: z.string(),
  user_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
});

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://mnema.example.com';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * POST /api/_internal/request-join
 *
 * Same-domain user asking to join an existing workspace they were NOT invited to. Unlike the
 * old join-workspace path (which auto-added them as editor), this creates a PENDING request and
 * notifies the workspace's owners/admins — no membership until one of them approves and picks a
 * role. If the user is already a member, we just log them in.
 *
 * Protected by internal_secret (same API_INTERNAL_SECRET used by set-session).
 */
export const requestJoinRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/_internal/request-join', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    if (parsed.data.internal_secret !== config.API_INTERNAL_SECRET) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const { user_id, workspace_id } = parsed.data;

    const [userRow] = await withSystemPrivilege((tx) =>
      tx.select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users).where(eq(users.id, user_id)).limit(1),
    );
    if (!userRow) return reply.code(404).send({ error: 'user_not_found' });

    const [wsRow] = await withSystemPrivilege((tx) =>
      tx.select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces).where(eq(workspaces.id, workspace_id)).limit(1),
    );
    if (!wsRow) return reply.code(404).send({ error: 'workspace_not_found' });

    // Already a member → nothing to request; mint a session so they just enter.
    const existing = await withSystemPrivilege((tx) =>
      tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.userId, user_id), eq(workspaceMembers.workspaceId, workspace_id)))
        .limit(1),
    );
    if (existing[0]) {
      const jwt = await signJwt({
        sub: user_id, tenant_id: workspace_id,
        scopes: scopesForRole(existing[0].role), email: userRow.email,
      });
      return { already_member: true, user_id, tenant_id: workspace_id, jwt };
    }

    // Create the pending request (idempotent — the partial unique index dedupes re-requests).
    await withSystemPrivilege((tx) =>
      tx.insert(workspaceJoinRequests)
        .values({ workspaceId: workspace_id, requesterId: user_id, status: 'pending' })
        .onConflictDoNothing(),
    );

    // Notify every owner/admin: in-app + email. Best-effort; a notify hiccup must not fail the request.
    const requesterName = userRow.displayName?.trim() || userRow.email;
    const reviewers = await withSystemPrivilege((tx) =>
      tx.select({ id: workspaceMembers.userId, email: users.email })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(and(
          eq(workspaceMembers.workspaceId, workspace_id),
          inArray(workspaceMembers.role, ['owner', 'admin']),
        )),
    );
    try {
      if (reviewers.length) {
        await withSystemPrivilege((tx) =>
          tx.insert(notifications).values(reviewers.map((r) => ({
            workspaceId: workspace_id,
            recipientId: r.id,
            actorId: user_id,
            kind: 'join_request',
            title: 'Request to join your workspace',
            body: `${requesterName} asked to join "${wsRow.name}". Review and choose their access.`,
            link: '/app/requests',
          }))),
        );
      }
      const link = `${WEB_BASE_URL}/app/requests`;
      const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0A0B0D;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0B0D;padding:40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr><td align="center">
            <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#131418;border:1px solid #24272D;border-radius:16px;padding:36px;">
              <tr><td style="font-size:18px;font-weight:600;color:#F4F5F7;padding-bottom:18px;">Mnema</td></tr>
              <tr><td style="font-size:20px;font-weight:600;color:#F4F5F7;padding-bottom:14px;">Someone wants to join ${esc(wsRow.name)}</td></tr>
              <tr><td style="font-size:14px;line-height:1.65;color:#B8BCC4;">
                <strong style="color:#F4F5F7;">${esc(requesterName)}</strong> has requested to join your workspace.
                Review the request and choose what access to grant them.
                <br/><br/>
                <a href="${link}" style="display:inline-block;background:#F4F5F7;color:#0A0B0D;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">Review request</a>
              </td></tr>
              <tr><td style="padding-top:28px;font-size:11px;color:#6E737C;border-top:1px solid #24272D;">Mnema, by BOPPL</td></tr>
            </table>
          </td></tr>
        </table></body></html>`;
      await Promise.all(
        reviewers.map((r) =>
          emailSender.send(r.email, `${requesterName} requested to join ${wsRow.name}`, html).catch(() => {}),
        ),
      );
    } catch (err) {
      console.error('[request-join] notify failed:', err instanceof Error ? err.message : String(err)); // eslint-disable-line no-console
    }

    return { requested: true };
  });
};
