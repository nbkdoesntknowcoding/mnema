import { eq, desc } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { docVersions, docs, users, workspaceMembers, workspaces } from '../db/schema.js';
import { signJwt } from '../lib/jwt.js';
import { authPlugin } from '../plugins/auth.js';
import { docVersionsRoutes } from '../routes/doc-versions.js';

/**
 * Phase 4.2 — doc-versions coverage.
 *
 * Restore goes through writeMarkdownIntoLiveDoc which makes an IPC call to
 * the collab process. In test there's no collab process listening, so the
 * fetch fails and the route correctly falls through to writing the docs row
 * directly. That fallback is what these tests cover — the live-writeback
 * path is exercised by the round-trip suite.
 */

let stamp: number;
let tenantAId: string;
let tenantBId: string;
let ownerId: string;
let editorId: string;
let viewerId: string;
let strangerId: string;
let docAId: string;
let docBId: string;
let editorJwt: string;
let viewerJwt: string;
let strangerJwt: string;
let app: Awaited<ReturnType<typeof buildApp>>;

async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const f = Fastify({ logger: false });
  await f.register(authPlugin);
  await f.register(docVersionsRoutes);
  await f.ready();
  return f;
}

async function mintJwt(userId: string, tenantId: string, email: string): Promise<string> {
  return signJwt({ sub: userId, tenant_id: tenantId, email, scopes: ['docs:read'] });
}

function cookieHeader(jwt: string): { cookie: string } {
  return { cookie: `boppl_jwt=${jwt}` };
}

beforeAll(async () => {
  stamp = Date.now();

  const [wsA] = await db
    .insert(workspaces)
    .values({ slug: `ver-a-${stamp}`, name: 'Versions Test A' })
    .returning();
  const [wsB] = await db
    .insert(workspaces)
    .values({ slug: `ver-b-${stamp + 1}`, name: 'Versions Test B' })
    .returning();
  tenantAId = wsA!.id;
  tenantBId = wsB!.id;

  const [u1] = await db
    .insert(users)
    .values({ email: `ver-owner-${stamp}@boppl.test`, displayName: 'Owner' })
    .returning();
  const [u2] = await db
    .insert(users)
    .values({ email: `ver-editor-${stamp}@boppl.test`, displayName: 'Editor' })
    .returning();
  const [u3] = await db
    .insert(users)
    .values({ email: `ver-viewer-${stamp}@boppl.test`, displayName: 'Viewer' })
    .returning();
  const [u4] = await db
    .insert(users)
    .values({ email: `ver-stranger-${stamp}@boppl.test`, displayName: 'Stranger' })
    .returning();
  ownerId = u1!.id;
  editorId = u2!.id;
  viewerId = u3!.id;
  strangerId = u4!.id;

  await db.insert(workspaceMembers).values([
    { workspaceId: tenantAId, userId: ownerId, role: 'owner' },
    { workspaceId: tenantAId, userId: editorId, role: 'editor' },
    { workspaceId: tenantAId, userId: viewerId, role: 'viewer' },
    { workspaceId: tenantBId, userId: strangerId, role: 'owner' },
  ]);

  const [dA] = await db
    .insert(docs)
    .values({
      workspaceId: tenantAId,
      path: `ver-doc-a-${stamp}.md`,
      title: 'Doc A',
      markdown: '# Initial\n\nFirst body.',
      yjsState: new Uint8Array(0),
      createdBy: ownerId,
    })
    .returning();
  const [dB] = await db
    .insert(docs)
    .values({
      workspaceId: tenantBId,
      path: `ver-doc-b-${stamp}.md`,
      title: 'Doc B',
      markdown: 'B contents',
      yjsState: new Uint8Array(0),
      createdBy: strangerId,
    })
    .returning();
  docAId = dA!.id;
  docBId = dB!.id;

  // owner role is set up via workspaceMembers above so the route's role
  // checks see a proper owner exists; we don't need an owner JWT for any
  // of the version assertions (everything tests against editor / viewer).
  editorJwt = await mintJwt(editorId, tenantAId, `ver-editor-${stamp}@boppl.test`);
  viewerJwt = await mintJwt(viewerId, tenantAId, `ver-viewer-${stamp}@boppl.test`);
  strangerJwt = await mintJwt(strangerId, tenantBId, `ver-stranger-${stamp}@boppl.test`);

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await db.delete(workspaces).where(eq(workspaces.id, tenantAId));
  await db.delete(workspaces).where(eq(workspaces.id, tenantBId));
});

