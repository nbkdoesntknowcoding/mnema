import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { flows, flowVersions, flowNodes, flowEdges, users } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { renderNodeContent, topologicalWalk } from '../lib/flows/walk.js';
import { enforceFreeFlowLimit } from '../plugins/free-limits.js';
import {
  validateFlow,
  type FlowEdge as ValidFlowEdge,
  type FlowNode as ValidFlowNode,
} from '../lib/flows/validate.js';

/**
 * Phase 6.1 REST API for flows.
 *
 * Endpoints:
 *   POST   /api/flows                              create
 *   GET    /api/flows                              list
 *   GET    /api/flows/:id                          read draft (or ?version=published)
 *   PUT    /api/flows/:id/draft                    save the entire draft graph
 *   POST   /api/flows/:id/publish                  promote draft → published
 *   DELETE /api/flows/:id                          soft-delete
 *   GET    /api/flows/:id/preview?version=…        what Claude would receive
 *
 * `:id` accepts EITHER a UUID OR a slug. Slug lookup happens automatically
 * by the format. This lets the UI use stable slug URLs even though the
 * underlying primary key is a UUID.
 */

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  slug: z.string().min(1).max(64).regex(SLUG_RE, 'must be kebab-case alphanumeric').optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

const nodeSchema = z.object({
  client_node_id: z.string().min(1).max(64).regex(SLUG_RE),
  kind: z.enum(['doc', 'docs', 'instruction', 'decision']),
  title: z.string().min(1).max(200),
  position_x: z.number(),
  position_y: z.number(),
  data: z.record(z.unknown()).default({}),
});

const edgeSchema = z.object({
  from_node_id: z.string().min(1).max(64),
  to_node_id: z.string().min(1).max(64),
  from_socket: z.string().max(64).default('default'),
});

const draftSaveSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

const restoreVersionSchema = z.object({
  version_id: z.string().uuid(),
});

/**
 * Look up a flow by either UUID or slug, scoped to the active tenant.
 * Returns null if not found (or soft-deleted).
 */
async function resolveFlow(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  idOrSlug: string,
) {
  const isUuid = UUID_RE.test(idOrSlug);
  const where = and(
    isUuid ? eq(flows.id, idOrSlug) : eq(flows.slug, idOrSlug),
    isNull(flows.deletedAt),
  );
  const rows = await tx
    .select({
      id: flows.id,
      slug: flows.slug,
      name: flows.name,
      description: flows.description,
      publishedVersionId: flows.publishedVersionId,
      createdAt: flows.createdAt,
      updatedAt: flows.updatedAt,
    })
    .from(flows)
    .where(where)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Find (or create) the in-progress draft version for a flow. The draft is
 * defined as the most recent version where is_published=false. If none
 * exists, a new draft is created with version_number = (max + 1).
 */
async function getOrCreateDraftVersion(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  flowId: string,
  userId: string,
  workspaceId: string,
) {
  const draft = await tx
    .select()
    .from(flowVersions)
    .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.isPublished, false)))
    .orderBy(desc(flowVersions.versionNumber))
    .limit(1);
  if (draft[0]) return draft[0];

  const maxVersion = await tx
    .select({ v: sql<number>`COALESCE(MAX(${flowVersions.versionNumber}), 0)::int` })
    .from(flowVersions)
    .where(eq(flowVersions.flowId, flowId));
  const next = (maxVersion[0]?.v ?? 0) + 1;

  const [created] = await tx
    .insert(flowVersions)
    .values({
      flowId,
      workspaceId,
      versionNumber: next,
      isPublished: false,
      createdBy: userId,
    })
    .returning();
  if (!created) throw new Error('failed_to_create_draft_version');
  return created;
}

