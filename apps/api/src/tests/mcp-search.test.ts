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
 * search_docs (Phase 2.4) keyword-mode behavior + integration tests.
 *
 * Same in-memory transport pattern as mcp-tools.test.ts: spin up
 * createMcpServer(ctx), wire through SDK InMemoryTransport, call
 * tools/call directly. RLS-bound throughout.
 *
 * Fixtures are designed so that:
 *   - "pricing" matches in 2 docs (one title+body = "both", one body = "body")
 *     — exercises ranking weight (title weight A > body weight B)
 *   - "team" matches in exactly 2 docs — exercises the limit truncation test
 *   - "SSO" matches in 2 docs — exercises snippet <mark> tagging across docs
 *   - "customer onboarding" as a phrase matches 1 doc — exercises quoted-phrase
 *   - "zzznonexistent" matches 0 docs — exercises empty-result path
 */

const emptyYjsState = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

let tenantId: string;
let userId: string;

beforeAll(async () => {
  const stamp = Date.now();
  const [ws] = await db
    .insert(workspaces)
    .values({ slug: `search-${stamp}`, name: 'Search test' })
    .returning();
  if (!ws) throw new Error('Failed to create workspace');
  tenantId = ws.id;

  const [u] = await db
    .insert(users)
    .values({ email: `search-${stamp}@boppl.test`, displayName: 'S' })
    .returning();
  if (!u) throw new Error('Failed to create user');
  userId = u.id;
  await db.insert(workspaceMembers).values({ workspaceId: tenantId, userId, role: 'owner' });

  const fixtures = [
    {
      path: 'pricing.md',
      title: 'Pricing Strategy',
      markdown:
        '# Pricing\n\nOur pricing tiers are Free, Pro, and Team. The Team tier includes SSO.',
    },
    {
      path: 'arch.md',
      title: 'Architecture Overview',
      markdown:
        '# Architecture\n\nThe system runs Postgres for storage and Redis for caching. Pricing is computed at request time.',
    },
    {
      path: 'onboarding.md',
      title: 'Customer Onboarding',
      markdown:
        '# Onboarding\n\nNew customers complete a setup wizard. SSO is configured during onboarding for Team accounts.',
    },
    {
      path: 'irrelevant.md',
      title: 'Vacation Schedule',
      markdown: '# Vacation\n\nHoliday calendar for 2026.',
    },
  ];

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    for (const f of fixtures) {
      await tx.insert(docs).values({
        workspaceId: tenantId,
        path: f.path,
        title: f.title,
        markdown: f.markdown,
        yjsState: emptyYjsState,
      });
    }
  });
});

afterAll(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, tenantId));
});

interface SearchHit {
  id: string;
  title: string;
  path: string;
  rank: number;
  match_type: 'title' | 'body' | 'both';
  snippet: string;
}

interface SearchBody {
  query: string;
  mode: 'keyword';
  results: SearchHit[];
}

async function call(
  query: string,
  extra: Record<string, unknown> = {},
  scopes: string[] = ['docs:read'],
): Promise<{ body: SearchBody | null; isError: boolean }> {
  const ctx: McpAuthContext = {
    user_id: userId,
    tenant_id: tenantId,
    email: 'search@boppl.test',
    scopes,
    jwt_id: null,
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server: McpServer = createMcpServer(ctx);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  // This file targets the keyword path (it predates Phase 3.2's hybrid default).
  // Force mode:'keyword' unless a test explicitly overrides — the hybrid path
  // gets its own coverage in mcp-search-hybrid.test.ts.
  const args = { mode: 'keyword' as const, ...extra, query };

  const res = await client.callTool({
    name: 'search_docs',
    arguments: args,
  });

  await Promise.all([client.close(), server.close()]);

  const isError = res.isError === true;
  if (isError) {
    return { body: null, isError: true };
  }
  const text = (res.content as Array<{ type: string; text?: string }>)[0]!.text!;
  return { body: JSON.parse(text) as SearchBody, isError: false };
}

describe('search_docs — keyword mode', () => {
  it('returns matches ranked by relevance (title-weighted higher than body)', async () => {
    const { body, isError } = await call('pricing');
    expect(isError).toBe(false);
    expect(body!.results.length).toBeGreaterThan(0);
    expect(body!.results[0]!.title).toBe('Pricing Strategy');
    // Pricing-titled doc must rank above the doc that only mentions
    // pricing in body (weight A > weight B in ts_rank_cd with our schema).
    const pricingIdx = body!.results.findIndex((r) => r.title === 'Pricing Strategy');
    const archIdx = body!.results.findIndex((r) => r.title === 'Architecture Overview');
    expect(pricingIdx).toBeGreaterThanOrEqual(0);
    expect(archIdx).toBeGreaterThan(pricingIdx);
  });

  it('match_type reflects where the term hit', async () => {
    const { body } = await call('pricing');
    const pricing = body!.results.find((r) => r.title === 'Pricing Strategy');
    const arch = body!.results.find((r) => r.title === 'Architecture Overview');
    expect(pricing?.match_type).toBe('both'); // title + body
    expect(arch?.match_type).toBe('body'); // body only
  });

  it('snippet contains <mark> tags around matched terms', async () => {
    const { body } = await call('SSO');
    expect(body!.results.length).toBeGreaterThan(0);
    for (const hit of body!.results) {
      expect(hit.snippet).toContain('<mark>');
      expect(hit.snippet).toContain('</mark>');
    }
  });

  it('handles a quoted multi-word phrase', async () => {
    // websearch_to_tsquery turns "customer onboarding" into a phrase query
    // (customer <-> onboarding). The Onboarding doc has "Customer Onboarding"
    // in the title; the phrase match wins.
    const { body } = await call('"customer onboarding"');
    expect(body!.results.length).toBeGreaterThan(0);
    expect(body!.results[0]!.title).toBe('Customer Onboarding');
  });

  it('returns empty results for a term that does not appear', async () => {
    const { body } = await call('zzznonexistentword');
    expect(body!.results).toEqual([]);
  });

  it('rejects empty (whitespace-only) query with isError', async () => {
    const { isError } = await call('   ');
    expect(isError).toBe(true);
  });

  it('respects the limit parameter (truncates to N from a multi-doc match)', async () => {
    // "team" matches 2 docs (pricing.md + onboarding.md). limit=1 must
    // truncate to 1. Avoid words like "the" — they're english-config stop
    // words that produce empty tsqueries and pass length<=N vacuously.
    const { body } = await call('team', { limit: 1 });
    expect(body!.results.length).toBe(1);
  });

  it('rejects unknown mode value with isError', async () => {
    // Phase 3.2 widened the enum to include 'semantic' and 'hybrid'.
    // Use a value that is definitely outside the enum.
    const { isError } = await call('pricing', { mode: 'magic' });
    expect(isError).toBe(true);
  });
});
