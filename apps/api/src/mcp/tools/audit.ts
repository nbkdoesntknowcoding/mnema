import { db } from '../../db/index.js';
import { toolAudit } from '../../db/schema.js';
import type { McpAuthContext } from '../auth.js';

/**
 * Wrap a tool body so every invocation lands one row in `tool_audit`,
 * regardless of whether the body succeeded or threw.
 *
 * The audit insert runs OUTSIDE `withTenant` on purpose:
 *   - `tool_audit` is partitioned by `created_at` and isn't governed by
 *     the per-tenant RLS policies — workspace_id is just a column value.
 *   - We want the audit row even when a tool rejected on auth/scope
 *     before touching tenant data; the failure itself is interesting.
 *
 * If the audit insert itself fails (DB blip, partition rollover race, …)
 * we log and swallow — losing telemetry must NEVER turn into a tool
 * failure for the caller. Phase 3 may add a retry queue here.
 *
 * Errors thrown by `fn` are preserved in their original shape (Error
 * subclasses included) — that's what lets `McpForbiddenError` from
 * `requireScope()` bubble all the way back to the route handler. Don't
 * unwrap with `throw new Error(message)`; that would erase the type.
 */

interface AuditMeta {
  tool_name: string;
  args: Record<string, unknown>;
}

export async function withAudit<T>(
  ctx: McpAuthContext,
  meta: AuditMeta,
  fn: () => Promise<T>,
  summarize: (result: T) => Record<string, unknown> | null,
): Promise<T> {
  const startedAt = performance.now();
  let captured: { ok: true; value: T } | { ok: false; err: unknown };

  try {
    captured = { ok: true, value: await fn() };
  } catch (err) {
    captured = { ok: false, err };
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  const errorMessage = !captured.ok
    ? captured.err instanceof Error
      ? captured.err.message
      : String(captured.err)
    : null;

  try {
    await db.insert(toolAudit).values({
      workspaceId: ctx.tenant_id,
      userId: ctx.user_id,
      // Phase 4 may split agentId from userId once tokens are explicitly
      // issued to claude.ai's connector identity. For now, same as user.
      agentId: ctx.user_id,
      toolName: meta.tool_name,
      args: meta.args,
      resultSummary: captured.ok ? summarize(captured.value) : null,
      latencyMs,
      status: captured.ok ? 'success' : 'error',
      error: errorMessage,
    });
  } catch (auditErr) {
    // Telemetry-loss must never become a tool failure. Use process.stderr
    // directly to avoid the no-console rule without disabling it inline.
    process.stderr.write(
      `[mcp] audit write failed: ${
        auditErr instanceof Error ? auditErr.message : String(auditErr)
      }\n`,
    );
  }

  if (!captured.ok) {
    // Re-throw the ORIGINAL error so its type (e.g., McpForbiddenError)
    // is preserved for the route layer's catch.
    throw captured.err;
  }
  return captured.value;
}
