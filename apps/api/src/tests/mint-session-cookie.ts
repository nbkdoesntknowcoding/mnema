/**
 * Dev-only helper: seeds a test workspace + user, then prints two cookie
 * strings (boppl_session sealed, boppl_jwt) you can paste into a browser
 * (or programmatically via document.cookie) to bypass the WorkOS login.
 *
 * Strictly local debugging — never used in any deployed environment.
 */
import { eq } from 'drizzle-orm';
import { sealData } from 'iron-session';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { signJwt } from '../lib/jwt.js';
import { users, workspaceMembers, workspaces } from '../db/schema.js';

const EMAIL = process.argv[2] ?? `dev-${Date.now()}@local.test`;

async function main(): Promise<void> {
  let user = (await db.select().from(users).where(eq(users.email, EMAIL)).limit(1))[0];
  if (!user) {
    user = (
      await db
        .insert(users)
        .values({ email: EMAIL, displayName: 'Dev User', lastLoginAt: new Date() })
        .returning()
    )[0]!;
  }

  const mem = (
    await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, user.id)).limit(1)
  )[0];

  let workspace;
  if (mem) {
    workspace = (
      await db.select().from(workspaces).where(eq(workspaces.id, mem.workspaceId)).limit(1)
    )[0]!;
  } else {
    workspace = (
      await db
        .insert(workspaces)
        .values({ slug: `dev-${Date.now()}`, name: 'Dev Workspace' })
        .returning()
    )[0]!;
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
  }

  const jwt = await signJwt({
    sub: user.id,
    tenant_id: workspace.id,
    email: user.email,
    scopes: ['docs:read', 'docs:write'],
  });

  const sealed = await sealData(
    {
      user_id: user.id,
      email: user.email,
      tenant_id: workspace.id,
      workos_user_id: 'dev-no-workos',
      access_token: 'dev-no-token',
      jwt,
    },
    { password: config.WORKOS_COOKIE_PASSWORD },
  );

  console.log(JSON.stringify({ jwt, sealed, user_id: user.id, tenant_id: workspace.id, email: user.email }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
