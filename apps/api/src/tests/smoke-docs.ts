/**
 * One-off smoke test for the docs API. Seeds two tenants + users, mints JWTs,
 * runs list/create/get/save against /api/docs, and verifies cross-tenant 404.
 *
 * Run via: pnpm --filter @boppl/api exec tsx src/tests/smoke-docs.ts
 *
 * Cleans up its own seeded rows on the way out.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { signJwt } from '../lib/jwt.js';
import { users, workspaceMembers, workspaces } from '../db/schema.js';

const API = 'http://localhost:8080';

async function jwtFor(userId: string, tenantId: string, email: string): Promise<string> {
  return signJwt({
    sub: userId,
    tenant_id: tenantId,
    email,
    scopes: ['docs:read', 'docs:write'],
  });
}

async function main(): Promise<void> {
  const stamp = Date.now();
  console.log('Seeding two tenants...');
  const [wa] = await db
    .insert(workspaces)
    .values({ slug: `smoke-a-${stamp}`, name: 'Smoke A' })
    .returning();
  const [wb] = await db
    .insert(workspaces)
    .values({ slug: `smoke-b-${stamp + 1}`, name: 'Smoke B' })
    .returning();
  const [ua] = await db
    .insert(users)
    .values({ email: `smoke-a-${stamp}@test.local`, displayName: 'Smoke A' })
    .returning();
  const [ub] = await db
    .insert(users)
    .values({ email: `smoke-b-${stamp + 1}@test.local`, displayName: 'Smoke B' })
    .returning();
  if (!wa || !wb || !ua || !ub) throw new Error('Seed failed');
  await db.insert(workspaceMembers).values({ workspaceId: wa.id, userId: ua.id, role: 'owner' });
  await db.insert(workspaceMembers).values({ workspaceId: wb.id, userId: ub.id, role: 'owner' });

  const tokenA = await jwtFor(ua.id, wa.id, ua.email);
  const tokenB = await jwtFor(ub.id, wb.id, ub.email);

  const headersA = {
    Cookie: `boppl_jwt=${tokenA}`,
    'Content-Type': 'application/json',
  };
  const headersB = {
    Cookie: `boppl_jwt=${tokenB}`,
    'Content-Type': 'application/json',
  };

  let pass = 0;
  let fail = 0;
  function check(label: string, ok: boolean, detail?: string): void {
    if (ok) {
      console.log(`  ✓ ${label}`);
      pass += 1;
    } else {
      console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
      fail += 1;
    }
  }

  console.log('\nTenant A — list (expect empty)');
  let r = await fetch(`${API}/api/docs`, { headers: headersA });
  check('200', r.status === 200, `got ${r.status}`);
  let body = (await r.json()) as { docs: unknown[] };
  check('zero docs initially', body.docs.length === 0);

  console.log('\nTenant A — create');
  r = await fetch(`${API}/api/docs`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ title: 'Smoke doc', markdown: '# Hello\n\nSome **bold** text.' }),
  });
  check('201', r.status === 201, `got ${r.status}`);
  const created = (await r.json()) as { doc: { id: string; title: string; markdown: string } };
  check('returned id', typeof created.doc.id === 'string');
  check('title preserved', created.doc.title === 'Smoke doc');
  check('markdown preserved', created.doc.markdown.startsWith('# Hello'));
  const docId = created.doc.id;

  console.log('\nTenant A — get');
  r = await fetch(`${API}/api/docs/${docId}`, { headers: headersA });
  check('200', r.status === 200);
  const fetched = (await r.json()) as { doc: { markdown: string } };
  check('markdown round-trips', fetched.doc.markdown === '# Hello\n\nSome **bold** text.');

  console.log('\nTenant A — save (round-trip stress)');
  const stress = '# Round-trip\n\n- one\n- two\n\nMath: $a^2 + b^2 = c^2$.\n\n```ts\nconst x = 42;\n```\n';
  r = await fetch(`${API}/api/docs/${docId}`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ title: 'Round-trip', markdown: stress }),
  });
  check('200', r.status === 200);
  r = await fetch(`${API}/api/docs/${docId}`, { headers: headersA });
  const after = (await r.json()) as { doc: { markdown: string; title: string } };
  check('saved markdown is exact', after.doc.markdown === stress, JSON.stringify(after.doc.markdown).slice(0, 80));
  check('saved title is exact', after.doc.title === 'Round-trip');

  console.log('\nTenant B — cross-tenant 404 (the load-bearing check)');
  r = await fetch(`${API}/api/docs/${docId}`, { headers: headersB });
  check('404 (not 200)', r.status === 404, `got ${r.status} — RLS LEAK if 200`);

  console.log('\nTenant B — list (sees zero, not tenant A’s doc)');
  r = await fetch(`${API}/api/docs`, { headers: headersB });
  body = (await r.json()) as { docs: unknown[] };
  check('zero docs', body.docs.length === 0);

  console.log('\nNo cookie — 401');
  r = await fetch(`${API}/api/docs`);
  check('401', r.status === 401);

  console.log('\nBad UUID — 400');
  r = await fetch(`${API}/api/docs/not-a-uuid`, { headers: headersA });
  check('400', r.status === 400);

  console.log('\nCleanup...');
  await db.delete(workspaces).where(eq(workspaces.id, wa.id));
  await db.delete(workspaces).where(eq(workspaces.id, wb.id));
  await db.delete(users).where(eq(users.id, ua.id));
  await db.delete(users).where(eq(users.id, ub.id));

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
