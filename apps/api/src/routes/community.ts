/**
 * Community Flows — CORE client routes (Phase 2, P2-2…P2-6).
 *
 * These ship to EVERY instance (cloud + self-hosted). They proxy the central
 * hub (so the browser never calls it directly / cross-origin), import a hub
 * template into the caller's workspace as a new draft flow, and publish a local
 * flow up to the hub. All hub I/O goes through lib/community/hub-client.
 *
 * Registered from server.ts as core (NOT ee) — self-hosters must be able to
 * browse/import/publish. When COMMUNITY_HUB_ENABLED=false every route returns
 * 404 community_disabled.
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { flows, flowVersions, flowNodes, flowEdges, workspaceMembers } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { enforceFreeFlowLimit } from '../plugins/free-limits.js';
import { enforceRateLimit } from '../lib/auth-rate-limit.js';
import { sanitizeFlowForPublish, rehydrateFlowFromTemplate } from '../lib/flows/portability.js';
import { validateTemplate } from '../lib/flows/template-schema.js';
import { isCommunityEnabled, getHubKey, getHubBaseUrl } from '../lib/community/hub-config.js';
import {
  hubList,
  hubGet,
  hubPublish,
  hubUnpublish,
  hubReport,
  hubBumpImport,
  HubError,
  CommunityDisabledError,
} from '../lib/community/hub-client.js';

/** Transaction handle type (mirrors the local alias in db/with-tenant.ts). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE_ROLES = new Set(['owner', 'admin', 'editor']);

function hubErrorToReply(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof CommunityDisabledError) return reply.code(404).send({ error: 'community_disabled' });
  if (err instanceof HubError) {
    if (err.status === 404) return reply.code(404).send({ error: 'not_found' });
    if (err.status === 401) return reply.code(400).send({ error: 'hub_rejected_key', message: err.message });
    if (err.status === 422) return reply.code(422).send({ error: 'invalid_template', body: err.body });
    return reply.code(502).send({ error: 'hub_error', message: err.message });
  }
  reply.log.error({ err }, 'community route unexpected error');
  return reply.code(500).send({ error: 'internal_error' });
}

async function resolveFlowTx(tx: Tx, idOrSlug: string) {
  const [flow] = await tx
    .select()
    .from(flows)
    .where(and(UUID_RE.test(idOrSlug) ? eq(flows.id, idOrSlug) : eq(flows.slug, idOrSlug), isNull(flows.deletedAt)))
    .limit(1);
  return flow ?? null;
}

async function memberRole(tx: Tx, workspaceId: string, userId: string): Promise<string | null> {
  const [m] = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

export const communityRoutes: FastifyPluginAsync = async (app) => {
  // Guard: whole feature disabled → 404 for every route EXCEPT the status
  // endpoint, which must always report so Settings can show the disabled state.
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/community/config')) return;
    if (!isCommunityEnabled()) return reply.code(404).send({ error: 'community_disabled' });
  });

  // ── GET /api/community/config — non-secret status for Settings ──────────────
  app.get('/api/community/config', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    return reply.send({
      enabled: isCommunityEnabled(),
      hub_url: getHubBaseUrl(),
      can_publish: isCommunityEnabled() && !!getHubKey(),
    });
  });

  // ── GET /api/community/flows — browse (proxied) ─────────────────────────────
  app.get('/api/community/flows', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const q = req.query as Record<string, string>;
    try {
      const result = await hubList({
        q: q.q,
        tag: q.tag,
        sort: q.sort,
        cursor: q.cursor ? Number(q.cursor) : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      });
      return reply.send(result);
    } catch (err) {
      return hubErrorToReply(err, reply);
    }
  });

  // ── GET /api/community/flows/:slug — detail (proxied) ───────────────────────
  app.get<{ Params: { slug: string } }>('/api/community/flows/:slug', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try {
      const detail = await hubGet(req.params.slug);
      return reply.send(detail);
    } catch (err) {
      return hubErrorToReply(err, reply);
    }
  });

  // ── POST /api/community/flows/:slug/import — rehydrate into a new local flow ─
  app.post<{ Params: { slug: string } }>('/api/community/flows/:slug/import', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const auth = req.auth;
    if (await enforceFreeFlowLimit(req, reply, auth.tenant_id)) return;

    // Fetch + validate the template before touching the DB.
    let template;
    try {
      const detail = await hubGet(req.params.slug);
      const validated = validateTemplate(detail.template_json);
      if (!validated.ok) return reply.code(422).send({ error: 'invalid_template', errors: validated.errors });
      template = validated.template;
    } catch (err) {
      return hubErrorToReply(err, reply);
    }

    const rehydrated = rehydrateFlowFromTemplate(template);

    try {
      const result = await withTenant(auth.tenant_id, async (tx) => {
        const role = await memberRole(tx, auth.tenant_id, auth.sub);
        if (!role || !WRITE_ROLES.has(role)) return { error: 'insufficient_role' as const };

        const baseSlug =
          rehydrated.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44) || 'flow';
        const slug = `${baseSlug}-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;

        const [createdFlow] = await tx
          .insert(flows)
          .values({
            workspaceId: auth.tenant_id,
            slug,
            name: rehydrated.name,
            description: rehydrated.description,
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

        if (rehydrated.nodes.length > 0) {
          await tx.insert(flowNodes).values(
            rehydrated.nodes.map((n) => ({
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
        if (rehydrated.edges.length > 0) {
          await tx.insert(flowEdges).values(
            rehydrated.edges.map((e) => ({
              flowVersionId: draft.id,
              fromNodeId: e.from_node_id,
              toNodeId: e.to_node_id,
              fromSocket: e.from_socket,
            })),
          );
        }

        return { flow_slug: createdFlow.slug, unbound_nodes: rehydrated.unboundNodes };
      });

      if ('error' in result) return reply.code(403).send(result);

      // Best-effort import counter bump — never fail the import on this.
      void hubBumpImport(req.params.slug).catch(() => undefined);

      return reply.code(201).send(result);
    } catch (err) {
      return hubErrorToReply(err, reply);
    }
  });

  // ── POST /api/community/flows/:slug/report — report intake (proxied) ────────
  app.post<{ Params: { slug: string } }>('/api/community/flows/:slug/report', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    if (await enforceRateLimit(req, reply, { category: 'community-report', max: 10, windowSec: 3600 })) return;
    const body = (req.body ?? {}) as { reason?: string; detail?: string };
    try {
      await hubReport(req.params.slug, { reason: body.reason ?? 'other', detail: body.detail });
      return reply.code(202).send({ received: true });
    } catch (err) {
      return hubErrorToReply(err, reply);
    }
  });

  // ── POST /api/flows/:id/publish-to-community — sanitize + upload ────────────
  app.post<{ Params: { id: string }; Body: { tags?: string[]; description_override?: string } }>(
    '/api/flows/:id/publish-to-community',
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
      const auth = req.auth;
      if (!getHubKey()) {
        return reply.code(400).send({ error: 'no_community_key', message: 'Add your community key to publish.' });
      }
      if (await enforceRateLimit(req, reply, { category: 'community-publish', identifier: auth.tenant_id, max: 20, windowSec: 3600 })) {
        return;
      }

      // Load + sanitize the published version inside the tenant scope.
      const prepared = await withTenant(auth.tenant_id, async (tx) => {
        const role = await memberRole(tx, auth.tenant_id, auth.sub);
        if (!role || !WRITE_ROLES.has(role)) return { error: 'insufficient_role' as const };

        const flow = await resolveFlowTx(tx, req.params.id);
        if (!flow) return { error: 'flow_not_found' as const };
        if (!flow.publishedVersionId) return { error: 'not_published' as const };

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
          .where(eq(flowNodes.flowVersionId, flow.publishedVersionId));
        const edges = await tx
          .select({
            from_node_id: flowEdges.fromNodeId,
            to_node_id: flowEdges.toNodeId,
            from_socket: flowEdges.fromSocket,
          })
          .from(flowEdges)
          .where(eq(flowEdges.flowVersionId, flow.publishedVersionId));

        return {
          flowId: flow.id,
          name: flow.name,
          description: (req.body?.description_override ?? flow.description) ?? null,
          nodes,
          edges,
        };
      });

      if ('error' in prepared) {
        const status = prepared.error === 'flow_not_found' ? 404 : prepared.error === 'not_published' ? 409 : 403;
        return reply.code(status).send(prepared);
      }

      const tags = Array.isArray(req.body?.tags) ? req.body.tags.filter((t) => typeof t === 'string').slice(0, 10) : [];
      const template = sanitizeFlowForPublish(prepared.nodes as never, prepared.edges as never, {
        name: prepared.name,
        description: prepared.description,
        tags,
      });

      try {
        const published = await hubPublish({
          template_json: template,
          name: prepared.name,
          description: prepared.description,
          tags,
        });
        await withTenant(auth.tenant_id, async (tx) => {
          await tx.update(flows).set({ communitySlug: published.slug }).where(eq(flows.id, prepared.flowId));
        });
        return reply.send({ community_slug: published.slug, community_url: published.url });
      } catch (err) {
        return hubErrorToReply(err, reply);
      }
    },
  );

  // ── DELETE /api/flows/:id/publish-to-community — owner unpublish ─────────────
  app.delete<{ Params: { id: string } }>('/api/flows/:id/publish-to-community', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const auth = req.auth;

    const found = await withTenant(auth.tenant_id, async (tx) => {
      const role = await memberRole(tx, auth.tenant_id, auth.sub);
      if (!role || !WRITE_ROLES.has(role)) return { error: 'insufficient_role' as const };
      const flow = await resolveFlowTx(tx, req.params.id);
      if (!flow) return { error: 'flow_not_found' as const };
      return { flowId: flow.id, communitySlug: flow.communitySlug };
    });

    if ('error' in found) {
      return reply.code(found.error === 'flow_not_found' ? 404 : 403).send(found);
    }
    if (!found.communitySlug) return reply.send({ removed: true });

    try {
      await hubUnpublish(found.communitySlug);
    } catch (err) {
      // If the hub rejects, still clear locally only on 404 (already gone).
      if (!(err instanceof HubError && err.status === 404)) return hubErrorToReply(err, reply);
    }
    await withTenant(auth.tenant_id, async (tx) => {
      await tx.update(flows).set({ communitySlug: null }).where(eq(flows.id, found.flowId));
    });
    return reply.send({ removed: true });
  });
};
