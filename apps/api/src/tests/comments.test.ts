import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import {
  commentThreads,
  comments,
  docs,
  users,
  workspaceMembers,
  workspaces,
} from '../db/schema.js';
import { signJwt } from '../lib/jwt.js';
import { authPlugin } from '../plugins/auth.js';
import { commentsRoutes } from '../routes/comments.js';

/**
 * Phase 4.2 — comment_threads + comments coverage.
 *
 * Same `app.inject()` pattern as invitations.test. Fixtures: workspace A
 * with owner / editor / viewer, plus workspace B with a stranger for the
 * cross-tenant RLS check. One doc in A, one doc in B. Anchors are arbitrary
 * bytes (the server doesn't interpret them).
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
let ownerJwt: string;
let editorJwt: string;
let viewerJwt: string;
let strangerJwt: string;
let app: Awaited<ReturnType<typeof buildApp>>;

async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const f = Fastify({ logger: false });
  await f.register(authPlugin);
  await f.register(commentsRoutes);
  await f.ready();
  return f;
}

async function mintJwt(userId: string, tenantId: string, email: string): Promise<string> {
  return signJwt({ sub: userId, tenant_id: tenantId, email, scopes: ['docs:read'] });
}

function cookieHeader(jwt: string): { cookie: string } {
  return { cookie: `boppl_jwt=${jwt}` };
}

const ANCHOR_A = Buffer.from(new Uint8Array([1, 2, 3, 4, 5])).toString('base64');
const ANCHOR_B = Buffer.from(new Uint8Array([9, 8, 7, 6, 5])).toString('base64');

beforeAll(async () => {
  stamp = Date.now();

  const [wsA] = await db
    .insert(workspaces)
    .values({ slug: `cmt-a-${stamp}`, name: 'Comments Test A' })
    .returning();
  const [wsB] = await db
    .insert(workspaces)
    .values({ slug: `cmt-b-${stamp + 1}`, name: 'Comments Test B' })
    .returning();
  tenantAId = wsA!.id;
  tenantBId = wsB!.id;

  const [u1] = await db
    .insert(users)
    .values({ email: `cmt-owner-${stamp}@boppl.test`, displayName: 'Owner' })
    .returning();
  const [u2] = await db
    .insert(users)
    .values({ email: `cmt-editor-${stamp}@boppl.test`, displayName: 'Editor' })
    .returning();
  const [u3] = await db
    .insert(users)
    .values({ email: `cmt-viewer-${stamp}@boppl.test`, displayName: 'Viewer' })
    .returning();
  const [u4] = await db
    .insert(users)
    .values({ email: `cmt-stranger-${stamp}@boppl.test`, displayName: 'Stranger' })
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

  // Docs live behind RLS, so we insert them directly via the privileged db
  // handle (the test runner is connected as the superuser; the route layer
  // uses withTenant which drops to app_user). The yjs_state is a zero-byte
  // placeholder — comments don't read it.
  const [dA] = await db
    .insert(docs)
    .values({
      workspaceId: tenantAId,
      path: `cmt-doc-a-${stamp}.md`,
      title: 'Doc A',
      markdown: '# Hello\n\nWorld',
      yjsState: new Uint8Array(0),
      createdBy: ownerId,
    })
    .returning();
  const [dB] = await db
    .insert(docs)
    .values({
      workspaceId: tenantBId,
      path: `cmt-doc-b-${stamp}.md`,
      title: 'Doc B',
      markdown: 'B contents',
      yjsState: new Uint8Array(0),
      createdBy: strangerId,
    })
    .returning();
  docAId = dA!.id;
  docBId = dB!.id;

  ownerJwt = await mintJwt(ownerId, tenantAId, `cmt-owner-${stamp}@boppl.test`);
  editorJwt = await mintJwt(editorId, tenantAId, `cmt-editor-${stamp}@boppl.test`);
  viewerJwt = await mintJwt(viewerId, tenantAId, `cmt-viewer-${stamp}@boppl.test`);
  strangerJwt = await mintJwt(strangerId, tenantBId, `cmt-stranger-${stamp}@boppl.test`);

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await db.delete(workspaces).where(eq(workspaces.id, tenantAId));
  await db.delete(workspaces).where(eq(workspaces.id, tenantBId));
});

describe('POST /api/comment-threads — create', () => {
  it('editor can create a thread with an initial comment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(editorJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'Looks great',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      thread: {
        id: string;
        anchor_start: string;
        anchor_end: string;
        resolved: boolean;
        comments: Array<{ body: string; author_id: string }>;
      };
    };
    expect(body.thread.anchor_start).toBe(ANCHOR_A);
    expect(body.thread.anchor_end).toBe(ANCHOR_B);
    expect(body.thread.resolved).toBe(false);
    expect(body.thread.comments).toHaveLength(1);
    expect(body.thread.comments[0]!.body).toBe('Looks great');
    expect(body.thread.comments[0]!.author_id).toBe(editorId);
  });

  it('owner can create a thread', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(ownerJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'Owner note',
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('viewer CANNOT create a thread (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(viewerJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'nope',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects cross-tenant doc_id (404 doc_not_found)', async () => {
    // editor of A tries to comment on a doc that lives in B
    const res = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(editorJwt),
      payload: {
        doc_id: docBId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'cross-tenant probe',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects unauthenticated request (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'no auth',
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/comments — reply', () => {
  let threadId: string;
  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(editorJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'Top-level',
      },
    });
    const body = res.json() as { thread: { id: string } };
    threadId = body.thread.id;
  });

  it('owner can reply on an editor-created thread', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers: cookieHeader(ownerJwt),
      payload: { thread_id: threadId, body: 'Reply from owner' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { comment: { body: string; author_id: string } };
    expect(body.comment.body).toBe('Reply from owner');
    expect(body.comment.author_id).toBe(ownerId);
  });

  it('viewer CANNOT reply (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers: cookieHeader(viewerJwt),
      payload: { thread_id: threadId, body: 'viewer reply' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('cross-tenant thread_id is invisible (404 thread_not_found)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers: cookieHeader(strangerJwt), // tenant B — can't see tenant A's thread
      payload: { thread_id: threadId, body: 'cross-tenant reply' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/comment-threads — list', () => {
  it('returns threads ordered by created_at, with their comments inlined', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/comment-threads?doc_id=${docAId}`,
      headers: cookieHeader(viewerJwt),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      threads: Array<{ id: string; resolved: boolean; comments: Array<{ body: string }> }>;
    };
    expect(body.threads.length).toBeGreaterThan(0);
    for (const t of body.threads) {
      expect(t.resolved).toBe(false); // default filter
      expect(t.comments.length).toBeGreaterThan(0);
    }
  });

  it('cross-tenant doc returns empty (RLS hides threads)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/comment-threads?doc_id=${docAId}`,
      headers: cookieHeader(strangerJwt),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { threads: unknown[] };
    expect(body.threads).toHaveLength(0);
  });

  it('include_resolved=true returns resolved threads too', async () => {
    // Create a thread and resolve it, then verify it appears with the flag.
    const create = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(editorJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'will be resolved',
      },
    });
    const tid = (create.json() as { thread: { id: string } }).thread.id;
    await app.inject({
      method: 'PATCH',
      url: `/api/comment-threads/${tid}`,
      headers: cookieHeader(editorJwt),
      payload: { resolved: true },
    });

    const withoutResolved = await app.inject({
      method: 'GET',
      url: `/api/comment-threads?doc_id=${docAId}`,
      headers: cookieHeader(viewerJwt),
    });
    const withResolved = await app.inject({
      method: 'GET',
      url: `/api/comment-threads?doc_id=${docAId}&include_resolved=true`,
      headers: cookieHeader(viewerJwt),
    });

    const idsWithout = (withoutResolved.json() as { threads: Array<{ id: string }> }).threads.map(
      (t) => t.id,
    );
    const idsWith = (withResolved.json() as { threads: Array<{ id: string }> }).threads.map(
      (t) => t.id,
    );
    expect(idsWithout).not.toContain(tid);
    expect(idsWith).toContain(tid);
  });
});

describe('PATCH /api/comment-threads/:id — resolve / unresolve', () => {
  let threadId: string;
  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(editorJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'resolvable',
      },
    });
    threadId = (res.json() as { thread: { id: string } }).thread.id;
  });

  it('editor can resolve and unresolve', async () => {
    const resolve = await app.inject({
      method: 'PATCH',
      url: `/api/comment-threads/${threadId}`,
      headers: cookieHeader(editorJwt),
      payload: { resolved: true },
    });
    expect(resolve.statusCode).toBe(200);
    const r = resolve.json() as {
      thread: { resolved: boolean; resolved_by: string | null; resolved_at: string | null };
    };
    expect(r.thread.resolved).toBe(true);
    expect(r.thread.resolved_by).toBe(editorId);
    expect(r.thread.resolved_at).not.toBeNull();

    const unresolve = await app.inject({
      method: 'PATCH',
      url: `/api/comment-threads/${threadId}`,
      headers: cookieHeader(editorJwt),
      payload: { resolved: false },
    });
    expect(unresolve.statusCode).toBe(200);
    const u = unresolve.json() as {
      thread: { resolved: boolean; resolved_by: string | null; resolved_at: string | null };
    };
    expect(u.thread.resolved).toBe(false);
    expect(u.thread.resolved_by).toBeNull();
    expect(u.thread.resolved_at).toBeNull();
  });

  it('viewer CANNOT resolve (403)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/comment-threads/${threadId}`,
      headers: cookieHeader(viewerJwt),
      payload: { resolved: true },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /api/comments/:id', () => {
  it('author can delete their own comment', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(editorJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'self-delete',
      },
    });
    const cid = (create.json() as { thread: { comments: Array<{ id: string }> } }).thread
      .comments[0]!.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/comments/${cid}`,
      headers: cookieHeader(editorJwt),
    });
    expect(del.statusCode).toBe(200);
  });

  it('non-author editor CANNOT delete another editor\'s comment (403)', async () => {
    // Owner posts a top-level comment; another editor (the one above) tries to delete it.
    const create = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(ownerJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'owner-authored',
      },
    });
    const cid = (create.json() as { thread: { comments: Array<{ id: string }> } }).thread
      .comments[0]!.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/comments/${cid}`,
      headers: cookieHeader(editorJwt),
    });
    expect(del.statusCode).toBe(403);
  });

  it('owner can delete any comment', async () => {
    // Editor posts; owner deletes.
    const create = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(editorJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'owner-will-delete',
      },
    });
    const cid = (create.json() as { thread: { comments: Array<{ id: string }> } }).thread
      .comments[0]!.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/comments/${cid}`,
      headers: cookieHeader(ownerJwt),
    });
    expect(del.statusCode).toBe(200);
  });

  it('deleting the last comment in a thread also deletes the thread', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(editorJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'lonely',
      },
    });
    const created = create.json() as { thread: { id: string; comments: Array<{ id: string }> } };
    const tid = created.thread.id;
    const cid = created.thread.comments[0]!.id;

    await app.inject({
      method: 'DELETE',
      url: `/api/comments/${cid}`,
      headers: cookieHeader(editorJwt),
    });

    // Thread should be gone (cascade-style cleanup at the route level).
    const list = await app.inject({
      method: 'GET',
      url: `/api/comment-threads?doc_id=${docAId}&include_resolved=true`,
      headers: cookieHeader(editorJwt),
    });
    const ids = (list.json() as { threads: Array<{ id: string }> }).threads.map((t) => t.id);
    expect(ids).not.toContain(tid);

    // Belt and suspenders: query the DB directly through the privileged
    // connection to make sure the row is really gone, not just RLS-hidden.
    const rows = await db
      .select({ id: commentThreads.id })
      .from(commentThreads)
      .where(eq(commentThreads.id, tid));
    expect(rows).toHaveLength(0);
  });

  it('deleting one of several comments leaves the thread intact', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/comment-threads',
      headers: cookieHeader(editorJwt),
      payload: {
        doc_id: docAId,
        anchor_start: ANCHOR_A,
        anchor_end: ANCHOR_B,
        body: 'first',
      },
    });
    const tid = (create.json() as { thread: { id: string } }).thread.id;
    const reply = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers: cookieHeader(editorJwt),
      payload: { thread_id: tid, body: 'second' },
    });
    const replyId = (reply.json() as { comment: { id: string } }).comment.id;

    await app.inject({
      method: 'DELETE',
      url: `/api/comments/${replyId}`,
      headers: cookieHeader(editorJwt),
    });

    const remaining = await db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.threadId, tid));
    expect(remaining).toHaveLength(1); // the original "first" still there
  });
});
