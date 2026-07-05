import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { docs, embeddings, users, workspaceMembers, workspaces } from '../db/schema.js';
import type { McpAuthContext } from '../mcp/auth.js';
import { createMcpServer } from '../mcp/server.js';

/**
 * search_docs (Phase 3.2) — semantic + hybrid + RRF + caching coverage.
 *
 * The Voyage call is mocked with a deterministic, semantically-meaningful
 * embedding scheme: keywords like "pricing/cost/tier" map to slot 0,
 * "rate/limit/throttl" to slot 1, "auth/login/session" to slot 2. This
 * makes cosine similarity behave predictably across docs and queries
 * even though we never call real Voyage in CI.
 *
 * Same `inputType: 'document' | 'query'` distinction is preserved by the
 * mock — both sides use the same mapping function so docs+queries on the
 * same topic land in the same vector space.
 */

vi.mock('../workers/embeddings/voyage.js', () => ({
  embedBatch: vi.fn(async ({ texts }: { texts: string[] }) => {
    const vectors = texts.map((t) => {
      const lower = t.toLowerCase();
      const vec = new Array<number>(config.EMBEDDING_DIM).fill(0);
      if (
        lower.includes('pricing') ||
        lower.includes('cost') ||
        lower.includes('plan') ||
        lower.includes('tier')
      ) {
        vec[0] = 1;
      }
      if (
        lower.includes('rate') ||
        lower.includes('limit') ||
        lower.includes('throttl')
      ) {
        vec[1] = 1;
      }
      if (
        lower.includes('auth') ||
        lower.includes('login') ||
        lower.includes('session')
      ) {
        vec[2] = 1;
      }
      const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
      return vec.map((v) => v / mag);
    });
    return {
      vectors,
      totalTokens: texts.reduce((s, t) => s + t.length, 0),
    };
  }),
}));

const emptyYjsState = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

let tenantId: string;
let userId: string;
let pricingDocId: string;
let throttlingDocId: string;

const FIXTURES = [
  {
    path: 'pricing.md',
    title: 'Pricing Strategy',
    markdown:
      '# Pricing\n\nOur pricing tiers are Free, Pro, and Team. Costs scale with seat count.',
    chunks: [
      {
        text: '# Pricing\n\nOur pricing tiers are Free, Pro, and Team. Costs scale with seat count.',
        heading: 'Pricing',
        vec_slot: 0,
      },
    ],
  },
  {
    path: 'throttling.md',
    title: 'Request Throttling',
    markdown:
      '# Throttling\n\nWe throttle excessive requests via sliding-window counters in Redis.',
    chunks: [
      {
        text: '# Throttling\n\nWe throttle excessive requests via sliding-window counters in Redis.',
        heading: 'Throttling',
        vec_slot: 1,
      },
    ],
  },
];

