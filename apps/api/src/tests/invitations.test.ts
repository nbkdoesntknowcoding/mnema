import { eq, sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { invitations, users, workspaceMembers, workspaces } from '../db/schema.js';
import { signInvitationToken, verifyInvitationToken } from '../lib/invitation-token.js';
import { signJwt } from '../lib/jwt.js';
import { authPlugin } from '../plugins/auth.js';
import { invitationsRoutes } from '../routes/invitations.js';
import { membersRoutes } from '../routes/members.js';

/**
 * Phase 4.1 — invitations + members route coverage.
 *
 * Uses Fastify's `app.inject()` so we exercise the full plugin chain
 * (cookie parsing → auth preHandler → JWT verify → route handler) without
 * actually opening a port. Tests run in ~150ms total.
 *
 * Fixtures: a workspace with an owner, an editor, and a viewer. JWTs
 * minted directly via signJwt to skip the WorkOS callback for tests.
 */

let stamp: number;
let tenantAId: string;
let tenantBId: string;
let ownerId: string;
let editorId: string;
let viewerId: string;
let strangerId: string;
let ownerJwt: string;
let editorJwt: string;
let viewerJwt: string;
let strangerJwt: string;
let app: Awaited<ReturnType<typeof buildApp>>;

async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  // authPlugin already registers @fastify/cookie internally. Registering
  // it again here triggers "decorator already added".
  const f = Fastify({ logger: false });
  await f.register(authPlugin);
  await f.register(invitationsRoutes);
  await f.register(membersRoutes);
  await f.ready();
  return f;
}

async function mintJwt(userId: string, tenantId: string, email: string): Promise<string> {
  return signJwt({
    sub: userId,
    tenant_id: tenantId,
    email,
    scopes: ['docs:read'],
  });
}

beforeAll(async () => {
  stamp = Date.now();

  const [wsA] = await db
    .insert(workspaces)
    .values({ slug: `inv-a-${stamp}`, name: 'Invitations Test A' })
    .returning();
  const [wsB] = await db
    .insert(workspaces)
    .values({ slug: `inv-b-${stamp + 1}`, name: 'Invitations Test B' })
    .returning();
  tenantAId = wsA!.id;
  tenantBId = wsB!.id;

  const [u1] = await db
    .insert(users)
    .values({ email: `inv-owner-${stamp}@boppl.test`, displayName: 'Owner User' })
    .returning();
  const [u2] = await db
    .insert(users)
    .values({ email: `inv-editor-${stamp}@boppl.test`, displayName: 'Editor User' })
    .returning();
  const [u3] = await db
    .insert(users)
    .values({ email: `inv-viewer-${stamp}@boppl.test`, displayName: 'Viewer User' })
    .returning();
  const [u4] = await db
    .insert(users)
    .values({ email: `inv-stranger-${stamp}@boppl.test`, displayName: 'Stranger' })
    .returning();
  ownerId = u1!.id;
  editorId = u2!.id;
  viewerId = u3!.id;
  strangerId = u4!.id;

  await db.insert(workspaceMembers).values([
    { workspaceId: tenantAId, userId: ownerId, role: 'owner' },
    { workspaceId: tenantAId, userId: editorId, role: 'editor' },
    { workspaceId: tenantAId, userId: viewerId, role: 'viewer' },
    // stranger is a member of B only — used for cross-tenant isolation checks
    { workspaceId: tenantBId, userId: strangerId, role: 'owner' },
  ]);

  ownerJwt = await mintJwt(ownerId, tenantAId, `inv-owner-${stamp}@boppl.test`);
  editorJwt = await mintJwt(editorId, tenantAId, `inv-editor-${stamp}@boppl.test`);
  viewerJwt = await mintJwt(viewerId, tenantAId, `inv-viewer-${stamp}@boppl.test`);
  strangerJwt = await mintJwt(strangerId, tenantBId, `inv-stranger-${stamp}@boppl.test`);

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await db.delete(workspaces).where(eq(workspaces.id, tenantAId));
  await db.delete(workspaces).where(eq(workspaces.id, tenantBId));
});

function cookieHeader(jwt: string): { cookie: string } {
  return { cookie: `boppl_jwt=${jwt}` };
}

