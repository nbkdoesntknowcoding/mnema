/**
 * MCP tool: `get_flow`.
 *
 * Phase 9.4 — returns the full DRAFT graph of a flow so Claude can see what
 * it's editing before making changes. Read-only; does NOT touch the DB.
 *
 * Returns all nodes (client_node_id, kind, title, data, position) and all
 * edges (from_node_id, to_node_id, from_socket / branch_label).
 * `is_dirty` is true when a draft exists that diverges from (or was not yet
 * published) i.e. the draft's version_number > published version's (or there
 * is no published version).
 *
 * Phase 12 Chunk A — getFlowStructured() wraps the same DB logic and returns
 * three-channel output (content + structuredContent + _meta) for the Flow
 * Builder Canvas MCP App.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { flowEdges, flowNodes, flowVersions, flows } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireScope } from '../scope.js';
import { withAudit } from './audit.js';

export const GET_FLOW_TOOL_NAME = 'get_flow';

export const GET_FLOW_TOOL = {
  name: GET_FLOW_TOOL_NAME,
  description: [
    'Get the full draft graph of a flow for editing — all nodes (with their',
    'client_node_id, kind, data, position) and all edges (from/to, branch label).',
    'Use this before editing a flow so you have current node ids.',
    'The Flow Builder Canvas will render the graph visually in the panel.',
    '',
    'NOT to be confused with get_flow_step: get_flow EDITS a DRAFT graph (by UUID);',
    'get_flow_step WALKS a PUBLISHED flow one step at a time (by slug).',
    '',
    'Returns the draft version, not the published one. Read-only.',
    'If no draft exists yet (unmodified published flow), the published graph is returned.',
    '',
    'Arguments:',
    '  flow_id — The flow UUID. Use the `uuid` field from list_flows (not the slug `id` field).',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_id: { type: 'string', description: 'UUID of the flow. Use the `uuid` field from list_flows (not the slug `id` field).' },
    },
    required: ['flow_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'Get a flow draft for editing' },
};

const argsSchema = z.object({
  flow_id: z.string().uuid(),
}).strict();

export interface GetFlowResult {
  flow_id?: string;
  flow_name?: string;
  draft_version_id?: string;
  is_dirty?: boolean;
  nodes?: Array<{
    client_node_id: string;
    kind: string;
    title: string;
    data: Record<string, unknown>;
    position: { x: number; y: number };
  }>;
  edges?: Array<{
    from_node_id: string;
    to_node_id: string;
    branch_label: string | null;
  }>;
  error?: string;
  message?: string;
}

export async function getFlow(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<GetFlowResult> {
  requireScope(ctx, 'docs:read');

  const args = argsSchema.parse(rawArgs);

  return await withAudit(
    ctx,
    { tool_name: GET_FLOW_TOOL.name, args: args as Record<string, unknown> },
    () => withTenant(ctx.tenant_id, async (tx) => {
      // Resolve the flow
      const flowRows = await tx
        .select({ id: flows.id, name: flows.name, publishedVersionId: flows.publishedVersionId })
        .from(flows)
        .where(and(eq(flows.id, args.flow_id), isNull(flows.deletedAt)))
        .limit(1);

      if (flowRows.length === 0) {
        return { error: 'flow_not_found', message: `Flow ${args.flow_id} not found.` };
      }
      const flow = flowRows[0]!;

      // Find the draft version (latest unpublished), or fall back to published
      const draftRows = await tx
        .select({ id: flowVersions.id, versionNumber: flowVersions.versionNumber })
        .from(flowVersions)
        .where(and(eq(flowVersions.flowId, args.flow_id), eq(flowVersions.isPublished, false)))
        .orderBy(desc(flowVersions.versionNumber))
        .limit(1);

      let versionId: string;
      let isDirty: boolean;

      if (draftRows.length > 0) {
        versionId = draftRows[0]!.id;
        isDirty = true;
      } else if (flow.publishedVersionId) {
        versionId = flow.publishedVersionId;
        isDirty = false;
      } else {
        // No versions at all — empty new flow
        return {
          flow_id: flow.id,
          flow_name: flow.name,
          draft_version_id: undefined,
          is_dirty: false,
          nodes: [],
          edges: [],
        };
      }

      // Fetch nodes and edges
      const dbNodes = await tx
        .select({
          clientNodeId: flowNodes.clientNodeId,
          kind: flowNodes.kind,
          title: flowNodes.title,
          data: flowNodes.data,
          positionX: flowNodes.positionX,
          positionY: flowNodes.positionY,
        })
        .from(flowNodes)
        .where(eq(flowNodes.flowVersionId, versionId));

      const dbEdges = await tx
        .select({
          fromNodeId: flowEdges.fromNodeId,
          toNodeId: flowEdges.toNodeId,
          fromSocket: flowEdges.fromSocket,
        })
        .from(flowEdges)
        .where(eq(flowEdges.flowVersionId, versionId));

      return {
        flow_id: flow.id,
        flow_name: flow.name,
        draft_version_id: versionId,
        is_dirty: isDirty,
        nodes: dbNodes.map((n) => ({
          client_node_id: n.clientNodeId,
          kind: n.kind,
          title: n.title,
          data: n.data as Record<string, unknown>,
          position: { x: n.positionX, y: n.positionY },
        })),
        edges: dbEdges.map((e) => ({
          from_node_id: e.fromNodeId,
          to_node_id: e.toNodeId,
          branch_label: e.fromSocket === 'default' ? null : e.fromSocket,
        })),
      };
    }),
    (r) => ({ flow_id: r.flow_id ?? null, error: r.error ?? null }),
  );
}

// ── Phase 12 Chunk A: structured result for Flow Builder Canvas ────────────

export interface GetFlowStructuredResult {
  content: string;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Same DB logic as `getFlow` but returns three-channel output for the
 * Flow Builder Canvas MCP App:
 *   content         — short one-liner for model orientation
 *   structuredContent — full graph for the canvas renderer
 */
