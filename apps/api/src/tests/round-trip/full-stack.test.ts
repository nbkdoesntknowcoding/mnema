import { markdownToYjsState, yjsStateToMarkdown } from '@boppl/schema/node';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ConnectionContext } from '../../collab/auth.js';
import { storeDocumentState } from '../../collab/persistence.js';
import { db } from '../../db/index.js';
import { docs, users, workspaceMembers, workspaces } from '../../db/schema.js';

/**
 * Full-stack round-trip: exercise the SAME persistence code path the
 * Hocuspocus collab process uses (storeDocumentState), against a real
 * Postgres, and assert the resulting `docs.markdown` is byte-identical to
 * what `yjsStateToMarkdown` produces from the Y.Doc standalone.
 *
 * This catches integration-level drift — e.g., a bug where storeDocumentState
 * serializes via a different code path than the round-trip unit tests.
 *
 * We don't spin up a real Hocuspocus + WSS client here. The 1.1 prompt's
 * Node-bound HocuspocusProvider has flaky handshake behaviour we already
 * documented. The persistence path IS the integration we care about; the
 * websocket transport is exercised by the live editor in browser smoke.
 */

let workspaceId: string;
let userId: string;
let docId: string;
let ctx: ConnectionContext;

beforeAll(async () => {
  const stamp = Date.now();
  const [ws] = await db
    .insert(workspaces)
    .values({ slug: `test-rt-fs-${stamp}`, name: 'RT FS' })
    .returning();
  workspaceId = ws!.id;

  const [u] = await db
    .insert(users)
    .values({ email: `rt-fs-${stamp}@boppl.test`, displayName: 'RT FS' })
    .returning();
  userId = u!.id;

  await db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });

  const seedYjsState = await markdownToYjsState('# Seed\n\nA paragraph.\n');
  const insertedDoc = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${workspaceId}, true)`);
    return await tx
      .insert(docs)
      .values({
        workspaceId,
        path: `rt-fs-${stamp}.md`,
        title: 'RT FS',
        markdown: '# Seed\n\nA paragraph.\n',
        yjsState: Buffer.from(seedYjsState),
        contentHash: '',
        createdBy: userId,
      })
      .returning();
  });
  docId = insertedDoc[0]!.id;

  ctx = {
    user_id: userId,
    tenant_id: workspaceId,
    email: `rt-fs-${stamp}@boppl.test`,
    doc_id: docId,
  };
});

afterAll(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
});

describe('full-stack round-trip', () => {
  it('storeDocumentState writes markdown byte-identical to yjsStateToMarkdown', async () => {
    // Build a fresh Y.Doc with rich content via the schema bridge.
    const newMarkdown =
      '# After edit\n\nThis paragraph replaces the seed content.\n\n- one\n- two\n- three\n\nInline math: $E = mc^2$\n';
    const newState = await markdownToYjsState(newMarkdown);
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, newState);

    // Run the EXACT path Hocuspocus's onStoreDocument hook runs.
    const result = await storeDocumentState(ctx, ydoc);
    expect(result.contentChanged).toBe(true);

    // Fetch the row directly under RLS scoping.
    const dbRow = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${workspaceId}, true)`);
      const rows = await tx
        .select({ md: docs.markdown, hash: docs.contentHash })
        .from(docs)
        .where(eq(docs.id, docId))
        .limit(1);
      return rows[0];
    });

    // The DB markdown MUST equal what the standalone helper produces from
    // the same Y.Doc — proves the persistence path uses the same serializer.
    const expected = await yjsStateToMarkdown(Y.encodeStateAsUpdate(ydoc));
    expect(dbRow?.md).toBe(expected);
    expect(dbRow?.md).toContain('After edit');
    expect(dbRow?.hash).toBeTruthy();

    // Second store with no content change: contentChanged should be false.
    const result2 = await storeDocumentState(ctx, ydoc);
    expect(result2.contentChanged).toBe(false);
  });

  it('round-trip after store: re-loading yjs_state and serializing yields the same markdown', async () => {
    const dbRow = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${workspaceId}, true)`);
      const rows = await tx
        .select({ md: docs.markdown, yjs: docs.yjsState })
        .from(docs)
        .where(eq(docs.id, docId))
        .limit(1);
      return rows[0];
    });
    expect(dbRow).toBeDefined();
    const md = await yjsStateToMarkdown(new Uint8Array(dbRow!.yjs as Buffer));
    expect(md).toBe(dbRow!.md);
  });
});
