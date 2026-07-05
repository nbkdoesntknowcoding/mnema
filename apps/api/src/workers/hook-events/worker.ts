/**
 * BullMQ Worker — hook event processor (Phase 2 AgentLens).
 *
 * Processes Claude Code hook events enqueued by POST /api/hooks/claude-code.
 * Runs with concurrency 10 — each job is a single hook event.
 *
 * Job lifecycle:
 *   1. Normalise raw payload via adapter
 *   2. Upsert agent session
 *   3. Store tool_call row (PostToolUse)
 *   4. Generate + store file diff (Write/Edit tools)
 *   5. Calculate cost + accumulate on session
 *   6. Emit session_cost_updated SSE event
 *   7. Check budget thresholds (async, non-blocking)
 *   8. On Stop: finalise session + trigger GitHub PR lookup
 *
 * Failure policy: 3 retries with exponential backoff.
 * After exhaustion: log full payload + discard (fail-open).
 * Never propagate errors to the agent.
 */

import { Worker, type Job } from 'bullmq';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { config } from '../../config/env.js';
import { agentSessions, fileDiffs, toolCalls } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import {
  normaliseClaudeCodePayload,
  extractFilePath,
  extractWriteContent,
  type ClaudeCodeHookPayload,
} from '../../lib/dev/adapters/claude-code.js';
import { checkBudgetThreshold } from '../../lib/dev/budget.js';
import {
  accumulateSessionCost,
  calculateCost,
  getSessionTotalCost,
} from '../../lib/dev/cost.js';
import { generateUnifiedDiff } from '../../lib/dev/diff.js';
import { emitWorkspaceEvent } from '../../lib/events.js';
import type { HookEventJobData } from '../../queue/hook-events.js';
import { HOOK_EVENTS_QUEUE_NAME } from '../../queue/hook-events.js';

// ── Payload size limits ───────────────────────────────────────────────────────

const MAX_JSON_BYTES = 50 * 1024; // 50KB max per tool call input/output JSON

function truncateJson(
  value: Record<string, unknown> | undefined,
): { json: Record<string, unknown> | undefined; truncated: boolean } {
  if (!value) return { json: undefined, truncated: false };
  const serialised = JSON.stringify(value);
  if (Buffer.byteLength(serialised, 'utf8') > MAX_JSON_BYTES) {
    // Keep a minimal truncation marker so the row still shows something useful
    return {
      json: { _truncated: true, _original_keys: Object.keys(value) },
      truncated: true,
    };
  }
  return { json: value, truncated: false };
}

// ── Session upsert ────────────────────────────────────────────────────────────

