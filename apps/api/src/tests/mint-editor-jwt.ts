/**
 * Dev-only helper for Phase 4.2 chunk-C two-user smoke: mint an editor-role
 * JWT in a known workspace so the second-user-comments-while-first-user-
 * watches scenario can be exercised from curl without spinning up a second
 * Chrome session.
 *
 * Usage: tsx src/tests/mint-editor-jwt.ts <workspace_uuid> [email]
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, workspaceMembers } from '../db/schema.js';
import { signJwt } from '../lib/jwt.js';

const tenantId = process.argv[2];
const email = process.argv[3] ?? 'dev-chunkb-editor@local.test';
if (!tenantId) {
  console.error('usage: mint-editor-jwt.ts <workspace_uuid> [email]');
  process.exit(1);
}

async function main(): Promise<void> {
  let editor = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!editor) {
    editor = (
      await db.insert(users).values({ email, displayName: 'Chunk-C Editor' }).returning()
    )[0]!;
  }
  try {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: tenantId!, userId: editor.id, role: 'editor' });
  } catch {
    /* already a member */
  }
  const jwt = await signJwt({
    sub: editor.id,
    tenant_id: tenantId!,
    email: editor.email,
    scopes: ['docs:read', 'docs:write'],
  });
  console.log(jwt);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