export async function getFlowStructured(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<GetFlowStructuredResult> {
  requireScope(ctx, 'docs:read');
  const args = argsSchema.parse(rawArgs);

  return await withAudit(
    ctx,
    { tool_name: GET_FLOW_TOOL_NAME, args: args as Record<string, unknown> },
    () =>
      withTenant(ctx.tenant_id, async (tx) => {
        // 1) Resolve the flow + slug
        const flowRows = await tx
          .select({
            id: flows.id,
            slug: flows.slug,
            name: flows.name,
            publishedVersionId: flows.publishedVersionId,
          })
          .from(flows)
          .where(and(eq(flows.id, args.flow_id), isNull(flows.deletedAt)))
          .limit(1);

        if (flowRows.length === 0) {
          const message = `Flow ${args.flow_id} not found.`;
          return {
            content: `Error: ${message}`,
            structuredContent: { error: 'flow_not_found', message },
            isError: true,
          };
        }
        const flow = flowRows[0]!;

        // 2) published_at — grab from the published version if one exists
        let publishedAt: string | null = null;
        if (flow.publishedVersionId) {
          const pvRows = await tx
            .select({ createdAt: flowVersions.createdAt })
            .from(flowVersions)
            .where(eq(flowVersions.id, flow.publishedVersionId))
            .limit(1);
          if (pvRows[0]) {
            publishedAt = pvRows[0].createdAt.toISOString();
          }
        }

        // 3) Draft version or fall back to published
        const draftRows = await tx
          .select({ id: flowVersions.id })
          .from(flowVersions)
          .where(and(eq(flowVersions.flowId, args.flow_id), eq(flowVersions.isPublished, false)))
          .orderBy(desc(flowVersions.versionNumber))
          .limit(1);

        let versionId: string;
        let isDirty: boolean;

        if (draftRows.length > 0) {
          versionId = draftRows[0]!.id;
          isDirty = true;
        } else if (flow.publishedVersionId) {
          versionId = flow.publishedVersionId;
          isDirty = false;
        } else {
          // Empty flow — no versions yet
          const sc: Record<string, unknown> = {
            flow: { uuid: flow.id, slug: flow.slug, name: flow.name, published_at: null, is_dirty: false },
            nodes: [],
            edges: [],
          };
          return {
            content: `Flow '${flow.slug}': 0 nodes, 0 edges, draft. Graph rendered in canvas.`,
            structuredContent: sc,
          };
        }

        // 4) Fetch nodes and edges
        const dbNodes = await tx
          .select({
            clientNodeId: flowNodes.clientNodeId,
            kind: flowNodes.kind,
            title: flowNodes.title,
            data: flowNodes.data,
            positionX: flowNodes.positionX,
            positionY: flowNodes.positionY,
          })
          .from(flowNodes)
          .where(eq(flowNodes.flowVersionId, versionId));

        const dbEdges = await tx
          .select({
            fromNodeId: flowEdges.fromNodeId,
            toNodeId: flowEdges.toNodeId,
            fromSocket: flowEdges.fromSocket,
          })
          .from(flowEdges)
          .where(eq(flowEdges.flowVersionId, versionId));

        // 5) Build structuredContent
        const statusText = publishedAt && !isDirty ? 'published' : 'draft';
        const content = `Flow '${flow.slug}': ${dbNodes.length} node${dbNodes.length === 1 ? '' : 's'}, ${dbEdges.length} edge${dbEdges.length === 1 ? '' : 's'}, ${statusText}. Graph rendered in canvas.`;

        const structuredContent: Record<string, unknown> = {
          flow: {
            uuid: flow.id,
            slug: flow.slug,
            name: flow.name,
            published_at: publishedAt,
            is_dirty: isDirty,
          },
          nodes: dbNodes.map((n) => ({
            client_node_id: n.clientNodeId,
            kind: n.kind,
            title: n.title,
            position: { x: n.positionX, y: n.positionY },
            data: n.data as Record<string, unknown>,
          })),
          edges: dbEdges.map((e) => ({
            from: e.fromNodeId,
            to: e.toNodeId,
            branch: e.fromSocket === 'default' ? null : e.fromSocket,
          })),
        };

        return { content, structuredContent };
      }),
    (result) =>
      result.isError
        ? { isError: true }
        : {
            flow_id: (result.structuredContent as Record<string, unknown> & { flow?: { uuid?: string } })?.flow?.uuid ?? null,
            isError: false,
          },
  );
}