describe('POST /api/doc-versions — manual snapshot', () => {
  it('editor can save a named version', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/doc-versions',
      headers: cookieHeader(editorJwt),
      payload: { doc_id: docAId, comment: 'Before refactor' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      version: { version: number; comment: string; author_id: string };
    };
    expect(body.version.version).toBeGreaterThanOrEqual(1);
    expect(body.version.comment).toBe('Before refactor');
    expect(body.version.author_id).toBe(editorId);
  });

  it('viewer CANNOT save a version (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/doc-versions',
      headers: cookieHeader(viewerJwt),
      payload: { doc_id: docAId, comment: 'nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('saving a version on a cross-tenant doc returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/doc-versions',
      headers: cookieHeader(editorJwt),
      payload: { doc_id: docBId, comment: 'cross' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/doc-versions — list', () => {
  it('lists versions newest first', async () => {
    // Save two more so we definitely have ordering to check.
    await app.inject({
      method: 'POST',
      url: '/api/doc-versions',
      headers: cookieHeader(editorJwt),
      payload: { doc_id: docAId, comment: 'second snapshot' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/doc-versions',
      headers: cookieHeader(editorJwt),
      payload: { doc_id: docAId, comment: 'third snapshot' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/doc-versions?doc_id=${docAId}`,
      headers: cookieHeader(viewerJwt),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { versions: Array<{ version: number; comment: string }> };
    expect(body.versions.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < body.versions.length; i++) {
      expect(body.versions[i - 1]!.version).toBeGreaterThan(body.versions[i]!.version);
    }
  });

  it('cross-tenant doc returns 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/doc-versions?doc_id=${docBId}`,
      headers: cookieHeader(editorJwt),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/doc-versions/diff', () => {
  it('returns add/remove/context chunks between a saved version and current', async () => {
    // 1. Snapshot current state.
    const snap = await app.inject({
      method: 'POST',
      url: '/api/doc-versions',
      headers: cookieHeader(editorJwt),
      payload: { doc_id: docAId, comment: 'pre-diff snapshot' },
    });
    const versionNum = (snap.json() as { version: { version: number } }).version.version;

    // 2. Mutate the live docs.markdown directly (the route layer would do
    //    this via collab; for the diff test we simulate the result).
    await db
      .update(docs)
      .set({ markdown: '# Initial\n\nFirst body.\n\nNEW LINE INSERTED' })
      .where(eq(docs.id, docAId));

    // 3. Diff.
    const res = await app.inject({
      method: 'GET',
      url: `/api/doc-versions/diff?doc_id=${docAId}&version=${versionNum}`,
      headers: cookieHeader(viewerJwt),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      diff: Array<{ type: 'add' | 'remove' | 'context'; text: string }>;
    };
    expect(body.diff.some((c) => c.type === 'add' && c.text.includes('NEW LINE'))).toBe(true);
  });

  it('diff for a missing version returns 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/doc-versions/diff?doc_id=${docAId}&version=99999`,
      headers: cookieHeader(viewerJwt),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/doc-versions/restore', () => {
  it('editor restore rewrites the docs row and creates a recovery snapshot', async () => {
    // Reset the doc markdown deterministically.
    await db
      .update(docs)
      .set({ markdown: '# Reset\n\nState before restore.' })
      .where(eq(docs.id, docAId));

    // Snapshot the known state.
    const snap = await app.inject({
      method: 'POST',
      url: '/api/doc-versions',
      headers: cookieHeader(editorJwt),
      payload: { doc_id: docAId, comment: 'restore-target' },
    });
    const targetVersion = (snap.json() as { version: { version: number } }).version.version;

    // Drift away from the snapshot.
    await db
      .update(docs)
      .set({ markdown: 'completely different content' })
      .where(eq(docs.id, docAId));

    // Restore — no live collab session in tests, so the route falls through
    // to writing the docs row directly.
    const res = await app.inject({
      method: 'POST',
      url: '/api/doc-versions/restore',
      headers: cookieHeader(editorJwt),
      payload: { doc_id: docAId, version: targetVersion },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { restored: boolean; wrote_to_live_doc: boolean };
    expect(body.restored).toBe(true);
    expect(body.wrote_to_live_doc).toBe(false);

    // Verify the docs.markdown matches the snapshot we restored to.
    const rows = await db.select({ md: docs.markdown }).from(docs).where(eq(docs.id, docAId));
    expect(rows[0]!.md).toBe('# Reset\n\nState before restore.');

    // Verify the auto-snapshot landed with the right comment.
    const ver = await db
      .select({ comment: docVersions.comment })
      .from(docVersions)
      .where(eq(docVersions.docId, docAId))
      .orderBy(desc(docVersions.version))
      .limit(1);
    expect(ver[0]!.comment).toBe(`Restored to version ${targetVersion}`);
  });

  it('viewer CANNOT restore (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/doc-versions/restore',
      headers: cookieHeader(viewerJwt),
      payload: { doc_id: docAId, version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('restoring a missing version returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/doc-versions/restore',
      headers: cookieHeader(editorJwt),
      payload: { doc_id: docAId, version: 99999 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cross-tenant restore is invisible (404)', async () => {
    // stranger lives in B; tries to restore A's doc.
    const res = await app.inject({
      method: 'POST',
      url: '/api/doc-versions/restore',
      headers: cookieHeader(strangerJwt),
      payload: { doc_id: docAId, version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});
