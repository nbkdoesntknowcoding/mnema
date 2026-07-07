/**
 * Flow run history helpers (n8n-style executions).
 *
 * The walk is stateless, so a "run" is an explicit record: start_flow_run snapshots
 * the flow's ordered steps into flow_run_steps (pending); submit_flow_capture links
 * each produced doc back to its step and auto-completes the run when every capture
 * step has landed. All scoped through withTenant (RLS).
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { docs, flowEdges, flowNodes, flowRunSteps, flowRuns, flowVersions, flows } from '../../db/schema.js';
import type { FlowRunStepInput, FlowRunStepOutput } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import type { McpAuthContext } from '../../mcp/auth.js';
import { topologicalWalk } from './walk.js';

export interface RunStepSnapshot {
  step_index: number;
  node_id: string;
  kind: string;
  title: string;
}

// Active drizzle transaction — kept loose (same convention as walk.ts) so callers
// can hand their own withTenant tx to recordStepVisitedInTx without a second connection.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RunTx = any;

export async function startFlowRun(
  ctx: McpAuthContext,
  args: { flowId: string; flowVersionId: string | null; flowSlug: string; flowName: string; steps: RunStepSnapshot[] },
): Promise<string> {
  return withTenant(ctx.tenant_id, async (tx) => {
    const rows = await tx
      .insert(flowRuns)
      .values({
        workspaceId: ctx.tenant_id,
        flowId: args.flowId,
        flowVersionId: args.flowVersionId,
        flowSlug: args.flowSlug,
        flowName: args.flowName,
        totalSteps: args.steps.length,
        startedBy: ctx.user_id,
        status: 'running',
      })
      .returning({ id: flowRuns.id });
    const runId = rows[0]!.id;
    if (args.steps.length) {
      await tx.insert(flowRunSteps).values(
        args.steps.map((s) => ({
          runId,
          stepIndex: s.step_index,
          nodeId: s.node_id,
          kind: s.kind,
          title: s.title,
          status: 'pending' as const,
        })),
      );
    }
    return runId;
  });
}

/**
 * Find-or-create an "open" run for a flow so captures are recorded even when the
 * walker never called start_flow_run. Resumes the most recent still-`running` run
 * for this (flow, user) started within the last 12h; otherwise snapshots the flow's
 * steps into a fresh run. An advisory lock on (flow, user) serialises concurrent
 * captures so a burst of them shares ONE run instead of spawning many.
 *
 * Returns the run id, or null if the flow slug doesn't resolve to a published flow.
 */
export async function ensureRunForCapture(ctx: McpAuthContext, flowSlug: string): Promise<string | null> {
  return withTenant(ctx.tenant_id, async (tx) => {
    const flowRows = await tx
      .select({ id: flows.id, name: flows.name, versionId: flowVersions.id })
      .from(flows)
      .innerJoin(flowVersions, eq(flowVersions.id, flows.publishedVersionId))
      .where(and(eq(flows.slug, flowSlug), isNull(flows.deletedAt), eq(flowVersions.isPublished, true)))
      .limit(1);
    const flow = flowRows[0];
    if (!flow) return null;

    // Serialise concurrent captures for the same (flow, user) so they attach to one run.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`flowrun:${flow.id}:${ctx.user_id}`}))`);

    // Resume a still-open run from the last 12h, if any.
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const open = await tx
      .select({ id: flowRuns.id })
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.flowId, flow.id),
          eq(flowRuns.status, 'running'),
          eq(flowRuns.startedBy, ctx.user_id),
          gte(flowRuns.startedAt, cutoff),
        ),
      )
      .orderBy(desc(flowRuns.startedAt))
      .limit(1);
    if (open[0]) return open[0].id;

    // Otherwise snapshot the flow's steps into a fresh run.
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
      .select({ from_node_id: flowEdges.fromNodeId, to_node_id: flowEdges.toNodeId, from_socket: flowEdges.fromSocket })
      .from(flowEdges)
      .where(eq(flowEdges.flowVersionId, flow.versionId));
    const ordered = topologicalWalk(dbNodes, dbEdges);

    const rows = await tx
      .insert(flowRuns)
      .values({
        workspaceId: ctx.tenant_id,
        flowId: flow.id,
        flowVersionId: flow.versionId,
        flowSlug,
        flowName: flow.name,
        totalSteps: ordered.length,
        startedBy: ctx.user_id,
        status: 'running',
      })
      .returning({ id: flowRuns.id });
    const runId = rows[0]!.id;
    if (ordered.length) {
      await tx.insert(flowRunSteps).values(
        ordered.map((n, i) => ({
          runId,
          stepIndex: i + 1,
          nodeId: n.client_node_id,
          kind: n.kind,
          title: n.title,
          status: 'pending' as const,
        })),
      );
    }
    return runId;
  });
}

