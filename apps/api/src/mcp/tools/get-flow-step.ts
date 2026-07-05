import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { flowEdges, flowNodes, flowVersions, flows } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import { renderNodeContent, topologicalWalk } from '../../lib/flows/walk.js';
import type { McpAuthContext } from '../auth.js';
import { requireScope } from '../scope.js';
import { withAudit } from './audit.js';

export const GET_FLOW_STEP_TOOL_NAME = 'get_flow_step';

/**
 * MCP tool: `get_flow_step`.
 *
 * Retrieves one step from a *published* flow by its 1-indexed step index.
 * Claude is expected to walk a flow by calling this iteratively
 * (step 1, then 2, ...) until `has_more` is false. Each response carries:
 *
 *   - The author's instruction for this step (what to look for / how to read)
 *   - The actual content (the doc text, or the freeform instruction text)
 *   - A `source` block describing where the content came from
 *
 * Drafts are explicitly inaccessible to MCP clients — only published versions
 * are walkable. Phase 6.1 traversal is linear topological order with
 * position_y as the tie-breaker. Decision-node branching arrives in 6.4.
 *
 * Phase 6.1 replaces the Phase 5 stub with this DB-backed implementation.
 */
export const GET_FLOW_STEP_TOOL = {
  name: 'get_flow_step',
  description: [
    'Retrieves one step from a published flow by its index.',
    '',
    'NOT to be confused with get_flow: get_flow_step WALKS a PUBLISHED flow (by slug);',
    'get_flow EDITS a DRAFT graph (by UUID).',
    '',
    'EXECUTION MODEL — a flow is a program, not a document. Walk it one step at a',
    'time and ACT on each step before fetching the next one. Never pre-fetch all',
    'steps and summarize them — that defeats the flow\'s purpose.',
    '',
    'Each step has a `kind` that tells you how to handle it:',
    '  "instruction" — a directive from the flow author. Execute it immediately.',
    '    The `instruction` field IS the action to take (there is no separate content).',
    '    If it says to ask the user something, ask it and WAIT for their answer.',
    '    If it says to adopt a role or set context, do so silently.',
    '    `pause_for_user_input` will be true — do NOT call the next step until',
    '    the user has responded and you have acted on their answer.',
    '  "doc" or "docs" — reference material to ingest as background knowledge.',
    '    Read the `instruction` framing, absorb the `content`, then proceed to',
    '    the next step automatically (no user interaction needed).',
    '',
    'Step response includes:',
    '  `instruction`: the author\'s framing or directive — always read this first',
    '  `content`: the material (doc markdown, snippet, or empty for instruction steps)',
    '  `source`: where the content came from',
    '  `pause_for_user_input`: true when you must interact with the user before',
    '    proceeding; false when you can call the next step immediately',
    '',
    'Call with step_index=1 for the first step, then increment ONLY after fully',
    'executing the current step (including any required user interaction).',
    '',
    'Returns `error: "flow_not_found"` if the slug doesn\'t resolve to a published flow.',
    'Returns `error: "step_out_of_range"` if step_index is past the end.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_id: {
        type: 'string',
        description: 'The flow slug (the `id` field from list_flows, e.g. "example-onboarding") — NOT the uuid.',
      },
      step_index: {
        type: 'integer',
        minimum: 1,
        description: 'Which step to retrieve. 1-indexed; call in order.',
      },
    },
    required: ['flow_id', 'step_index'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'Fetch one step of a published flow' },
};

const argsSchema = z
  .object({
    flow_id: z.string().min(1).max(64),
    // Coerce from string so clients that serialise integers as strings still work
    step_index: z.coerce.number().int().min(1),
  })
  .strict();

export interface GetFlowStepResult {
  flow_id?: string;
  flow_name?: string;
  step_index?: number;
  total_steps?: number;
  has_more?: boolean;
  step?: {
    node_id: string;
    title: string;
    kind: string;
    instruction: string;
    content: string;
    content_type: string;
    source: Record<string, unknown> | null;
    /** True when this step requires user interaction before proceeding to the next step.
     *  Present on instruction-kind steps — stop, execute the instruction (e.g. ask
     *  the user a question), wait for their response, then call the next step. */
    pause_for_user_input: boolean;
  };
  error?: string;
  message?: string;
}

