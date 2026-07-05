/**
 * Public REST API v1 — Multi-AI Connectivity.
 *
 * Base path: /api/public/v1
 * Auth:      Authorization: Bearer mnema_api_xxxx (API key)
 * Rate:      60 req/min per API key
 *
 * Design rule: NO business logic here. Call the same DB layer used by MCP tools.
 * Scope enforcement mirrors MCP scope checks.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { withTenant } from '../../db/with-tenant.js';
import { docs, folders, flows, tasks } from '../../db/schema.js';
import { resolveApiKey } from '../../lib/api-keys.js';
import { searchDocs } from '../../mcp/tools/search-docs.js';
import { emptyYjsState } from '../../lib/yjs.js';
import { db } from '../../db/index.js';

// ── Rate limiter (per API key, 60/min) ────────────────────────────────────────
const RL_WINDOW_MS  = 60 * 1000;
const RL_MAX        = 60;
const rlMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(keyId: string): { ok: boolean; resetAt: number } {
  const now = Date.now();
  let entry = rlMap.get(keyId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + RL_WINDOW_MS };
    rlMap.set(keyId, entry);
    return { ok: true, resetAt: entry.resetAt };
  }
  entry.count++;
  return { ok: entry.count <= RL_MAX, resetAt: entry.resetAt };
}

// ── Auth middleware ────────────────────────────────────────────────────────────
interface ApiAuthContext {
  workspaceId: string;
  scopes: string[];
  keyToken: string;
}

async function requireApiAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<ApiAuthContext | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    reply.code(401).send({ error: { code: 'unauthorized', message: 'Missing Bearer token' } });
    return null;
  }

  const resolved = await resolveApiKey(token);
  if (!resolved) {
    reply.code(401).send({ error: { code: 'unauthorized', message: 'Invalid or revoked API key' } });
    return null;
  }

  const rl = checkRateLimit(token.slice(0, 20)); // use prefix as key
  if (!rl.ok) {
    reply.header('Retry-After', String(Math.ceil((rl.resetAt - Date.now()) / 1000)));
    reply.code(429).send({ error: { code: 'rate_limited', message: 'Rate limit exceeded. Retry after window reset.' } });
    return null;
  }

  return { workspaceId: resolved.workspaceId, scopes: resolved.scopes, keyToken: token };
}

function requireScope(ctx: ApiAuthContext, scope: string, reply: FastifyReply): boolean {
  if (!ctx.scopes.includes(scope)) {
    reply.code(403).send({
      error: { code: 'forbidden', message: `Scope '${scope}' required. This key has: ${ctx.scopes.join(', ')}` },
    });
    return false;
  }
  return true;
}

function meta(workspaceId: string, requestId: string) {
  return { workspaceId, requestId, timestamp: new Date().toISOString() };
}

let _reqCounter = 0;
function nextRequestId() { return `req_${(++_reqCounter).toString(36)}`; }

// ── Plugin ─────────────────────────────────────────────────────────────────────
export const publicV1Routes: FastifyPluginAsync = async (app) => {

  // ── B.1 READ endpoints ───────────────────────────────────────────────────────

  // GET /api/public/v1/docs
  app.get('/api/public/v1/docs', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'read', reply)) return;

    const qs = req.query as Record<string, string>;
    const limit = Math.min(parseInt(qs.limit ?? '20', 10), 100);
    const isGpt = qs.format === 'gpt';
    const effectiveLimit = isGpt ? Math.min(limit, 10) : limit;

    const rows = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .select({ id: docs.id, title: docs.title, path: docs.path, updatedAt: docs.updatedAt })
        .from(docs)
        .where(isNull(docs.deletedAt))
        .orderBy(desc(docs.updatedAt))
        .limit(effectiveLimit + 1),
    );

    const hasMore = rows.length > effectiveLimit;
    const items = rows.slice(0, effectiveLimit);
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    const rid = nextRequestId();
    return reply.send({ data: { docs: items, next_cursor: nextCursor ?? null }, meta: meta(ctx.workspaceId, rid) });
  });

  // GET /api/public/v1/docs/search
  app.get('/api/public/v1/docs/search', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'read', reply)) return;

    const qs = req.query as Record<string, string>;
    const q = qs.q?.trim() ?? '';
    const isGpt = qs.format === 'gpt';
    const rawLimit = parseInt(qs.limit ?? '10', 10);
    const limit = isGpt ? Math.min(rawLimit, 10) : Math.min(rawLimit, 50);

    if (!q) {
      return reply.send({ data: { results: [] }, meta: meta(ctx.workspaceId, nextRequestId()) });
    }

    const fakeCtx = { tenant_id: ctx.workspaceId, scopes: ['docs:read'], sessionId: 'public-api' } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const result = await searchDocs(fakeCtx, { query: q, limit, mode: 'hybrid' });

    const results = result.results.map((r) => ({
      id: r.id,
      title: r.title,
      path: r.path,
      preview: r.snippet?.slice(0, 300) ?? '',
      score: r.rank ?? 0,
    }));

    return reply.send({ data: { results }, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // GET /api/public/v1/docs/:id
  app.get('/api/public/v1/docs/:id', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'read', reply)) return;

    const { id } = req.params as { id: string };
    const qs = req.query as Record<string, string>;
    const isGpt = qs.format === 'gpt';

    const rows = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .select({ id: docs.id, title: docs.title, path: docs.path, markdown: docs.markdown, updatedAt: docs.updatedAt })
        .from(docs)
        .where(and(eq(docs.id, id), isNull(docs.deletedAt)))
        .limit(1),
    );

    const doc = rows[0];
    if (!doc) return reply.code(404).send({ error: { code: 'not_found', message: 'Document not found' } });

    let markdown = doc.markdown ?? '';
    const truncated = isGpt && markdown.length > 8000;
    if (isGpt) markdown = markdown.slice(0, 8000);

    return reply.send({
      data: { id: doc.id, title: doc.title, path: doc.path, markdown, updatedAt: doc.updatedAt, ...(isGpt ? { truncated } : {}) },
      meta: meta(ctx.workspaceId, nextRequestId()),
    });
  });

  // GET /api/public/v1/folders
  app.get('/api/public/v1/folders', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'read', reply)) return;

    const rows = await db.execute(sql`
      SELECT f.id, f.name, COUNT(d.id) AS doc_count
      FROM folders f
      LEFT JOIN docs d ON d.folder_id = f.id AND d.deleted_at IS NULL
      WHERE f.workspace_id = ${ctx.workspaceId} AND f.deleted_at IS NULL
      GROUP BY f.id, f.name
      ORDER BY f.name
    `);

    return reply.send({
      data: { folders: (rows as unknown as Array<{ id: string; name: string; doc_count: string }>).map((r) => ({ id: r.id, name: r.name, docCount: Number(r.doc_count) })) },
      meta: meta(ctx.workspaceId, nextRequestId()),
    });
  });

  // GET /api/public/v1/flows
  app.get('/api/public/v1/flows', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'read', reply)) return;

    const rows = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .select({ id: flows.id, slug: flows.slug, name: flows.name })
        .from(flows)
        .where(eq(flows.workspaceId, ctx.workspaceId))
        .orderBy(asc(flows.name)),
    );

    return reply.send({ data: { flows: rows }, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // GET /api/public/v1/flows/:slug
  app.get('/api/public/v1/flows/:slug', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'read', reply)) return;

    const { slug } = req.params as { slug: string };

    const rows = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .select()
        .from(flows)
        .where(and(eq(flows.workspaceId, ctx.workspaceId), eq(flows.slug, slug)))
        .limit(1),
    );

    const flow = rows[0];
    if (!flow) return reply.code(404).send({ error: { code: 'not_found', message: 'Flow not found' } });

    return reply.send({ data: flow, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // GET /api/public/v1/flows/:slug/steps/:stepIndex
  app.get('/api/public/v1/flows/:slug/steps/:stepIndex', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'read', reply)) return;

    const { slug, stepIndex } = req.params as { slug: string; stepIndex: string };
    const idx = parseInt(stepIndex, 10);

    if (isNaN(idx) || idx < 1) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: 'stepIndex must be a positive integer' } });
    }

    // Import getFlowStep from MCP tools — same underlying function
    const { getFlowStepStructured } = await import('../../mcp/tools/get-flow-step.js');
    const fakeCtx = { tenant_id: ctx.workspaceId, scopes: ['flows:read'], sessionId: 'public-api' } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    try {
      const result = await getFlowStepStructured(fakeCtx, { slug, step_index: idx });
      return reply.send({ data: result, meta: meta(ctx.workspaceId, nextRequestId()) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Flow step not found';
      return reply.code(404).send({ error: { code: 'not_found', message: msg } });
    }
  });

  // ── B.2 WRITE endpoints ──────────────────────────────────────────────────────

  // POST /api/public/v1/docs — create doc
  app.post('/api/public/v1/docs', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'write', reply)) return;

    const body = (req.body ?? {}) as { title?: string; markdown?: string; folderId?: string };
    if (!body.title?.trim()) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: 'title is required' } });
    }

    const slug = body.title!.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const path = `${slug}-${Date.now().toString(36)}.md`;

    const [created] = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .insert(docs)
        .values({
          workspaceId: ctx.workspaceId,
          title: body.title!.trim(),
          markdown: body.markdown ?? '',
          path,
          folderId: body.folderId ?? null,
          yjsState: emptyYjsState(),
        })
        .returning({ id: docs.id, title: docs.title, path: docs.path }),
    );

    return reply.code(201).send({ data: created, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // PATCH /api/public/v1/docs/:id — update doc body/title
  app.patch('/api/public/v1/docs/:id', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'write', reply)) return;

    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { markdown?: string; title?: string };

    const updates: Partial<typeof docs.$inferInsert> = {};
    if (body.markdown !== undefined) updates.markdown = body.markdown;
    if (body.title !== undefined) updates.title = body.title;
    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: 'Provide markdown or title to update' } });
    }

    const [updated] = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .update(docs)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(docs.id, id), eq(docs.workspaceId, ctx.workspaceId), isNull(docs.deletedAt)))
        .returning({ updatedAt: docs.updatedAt }),
    );

    if (!updated) return reply.code(404).send({ error: { code: 'not_found', message: 'Document not found' } });

    return reply.send({ data: { ok: true, updatedAt: updated.updatedAt }, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // POST /api/public/v1/docs/:id/append — append markdown
  app.post('/api/public/v1/docs/:id/append', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'write', reply)) return;

    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { markdown?: string };

    if (!body.markdown) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: 'markdown is required' } });
    }

    const [updated] = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .update(docs)
        .set({
          markdown: sql`COALESCE(${docs.markdown}, '') || ${'\n\n' + body.markdown}`,
          updatedAt: new Date(),
        })
        .where(and(eq(docs.id, id), eq(docs.workspaceId, ctx.workspaceId), isNull(docs.deletedAt)))
        .returning({ updatedAt: docs.updatedAt }),
    );

    if (!updated) return reply.code(404).send({ error: { code: 'not_found', message: 'Document not found' } });

    return reply.send({ data: { ok: true }, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // ── B.3 TASK endpoints ───────────────────────────────────────────────────────

  // GET /api/public/v1/tasks/next
  app.get('/api/public/v1/tasks/next', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'tasks', reply)) return;

    const qs = req.query as Record<string, string>;
    const status = (qs.status ?? 'backlog') as string;

    const rows = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ctx.workspaceId), eq(tasks.status, status)))
        .orderBy(asc(tasks.createdAt))
        .limit(1),
    );

    const task = rows[0] ?? null;
    return reply.send({ data: { task }, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // POST /api/public/v1/tasks/:id/claim
  app.post('/api/public/v1/tasks/:id/claim', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'tasks', reply)) return;

    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { developerId?: string };

    const [updated] = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .update(tasks)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(and(
          eq(tasks.id, id),
          eq(tasks.workspaceId, ctx.workspaceId),
          eq(tasks.status, 'backlog'),
        ))
        .returning(),
    );

    if (!updated) {
      return reply.code(409).send({ error: { code: 'invalid_request', message: 'Task not found or not in backlog state' } });
    }

    return reply.send({ data: { task: updated }, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // POST /api/public/v1/tasks/:id/complete
  app.post('/api/public/v1/tasks/:id/complete', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'tasks', reply)) return;

    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { summary?: string; githubPrUrl?: string };

    const [updated] = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .update(tasks)
        .set({
          status: 'done',
          ...(body.summary ? { description: sql`COALESCE(${tasks.description}, '') || ${'\\n\\n**Completion summary:** ' + body.summary}` } : {}),
          updatedAt: new Date(),
        })
        .where(and(
          eq(tasks.id, id),
          eq(tasks.workspaceId, ctx.workspaceId),
          eq(tasks.status, 'in_progress'),
        ))
        .returning(),
    );

    if (!updated) {
      return reply.code(409).send({ error: { code: 'invalid_request', message: 'Task not found or not in_progress' } });
    }

    return reply.send({ data: { task: updated }, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // POST /api/public/v1/tasks/:id/block
  app.post('/api/public/v1/tasks/:id/block', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;
    if (!requireScope(ctx, 'tasks', reply)) return;

    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { description?: string };

    if (!body.description?.trim()) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: 'description is required' } });
    }

    const [updated] = await withTenant(ctx.workspaceId, (tx) =>
      tx
        .update(tasks)
        .set({
          status: 'audit_fix',
          blockerDescription: body.description,
          retryCount: sql`${tasks.retryCount} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(tasks.id, id),
          eq(tasks.workspaceId, ctx.workspaceId),
          eq(tasks.status, 'in_progress'),
        ))
        .returning(),
    );

    if (!updated) {
      return reply.code(409).send({ error: { code: 'invalid_request', message: 'Task not found or not in_progress' } });
    }

    // Trigger retry engine async (fire and forget)
    setImmediate(() => {
      import('../../lib/dev/retry/trigger.js').then(({ triggerRetry }) => {
        triggerRetry(updated!, body.description!).catch(() => {});
      }).catch(() => {});
    });

    return reply.send({ data: { task: updated }, meta: meta(ctx.workspaceId, nextRequestId()) });
  });

  // ── E.2 Unified function call endpoint ──────────────────────────────────────
  // POST /api/public/v1/call — Gemini function call dispatcher
  app.post('/api/public/v1/call', async (req, reply) => {
    const ctx = await requireApiAuth(req, reply);
    if (!ctx) return;

    const body = (req.body ?? {}) as { function?: string; parameters?: Record<string, unknown> };
    const fn   = body.function ?? '';
    const params = body.parameters ?? {};

    const fakeCtx = { tenant_id: ctx.workspaceId, scopes: ctx.scopes, sessionId: 'public-api' } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    try {
      let result: unknown;

      switch (fn) {
        case 'search_knowledge_base': {
          if (!requireScope(ctx, 'read', reply)) return;
          const r = await searchDocs(fakeCtx, {
            query: String(params.query ?? ''),
            limit: Math.min(Number(params.limit ?? 5), 10),
            mode: 'hybrid',
          });
          result = r.results.map((x) => ({ id: x.id, title: x.title, preview: x.snippet?.slice(0, 300) ?? '' }));
          break;
        }

        case 'get_doc': {
          if (!requireScope(ctx, 'read', reply)) return;
          const rows = await withTenant(ctx.workspaceId, (tx) =>
            tx.select({ id: docs.id, title: docs.title, markdown: docs.markdown })
              .from(docs)
              .where(and(eq(docs.id, String(params.doc_id)), isNull(docs.deletedAt)))
              .limit(1),
          );
          result = rows[0] ?? null;
          if (!result) return reply.code(404).send({ error: { code: 'not_found', message: 'Document not found' } });
          break;
        }

        case 'list_docs': {
          if (!requireScope(ctx, 'read', reply)) return;
          const lim = Math.min(Number(params.limit ?? 20), 50);
          const rows = await withTenant(ctx.workspaceId, (tx) =>
            tx.select({ id: docs.id, title: docs.title, path: docs.path })
              .from(docs)
              .where(isNull(docs.deletedAt))
              .orderBy(desc(docs.updatedAt))
              .limit(lim),
          );
          result = rows;
          break;
        }

        case 'get_flow_step': {
          if (!requireScope(ctx, 'read', reply)) return;
          const { getFlowStepStructured } = await import('../../mcp/tools/get-flow-step.js');
          result = await getFlowStepStructured(fakeCtx, {
            slug: String(params.flow_slug ?? ''),
            step_index: Number(params.step_index ?? 1),
          });
          break;
        }

        case 'create_doc': {
          if (!requireScope(ctx, 'write', reply)) return;
          const title = String(params.title ?? '').trim();
          if (!title) return reply.code(400).send({ error: { code: 'invalid_request', message: 'title required' } });
          const slug2 = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const [created] = await withTenant(ctx.workspaceId, (tx) =>
            tx.insert(docs).values({
              workspaceId: ctx.workspaceId,
              title,
              markdown: String(params.content ?? ''),
              path: `${slug2}-${Date.now().toString(36)}.md`,
              yjsState: emptyYjsState(),
            }).returning({ id: docs.id, title: docs.title }),
          );
          result = created;
          break;
        }

        default:
          return reply.code(404).send({ error: { code: 'not_found', message: `Unknown function: '${fn}'` } });
      }

      return reply.send({ data: result, meta: meta(ctx.workspaceId, nextRequestId()) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Function call failed';
      return reply.code(500).send({ error: { code: 'internal', message: msg } });
    }
  });
};
