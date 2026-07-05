/**
 * Dev-only helper for Phase 4.2 chunk-B verification: mint a viewer-role
 * JWT in a known workspace so we can exercise the role-gate on POST
 * /api/comment-threads from curl without bouncing through WorkOS.
 *
 * Usage: tsx src/tests/mint-viewer-jwt.ts <workspace_uuid>
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, workspaceMembers } from '../db/schema.js';
import { signJwt } from '../lib/jwt.js';

const tenantId = process.argv[2];
if (!tenantId) {
  console.error('usage: mint-viewer-jwt.ts <workspace_uuid>');
  process.exit(1);
}

async function main(): Promise<void> {
  const email = 'dev-chunkb-viewer@local.test';
  let viewer = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!viewer) {
    viewer = (
      await db.insert(users).values({ email, displayName: 'Chunk-B Viewer' }).returning()
    )[0]!;
  }
  // Try to add membership; ignore conflict.
  try {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: tenantId!, userId: viewer.id, role: 'viewer' });
  } catch {
    /* already a member */
  }
  const jwt = await signJwt({
    sub: viewer.id,
    tenant_id: tenantId!,
    email: viewer.email,
    scopes: ['docs:read'],
  });
  console.log(jwt);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
