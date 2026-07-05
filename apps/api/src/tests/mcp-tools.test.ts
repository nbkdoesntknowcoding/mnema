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
 * Per-tool behavior + integration tests for the Phase 2.3 read tools.
 *
 * Same in-memory transport pattern the 2.2 wrong-tenant test established:
 * spin up createMcpServer(ctx), wire it through SDK InMemoryTransport,
 * call tools/list and tools/call directly. Fast (~200ms total), no HTTP.
 *
 * Three fixture docs:
 *   - architecture.md  — distinct headings ("Overview", "Setup", "Deployment")
 *   - pricing.md       — different content; one "Setup" heading
 *   - multi-setup.md   — TWO sibling "Setup" headings under different parents,
 *                        used to exercise the multiple_matches and breadcrumb
 *                        disambiguation branches of get_doc_section.
 */

const emptyYjsState = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

let tenantId: string;
let userId: string;
let docArchId: string;
let docPriceId: string;
let docMultiId: string;

const FIXTURE_ARCH = `# Architecture

## Overview

A brief overview of the system architecture.

## Setup

Steps to set up the development environment.

### Database

Run docker compose up to start Postgres.

### Redis

Redis runs alongside Postgres.

## Deployment

Phase D notes.
`;

const FIXTURE_PRICE = `# Pricing

## Tiers

Free, Pro, Team.

## Setup

Stripe configuration for the pricing flow.
`;

// Two siblings literally named "Setup" under distinct parents — the
// canonical case for forced breadcrumb disambiguation.
const FIXTURE_MULTI = `# Multiple Setups

## Service A

Intro for service A.

### Setup

Setup steps for Service A.

## Service B

Intro for service B.

### Setup

Setup steps for Service B.
`;

beforeAll(async () => {
  const stamp = Date.now();
  const [ws] = await db
    .insert(workspaces)
    .values({ slug: `mcp-tools-${stamp}`, name: 'MCP tools test' })
    .returning();
  if (!ws) throw new Error('Failed to create workspace');
  tenantId = ws.id;

  const [u] = await db
    .insert(users)
    .values({ email: `mcp-tools-${stamp}@boppl.test`, displayName: 'T' })
    .returning();
  if (!u) throw new Error('Failed to create user');
  userId = u.id;
  await db.insert(workspaceMembers).values({
    workspaceId: tenantId,
    userId,
    role: 'owner',
  });

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    const [d1] = await tx
      .insert(docs)
      .values({
        workspaceId: tenantId,
        path: 'architecture.md',
        title: 'Architecture',
        markdown: FIXTURE_ARCH,
        yjsState: emptyYjsState,
      })
      .returning();
    docArchId = d1!.id;

    const [d2] = await tx
      .insert(docs)
      .values({
        workspaceId: tenantId,
        path: 'pricing.md',
        title: 'Pricing',
        markdown: FIXTURE_PRICE,
        yjsState: emptyYjsState,
      })
      .returning();
    docPriceId = d2!.id;

    const [d3] = await tx
      .insert(docs)
      .values({
        workspaceId: tenantId,
        path: 'multi-setup.md',
        title: 'Multiple Setups',
        markdown: FIXTURE_MULTI,
        yjsState: emptyYjsState,
      })
      .returning();
    docMultiId = d3!.id;
  });
});

afterAll(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, tenantId));
});

interface ConnectedClient {
  client: Client;
  close: () => Promise<void>;
}

async function makeClient(scopes: string[] = ['docs:read']): Promise<ConnectedClient> {
  const ctx: McpAuthContext = {
    user_id: userId,
    tenant_id: tenantId,
    email: 'mcp-tools@boppl.test',
    scopes,
    jwt_id: null,
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server: McpServer = createMcpServer(ctx);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    close: async () => {
      await Promise.all([client.close(), server.close()]);
    },
  };
}

function readJson<T>(result: unknown): T {
  const r = result as { content: Array<{ type: string; text?: string }> };
  return JSON.parse(r.content[0]!.text!) as T;
}