describe('invitation-token (unit)', () => {
  it('signs and verifies a token with all claims', async () => {
    const { token, jti } = await signInvitationToken({
      workspace_id: tenantAId,
      email: 'invitee@boppl.test',
      role: 'editor',
      invited_by: ownerId,
    });
    const claims = await verifyInvitationToken(token);
    expect(claims.jti).toBe(jti);
    expect(claims.workspace_id).toBe(tenantAId);
    expect(claims.email).toBe('invitee@boppl.test');
    expect(claims.role).toBe('editor');
    expect(claims.invited_by).toBe(ownerId);
  });

  it('lowercases the email at sign time', async () => {
    const { token } = await signInvitationToken({
      workspace_id: tenantAId,
      email: 'MIXED-Case@Boppl.Test',
      role: 'viewer',
      invited_by: ownerId,
    });
    const claims = await verifyInvitationToken(token);
    expect(claims.email).toBe('mixed-case@boppl.test');
  });

  it('rejects a tampered token', async () => {
    const { token } = await signInvitationToken({
      workspace_id: tenantAId,
      email: 'invitee@boppl.test',
      role: 'editor',
      invited_by: ownerId,
    });
    const tampered = `${token.slice(0, -6)}XXXXXX`;
    await expect(verifyInvitationToken(tampered)).rejects.toThrow();
  });

  it('rejects a wrong-audience JWT (an app-login JWT replayed)', async () => {
    // signJwt mints app-login tokens with audience = JWT_AUDIENCE;
    // verifyInvitationToken expects audience = JWT_AUDIENCE/invite.
    const appJwt = await signJwt({
      sub: ownerId,
      tenant_id: tenantAId,
      email: `inv-owner-${stamp}@boppl.test`,
      scopes: ['docs:read'],
    });
    await expect(verifyInvitationToken(appJwt)).rejects.toThrow();
  });
});

describe('POST /api/invitations — create', () => {
  it('owner can create an editor invitation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(ownerJwt),
      payload: { email: `new-editor-${stamp}@boppl.test`, role: 'editor' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { invitation: { email: string; role: string } };
    expect(body.invitation.email).toBe(`new-editor-${stamp}@boppl.test`);
    expect(body.invitation.role).toBe('editor');
  });

  it('editor can create a viewer invitation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(editorJwt),
      payload: { email: `new-viewer-${stamp}@boppl.test`, role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('editor CANNOT create an owner invitation (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(editorJwt),
      payload: { email: `new-owner-${stamp}@boppl.test`, role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: string };
    expect(body.error).toBe('requires_owner_to_invite_owner');
  });

  it('viewer CANNOT invite anyone (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(viewerJwt),
      payload: { email: `nope-${stamp}@boppl.test`, role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects inviting an existing member (409 already_a_member)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(ownerJwt),
      payload: { email: `inv-editor-${stamp}@boppl.test`, role: 'editor' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string };
    expect(body.error).toBe('already_a_member');
  });

  it('rejects duplicate pending invitation (409 already_invited)', async () => {
    const email = `dup-${stamp}@boppl.test`;
    const first = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(ownerJwt),
      payload: { email, role: 'viewer' },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(ownerJwt),
      payload: { email, role: 'viewer' },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: string }).error).toBe('already_invited');
  });

  it('logs the invitation email to stdout', async () => {
    // Just verify the call succeeds — capturing console.log across vitest's
    // worker is brittle. The handler explicitly calls emailSender.sendInvitation
    // which is the StdoutEmailSender; the dev-smoke check covers visual confirm.
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(ownerJwt),
      payload: { email: `stdout-${stamp}@boppl.test`, role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/invitations — list', () => {
  it('lists pending invitations for the active tenant only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/invitations',
      headers: cookieHeader(ownerJwt),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { invitations: Array<{ email: string }> };
    expect(body.invitations.length).toBeGreaterThan(0);
    // None of the invitations should leak from tenant B
    for (const inv of body.invitations) {
      expect(inv.email).toContain(`-${stamp}@boppl.test`);
    }
  });

  it("stranger (member of tenant B) sees ZERO of tenant A's invitations", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/invitations',
      headers: cookieHeader(strangerJwt),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { invitations: Array<unknown> };
    // Tenant B has no invitations — and critically, the response must NOT
    // include any from tenant A (RLS would have to fail for that).
    expect(body.invitations.length).toBe(0);
  });
});