export async function getFlowStep(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<GetFlowStepResult> {
  requireScope(ctx, 'docs:read');
  const args = argsSchema.parse(rawArgs);

  return await withAudit(
    ctx,
    { tool_name: GET_FLOW_STEP_TOOL.name, args },
    async () =>
      withTenant(ctx.tenant_id, async (tx) => {
        // 1) Resolve the flow by slug, joined to its published version.
        const flowRows = await tx
          .select({
            id: flows.id,
            slug: flows.slug,
            name: flows.name,
            versionId: flowVersions.id,
          })
          .from(flows)
          .innerJoin(flowVersions, eq(flowVersions.id, flows.publishedVersionId))
          .where(
            and(
              eq(flows.slug, args.flow_id),
              isNull(flows.deletedAt),
              eq(flowVersions.isPublished, true),
            ),
          )
          .limit(1);

        const flow = flowRows[0];
        if (!flow) {
          return {
            error: 'flow_not_found',
            message: `No published flow with slug '${args.flow_id}' in this workspace. Call list_flows to see available flows.`,
          };
        }

        // 2) Walk the graph topologically.
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
          .where(eq(flowNodes.flowVersionId, flow.versionId));
        const dbEdges = await tx
          .select({
            from_node_id: flowEdges.fromNodeId,
            to_node_id: flowEdges.toNodeId,
            from_socket: flowEdges.fromSocket,
          })
          .from(flowEdges)
          .where(eq(flowEdges.flowVersionId, flow.versionId));

        const ordered = topologicalWalk(dbNodes, dbEdges);

        // 3) Bounds-check the requested step.
        if (args.step_index > ordered.length) {
          return {
            error: 'step_out_of_range',
            message: `Flow '${args.flow_id}' has ${ordered.length} step${ordered.length === 1 ? '' : 's'}; step ${args.step_index} is past the end.`,
            total_steps: ordered.length,
          };
        }

        const node = ordered[args.step_index - 1]!;
        const rendered = await renderNodeContent(node, tx);

        // instruction-kind nodes are pure action directives (no content body).
        // Signal to Claude that it must pause and interact with the user before
        // fetching the next step.
        const pauseForUserInput = node.kind === 'instruction';

        return {
          flow_id: flow.slug,
          flow_name: flow.name,
          step_index: args.step_index,
          total_steps: ordered.length,
          has_more: args.step_index < ordered.length,
          step: {
            node_id: node.client_node_id,
            title: node.title,
            kind: node.kind,
            instruction: rendered.instruction,
            content: rendered.content,
            content_type: rendered.content_type,
            source: rendered.source,
            pause_for_user_input: pauseForUserInput,
          },
        };
      }),
    (result) =>
      result.error
        ? { error: result.error }
        : {
            flow_id: result.flow_id,
            step_index: result.step_index,
            total_steps: result.total_steps,
            has_more: result.has_more,
          },
  );
}

// ── Phase 11 Chunk A: structured result for Walk Simulator ─────────────────

export interface GetFlowStepStructuredResult {
  content: string;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Same DB logic as `getFlowStep` but returns:
 *   - A short one-liner `content` string for model orientation
 *   - Full `structuredContent` for the Walk Simulator HTML panel
 *   - Decision branch data computed from edges
 */
export async function getFlowStepStructured(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<GetFlowStepStructuredResult> {
  requireScope(ctx, 'docs:read');
  const args = argsSchema.parse(rawArgs);

  return await withAudit(
    ctx,
    { tool_name: GET_FLOW_STEP_TOOL_NAME, args },
    async () =>
      withTenant(ctx.tenant_id, async (tx) => {
        // 1) Resolve the flow by slug, joined to its published version.
        const flowRows = await tx
          .select({
            id: flows.id,
            slug: flows.slug,
            name: flows.name,
            versionId: flowVersions.id,
          })
          .from(flows)
          .innerJoin(flowVersions, eq(flowVersions.id, flows.publishedVersionId))
          .where(
            and(
              eq(flows.slug, args.flow_id),
              isNull(flows.deletedAt),
              eq(flowVersions.isPublished, true),
            ),
          )
          .limit(1);

        const flow = flowRows[0];
        if (!flow) {
          const message = `No published flow with slug '${args.flow_id}' in this workspace. Call list_flows to see available flows.`;
          return {
            content: `Error: ${message}`,
            structuredContent: { error: 'flow_not_found', message },
            isError: true,
          };
        }

        // 2) Walk the graph topologically.
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
          .where(eq(flowNodes.flowVersionId, flow.versionId));
        const dbEdges = await tx
          .select({
            from_node_id: flowEdges.fromNodeId,
            to_node_id: flowEdges.toNodeId,
            from_socket: flowEdges.fromSocket,
          })
          .from(flowEdges)
          .where(eq(flowEdges.flowVersionId, flow.versionId));

        const ordered = topologicalWalk(dbNodes, dbEdges);

        // 3) Bounds-check the requested step.
        if (args.step_index > ordered.length) {
          const message = `Flow '${args.flow_id}' has ${ordered.length} step${ordered.length === 1 ? '' : 's'}; step ${args.step_index} is past the end.`;
          return {
            content: `Error: ${message}`,
            structuredContent: { error: 'step_out_of_range', message, total_steps: ordered.length },
            isError: true,
          };
        }

        const node = ordered[args.step_index - 1]!;
        const rendered = await renderNodeContent(node, tx);

        const hasMore = args.step_index < ordered.length;
        const pauseForUserInput = node.kind === 'instruction';

        // 4) Build nodeToIndex map for decision branch resolution.
        const nodeToIndex = new Map<string, number>();
        for (let i = 0; i < ordered.length; i++) {
          nodeToIndex.set(ordered[i]!.client_node_id, i + 1); // 1-indexed
        }

        // 5) Compute decision branches if this is a decision node.
        let decision: { question: string; branches: { label: string; target_step_index: number }[] } | null = null;
        if (node.kind === 'decision') {
          const outEdges = dbEdges.filter((e) => e.from_node_id === node.client_node_id);
          const branches = outEdges
            .map((e) => ({
              label: e.from_socket === 'default' ? 'Continue' : e.from_socket,
              target_step_index: nodeToIndex.get(e.to_node_id) ?? 0,
            }))
            .filter((b) => b.target_step_index > 0);
          const question = (node.data as Record<string, unknown> | null)?.question as string | undefined ?? node.title;
          decision = { question, branches };
        }

        // 6) Build structured content.
        const structuredContent: Record<string, unknown> = {
          flow: {
            slug: flow.slug,
            name: flow.name,
            total_steps: ordered.length,
          },
          step: {
            index: args.step_index,
            kind: node.kind,
            title: node.title,
            instruction: rendered.instruction,
            content: rendered.content,
            source: rendered.source,
            pause_for_user_input: pauseForUserInput,
          },
          decision,
          progress: {
            current: args.step_index,
            total: ordered.length,
          },
          has_more: hasMore,
        };

        // 7) Build short one-liner content string for model orientation.
        const prefix = `Step ${args.step_index} of ${ordered.length}: '${node.title}'`;
        let content: string;
        if (!hasMore) {
          content = `${prefix} — flow complete.`;
        } else if (node.kind === 'decision') {
          content = `${prefix} (decision) — awaiting the user's branch choice in the panel.`;
        } else if (node.kind === 'instruction') {
          const snippet = rendered.instruction
            ? rendered.instruction.slice(0, 100) + (rendered.instruction.length > 100 ? '…' : '')
            : '';
          content = `${prefix} (instruction) — ${snippet}`;
        } else {
          content = `${prefix} (${node.kind}) — reference material available in the walk panel.`;
        }

        return { content, structuredContent };
      }),
    (result) =>
      result.isError
        ? { isError: true }
        : {
            flow_id: (result.structuredContent as any)?.flow?.slug,
            step_index: args.step_index,
            isError: false,
          },
  );
}