/** Link a captured doc to its run step; auto-complete the run when all captures are done. */
export async function recordCapture(
  ctx: McpAuthContext,
  args: { runId: string; nodeId: string; docId: string; docTitle: string },
): Promise<void> {
  await withTenant(ctx.tenant_id, async (tx) => {
    const output: FlowRunStepOutput = { doc_id: args.docId, doc_title: args.docTitle };
    const updated = await tx
      .update(flowRunSteps)
      .set({
        status: 'captured',
        capturedDocId: args.docId,
        capturedTitle: args.docTitle,
        output,
        capturedAt: new Date(),
        visitedAt: sql`COALESCE(${flowRunSteps.visitedAt}, now())`,
      })
      .where(and(eq(flowRunSteps.runId, args.runId), eq(flowRunSteps.nodeId, args.nodeId)))
      .returning({ id: flowRunSteps.id });
    if (!updated.length) return; // run_id/node_id didn't match a snapshotted step — ignore silently

    const steps = await tx
      .select({ status: flowRunSteps.status, kind: flowRunSteps.kind })
      .from(flowRunSteps)
      .where(eq(flowRunSteps.runId, args.runId));
    const capturedCount = steps.filter((s) => s.status === 'captured').length;
    const captureNodes = steps.filter((s) => s.kind === 'capture');
    const allCaptured = captureNodes.length > 0 && captureNodes.every((s) => s.status === 'captured');
    await tx
      .update(flowRuns)
      .set({ capturedCount, ...(allCaptured ? { status: 'completed', finishedAt: new Date() } : {}) })
      .where(eq(flowRuns.id, args.runId));
  });
}

/**
 * Build the transaction-local UPDATE that marks a step visited and stores what the
 * model was served (the "input"). Shared so get_flow_step can record inside its own
 * walk transaction without opening a second connection. Never downgrades a step that
 * already reached 'captured'; only flips 'pending' → 'visited'.
 */
export function recordStepVisitedInTx(
  tx: RunTx,
  args: { runId: string; nodeId: string; input: FlowRunStepInput },
): Promise<unknown> {
  return tx
    .update(flowRunSteps)
    .set({
      input: args.input,
      visitedAt: sql`COALESCE(${flowRunSteps.visitedAt}, now())`,
      status: sql`CASE WHEN ${flowRunSteps.status} = 'pending' THEN 'visited' ELSE ${flowRunSteps.status} END`,
    })
    .where(and(eq(flowRunSteps.runId, args.runId), eq(flowRunSteps.nodeId, args.nodeId)));
}

/**
 * Record the model's result for a step (the "output") — its answer, the branch it
 * took, or an action summary. Called by submit_flow_step_result for non-capture steps
 * (capture steps record their output via recordCapture). Marks the step visited/errored;
 * never downgrades a 'captured' step.
 */
export async function recordStepResult(
  ctx: McpAuthContext,
  args: { runId: string; nodeId: string; output: FlowRunStepOutput; error?: string | null; durationMs?: number | null },
): Promise<boolean> {
  return withTenant(ctx.tenant_id, async (tx) => {
    const nextStatus = args.error
      ? sql`'error'`
      : sql`CASE WHEN ${flowRunSteps.status} = 'captured' THEN 'captured' ELSE 'visited' END`;
    const updated = await tx
      .update(flowRunSteps)
      .set({
        output: args.output,
        error: args.error ?? null,
        durationMs: args.durationMs ?? null,
        visitedAt: sql`COALESCE(${flowRunSteps.visitedAt}, now())`,
        status: nextStatus,
      })
      .where(and(eq(flowRunSteps.runId, args.runId), eq(flowRunSteps.nodeId, args.nodeId)))
      .returning({ id: flowRunSteps.id });
    return updated.length > 0;
  });
}