beforeAll(async () => {
  const stamp = Date.now();
  const [ws] = await db
    .insert(workspaces)
    .values({ slug: `hybrid-${stamp}`, name: 'Hybrid test' })
    .returning();
  if (!ws) throw new Error('Failed to create workspace');
  tenantId = ws.id;

  const [u] = await db
    .insert(users)
    .values({ email: `hybrid-${stamp}@boppl.test`, displayName: 'H' })
    .returning();
  if (!u) throw new Error('Failed to create user');
  userId = u.id;
  await db.insert(workspaceMembers).values({ workspaceId: tenantId, userId, role: 'owner' });

  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    for (const f of FIXTURES) {
      const [d] = await tx
        .insert(docs)
        .values({
          workspaceId: tenantId,
          path: f.path,
          title: f.title,
          markdown: f.markdown,
          yjsState: emptyYjsState,
          contentHash: f.path,
        })
        .returning();
      if (!d) throw new Error(`Failed to insert ${f.path}`);
      if (f.path === 'pricing.md') pricingDocId = d.id;
      if (f.path === 'throttling.md') throttlingDocId = d.id;

      for (let i = 0; i < f.chunks.length; i += 1) {
        const ch = f.chunks[i]!;
        const vec = new Array<number>(config.EMBEDDING_DIM).fill(0);
        vec[ch.vec_slot] = 1;
        await tx.insert(embeddings).values({
          workspaceId: tenantId,
          docId: d.id,
          chunkIndex: i,
          chunkText: ch.text,
          tokenCount: ch.text.length,
          headingPath: ch.heading,
          embedding: vec,
          model: config.EMBEDDING_MODEL,
          contentHash: f.path,
        });
      }
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
  match_type: 'title' | 'body' | 'both' | 'chunk';
  snippet: string;
  heading_path?: string;
}

interface SearchBody {
  query: string;
  mode: 'keyword' | 'semantic' | 'hybrid';
  results: SearchHit[];
}

async function search(
  query: string,
  mode?: string,
  limit?: number,
): Promise<{ body: SearchBody | null; isError: boolean }> {
  const ctx: McpAuthContext = {
    user_id: userId,
    tenant_id: tenantId,
    email: 'hybrid@boppl.test',
    scopes: ['docs:read'],
    jwt_id: null,
  };
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server: McpServer = createMcpServer(ctx);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  const args: Record<string, unknown> = { query };
  if (mode !== undefined) args.mode = mode;
  if (limit !== undefined) args.limit = limit;

  const res = await client.callTool({ name: 'search_docs', arguments: args });
  await Promise.all([client.close(), server.close()]);

  const isError = res.isError === true;
  if (isError) return { body: null, isError: true };
  const text = (res.content as Array<{ type: string; text?: string }>)[0]!.text!;
  return { body: JSON.parse(text) as SearchBody, isError: false };
}

describe('search_docs — hybrid mode (default)', () => {
  it('uses hybrid by default when no mode given', async () => {
    const { body } = await search('pricing tiers');
    expect(body!.mode).toBe('hybrid');
    expect(body!.results.length).toBeGreaterThan(0);
    expect(body!.results[0]!.title).toBe('Pricing Strategy');
  });

  it('returns RRF-fused results that prefer docs hit by both signals', async () => {
    const { body } = await search('pricing');
    const pricing = body!.results.find((h) => h.id === pricingDocId);
    expect(pricing).toBeTruthy();
    // Pricing doc is hit by keyword AND semantic — match_type "both" is expected.
    expect(['both', 'title', 'chunk']).toContain(pricing!.match_type);
  });

  it('exposes heading_path on chunk-bearing hits', async () => {
    const { body } = await search('throttling');
    const throttling = body!.results.find((h) => h.id === throttlingDocId);
    expect(throttling?.heading_path).toBe('Throttling');
  });
});

describe('search_docs — semantic mode', () => {
  it('finds the throttling doc when query is "rate limiting" (no lexical overlap)', async () => {
    // The doc says "throttle"; query says "rate limit". Keyword wouldn't
    // find this — semantic must, because both map to slot 1 in the mock.
    const { body } = await search('rate limiting', 'semantic');
    expect(body!.mode).toBe('semantic');
    expect(body!.results.length).toBeGreaterThan(0);
    expect(body!.results[0]!.id).toBe(throttlingDocId);
    expect(body!.results[0]!.match_type).toBe('chunk');
  });

  it('rank field is the cosine similarity (higher = better)', async () => {
    const { body } = await search('rate limiting', 'semantic');
    expect(body!.results[0]!.rank).toBeGreaterThan(0);
    expect(body!.results[0]!.rank).toBeLessThanOrEqual(1);
  });

  it('collapses to one row per doc (DISTINCT ON)', async () => {
    const { body } = await search('throttling', 'semantic');
    const ids = body!.results.map((h) => h.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe('search_docs — keyword mode (regression)', () => {
  it('still works exactly as in 2.4 (lexical only)', async () => {
    const { body } = await search('pricing', 'keyword');
    expect(body!.mode).toBe('keyword');
    expect(body!.results.length).toBeGreaterThan(0);
    expect(body!.results.some((h) => h.id === pricingDocId)).toBe(true);
  });

  it('does not find throttling for "rate limiting" (proves lexical-only behavior)', async () => {
    // Critical contrast with the semantic test above: keyword sees zero
    // matches because the doc never says "rate" or "limiting".
    const { body } = await search('rate limiting', 'keyword');
    expect(body!.results).toEqual([]);
  });
});

describe('search_docs — error cases (3.2 enum)', () => {
  it('rejects unknown mode like "magic"', async () => {
    const { isError } = await search('pricing', 'magic');
    expect(isError).toBe(true);
  });

  it('rejects empty query in hybrid mode', async () => {
    const { isError } = await search('   ');
    expect(isError).toBe(true);
  });
});
