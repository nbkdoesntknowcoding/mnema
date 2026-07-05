import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { db } from '../db/index.js';
import { docs, users, workspaceMembers, workspaces } from '../db/schema.js';
import type { McpAuthContext } from '../mcp/auth.js';
import { createMcpServer } from '../mcp/server.js';

/**
 * MCP-path tenant-isolation regression.
 *
 * Mirrors the existing rls-wrong-tenant.test.ts but exercises the SDK
 * dispatch path: instantiate createMcpServer(ctx), wire it through the
 * SDK's InMemoryTransport, and call the test-only `__test_probe_doc_count`
 * tool. Asserts that:
 *
 *   1. A token bound to tenant A sees only tenant A's docs.
 *   2. A token bound to tenant B sees only tenant B's docs.
 *   3. A FORGED context (user A, but tenant_id=B) reads tenant B because
 *      RLS scopes by GUC. This makes explicit that the trust root is the
 *      JWT signature check upstream — not the GUC itself.
 *   4. A tampered JWT is rejected by verifyMcpToken before any of this
 *      could happen at the route layer.
 *
 * No HTTP, no Hocuspocus, no Inspector — fast, deterministic, and exactly
 * the surface a tenant-leakage bug would crash through.
 */

const emptyYjsState = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

let tenantAId: string;
let tenantBId: string;
let userAId: string;
let userBId: string;

beforeAll(async () => {
  const stamp = Date.now();
  const [wsA] = await db
    .insert(workspaces)
    .values({ slug: `mcp-a-${stamp}`, name: 'MCP Test Tenant A' })
    .returning();
  const [wsB] = await db
    .insert(workspaces)
    .values({ slug: `mcp-b-${stamp + 1}`, name: 'MCP Test Tenant B' })
    .returning();
  if (!wsA || !wsB) throw new Error('Failed to create test workspaces');
  tenantAId = wsA.id;
  tenantBId = wsB.id;

  const [userA] = await db
    .insert(users)
    .values({ email: `mcp-a-${stamp}@boppl.test`, displayName: 'MCP A' })
    .returning();
  const [userB] = await db
    .insert(users)
    .values({ email: `mcp-b-${stamp + 1}@boppl.test`, displayName: 'MCP B' })
    .returning();
  if (!userA || !userB) throw new Error('Failed to create test users');
  userAId = userA.id;
  userBId = userB.id;

  await db.insert(workspaceMembers).values({
    workspaceId: tenantAId,
    userId: userAId,
    role: 'owner',
  });
  await db.insert(workspaceMembers).values({
    workspaceId: tenantBId,
    userId: userBId,
    role: 'owner',
  });

  // 3 docs in tenant A — inserted under that tenant's RLS GUC so the policy
  // accepts them.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantAId}, true)`);
    for (let i = 0; i < 3; i += 1) {
      await tx.insert(docs).values({
        workspaceId: tenantAId,
        path: `a-${i}.md`,
        title: `Tenant A doc ${i}`,
        markdown: `# A${i}`,
        yjsState: emptyYjsState,
      });
    }
  });

  // 5 docs in tenant B.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantBId}, true)`);
    for (let i = 0; i < 5; i += 1) {
      await tx.insert(docs).values({
        workspaceId: tenantBId,
        path: `b-${i}.md`,
        title: `Tenant B doc ${i}`,
        markdown: `# B${i}`,
        yjsState: emptyYjsState,
      });
    }
  });
});

afterAll(async () => {
  // Cleanup runs as the owner role (no SET ROLE), bypassing RLS.
  await db.delete(workspaces).where(eq(workspaces.id, tenantAId));
  await db.delete(workspaces).where(eq(workspaces.id, tenantBId));
});

interface ProbeResult {
  count: number;
}

/**
 * Build a Server + Client pair connected by InMemoryTransport, call the
 * test probe under the supplied context, then close both sides cleanly.
 */
async function callProbe(authCtx: McpAuthContext): Promise<ProbeResult> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server: McpServer = createMcpServer(authCtx);
  const client = new Client(
    { name: 'mcp-test-client', version: '0.0.0' },
    { capabilities: {} },
  );

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const tools = await client.listTools();
  const probe = tools.tools.find((t) => t.name === '__test_probe_doc_count');
  if (!probe) {
    await Promise.all([client.close(), server.close()]);
    throw new Error(
      'Probe not registered — check NODE_ENV=test (vitest sets this by default)',
    );
  }

  const result = await client.callTool({
    name: '__test_probe_doc_count',
    arguments: {},
  });

  await Promise.all([client.close(), server.close()]);

  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  const firstText =
    Array.isArray(content) && content[0]?.type === 'text' ? content[0].text ?? '' : '';
  return JSON.parse(firstText) as ProbeResult;
}

describe('MCP path — tenant isolation', () => {
  it('A token sees only A docs (3)', async () => {
    const ctx: McpAuthContext = {
      user_id: userAId,
      tenant_id: tenantAId,
      email: 'mcp-a@boppl.test',
      scopes: ['docs:read'],
      jwt_id: null,
    };
    const result = await callProbe(ctx);
    expect(result.count).toBe(3);
  });

  it('B token sees only B docs (5)', async () => {
    const ctx: McpAuthContext = {
      user_id: userBId,
      tenant_id: tenantBId,
      email: 'mcp-b@boppl.test',
      scopes: ['docs:read'],
      jwt_id: null,
    };
    const result = await callProbe(ctx);
    expect(result.count).toBe(5);
  });

  it('A user with B tenant_id swapped in still reads tenant B: GUC-bound trust depends on the upstream signature check', async () => {
    // Forged context: user A's id, but tenant_id=B. The probe returns 5
    // because RLS scopes by GUC, not by user. The defense against this in
    // production is the JWT signature check in plugin.ts — verified directly
    // in the next test.
    const ctx: McpAuthContext = {
      user_id: userAId,
      tenant_id: tenantBId,
      email: 'mcp-a@boppl.test',
      scopes: ['docs:read'],
      jwt_id: null,
    };
    const result = await callProbe(ctx);
    expect(result.count).toBe(5);
  });

  it('Tampered JWT is rejected at the route layer (signature mismatch)', async () => {
    const { verifyMcpToken, McpUnauthorizedError } = await import('../mcp/auth.js');
    const tamperedToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwgay-i.bad-signature';
    await expect(verifyMcpToken(tamperedToken)).rejects.toBeInstanceOf(
      McpUnauthorizedError,
    );
  });
});