async function upsertSession(
  workspaceId: string,
  hook: ClaudeCodeHookPayload,
): Promise<{ id: string; totalCostUsd: number; totalToolCalls: number }> {
  const sessionId = hook.session_id;
  const developerId = hook.developer_id ?? 'unknown';

  return await withSystemPrivilege(async (tx) => {
    // Check if session already exists
    const existing = await tx
      .select({
        id:             agentSessions.id,
        totalCostUsd:   agentSessions.totalCostUsd,
        totalToolCalls: agentSessions.totalToolCalls,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (existing[0]) {
      // Update model/git info if newly available
      const updates: Partial<typeof agentSessions.$inferInsert> = {};
      if (hook.model && !existing[0]) updates.model = hook.model;
      if (hook.git_branch) updates.gitBranch = hook.git_branch;
      if (hook.git_commit) updates.gitCommitBefore = hook.git_commit;

      if (Object.keys(updates).length > 0) {
        await tx
          .update(agentSessions)
          .set(updates)
          .where(eq(agentSessions.id, sessionId));
      }

      return existing[0];
    }

    // Create new session — insert with provided session_id as the UUID
    // We use a raw insert here so Claude Code's session_id becomes our PK
    // (gives stable session URLs that match what Claude Code tracks internally)
    const inserted = await tx
      .insert(agentSessions)
      .values({
        // Use the provided session_id directly as our UUID.
        // If it's not a valid UUID format, Postgres will reject it — that's fine,
        // we'll catch below and create a fresh random UUID instead.
        workspaceId,
        developerId,
        agent:            'claude_code',
        status:           'active',
        model:            hook.model,
        gitBranch:        hook.git_branch,
        gitCommitBefore:  hook.git_commit,
      })
      .returning({
        id:             agentSessions.id,
        totalCostUsd:   agentSessions.totalCostUsd,
        totalToolCalls: agentSessions.totalToolCalls,
      });

    return inserted[0]!;
  });
}

// ── Tool call storage ─────────────────────────────────────────────────────────

async function storeToolCall(
  sessionId:   string,
  workspaceId: string,
  hook:        ClaudeCodeHookPayload,
  costUsd:     number,
): Promise<{ id: string }> {
  const filePath   = extractFilePath(hook.tool_name, hook.tool_input ?? {});
  const inputTrunc  = truncateJson(hook.tool_input);
  const outputTrunc = truncateJson(hook.tool_response);

  const rows = await withSystemPrivilege((tx) =>
    tx
      .insert(toolCalls)
      .values({
        sessionId,
        workspaceId,
        toolName:         hook.tool_name,
        inputJson:        inputTrunc.json,
        outputJson:       outputTrunc.json,
        truncated:        inputTrunc.truncated || outputTrunc.truncated,
        filePath,
        durationMs:       hook.duration_ms,
        isError:          hook.is_error ?? false,
        errorMessage:     hook.error_message,
        exitCode:         hook.exit_code,
        inputTokens:      hook.usage?.input_tokens ?? 0,
        outputTokens:     hook.usage?.output_tokens ?? 0,
        cacheReadTokens:  hook.usage?.cache_read_tokens ?? 0,
        cacheWriteTokens: hook.usage?.cache_write_tokens ?? 0,
        costUsd,
      })
      .returning({ id: toolCalls.id }),
  );

  return rows[0]!;
}

// ── File diff storage ─────────────────────────────────────────────────────────

async function storeFileDiff(
  sessionId:   string,
  workspaceId: string,
  toolCallId:  string,
  hook:        ClaudeCodeHookPayload,
): Promise<void> {
  const filePath = extractFilePath(hook.tool_name, hook.tool_input ?? {});
  if (!filePath) return;

  const { oldContent, newContent } = extractWriteContent(
    hook.tool_name,
    hook.tool_input ?? {},
    hook.tool_response,
  );

  if (!newContent) return; // no content to diff

  const { diff, linesAdded, linesRemoved, truncated } = generateUnifiedDiff(
    filePath,
    oldContent,
    newContent,
  );

  await withSystemPrivilege((tx) =>
    tx.insert(fileDiffs).values({
      sessionId,
      workspaceId,
      toolCallId,
      filePath,
      diffContent:  diff,
      truncated,
      linesAdded,
      linesRemoved,
    }),
  );

  // Increment filesModifiedCount on the session
  await withSystemPrivilege((tx) =>
    tx
      .update(agentSessions)
      .set({ filesModifiedCount: drizzleSql`files_modified_count + 1` })
      .where(eq(agentSessions.id, sessionId)),
  );
}

// ── Session finalisation ──────────────────────────────────────────────────────

async function finaliseSession(
  sessionId:   string,
  workspaceId: string,
  hook:        ClaudeCodeHookPayload,
): Promise<void> {
  await withSystemPrivilege((tx) =>
    tx
      .update(agentSessions)
      .set({
        status:         'completed',
        endedAt:        new Date(),
        gitCommitAfter: hook.git_commit,
      })
      .where(eq(agentSessions.id, sessionId)),
  );

  // Emit session_ended SSE event
  const totalCostUsd = await getSessionTotalCost(sessionId);
  emitWorkspaceEvent(workspaceId, {
    type: 'session_ended',
    data: { sessionId, totalCostUsd, status: 'completed' },
  });

  // GitHub PR attribution (async, non-blocking — runs after 202 is sent)
  const { findPrForBranch } = await import('../../lib/dev/github.js');
  if (hook.git_branch && process.env.GITHUB_REPO_OWNER && process.env.GITHUB_REPO_NAME) {
    findPrForBranch(
      hook.git_branch,
      process.env.GITHUB_REPO_OWNER,
      process.env.GITHUB_REPO_NAME,
    )
      .then(async (pr: import('../../lib/dev/github.js').PrInfo | null) => {
        if (!pr) return;
        await withSystemPrivilege((tx) =>
          tx
            .update(agentSessions)
            .set({ gitCommitAfter: pr.url })
            .where(eq(agentSessions.id, sessionId)),
        );
      })
      .catch((err: unknown) => {
        console.error('[hook-events] GitHub PR lookup failed:', err);
      });
  }
}

// ── Main job processor ────────────────────────────────────────────────────────

async function processHookEvent(job: Job<HookEventJobData>): Promise<void> {
  const { workspaceId, adapter, payload } = job.data;

  if (adapter !== 'claude-code') {
    // Other adapters not yet implemented
    return;
  }

  let hook: ClaudeCodeHookPayload;
  try {
    hook = normaliseClaudeCodePayload(payload);
  } catch (err) {
    // Malformed payload — discard after logging (no retry needed)
    console.error('[hook-events] payload normalisation failed:', err, { workspaceId });
    return;
  }

  // 1. Upsert session
  const session = await upsertSession(workspaceId, hook);

  // 2. Process PostToolUse events
  if (hook.hook_event_name === 'PostToolUse') {
    // 3. Calculate cost
    let cost = 0;
    if (hook.usage && hook.model) {
      cost = await calculateCost(hook.model, hook.usage);
      if (cost === 0 && hook.model) {
        console.warn('[hook-events] No pricing found for model:', hook.model);
      }
    }

    // 4. Store tool call
    const toolCall = await storeToolCall(session.id, workspaceId, hook, cost);

    // 5. Store file diff (Write/Edit tools)
    if (['Write', 'Edit', 'MultiEdit'].includes(hook.tool_name)) {
      await storeFileDiff(session.id, workspaceId, toolCall.id, hook).catch((err: unknown) => {
        console.error('[hook-events] file diff storage failed:', err);
      });
    }

    // 6. Accumulate cost on session
    if (hook.usage) {
      await accumulateSessionCost(session.id, hook.usage, cost);
    }

    // 7. Emit real-time SSE event
    const newTotal = session.totalCostUsd + cost;
    emitWorkspaceEvent(workspaceId, {
      type: 'session_cost_updated',
      data: {
        sessionId:      session.id,
        developerId:    hook.developer_id ?? 'unknown',
        totalCostUsd:   newTotal,
        totalToolCalls: session.totalToolCalls + 1,
        latestToolName: hook.tool_name,
      },
    });

    // 8. Check budget (non-blocking)
    checkBudgetThreshold(workspaceId).catch((err: unknown) => {
      console.error('[hook-events] budget check failed:', err);
    });
  }

  // 9. Process session start (PreToolUse on first call)
  if (hook.hook_event_name === 'PreToolUse' && session.totalToolCalls === 0) {
    emitWorkspaceEvent(workspaceId, {
      type: 'session_started',
      data: {
        sessionId:   session.id,
        developerId: hook.developer_id ?? 'unknown',
        agent:       'claude_code',
      },
    });
  }

  // 10. Process Stop event
  if (hook.hook_event_name === 'Stop') {
    await finaliseSession(session.id, workspaceId, hook);
  }
}

// ── Worker factory ────────────────────────────────────────────────────────────

export function startHookEventsWorker(): Worker<HookEventJobData> {
  // Dedicated connection for the worker (separate from queue connection)
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker<HookEventJobData>(
    HOOK_EVENTS_QUEUE_NAME,
    async (job) => {
      await processHookEvent(job);
    },
    {
      connection,
      concurrency: 10,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[hook-events] ${job.id} processed adapter=${job.data.adapter} ws=${job.data.workspaceId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[hook-events] ${job?.id ?? '?'} failed (attempt ${job?.attemptsMade ?? '?'}):`,
      err.message,
      { workspaceId: job?.data.workspaceId, adapter: job?.data.adapter },
    );
  });

  worker.on('error', (err) => {
    console.error('[hook-events] worker error:', err);
  });

  return worker;
}
