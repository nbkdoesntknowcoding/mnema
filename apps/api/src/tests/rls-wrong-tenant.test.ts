import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { db } from '../db/index.js';
import { docs, workspaces } from '../db/schema.js';

const emptyYjsState = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

let tenantAId: string;
let tenantBId: string;
let tenantADocId: string;

/**
 * Helper: simulates the runtime path withTenant uses — drop to app_user, set
 * the tenant GUC, then run the query. RLS only engages once we've left the
 * superuser role.
 */
async function asTenant<T>(
  tenantId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return await fn(tx);
  });
}

beforeAll(async () => {
  const stamp = Date.now();
  const insertedA = await db
    .insert(workspaces)
    .values({ slug: `test-a-${stamp}`, name: 'Test Tenant A' })
    .returning();
  const insertedB = await db
    .insert(workspaces)
    .values({ slug: `test-b-${stamp + 1}`, name: 'Test Tenant B' })
    .returning();
  const a = insertedA[0];
  const b = insertedB[0];
  if (!a || !b) throw new Error('Failed to create test workspaces');
  tenantAId = a.id;
  tenantBId = b.id;

  // Seed tenant A's doc as that tenant (so RLS lets the insert through).
  await asTenant(tenantAId, async (tx) => {
    const inserted = await tx
      .insert(docs)
      .values({
        workspaceId: tenantAId,
        path: 'secret.md',
        title: 'Secret tenant A doc',
        markdown: 'tenant A only',
        yjsState: emptyYjsState,
      })
      .returning();
    const doc = inserted[0];
    if (!doc) throw new Error('Failed to seed tenant A doc');
    tenantADocId = doc.id;
  });
});

afterAll(async () => {
  // Cleanup runs as the owner (no SET ROLE), bypassing RLS.
  await db.delete(workspaces).where(eq(workspaces.id, tenantAId));
  await db.delete(workspaces).where(eq(workspaces.id, tenantBId));
});

describe('RLS — wrong tenant cannot see other tenant data', () => {
  it('Tenant B GUC cannot SELECT tenant A docs', async () => {
    const result = await asTenant(tenantBId, async (tx) => {
      return await tx.select().from(docs).where(eq(docs.id, tenantADocId));
    });
    expect(result.length).toBe(0);
  });

  it('Tenant B GUC cannot UPDATE tenant A docs', async () => {
    await asTenant(tenantBId, async (tx) => {
      const result = await tx
        .update(docs)
        .set({ title: 'hacked' })
        .where(eq(docs.id, tenantADocId))
        .returning();
      expect(result.length).toBe(0);
    });
  });

  it('Tenant B GUC cannot DELETE tenant A docs', async () => {
    await asTenant(tenantBId, async (tx) => {
      const result = await tx
        .delete(docs)
        .where(eq(docs.id, tenantADocId))
        .returning();
      expect(result.length).toBe(0);
    });
  });

  it('No GUC set returns zero rows (defensive)', async () => {
    const result = await db.transaction(async (tx) => {
      // Drop role but deliberately skip the set_config call.
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      return await tx.select().from(docs).where(eq(docs.id, tenantADocId));
    });
    expect(result.length).toBe(0);
  });

  it('Tenant A GUC CAN see its own doc (sanity check)', async () => {
    const result = await asTenant(tenantAId, async (tx) => {
      return await tx.select().from(docs).where(eq(docs.id, tenantADocId));
    });
    expect(result.length).toBe(1);
    expect(result[0]?.title).toBe('Secret tenant A doc');
  });
});
