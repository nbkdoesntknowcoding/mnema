/**
 * Per-tenant aggregate metrics for autocomplete, flushed to stdout once
 * a minute. Per-keystroke `tool_audit` writes would explode that table —
 * autocomplete fires at debounce-bound rates that can hit thousands per
 * tenant per hour during heavy editing.
 *
 * Phase 4 may persist these to a dedicated `autocomplete_metrics` table
 * with proper aggregation; for 3.4 stdout is enough — production logging
 * (Axiom in Phase D) captures this stream natively.
 *
 * `unref()` on the interval ensures it doesn't keep the process alive
 * during graceful shutdown.
 */

interface MetricsBucket {
  requests: number;
  aborts: number;
  rateLimited: number;
  tokensOut: number;
  errors: number;
}

const buckets = new Map<string, MetricsBucket>();

function bucketFor(tenantId: string): MetricsBucket {
  let bucket = buckets.get(tenantId);
  if (!bucket) {
    bucket = { requests: 0, aborts: 0, rateLimited: 0, tokensOut: 0, errors: 0 };
    buckets.set(tenantId, bucket);
  }
  return bucket;
}

export function recordRequestStarted(tenantId: string): void {
  bucketFor(tenantId).requests += 1;
}
export function recordAbort(tenantId: string): void {
  bucketFor(tenantId).aborts += 1;
}
export function recordRateLimited(tenantId: string): void {
  bucketFor(tenantId).rateLimited += 1;
}
export function recordTokens(tenantId: string, n: number): void {
  bucketFor(tenantId).tokensOut += n;
}
export function recordError(tenantId: string): void {
  bucketFor(tenantId).errors += 1;
}

setInterval(() => {
  if (buckets.size === 0) return;
  for (const [tenantId, b] of buckets) {
    // Skip pure-zero buckets — only fired on metric calls anyway, but a
    // bucket may be left at 0 from a prior flush + nothing since.
    if (b.requests === 0 && b.rateLimited === 0 && b.aborts === 0 && b.errors === 0) {
      continue;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[autocomplete-metrics] tenant=${tenantId} ` +
        `req=${b.requests} abort=${b.aborts} rl=${b.rateLimited} ` +
        `tok=${b.tokensOut} err=${b.errors}`,
    );
  }
  buckets.clear();
}, 60_000).unref();
