import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/env.js';
import {
  recordAbort,
  recordError,
  recordRateLimited,
  recordRequestStarted,
  recordTokens,
} from './metrics.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { checkRateLimits, recordRequest } from './rate-limit.js';

/**
 * Production autocomplete handler — `POST /api/complete`.
 *
 * SSE streaming via Vercel AI SDK + Gemini 2.5 Flash-Lite. The single
 * non-trivial responsibility here is end-to-end abort propagation:
 *
 *     client closes fetch  →  req.raw 'close' event  →  controller.abort()
 *     → streamText's abortSignal trips  →  Google API request cancelled
 *     → no further tokens billed
 *
 * Without this chain, a user typing fast would burn $50/day on completions
 * the editor never displays. With it, mid-stream cancellations cost only
 * the tokens that already landed.
 */

const bodySchema = z.object({
  prefix: z.string().max(10000),
  suffix: z.string().max(2000),
  doc_id: z.string().uuid(),
});

// Provider built once; pinned to our config-validated key (which lives in
// `GEMINI_API_KEY` rather than `GOOGLE_GENERATIVE_AI_API_KEY` since the
// rest of the .env uses the friendlier name).
const google = createGoogleGenerativeAI({ apiKey: config.GEMINI_API_KEY });

export async function handleComplete(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.auth) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    return;
  }

  const userId = req.auth.sub;
  const tenantId = req.auth.tenant_id;

  const limit = await checkRateLimits({ userId, tenantId });
  if (!limit.allowed) {
    recordRateLimited(tenantId);
    reply
      .code(429)
      .header('Retry-After', String(limit.retryAfterSec ?? 60))
      .header('X-RateLimit-Reason', limit.reason ?? 'unknown')
      .send({
        error: 'rate_limited',
        reason: limit.reason,
        retry_after: limit.retryAfterSec,
      });
    return;
  }

  await recordRequest({ userId, tenantId });
  recordRequestStarted(tenantId);

  // SSE headers. `X-Accel-Buffering: no` defeats nginx-style proxies that
  // try to buffer chunked responses. Hijack so Fastify doesn't double-write.
  //
  // CORS headers MUST be written manually here. `reply.hijack()` skips
  // Fastify's onSend hook chain, which is where @fastify/cors normally
  // injects `Access-Control-Allow-Origin`. Without these, a browser fetch
  // from localhost:5173 receives a 200 with no CORS headers, treats it as
  // a same-origin violation, and surfaces the (uninformative) error
  // `TypeError: Failed to fetch` to the client.
  const origin = req.headers.origin;
  const corsHeaders: Record<string, string> = {};
  // Echo only origins we'd accept via the registered CORS allowlist —
  // mirrors the server.ts `origin: ['http://localhost:5173', ...]` policy.
  // We don't want to wildcard `*` here because credentialed requests
  // (cookies) require an explicit origin echo.
  if (
    origin === 'http://localhost:5173' ||
    origin === 'http://localhost:6274'
  ) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
    corsHeaders['Access-Control-Allow-Credentials'] = 'true';
    corsHeaders.Vary = 'Origin';
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...corsHeaders,
  });
  reply.hijack();

  const controller = new AbortController();

  // Client disconnect → cancel the upstream Gemini call. This is the
  // load-bearing piece for cost protection — without it, an aborted
  // fetch on the client still drains the full output token budget.
  req.raw.on('close', () => {
    if (!controller.signal.aborted) {
      controller.abort();
      recordAbort(tenantId);
    }
  });

  try {
    const result = streamText({
      model: google(config.AUTOCOMPLETE_MODEL),
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(parsed.data.prefix, parsed.data.suffix),
      maxOutputTokens: config.AUTOCOMPLETE_MAX_OUTPUT_TOKENS,
      stopSequences: config.AUTOCOMPLETE_STOP_SEQUENCES,
      abortSignal: controller.signal,
      // 0.2: low enough that completions feel deterministic in context,
      // high enough to avoid pure-greedy degenerate outputs.
      temperature: 0.2,
    });

    let tokenCount = 0;
    for await (const delta of result.textStream) {
      if (controller.signal.aborted) break;
      tokenCount += estimateTokens(delta);
      reply.raw.write(`data: ${JSON.stringify({ delta })}\n\n`);
    }
    recordTokens(tenantId, tokenCount);

    if (!controller.signal.aborted) {
      reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    }
  } catch (err) {
    // AbortError is the normal path for client disconnect mid-stream.
    if ((err as Error).name === 'AbortError') {
      // Already counted via the 'close' listener; nothing more to do.
    } else {
      recordError(tenantId);
      console.error('[complete] stream error', err);
      try {
        reply.raw.write(`data: ${JSON.stringify({ error: 'stream_failed' })}\n\n`);
      } catch {
        // Connection may already be closed; swallow.
      }
    }
  } finally {
    try {
      reply.raw.end();
    } catch {
      // Already ended.
    }
  }
}

/**
 * Coarse character→token estimator. Vercel AI SDK's `result.usage` is
 * accurate but only resolves at end-of-stream — we want incremental counts
 * for the metrics. ~4 chars/token is the rule-of-thumb for English LLMs;
 * the metrics tolerate the imprecision.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
