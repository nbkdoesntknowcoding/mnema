/**
 * Cost calculator for LLM API token usage.
 *
 * Pricing is loaded from the model_pricing DB table (NOT hardcoded).
 * Run `npx tsx src/scripts/seed-model-pricing.ts` to update prices.
 *
 * Reference: devmanager/cost/calculator.go
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agentSessions, modelPricing } from '../../db/schema.js';

export interface TokenUsage {
  input_tokens:        number;
  output_tokens:       number;
  cache_read_tokens?:  number;
  cache_write_tokens?: number;
}

/**
 * Calculates the USD cost for a token usage event.
 *
 * Looks up pricing from the DB. Returns 0 if no pricing row is found
 * (log warn is emitted by the caller — this function is pure calculation).
 *
 * Formula matches Anthropic's published pricing:
 *   cost = (tokens / 1_000_000) * price_per_million
 */
export async function calculateCost(
  modelId: string,
  usage: TokenUsage,
): Promise<number> {
  let pricing = await db.query.modelPricing.findFirst({
    where: and(
      eq(modelPricing.modelId, modelId),
      eq(modelPricing.isActive, true),
    ),
  });

  if (!pricing) {
    // Agents report full dated model IDs (e.g. claude-haiku-4-5-20251001)
    // while pricing rows use the alias (claude-haiku-4-5). Fall back to the
    // longest alias that is a dash-boundary prefix of the reported ID, so
    // 'claude-opus-4' can never shadow a 'claude-opus-4-8' report.
    const active = await db.query.modelPricing.findMany({
      where: eq(modelPricing.isActive, true),
    });
    pricing = active
      .filter((p) => modelId.startsWith(`${p.modelId}-`))
      .sort((a, b) => b.modelId.length - a.modelId.length)[0];
  }

  if (!pricing) {
    // Caller should log a warning with modelId
    return 0;
  }

  const inputCost  = (usage.input_tokens  / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.outputPricePerMillion;
  const cacheRead  = ((usage.cache_read_tokens  ?? 0) / 1_000_000) * (pricing.cacheReadPricePerMillion  ?? 0);
  const cacheWrite = ((usage.cache_write_tokens ?? 0) / 1_000_000) * (pricing.cacheWritePricePerMillion ?? 0);

  return inputCost + outputCost + cacheRead + cacheWrite;
}

/**
 * Atomically increments session token counts and cost totals.
 *
 * Uses SQL arithmetic updates to avoid lost-update race conditions when
 * multiple tool calls arrive in rapid succession for the same session.
 */
export async function accumulateSessionCost(
  sessionId: string,
  usage:     TokenUsage,
  cost:      number,
  opts?:     { countToolCall?: boolean },
): Promise<void> {
  // countToolCall defaults true (hook-event path: one usage report per tool
  // call). MCP report_usage passes false — a summary report is not a tool call.
  const toolCallIncrement = (opts?.countToolCall ?? true) ? 1 : 0;
  await db
    .update(agentSessions)
    .set({
      totalInputTokens:     sql`total_input_tokens + ${usage.input_tokens}`,
      totalOutputTokens:    sql`total_output_tokens + ${usage.output_tokens}`,
      totalCacheReadTokens: sql`total_cache_read_tokens + ${usage.cache_read_tokens ?? 0}`,
      totalCostUsd:         sql`total_cost_usd + ${cost}`,
      totalToolCalls:       sql`total_tool_calls + ${toolCallIncrement}`,
    })
    .where(eq(agentSessions.id, sessionId));
}

/**
 * Fetches the current total cost for a session (after accumulation).
 * Returns 0 if session not found.
 */
export async function getSessionTotalCost(sessionId: string): Promise<number> {
  const rows = await db
    .select({ totalCostUsd: agentSessions.totalCostUsd })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);

  return rows[0]?.totalCostUsd ?? 0;
}