export async function listFlowRuns(ctx: McpAuthContext, flowId: string, limit = 50) {
  return withTenant(ctx.tenant_id, (tx) =>
    tx.select().from(flowRuns).where(eq(flowRuns.flowId, flowId)).orderBy(desc(flowRuns.startedAt)).limit(limit),
  );
}

export async function getFlowRunDetail(ctx: McpAuthContext, runId: string) {
  return withTenant(ctx.tenant_id, async (tx) => {
    const runs = await tx.select().from(flowRuns).where(eq(flowRuns.id, runId)).limit(1);
    const run = runs[0];
    if (!run) return null;
    const steps = await tx
      .select()
      .from(flowRunSteps)
      .where(eq(flowRunSteps.runId, runId))
      .orderBy(flowRunSteps.stepIndex);
    return { run, steps };
  });
}

export interface FlowRunOutputDoc {
  doc_id: string;
  title: string;
  exists: boolean;
  step_index: number;
  node_id: string;
  step_title: string;
}
export interface FlowRunOutput {
  run_id: string;
  flow_slug: string;
  flow_name: string;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  total_steps: number;
  captured_count: number;
  docs: FlowRunOutputDoc[];
}

/**
 * Workspace-wide run outputs: recent runs (default: completed only) each paired
 * with the exact docs their capture steps produced. Lets an agent discover what
 * past flow executions actually wrote without walking each flow. The doc left-join
 * runs under RLS, so `exists=false` means the doc was deleted or is not accessible
 * to the caller; `title` falls back to the capture-time title in that case.
 */
export async function listFlowRunOutputs(
  ctx: McpAuthContext,
  opts: { flowId?: string | null; status?: string; limit?: number },
): Promise<FlowRunOutput[]> {
  const status = opts.status ?? 'completed';
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  return withTenant(ctx.tenant_id, async (tx) => {
    const runRows = await tx
      .select()
      .from(flowRuns)
      .where(
        and(
          status === 'all' ? undefined : eq(flowRuns.status, status),
          opts.flowId ? eq(flowRuns.flowId, opts.flowId) : undefined,
        ),
      )
      .orderBy(desc(flowRuns.startedAt))
      .limit(limit);
    if (!runRows.length) return [];

    const runIds = runRows.map((r) => r.id);
    const stepRows = await tx
      .select({
        runId: flowRunSteps.runId,
        stepIndex: flowRunSteps.stepIndex,
        nodeId: flowRunSteps.nodeId,
        stepTitle: flowRunSteps.title,
        capturedDocId: flowRunSteps.capturedDocId,
        capturedTitle: flowRunSteps.capturedTitle,
        liveId: docs.id,
        liveTitle: docs.title,
      })
      .from(flowRunSteps)
      .leftJoin(docs, and(eq(docs.id, flowRunSteps.capturedDocId), isNull(docs.deletedAt)))
      .where(and(inArray(flowRunSteps.runId, runIds), isNotNull(flowRunSteps.capturedDocId)))
      .orderBy(flowRunSteps.stepIndex);

    const byRun = new Map<string, FlowRunOutputDoc[]>();
    for (const s of stepRows) {
      const arr = byRun.get(s.runId) ?? [];
      arr.push({
        doc_id: s.capturedDocId!,
        title: s.liveTitle ?? s.capturedTitle ?? 'captured doc',
        exists: s.liveId != null,
        step_index: s.stepIndex,
        node_id: s.nodeId,
        step_title: s.stepTitle,
      });
      byRun.set(s.runId, arr);
    }

    return runRows.map((r) => ({
      run_id: r.id,
      flow_slug: r.flowSlug,
      flow_name: r.flowName,
      status: r.status,
      started_at: r.startedAt,
      finished_at: r.finishedAt,
      total_steps: r.totalSteps,
      captured_count: r.capturedCount,
      docs: byRun.get(r.id) ?? [],
    }));
  });
}
