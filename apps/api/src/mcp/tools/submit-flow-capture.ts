/**
 * MCP tool: `submit_flow_capture` (Phase 2 of the capture-node feature).
 *
 * A `capture` node (Phase 1) is a design-time slot; while walking a published
 * flow the agent produces content and calls this tool to persist it as a doc.
 * Hybrid approval, per the locked design — the `autonomous` flag is read from the
 * NODE (authored intent), never from the caller:
 *   - node.autonomous !== true → GATED: reuse propose_doc_write's create-proposal;
 *     the existing Approve panel surfaces it; confirm_doc_write commits → createDoc.
 *   - node.autonomous === true → DIRECT: createDoc immediately, with a per-user
 *     rate-limit, a hard size cap, and audit-log provenance.
 *
 * Free-core: ee-free (flows ship in the self-host core).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { flowNodes, flowVersions, flows } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { withAudit } from './audit.js';
import { createDoc } from './create-doc.js';
import { proposeDocWrite } from './propose-doc-write.js';
import { ensureRunForCapture, recordCapture } from '../../lib/flows/runs.js';

export const SUBMIT_FLOW_CAPTURE_TOOL_NAME = 'submit_flow_capture';

// Aligned to the stricter of the two downstream caps (propose_doc_write is 100k;
// create_doc is 200k) so neither path throws on an oversized body.
const MAX_CAPTURE_MARKDOWN = 100_000;

// Per-user rate limit for AUTONOMOUS captures only (gated captures are human-approved).
// In-memory, per-process; a backstop against a runaway autonomous walk.
const autoHits = new Map<string, { count: number; resetAt: number }>();
const AUTO_WINDOW_MS = 60_000;
const AUTO_MAX = 20;
function allowAutonomous(key: string): boolean {
  const now = Date.now();
  const e = autoHits.get(key);
  if (!e || now > e.resetAt) {
    autoHits.set(key, { count: 1, resetAt: now + AUTO_WINDOW_MS });
    return true;
  }
  e.count++;
  return e.count <= AUTO_MAX;
}

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const SUBMIT_FLOW_CAPTURE_TOOL_SPEC = {
  name: SUBMIT_FLOW_CAPTURE_TOOL_NAME,
  description: [
    'Persist the output of a `capture` node while walking a published flow.',
    'Call this when a get_flow_step response for a capture node directs you to.',
    '',
    'The NODE decides approval, not you:',
    '  - gated node   → this creates a proposal; get a human to Approve it, then call',
    '                   confirm_doc_write with the proposal_token to create the doc.',
    '  - autonomous   → the doc is written directly and its id returned immediately.',
    '',
    'Args: flow_slug (the flow you are walking), node_id (the capture node id from the',
    'step), title, markdown (the content you produced), target_folder_id? (override).',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_slug: { type: 'string', description: 'The flow slug (the flow_id from the walk).' },
      node_id: { type: 'string', description: 'The capture node id from the current step.' },
      title: { type: 'string', description: 'Title for the captured doc.' },
      markdown: { type: 'string', description: 'The content to capture as the doc body.' },
      target_folder_id: { type: 'string', description: 'Optional target folder uuid (overrides the node default).' },
      run_id: { type: 'string', description: 'Optional run id from start_flow_run — links this capture into the run-history record.' },
    },
    required: ['flow_slug', 'node_id', 'title', 'markdown'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Submit a flow capture' },
};

const argsSchema = z
  .object({
    flow_slug: z.string().min(1).max(64),
    node_id: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    markdown: z.string().min(1).max(MAX_CAPTURE_MARKDOWN),
    target_folder_id: z.string().uuid().optional(),
    run_id: z.string().uuid().optional(),
  })
  .strict();

export interface SubmitFlowCaptureResult {
  content: string;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

function err(code: string, message: string): SubmitFlowCaptureResult {
  return { content: `Error: ${message}`, structuredContent: { error: code, message }, isError: true };
}

export async function submitFlowCapture(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<SubmitFlowCaptureResult> {
  requireWriteScope(ctx);
  const args = argsSchema.parse(rawArgs);

  // Resolve the capture node from the PUBLISHED flow — authored intent governs.
  const node = await withTenant(ctx.tenant_id, async (tx) => {
    const flowRows = await tx
      .select({ versionId: flowVersions.id })
      .from(flows)
      .innerJoin(flowVersions, eq(flowVersions.id, flows.publishedVersionId))
      .where(and(eq(flows.slug, args.flow_slug), isNull(flows.deletedAt), eq(flowVersions.isPublished, true)))
      .limit(1);
    const flow = flowRows[0];
    if (!flow) return null;
    const rows = await tx
      .select({ kind: flowNodes.kind, data: flowNodes.data })
      .from(flowNodes)
      .where(and(eq(flowNodes.flowVersionId, flow.versionId), eq(flowNodes.clientNodeId, args.node_id)))
      .limit(1);
    return rows[0] ?? null;
  });

  if (!node) {
    return err('node_not_found', `No node '${args.node_id}' in published flow '${args.flow_slug}'.`);
  }
  if (node.kind !== 'capture') {
    return err(
      'not_a_capture_node',
      `Node '${args.node_id}' is a '${node.kind}' node, not 'capture'. submit_flow_capture only targets capture nodes.`,
    );
  }

  const data = (node.data ?? {}) as Record<string, unknown>;
  const autonomous = data.autonomous === true; // from the NODE, never the caller
  const folderId =
    args.target_folder_id ?? (typeof data.target_folder_id === 'string' ? data.target_folder_id : undefined);

  // Resolve the run this capture belongs to. Prefer the caller-threaded run_id; else
  // auto-open/attach one so a flow that produces docs ALWAYS gets a run record — even
  // when the walker never called start_flow_run. Best-effort: never fail the capture.
  let runId: string | undefined = args.run_id;
  if (!runId) {
    try {
      runId = (await ensureRunForCapture(ctx, args.flow_slug)) ?? undefined;
    } catch { /* recording is best-effort */ }
  }

  // ── GATED (default): reuse the propose→approve seam (opens the existing panel) ──
  if (!autonomous) {
    const proposal = await proposeDocWrite(ctx, {
      operation: 'create',
      title: args.title,
      markdown: args.markdown,
      folder_id: folderId,
      // Carry the run link through approve→confirm_doc_write so the created doc records.
      ...(runId ? { flow_capture: { run_id: runId, node_id: args.node_id, flow_slug: args.flow_slug } } : {}),
    });
    if (proposal.error) {
      return err(proposal.error, proposal.message ?? proposal.error);
    }
    return {
      content:
        `Capture proposed: "${args.title}". Awaiting human approval — once Approved in the panel, ` +
        `call confirm_doc_write with the proposal_token to create the doc and receive its id.`,
      structuredContent: proposal.structuredContent as Record<string, unknown>,
    };
  }

  // ── AUTONOMOUS (opt-in, authored): write directly, with guards + provenance ────
  return withAudit(
    ctx,
    {
      tool_name: SUBMIT_FLOW_CAPTURE_TOOL_NAME,
      args: { flow_slug: args.flow_slug, node_id: args.node_id, autonomous: true, created_by: 'flow_capture' },
    },
    async (): Promise<SubmitFlowCaptureResult> => {
      if (!allowAutonomous(ctx.user_id)) {
        return err('rate_limited', 'Autonomous capture rate limit exceeded — try again shortly.');
      }
      const result = await createDoc(ctx, {
        title: args.title,
        markdown: args.markdown,
        folder_id: folderId,
        idempotency_key: `fc:${shortHash(args.flow_slug + args.node_id + args.markdown)}`,
        user_confirmed: true,
      });
      if (result.error) {
        return err(result.error, result.message ?? result.error);
      }
      // Link into the run-history record (auto-opened above if the walker didn't).
      if (runId && result.doc_id) {
        try {
          await recordCapture(ctx, {
            runId,
            nodeId: args.node_id,
            docId: result.doc_id,
            docTitle: result.title ?? args.title,
          });
        } catch { /* run-linking is best-effort — never fail the capture on it */ }
      }
      return {
        content: `Captured "${result.title}" (autonomous) → doc ${result.doc_id}. Provenance logged (flow=${args.flow_slug}, node=${args.node_id}).`,
        structuredContent: {
          doc_id: result.doc_id,
          title: result.title,
          autonomous: true,
          created_by: 'flow_capture',
          flow_slug: args.flow_slug,
          node_id: args.node_id,
        },
      };
    },
    (r) => (r.isError ? { isError: true } : { doc_id: (r.structuredContent as { doc_id?: string }).doc_id }),
  );
}