describe('DELETE /api/invitations/:id — revoke', () => {
  it('owner can revoke a pending invitation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(ownerJwt),
      payload: { email: `revoke-${stamp}@boppl.test`, role: 'viewer' },
    });
    const { invitation } = created.json() as { invitation: { id: string } };
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/invitations/${invitation.id}`,
      headers: cookieHeader(ownerJwt),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { revoked: boolean }).revoked).toBe(true);
  });

  it('revoking an already-revoked invitation returns 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(ownerJwt),
      payload: { email: `revoke2-${stamp}@boppl.test`, role: 'viewer' },
    });
    const { invitation } = created.json() as { invitation: { id: string } };
    await app.inject({
      method: 'DELETE',
      url: `/api/invitations/${invitation.id}`,
      headers: cookieHeader(ownerJwt),
    });
    const second = await app.inject({
      method: 'DELETE',
      url: `/api/invitations/${invitation.id}`,
      headers: cookieHeader(ownerJwt),
    });
    expect(second.statusCode).toBe(404);
  });
});

describe('GET /api/invitations/lookup — unauthenticated preview', () => {
  it('returns workspace + inviter for a valid token+row pair', async () => {
    // Approach: sign a token + insert a row with matching JTI directly,
    // so we control both halves. The real production flow couples them
    // via signInvitationToken returning {token, jti} which the route
    // handler writes into the invitations row; we mimic that here.
    const { token, jti } = await signInvitationToken({
      workspace_id: tenantAId,
      email: `lookup-${stamp}@boppl.test`,
      role: 'editor',
      invited_by: ownerId,
    });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantAId}, true)`);
      await tx.insert(invitations).values({
        workspaceId: tenantAId,
        email: `lookup-${stamp}@boppl.test`,
        role: 'editor',
        invitedBy: ownerId,
        tokenJti: jti,
        expiresAt,
      });
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/invitations/lookup?token=${encodeURIComponent(token)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      workspace_name: string;
      inviter_name: string;
      email: string;
      role: string;
    };
    expect(body.workspace_name).toBe('Invitations Test A');
    expect(body.inviter_name).toBe('Owner User');
    expect(body.email).toBe(`lookup-${stamp}@boppl.test`);
    expect(body.role).toBe('editor');
  });

  it('returns 400 for an invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/invitations/lookup?token=not-a-jwt',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_token');
  });

  it('returns 404 for a valid-signature token with no matching row', async () => {
    // Signature verifies (right key/issuer/audience) but the JTI doesn't
    // match any invitation row — same shape as a token that was issued
    // by a DIFFERENT system or for a workspace that was deleted.
    const { token } = await signInvitationToken({
      workspace_id: tenantAId,
      email: `ghost-${stamp}@boppl.test`,
      role: 'editor',
      invited_by: ownerId,
    });
    // We did NOT insert a row for this token's JTI.
    const res = await app.inject({
      method: 'GET',
      url: `/api/invitations/lookup?token=${encodeURIComponent(token)}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/invitations/accept — accept flow', () => {
  it('rejects unauthenticated callers (401)', async () => {
    const { token } = await signInvitationToken({
      workspace_id: tenantAId,
      email: 'noauth@boppl.test',
      role: 'viewer',
      invited_by: ownerId,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/accept',
      payload: { token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects email mismatch (403)', async () => {
    // Sign a token for some-other@boppl.test, accept while signed in as owner.
    const { token } = await signInvitationToken({
      workspace_id: tenantAId,
      email: 'some-other@boppl.test',
      role: 'viewer',
      invited_by: ownerId,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/accept',
      headers: cookieHeader(ownerJwt),
      payload: { token },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('email_mismatch');
  });

  it('rejects an expired invitation (410)', async () => {
    // Create an invitation, then manually expire its row.
    const created = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: cookieHeader(ownerJwt),
      payload: { email: `expired-${stamp}@boppl.test`, role: 'viewer' },
    });
    const { invitation } = created.json() as { invitation: { id: string } };

    // Force the expires_at into the past.
    await db.execute(
      sql`UPDATE invitations SET expires_at = now() - interval '1 day' WHERE id = ${invitation.id}`,
    );

    // Sign a token that points at this row by JTI. The actual token isn't
    // captured (stdout email), so we use the row's stored JTI to reconstruct.
    const jtiRow = await db
      .select({ jti: invitations.tokenJti })
      .from(invitations)
      .where(eq(invitations.id, invitation.id))
      .limit(1);
    expect(jtiRow.length).toBe(1);

    // The token's signature must match — but since we control JWT_SECRET in
    // tests, we can re-sign with the same JTI.
    // (jose's SignJWT allows setJti, which we use in invitation-token.ts;
    // but the helper randomUUIDs a new JTI. We bypass and use jose directly.)
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(config.JWT_SECRET);
    const fakeToken = await new SignJWT({
      workspace_id: tenantAId,
      email: `expired-${stamp}@boppl.test`,
      role: 'viewer',
      invited_by: ownerId,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(config.JWT_ISSUER)
      .setAudience(`${config.JWT_AUDIENCE}/invite`)
      .setSubject(`expired-${stamp}@boppl.test`)
      .setJti(jtiRow[0]!.jti)
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret);

    // Sign in as the invitee — mint a JWT for them as a fresh user.
    const [inviteeUser] = await db
      .insert(users)
      .values({
        email: `expired-${stamp}@boppl.test`,
        displayName: 'Expired Invitee',
      })
      .returning();
    const inviteeJwt = await mintJwt(
      inviteeUser!.id,
      tenantAId,
      `expired-${stamp}@boppl.test`,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/invitations/accept',
      headers: cookieHeader(inviteeJwt),
      payload: { token: fakeToken },
    });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('expired');
  });
});

describe('members routes', () => {
  it('viewer can list members', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: cookieHeader(viewerJwt),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { members: Array<{ email: string }> };
    expect(body.members.length).toBe(3); // owner, editor, viewer
  });

  it('editor CANNOT change a role (403, requires owner)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/members/${viewerId}/role`,
      headers: cookieHeader(editorJwt),
      payload: { role: 'editor' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('owner CANNOT demote themselves if they are the last owner (409)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/members/${ownerId}/role`,
      headers: cookieHeader(ownerJwt),
      payload: { role: 'editor' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('last_owner_cannot_demote');
  });

  it('owner CANNOT remove themselves if they are the last owner (409)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/members/${ownerId}`,
      headers: cookieHeader(ownerJwt),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('last_owner_cannot_remove_self');
  });
});