export const flowsRoutes: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------------
  // POST /api/flows — create a flow + initial empty draft version
  // -------------------------------------------------------------------
  app.post('/api/flows', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    // Enforce free plan flow limit (no-op for paid workspaces).
    if (await enforceFreeFlowLimit(req, reply, req.auth.tenant_id)) return;

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }

    const auth = req.auth;
    try {
      // Auto-generate slug from name if not provided
      const slug = parsed.data.slug ??
        parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
        + '-' + nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, 'x');

      const result = await withTenant(auth.tenant_id, async (tx) => {
        const [createdFlow] = await tx
          .insert(flows)
          .values({
            workspaceId: auth.tenant_id,
            slug,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            createdBy: auth.sub,
          })
          .returning();
        if (!createdFlow) throw new Error('flow_insert_failed');

        const [draft] = await tx
          .insert(flowVersions)
          .values({
            flowId: createdFlow.id,
            workspaceId: auth.tenant_id,
            versionNumber: 1,
            isPublished: false,
            createdBy: auth.sub,
          })
          .returning();
        if (!draft) throw new Error('draft_insert_failed');

        return { flow: createdFlow, draft };
      });

      return reply.code(201).send({
        flow: {
          id: result.flow.id,
          slug: result.flow.slug,
          name: result.flow.name,
          description: result.flow.description,
          created_at: result.flow.createdAt,
          draft_version_id: result.draft.id,
        },
      });
    } catch (err) {
      // Unique-violation on (workspace_id, slug) → 409
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
        return reply.code(409).send({ error: 'slug_taken' });
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------
  // GET /api/flows — list flows in workspace
  // -------------------------------------------------------------------
  app.get('/api/flows', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const rows = await withTenant(req.auth.tenant_id, async (tx) => {
      // Pull the flow rows first; then per-flow we determine published-state
      // and whether the draft is newer than the published version.
      const flowRows = await tx
        .select({
          id: flows.id,
          slug: flows.slug,
          name: flows.name,
          description: flows.description,
          publishedVersionId: flows.publishedVersionId,
          updatedAt: flows.updatedAt,
        })
        .from(flows)
        .where(isNull(flows.deletedAt))
        .orderBy(desc(flows.updatedAt));

      // Decorate with published timestamp + draft-newer flag + step count.
      const out: Array<{
        id: string;
        slug: string;
        name: string;
        description: string | null;
        is_published: boolean;
        published_at: string | null;
        has_unpublished_changes: boolean;
        step_count: number;
        node_count: number;
        updated_at: string;
      }> = [];

      for (const f of flowRows) {
        let publishedAt: Date | null = null;
        let stepCount = 0;
        let hasUnpublishedChanges = false;

        if (f.publishedVersionId) {
          const pubRows = await tx
            .select({
              id: flowVersions.id,
              createdAt: flowVersions.createdAt,
            })
            .from(flowVersions)
            .where(eq(flowVersions.id, f.publishedVersionId))
            .limit(1);
          if (pubRows[0]) {
            publishedAt = pubRows[0].createdAt;
            const c = await tx
              .select({ n: count() })
              .from(flowNodes)
              .where(eq(flowNodes.flowVersionId, pubRows[0].id));
            stepCount = Number(c[0]?.n ?? 0);
          }
        }

        // Look for a newer draft. If draft exists and its created_at >
        // publishedAt (or no publishedAt), the flow has unpublished changes.
        const draftRows = await tx
          .select({ id: flowVersions.id, createdAt: flowVersions.createdAt })
          .from(flowVersions)
          .where(
            and(eq(flowVersions.flowId, f.id), eq(flowVersions.isPublished, false)),
          )
          .orderBy(desc(flowVersions.versionNumber))
          .limit(1);
        if (draftRows[0]) {
          if (!publishedAt || draftRows[0].createdAt > publishedAt) {
            hasUnpublishedChanges = true;
          }
          if (stepCount === 0) {
            // Count draft nodes if no published exists (so brand-new flows
            // show a usable step count in the list).
            const c = await tx
              .select({ n: count() })
              .from(flowNodes)
              .where(eq(flowNodes.flowVersionId, draftRows[0].id));
            stepCount = Number(c[0]?.n ?? 0);
          }
        }

        out.push({
          id: f.id,
          slug: f.slug,
          name: f.name,
          description: f.description,
          is_published: !!f.publishedVersionId,
          published_at: publishedAt ? publishedAt.toISOString() : null,
          has_unpublished_changes: hasUnpublishedChanges,
          step_count: stepCount,
          node_count: stepCount,
          updated_at: f.updatedAt.toISOString(),
        });
      }

      return out;
    });

    return reply.send({ flows: rows });
  });

  // -------------------------------------------------------------------
  // GET /api/flows/:id — read a flow (draft by default, or ?version=published)
  // -------------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { version?: string } }>(
    '/api/flows/:id',
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

      const result = await withTenant(req.auth.tenant_id, async (tx) => {
        const flow = await resolveFlow(tx, req.params.id);
        if (!flow) return null;

        const wantPublished = req.query.version === 'published';

        // Latest draft (unpublished) version, if any.
        const draftRows = await tx
          .select({ id: flowVersions.id })
          .from(flowVersions)
          .where(
            and(eq(flowVersions.flowId, flow.id), eq(flowVersions.isPublished, false)),
          )
          .orderBy(desc(flowVersions.versionNumber))
          .limit(1);
        const draftVersionId = draftRows[0]?.id ?? null;

        // Which graph to render:
        //   ?version=published → the published version
        //   otherwise          → the draft if one exists, ELSE fall back to the
        //                         published version. A flow that was published
        //                         with no pending edits has no draft, and must
        //                         still render (this is the empty-canvas fix).
        const versionId = wantPublished
          ? flow.publishedVersionId
          : (draftVersionId ?? flow.publishedVersionId);

        const nodes = versionId
          ? await tx
              .select({
                client_node_id: flowNodes.clientNodeId,
                kind: flowNodes.kind,
                title: flowNodes.title,
                position_x: flowNodes.positionX,
                position_y: flowNodes.positionY,
                data: flowNodes.data,
              })
              .from(flowNodes)
              .where(eq(flowNodes.flowVersionId, versionId))
          : [];

        const edges = versionId
          ? await tx
              .select({
                from_node_id: flowEdges.fromNodeId,
                to_node_id: flowEdges.toNodeId,
                from_socket: flowEdges.fromSocket,
              })
              .from(flowEdges)
              .where(eq(flowEdges.flowVersionId, versionId))
          : [];

        // Unsaved/unpublished changes exist iff a draft (unpublished) version
        // exists. Drafts are created only when the flow is edited after publish,
        // so their presence is the single source of truth — no fragile timestamp
        // comparison. (Brand-new, never-published flows always have a draft.)
        const hasUnpublishedChanges = draftVersionId !== null;

        return {
          flow,
          nodes,
          edges,
          versionId,
          draftVersionId,
          isPublished: !!flow.publishedVersionId,
          hasUnpublishedChanges,
        };
      });

      if (!result) return reply.code(404).send({ error: 'flow_not_found' });

      return reply.send({
        id: result.flow.id,
        slug: result.flow.slug,
        name: result.flow.name,
        description: result.flow.description,
        published_version_id: result.flow.publishedVersionId,
        draft_version_id: result.draftVersionId,
        is_published: result.isPublished,
        has_unpublished_changes: result.hasUnpublishedChanges,
        nodes: result.nodes,
        edges: result.edges,
      });
    },
  );

  // -------------------------------------------------------------------
  // PUT /api/flows/:id/draft — save the entire draft graph (full-replace)
  // -------------------------------------------------------------------
  app.put<{ Params: { id: string } }>('/api/flows/:id/draft', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = draftSaveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }

    // Validate graph invariants up-front. We don't run inside the tx
    // because validation is pure and shouldn't hold a row lock.
    const valid = validateFlow(
      parsed.data.nodes as ValidFlowNode[],
      parsed.data.edges as ValidFlowEdge[],
    );
    if (!valid.valid) {
      return reply.code(400).send({ error: 'invalid_flow', errors: valid.errors });
    }

    const auth = req.auth;
    const result = await withTenant(auth.tenant_id, async (tx) => {
      const flow = await resolveFlow(tx, req.params.id);
      if (!flow) return { error: 'flow_not_found' as const };

      const draft = await getOrCreateDraftVersion(tx, flow.id, auth.sub, auth.tenant_id);

      // Full-replace strategy: delete everything in the draft, then insert
      // the new shape. Inside a tx, RLS keeps this scoped automatically.
      await tx.delete(flowEdges).where(eq(flowEdges.flowVersionId, draft.id));
      await tx.delete(flowNodes).where(eq(flowNodes.flowVersionId, draft.id));

      if (parsed.data.nodes.length > 0) {
        await tx.insert(flowNodes).values(
          parsed.data.nodes.map((n) => ({
            flowVersionId: draft.id,
            clientNodeId: n.client_node_id,
            kind: n.kind,
            title: n.title,
            positionX: n.position_x,
            positionY: n.position_y,
            data: n.data,
          })),
        );
      }
      if (parsed.data.edges.length > 0) {
        await tx.insert(flowEdges).values(
          parsed.data.edges.map((e) => ({
            flowVersionId: draft.id,
            fromNodeId: e.from_node_id,
            toNodeId: e.to_node_id,
            fromSocket: e.from_socket,
          })),
        );
      }

      // Touch flows.updated_at so the list endpoint orders correctly.
      await tx
        .update(flows)
        .set({ updatedAt: new Date() })
        .where(eq(flows.id, flow.id));

      return {
        draft_version_id: draft.id,
        node_count: parsed.data.nodes.length,
        edge_count: parsed.data.edges.length,
      };
    });

    if ('error' in result) return reply.code(404).send(result);
    return reply.send(result);
  });

  // -------------------------------------------------------------------
  // POST /api/flows/:id/publish — promote draft → published, then open a
  // fresh draft mirroring the now-published version so editing continues.
  // -------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/api/flows/:id/publish', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const auth = req.auth;

    const outcome = await withTenant(auth.tenant_id, async (tx) => {
      const flow = await resolveFlow(tx, req.params.id);
      if (!flow) return { error: 'flow_not_found' as const };

      // Find current draft
      const draftRows = await tx
        .select()
        .from(flowVersions)
        .where(and(eq(flowVersions.flowId, flow.id), eq(flowVersions.isPublished, false)))
        .orderBy(desc(flowVersions.versionNumber))
        .limit(1);
      const draft = draftRows[0];
      if (!draft) return { error: 'no_draft_to_publish' as const };

      // Re-validate the draft before publishing.
      const nodes = await tx
        .select({
          client_node_id: flowNodes.clientNodeId,
          kind: flowNodes.kind,
          title: flowNodes.title,
          position_x: flowNodes.positionX,
          position_y: flowNodes.positionY,
          data: flowNodes.data,
        })
        .from(flowNodes)
        .where(eq(flowNodes.flowVersionId, draft.id));
      const edges = await tx
        .select({
          from_node_id: flowEdges.fromNodeId,
          to_node_id: flowEdges.toNodeId,
          from_socket: flowEdges.fromSocket,
        })
        .from(flowEdges)
        .where(eq(flowEdges.flowVersionId, draft.id));

      const valid = validateFlow(nodes as ValidFlowNode[], edges as ValidFlowEdge[]);
      if (!valid.valid) {
        return { error: 'invalid_flow' as const, errors: valid.errors };
      }

      // Promote this draft to published.
      await tx
        .update(flowVersions)
        .set({ isPublished: true })
        .where(eq(flowVersions.id, draft.id));

      // Point flows.published_version_id at it.
      await tx
        .update(flows)
        .set({ publishedVersionId: draft.id })
        .where(eq(flows.id, flow.id));

      // No mirrored draft is created here (Model B): after publishing there is
      // no unpublished draft, so the flow reads as "published, no changes" and
      // GET falls back to the published graph. A fresh draft is created lazily
      // (cloning the published graph) on the next edit via getOrCreateDraftVersion.

      return {
        published_version_id: draft.id,
        new_draft_version_id: null,
        version_number: draft.versionNumber,
      };
    });

    if ('error' in outcome) {
      if (outcome.error === 'flow_not_found') return reply.code(404).send(outcome);
      if (outcome.error === 'invalid_flow') return reply.code(400).send(outcome);
      return reply.code(409).send(outcome);
    }
    return reply.send(outcome);
  });

  // -------------------------------------------------------------------
  // GET /api/flows/:id/versions — version history for the History panel
  // -------------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/flows/:id/versions',
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

      const result = await withTenant(req.auth.tenant_id, async (tx) => {
        const flow = await resolveFlow(tx, req.params.id);
        if (!flow) return null;

        const versions = await tx
          .select({
            id: flowVersions.id,
            versionNumber: flowVersions.versionNumber,
            isPublished: flowVersions.isPublished,
            publishMessage: flowVersions.publishMessage,
            createdAt: flowVersions.createdAt,
            createdBy: flowVersions.createdBy,
            authorName: users.displayName,
            authorEmail: users.email,
          })
          .from(flowVersions)
          .leftJoin(users, eq(users.id, flowVersions.createdBy))
          .where(eq(flowVersions.flowId, flow.id))
          .orderBy(desc(flowVersions.versionNumber))
          .limit(limit);

        // Current draft = the latest unpublished version (highest versionNumber).
        const currentDraftId = versions.find((v) => !v.isPublished)?.id ?? null;

        const out = [];
        for (const v of versions) {
          const nc = await tx
            .select({ n: count() })
            .from(flowNodes)
            .where(eq(flowNodes.flowVersionId, v.id));
          const ec = await tx
            .select({ n: count() })
            .from(flowEdges)
            .where(eq(flowEdges.flowVersionId, v.id));
          out.push({
            id: v.id,
            version_number: v.versionNumber,
            is_published: v.isPublished,
            created_at: v.createdAt.toISOString(),
            created_by: {
              id: v.createdBy ?? null,
              display_name: v.authorName ?? null,
              email: v.authorEmail ?? null,
            },
            publish_message: v.publishMessage ?? null,
            node_count: Number(nc[0]?.n ?? 0),
            edge_count: Number(ec[0]?.n ?? 0),
            is_current_draft: v.id === currentDraftId,
            is_published_version: v.id === flow.publishedVersionId,
          });
        }
        return out;
      });

      if (!result) return reply.code(404).send({ error: 'flow_not_found' });
      return reply.send({ versions: result });
    },
  );

  // -------------------------------------------------------------------
  // POST /api/flows/:id/restore-version — copy a version's graph into the draft
  // -------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/api/flows/:id/restore-version', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = restoreVersionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const auth = req.auth;

    const result = await withTenant(auth.tenant_id, async (tx) => {
      const flow = await resolveFlow(tx, req.params.id);
      if (!flow) return { error: 'flow_not_found' as const };

      // The source version must belong to this flow.
      const srcRows = await tx
        .select({ id: flowVersions.id })
        .from(flowVersions)
        .where(and(eq(flowVersions.id, parsed.data.version_id), eq(flowVersions.flowId, flow.id)))
        .limit(1);
      const src = srcRows[0];
      if (!src) return { error: 'version_not_found' as const };

      const srcNodes = await tx
        .select({
          client_node_id: flowNodes.clientNodeId,
          kind: flowNodes.kind,
          title: flowNodes.title,
          position_x: flowNodes.positionX,
          position_y: flowNodes.positionY,
          data: flowNodes.data,
        })
        .from(flowNodes)
        .where(eq(flowNodes.flowVersionId, src.id));
      const srcEdges = await tx
        .select({
          from_node_id: flowEdges.fromNodeId,
          to_node_id: flowEdges.toNodeId,
          from_socket: flowEdges.fromSocket,
        })
        .from(flowEdges)
        .where(eq(flowEdges.flowVersionId, src.id));

      // Land the restored graph in the current draft (creating one if needed),
      // full-replace strategy.
      const draft = await getOrCreateDraftVersion(tx, flow.id, auth.sub, auth.tenant_id);
      await tx.delete(flowEdges).where(eq(flowEdges.flowVersionId, draft.id));
      await tx.delete(flowNodes).where(eq(flowNodes.flowVersionId, draft.id));
      if (srcNodes.length > 0) {
        await tx.insert(flowNodes).values(
          srcNodes.map((n) => ({
            flowVersionId: draft.id,
            clientNodeId: n.client_node_id,
            kind: n.kind,
            title: n.title,
            positionX: n.position_x,
            positionY: n.position_y,
            data: n.data,
          })),
        );
      }
      if (srcEdges.length > 0) {
        await tx.insert(flowEdges).values(
          srcEdges.map((e) => ({
            flowVersionId: draft.id,
            fromNodeId: e.from_node_id,
            toNodeId: e.to_node_id,
            fromSocket: e.from_socket,
          })),
        );
      }
      await tx.update(flows).set({ updatedAt: new Date() }).where(eq(flows.id, flow.id));

      return { draft_version_id: draft.id, node_count: srcNodes.length, edge_count: srcEdges.length };
    });

    if ('error' in result) {
      return reply.code(result.error === 'flow_not_found' || result.error === 'version_not_found' ? 404 : 400).send(result);
    }
    return reply.send(result);
  });

  // -------------------------------------------------------------------
  // DELETE /api/flows/:id — soft delete
  // -------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/flows/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const flow = await resolveFlow(tx, req.params.id);
      if (!flow) return { error: 'flow_not_found' as const };
      await tx
        .update(flows)
        .set({ deletedAt: new Date() })
        .where(eq(flows.id, flow.id));
      return { id: flow.id };
    });

    if ('error' in result) return reply.code(404).send(result);
    return reply.code(204).send();
  });

  // -------------------------------------------------------------------
  // GET /api/flows/:id/publish-preview — diff between draft and published
  // Returns the set of added/removed/changed nodes and edge counts so the
  // PublishModal can show the user what will change when they publish.
  // -------------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/flows/:id/publish-preview', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const flow = await resolveFlow(tx, req.params.id);
      if (!flow) return null;

      // Draft nodes/edges
      const draftRows = await tx
        .select({ id: flowVersions.id })
        .from(flowVersions)
        .where(and(eq(flowVersions.flowId, flow.id), eq(flowVersions.isPublished, false)))
        .orderBy(desc(flowVersions.versionNumber))
        .limit(1);
      const draftId = draftRows[0]?.id ?? null;

      const draftNodes = draftId
        ? await tx
            .select({
              client_node_id: flowNodes.clientNodeId,
              title: flowNodes.title,
              data: flowNodes.data,
            })
            .from(flowNodes)
            .where(eq(flowNodes.flowVersionId, draftId))
        : [];

      const draftEdges = draftId
        ? await tx
            .select({ from_node_id: flowEdges.fromNodeId, to_node_id: flowEdges.toNodeId })
            .from(flowEdges)
            .where(eq(flowEdges.flowVersionId, draftId))
        : [];

      // Published nodes/edges (empty if flow has never been published)
      const publishedId = flow.publishedVersionId;
      const publishedNodes = publishedId
        ? await tx
            .select({
              client_node_id: flowNodes.clientNodeId,
              title: flowNodes.title,
              data: flowNodes.data,
            })
            .from(flowNodes)
            .where(eq(flowNodes.flowVersionId, publishedId))
        : [];

      const publishedEdges = publishedId
        ? await tx
            .select({ from_node_id: flowEdges.fromNodeId, to_node_id: flowEdges.toNodeId })
            .from(flowEdges)
            .where(eq(flowEdges.flowVersionId, publishedId))
        : [];

      // Compute diff
      const publishedNodeMap = new Map(publishedNodes.map((n) => [n.client_node_id, n]));
      const draftNodeMap = new Map(draftNodes.map((n) => [n.client_node_id, n]));

      const addedNodes: string[] = [];
      const changedNodes: string[] = [];
      for (const dn of draftNodes) {
        const pn = publishedNodeMap.get(dn.client_node_id);
        if (!pn) {
          addedNodes.push(dn.title);
        } else if (
          pn.title !== dn.title ||
          JSON.stringify(pn.data) !== JSON.stringify(dn.data)
        ) {
          changedNodes.push(dn.title);
        }
      }
      const removedNodes = publishedNodes
        .filter((pn) => !draftNodeMap.has(pn.client_node_id))
        .map((pn) => pn.title);

      const pubEdgeSet = new Set(
        publishedEdges.map((e) => `${e.from_node_id}__${e.to_node_id}`),
      );
      const draftEdgeSet = new Set(
        draftEdges.map((e) => `${e.from_node_id}__${e.to_node_id}`),
      );
      const addedEdges = draftEdges.filter(
        (e) => !pubEdgeSet.has(`${e.from_node_id}__${e.to_node_id}`),
      ).length;
      const removedEdges = publishedEdges.filter(
        (e) => !draftEdgeSet.has(`${e.from_node_id}__${e.to_node_id}`),
      ).length;

      return {
        added_nodes: addedNodes,
        removed_nodes: removedNodes,
        changed_nodes: changedNodes,
        added_edges: addedEdges,
        removed_edges: removedEdges,
      };
    });

    if (!result) return reply.code(404).send({ error: 'flow_not_found' });
    return reply.send(result);
  });

  // -------------------------------------------------------------------
  // GET /api/flows/:id/preview?version=draft|published — what Claude sees
  // -------------------------------------------------------------------
  app.get<{
    Params: { id: string };
    Querystring: { version?: string };
  }>('/api/flows/:id/preview', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const wantPublished = req.query.version === 'published';

    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const flow = await resolveFlow(tx, req.params.id);
      if (!flow) return null;

      let versionId: string | null = null;
      let isPublished = false;
      if (wantPublished) {
        versionId = flow.publishedVersionId;
        isPublished = true;
      } else {
        const draft = await tx
          .select({ id: flowVersions.id })
          .from(flowVersions)
          .where(and(eq(flowVersions.flowId, flow.id), eq(flowVersions.isPublished, false)))
          .orderBy(desc(flowVersions.versionNumber))
          .limit(1);
        versionId = draft[0]?.id ?? null;
      }

      if (!versionId) {
        return {
          flow_id: flow.slug,
          flow_name: flow.name,
          version_id: null,
          is_published: isPublished,
          total_steps: 0,
          steps: [] as unknown[],
        };
      }

      const dbNodes = await tx
        .select({
          client_node_id: flowNodes.clientNodeId,
          kind: flowNodes.kind,
          title: flowNodes.title,
          position_x: flowNodes.positionX,
          position_y: flowNodes.positionY,
          data: flowNodes.data,
        })
        .from(flowNodes)
        .where(eq(flowNodes.flowVersionId, versionId));
      const dbEdges = await tx
        .select({
          from_node_id: flowEdges.fromNodeId,
          to_node_id: flowEdges.toNodeId,
          from_socket: flowEdges.fromSocket,
        })
        .from(flowEdges)
        .where(eq(flowEdges.flowVersionId, versionId));

      const ordered = topologicalWalk(dbNodes, dbEdges);

      const steps = [];
      for (let i = 0; i < ordered.length; i++) {
        const node = ordered[i]!; // bounds-checked by loop condition
        const rendered = await renderNodeContent(node, tx);
        steps.push({
          step_index: i + 1,
          node_id: node.client_node_id,
          title: node.title,
          kind: node.kind,
          instruction: rendered.instruction,
          content: rendered.content,
          content_type: rendered.content_type,
          source: rendered.source,
        });
      }

      return {
        flow_id: flow.slug,
        flow_name: flow.name,
        version_id: versionId,
        is_published: isPublished,
        total_steps: steps.length,
        steps,
      };
    });

    if (!result) return reply.code(404).send({ error: 'flow_not_found' });
    return reply.send(result);
  });

  // -------------------------------------------------------------------
  // POST /api/flows/:id/share — enable a share link (any Mnema user can view)
  // -------------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/api/flows/:id/share', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const flow = await resolveFlow(tx, req.params.id);
      if (!flow) return { error: 'flow_not_found' as const };
      const cur = await tx.select({ t: flows.shareToken }).from(flows).where(eq(flows.id, flow.id)).limit(1);
      let token = cur[0]?.t ?? null;
      if (!token) {
        token = nanoid(20);
        await tx.update(flows).set({ shareToken: token, sharedAt: new Date() }).where(eq(flows.id, flow.id));
      }
      return { token };
    });
    if ('error' in result) return reply.code(404).send(result);
    return reply.send({
      share_token: result.token,
      url: `${config.WEB_BASE_URL}/app/flows/shared/${result.token}`,
    });
  });

  // -------------------------------------------------------------------
  // DELETE /api/flows/:id/share — revoke the share link
  // -------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/flows/:id/share', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const flow = await resolveFlow(tx, req.params.id);
      if (!flow) return { error: 'flow_not_found' as const };
      await tx.update(flows).set({ shareToken: null, sharedAt: null }).where(eq(flows.id, flow.id));
      return { ok: true };
    });
    if ('error' in result) return reply.code(404).send(result);
    return reply.send(result);
  });

  // -------------------------------------------------------------------
  // GET /api/flows/shared/:token — read-only published flow for ANY Mnema user.
  // Cross-tenant by design: the unguessable token is the grant. Auth required
  // (must be a logged-in Mnema account) but workspace membership is NOT. Uses
  // the shared db client (owner role bypasses tenant RLS) to read across tenants.
  // -------------------------------------------------------------------
  app.get<{ Params: { token: string } }>('/api/flows/shared/:token', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const token = req.params.token;
    if (!token || token.length > 64) return reply.code(400).send({ error: 'bad_token' });

    const fl = await db
      .select({
        name: flows.name,
        description: flows.description,
        publishedVersionId: flows.publishedVersionId,
      })
      .from(flows)
      .where(and(eq(flows.shareToken, token), isNull(flows.deletedAt)))
      .limit(1);
    if (!fl[0]) return reply.code(404).send({ error: 'not_found' });

    const versionId = fl[0].publishedVersionId;
    if (!versionId) {
      return reply.send({ name: fl[0].name, description: fl[0].description, published: false, nodes: [], edges: [] });
    }

    const nodes = await db
      .select({
        client_node_id: flowNodes.clientNodeId,
        kind: flowNodes.kind,
        title: flowNodes.title,
        position_x: flowNodes.positionX,
        position_y: flowNodes.positionY,
        data: flowNodes.data,
      })
      .from(flowNodes)
      .where(eq(flowNodes.flowVersionId, versionId));
    const edges = await db
      .select({
        from_node_id: flowEdges.fromNodeId,
        to_node_id: flowEdges.toNodeId,
        from_socket: flowEdges.fromSocket,
      })
      .from(flowEdges)
      .where(eq(flowEdges.flowVersionId, versionId));

    return reply.send({ name: fl[0].name, description: fl[0].description, published: true, nodes, edges });
  });
};
