import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/env.js';
import { db } from '../../db/index.js';
import { invitations, users, workspaceMembers, workspaces } from '../../db/schema.js';
import { provisionOrgProfile } from '../../lib/iam-policy-factory.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { signJwt } from '../../lib/jwt.js';
import { scopesForRole } from '../../lib/scopes.js';
import { verifyInvitationToken } from '../../lib/invitation-token.js';
import { syncSubscriptionSeats } from '../../lib/billing/sync-seats.js';
import { emailQueue } from '../../queue/email.js';

const bodySchema = z.object({
  internal_secret: z.string(),
  user_id: z.string().uuid(),
  invite_token: z.string(),
});

/**
 * POST /api/_internal/accept-invite-pending
 *
 * Called from the join-or-create page when the user clicks "Join" on a workspace
 * they have been specifically invited to. Unlike POST /api/invitations/accept
 * (which requires an existing session JWT), this internal endpoint accepts the
 * invite token + user_id and does everything in one call.
 *
 * Uses onConflictDoUpdate so that if the user is already a member (e.g. they
 * joined as a viewer via the same-domain flow), they are upgraded to the invited
 * role rather than staying at viewer.
 */
export const acceptInvitePendingRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/_internal/accept-invite-pending', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    if (parsed.data.internal_secret !== config.API_INTERNAL_SECRET) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const { user_id, invite_token } = parsed.data;

    // Verify the invitation JWT
    let claims: Awaited<ReturnType<typeof verifyInvitationToken>>;
    try {
      claims = await verifyInvitationToken(invite_token);
    } catch {
      return reply.code(400).send({ error: 'invalid_token' });
    }

    // Fetch user and verify email matches the invitation
    const [userRow] = await withSystemPrivilege((tx) =>
      tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, user_id))
        .limit(1),
    );
    if (!userRow) return reply.code(404).send({ error: 'user_not_found' });
    if (userRow.email.toLowerCase() !== claims.email.toLowerCase()) {
      return reply.code(403).send({ error: 'email_mismatch' });
    }

    // Validate and consume the invitation row
    const result = await withSystemPrivilege(async (tx) => {
      const rows = await tx
        .select({
          id: invitations.id,
          workspaceId: invitations.workspaceId,
          role: invitations.role,
          invitedBy: invitations.invitedBy,
          acceptedAt: invitations.acceptedAt,
          revokedAt: invitations.revokedAt,
          expiresAt: invitations.expiresAt,
          orgRoleId: invitations.orgRoleId,
          displayTitle: invitations.displayTitle,
        })
        .from(invitations)
        .where(eq(invitations.tokenJti, claims.jti))
        .limit(1);

      const row = rows[0];
      if (!row) return { error: 'not_found' as const };
      if (row.acceptedAt) return { error: 'already_accepted' as const };
      if (row.revokedAt) return { error: 'revoked' as const };
      if (row.expiresAt < new Date()) return { error: 'expired' as const };

      // Upsert membership — upgrade role if already a viewer from domain-join
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: row.workspaceId, userId: user_id, role: row.role })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role: row.role },
        });

      await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedBy: user_id })
        .where(eq(invitations.id, row.id));

      return {
        workspace_id: row.workspaceId,
        role: row.role,
        invited_by: row.invitedBy,
        org_role_id: row.orgRoleId,
        display_title: row.displayTitle,
      };
    });

    if ('error' in result) {
      const status = result.error === 'not_found' ? 404 : 410;
      return reply.code(status).send({ error: result.error });
    }

    // Phase B: provision org identity if the invite carried an org_role (best-effort).
    if (result.org_role_id) {
      try {
        await provisionOrgProfile({
          userId: user_id,
          workspaceId: result.workspace_id,
          orgRoleId: result.org_role_id,
          actorUserId: user_id,
          displayTitle: result.display_title,
        });
      } catch (err) {
        app.log.warn({ err }, 'pending-invite accept: provisionOrgProfile failed (membership still granted)');
      }
    }

    const jwt = await signJwt({
      sub: user_id,
      tenant_id: result.workspace_id,
      email: userRow.email,
      scopes: scopesForRole(result.role),
    });

    // Sync billing seats (fire-and-forget)
    void syncSubscriptionSeats(result.workspace_id).catch((err) =>
      app.log.warn({ err }, 'syncSubscriptionSeats failed after pending-invite accept'),
    );

    // Notify the inviter (fire-and-forget)
    void (async () => {
      try {
        const inviterRows = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, result.invited_by))
          .limit(1);
        const wsRows = await db
          .select({ name: workspaces.name })
          .from(workspaces)
          .where(eq(workspaces.id, result.workspace_id))
          .limit(1);
        const inviterEmail = inviterRows[0]?.email;
        if (inviterEmail) {
          await emailQueue.add('invitation_accepted', {
            type: 'invitation_accepted',
            to: inviterEmail,
            params: {
              inviteeName: userRow.email,
              workspaceName: wsRows[0]?.name ?? 'your workspace',
              membersUrl: `${config.WEB_BASE_URL}/app/settings/members`,
            },
          });
        }
      } catch (err) {
        app.log.warn({ err }, 'Failed to enqueue invitation_accepted email');
      }
    })();

    return { user_id, tenant_id: result.workspace_id, jwt };
  });
};