describe('MCP tools', () => {
  it('list_docs returns all fixture docs ordered by updated_at desc', async () => {
    const { client, close } = await makeClient();
    const res = await client.callTool({ name: 'list_docs', arguments: {} });
    const body = readJson<{
      docs: Array<{ id: string; title: string }>;
      next_cursor: string | null;
    }>(res);
    expect(body.docs.length).toBe(3);
    expect(body.next_cursor).toBeNull();
    // The three fixture docs are present; we don't assert insertion-order
    // because they were all inserted in the same transaction with timestamp
    // resolution at the millisecond.
    const titles = body.docs.map((d) => d.title).sort();
    expect(titles).toEqual(['Architecture', 'Multiple Setups', 'Pricing']);
    await close();
  });

  it('list_docs paginates with stable cursor', async () => {
    const { client, close } = await makeClient();
    const first = readJson<{
      docs: Array<{ id: string }>;
      next_cursor: string | null;
    }>(await client.callTool({ name: 'list_docs', arguments: { limit: 1 } }));
    expect(first.docs.length).toBe(1);
    expect(first.next_cursor).not.toBeNull();

    const second = readJson<{
      docs: Array<{ id: string }>;
      next_cursor: string | null;
    }>(
      await client.callTool({
        name: 'list_docs',
        arguments: { limit: 1, cursor: first.next_cursor! },
      }),
    );
    expect(second.docs.length).toBe(1);
    expect(second.docs[0]!.id).not.toBe(first.docs[0]!.id);
    expect(second.next_cursor).not.toBeNull(); // one more page (3 docs, limit 1)
    await close();
  });

  it('get_doc by id returns full markdown', async () => {
    const { client, close } = await makeClient();
    const res = await client.callTool({
      name: 'get_doc',
      arguments: { id: docArchId },
    });
    const body = readJson<{ id: string; markdown: string }>(res);
    expect(body.id).toBe(docArchId);
    expect(body.markdown).toBe(FIXTURE_ARCH);
    await close();
  });

  it('get_doc by path returns full markdown', async () => {
    const { client, close } = await makeClient();
    const res = await client.callTool({
      name: 'get_doc',
      arguments: { path: 'pricing.md' },
    });
    const body = readJson<{ id: string; markdown: string }>(res);
    expect(body.id).toBe(docPriceId);
    expect(body.markdown).toBe(FIXTURE_PRICE);
    await close();
  });

  it('get_doc_section returns single when heading is unambiguous', async () => {
    const { client, close } = await makeClient();
    const res = await client.callTool({
      name: 'get_doc_section',
      arguments: { id: docArchId, heading: 'Overview' },
    });
    const body = readJson<{
      kind: string;
      heading_path: string;
      markdown: string;
    }>(res);
    expect(body.kind).toBe('single');
    // The H1 ("Architecture") is itself a heading and shows up in the breadcrumb.
    expect(body.heading_path).toBe('Architecture > Overview');
    expect(body.markdown).toContain('## Overview');
    expect(body.markdown).toContain('A brief overview');
    expect(body.markdown).not.toContain('## Setup');
    await close();
  });

  it('get_doc_section returns multiple_matches for ambiguous heading', async () => {
    const { client, close } = await makeClient();
    const res = await client.callTool({
      name: 'get_doc_section',
      arguments: { id: docMultiId, heading: 'Setup' },
    });
    const body = readJson<{
      kind: string;
      matches?: Array<{ heading_path: string; preview: string }>;
    }>(res);
    expect(body.kind).toBe('multiple_matches');
    expect(body.matches?.length).toBe(2);
    const paths = body.matches!.map((m) => m.heading_path).sort();
    expect(paths).toEqual([
      'Multiple Setups > Service A > Setup',
      'Multiple Setups > Service B > Setup',
    ]);
    // Previews are body text, not heading echoes.
    expect(body.matches!.every((m) => !m.preview.startsWith('#'))).toBe(true);
    await close();
  });

  it('get_doc_section disambiguates via breadcrumb path', async () => {
    const { client, close } = await makeClient();
    const res = await client.callTool({
      name: 'get_doc_section',
      arguments: { id: docMultiId, heading: 'Service A > Setup' },
    });
    const body = readJson<{
      kind: string;
      heading_path: string;
      markdown: string;
    }>(res);
    expect(body.kind).toBe('single');
    // The full breadcrumb (including H1) is what the tool returns.
    expect(body.heading_path).toBe('Multiple Setups > Service A > Setup');
    expect(body.markdown).toContain('Setup steps for Service A');
    expect(body.markdown).not.toContain('Service B');
    await close();
  });

  it('get_doc_section returns not_found with available_headings', async () => {
    const { client, close } = await makeClient();
    const res = await client.callTool({
      name: 'get_doc_section',
      arguments: { id: docArchId, heading: 'NoSuchHeading' },
    });
    const body = readJson<{
      kind: string;
      available_headings: string[];
    }>(res);
    expect(body.kind).toBe('not_found');
    expect(body.available_headings).toContain('Architecture');
    expect(body.available_headings).toContain('Architecture > Overview');
    expect(body.available_headings).toContain('Architecture > Setup');
    expect(body.available_headings).toContain('Architecture > Setup > Database');
    await close();
  });
});
