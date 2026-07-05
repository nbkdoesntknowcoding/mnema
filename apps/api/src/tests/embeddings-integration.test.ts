import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { docs, embeddings, users, workspaceMembers, workspaces } from '../db/schema.js';
import { processEmbeddingJob } from '../workers/embeddings/job.js';

/**
 * End-to-end embedding pipeline test, MOCKED at the Voyage boundary.
 *
 * The Voyage call itself is mocked (random vectors of the right dim) so
 * CI never burns real Voyage tokens. Everything ELSE is real: chunker,
 * Drizzle inserts, RLS, idempotency check by content_hash, delete-then-
 * insert on hash change.
 *
 * Tests in this file run in declaration order (Vitest's default for a
 * single describe block) — the idempotent / new-content / stale-job tests
 * deliberately depend on state established by the first test.
 */

vi.mock('../workers/embeddings/voyage.js', () => ({
  embedBatch: vi.fn(async ({ texts }: { texts: string[] }) => ({
    vectors: texts.map(() =>
      Array.from({ length: config.EMBEDDING_DIM }, () => Math.random()),
    ),
    totalTokens: texts.reduce((sum, t) => sum + t.length, 0),
  })),
}));

const emptyYjsState = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

let tenantId: string;
let userId: string;
let docId: string;

beforeAll(async () => {
  const stamp = Date.now();
  const [ws] = await db
    .insert(workspaces)
    .values({ slug: `emb-${stamp}`, name: 'Embeddings test' })
    .returning();
  if (!ws) throw new Error('Failed to create workspace');
  tenantId = ws.id;

  const [u] = await db
    .insert(users)
    .values({ email: `emb-${stamp}@boppl.test`, displayName: 'E' })
    .returning();
  if (!u) throw new Error('Failed to create user');
  userId = u.id;
  await db.insert(workspaceMembers).values({ workspaceId: tenantId, userId, role: 'owner' });

  const seedMarkdown = `# Test Doc

## Section One

Some content for section one.

## Section Two

More content for section two.
`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    const [d] = await tx
      .insert(docs)
      .values({
        workspaceId: tenantId,
        path: 'emb.md',
        title: 'Embeddings test',
        markdown: seedMarkdown,
        yjsState: emptyYjsState,
        contentHash: 'hash-v1',
        createdBy: userId,
      })
      .returning();
    if (!d) throw new Error('Failed to seed doc');
    docId = d.id;
  });
});

afterAll(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, tenantId));
});

async function readEmbeddingRows(): Promise<
  Array<{ contentHash: string; headingPath: string | null; embedding: unknown }>
> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return await tx
      .select({
        contentHash: embeddings.contentHash,
        headingPath: embeddings.headingPath,
        embedding: embeddings.embedding,
      })
      .from(embeddings)
      .where(eq(embeddings.docId, docId));
  });
}

describe('embeddings job', () => {
  it('produces chunks with heading paths and writes to embeddings table', async () => {
    const result = await processEmbeddingJob({
      doc_id: docId,
      tenant_id: tenantId,
      content_hash: 'hash-v1',
    });
    expect(result.skipped).toBe(false);
    expect(result.chunks).toBeGreaterThan(0);

    const rows = await readEmbeddingRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.contentHash).toBe('hash-v1');
      expect(r.embedding).toBeTruthy();
    }

    const hasOne = rows.some((r) => r.headingPath === 'Test Doc > Section One');
    const hasTwo = rows.some((r) => r.headingPath === 'Test Doc > Section Two');
    expect(hasOne).toBe(true);
    expect(hasTwo).toBe(true);
  });

  it('idempotent — running the same job twice does not duplicate rows', async () => {
    const before = (await readEmbeddingRows()).length;
    const result = await processEmbeddingJob({
      doc_id: docId,
      tenant_id: tenantId,
      content_hash: 'hash-v1',
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_embedded');
    const after = (await readEmbeddingRows()).length;
    expect(after).toBe(before);
  });

  it('new content_hash replaces all existing rows (delete-then-insert)', async () => {
    // Bump the doc's content + hash.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      await tx
        .update(docs)
        .set({
          markdown:
            '# Test Doc v2\n\n## Section Alpha\n\nNew content alpha.\n\n## Section Beta\n\nNew content beta.\n',
          contentHash: 'hash-v2',
        })
        .where(eq(docs.id, docId));
    });

    const result = await processEmbeddingJob({
      doc_id: docId,
      tenant_id: tenantId,
      content_hash: 'hash-v2',
    });
    expect(result.skipped).toBe(false);

    const rows = await readEmbeddingRows();
    // Every row now belongs to v2; no v1 ghosts left over.
    for (const r of rows) {
      expect(r.contentHash).toBe('hash-v2');
    }
    const hasAlpha = rows.some((r) => r.headingPath?.includes('Section Alpha'));
    expect(hasAlpha).toBe(true);
    // The old "Section One" should be gone — sanity check on full replacement.
    const hasOldOne = rows.some((r) => r.headingPath?.includes('Section One'));
    expect(hasOldOne).toBe(false);
  });

  it('skips when job content_hash is stale (doc has moved on)', async () => {
    // Doc is now at v3, but a stale v2 job arrives.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      await tx.update(docs).set({ contentHash: 'hash-v3' }).where(eq(docs.id, docId));
    });

    const result = await processEmbeddingJob({
      doc_id: docId,
      tenant_id: tenantId,
      content_hash: 'hash-v2',
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('stale_job');
  });
});
