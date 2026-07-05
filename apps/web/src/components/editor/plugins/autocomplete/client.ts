/**
 * Phase 3.4 — SSE client for `/api/complete`.
 *
 * `EventSource` doesn't work for our case because we need to POST a body
 * (prefix/suffix + doc_id). Instead we open a regular `fetch` with
 * `Accept: text/event-stream` and read `response.body` as a ReadableStream.
 * Same wire format as EventSource, different client surface.
 *
 * Three contracts the plugin relies on:
 *   1. `signal.aborted` is checked between every chunk read; on abort we
 *      cancel the reader (which closes the underlying TCP connection,
 *      which trips the server's `req.raw 'close'` listener, which aborts
 *      the upstream Gemini call). The whole chain matters for cost.
 *   2. `onUpdate(cumulativeText)` fires once per `data: {"delta":"..."}`
 *      event, with the accumulated text so far. The plugin's RAF
 *      coalescer takes care of capping ProseMirror transactions.
 *   3. Returns the final text on clean stream completion. Returns `''`
 *      on a 429 — the plugin treats rate-limit as a silent "no
 *      suggestion this time", never an error toast.
 */

export interface CompletionContext {
  prefix: string;
  suffix: string;
  doc_id: string;
}

export type CompletionStreamCallback = (cumulativeText: string) => void;

export async function streamCompletion(
  ctx: CompletionContext,
  signal: AbortSignal,
  onUpdate: CompletionStreamCallback,
): Promise<string> {
  const response = await fetch(`/api/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(ctx),
    signal,
  });

  // Soft no — caller treats rate-limit as "no suggestion right now".
  // No error UI, no retry, no warning. The next debounce cycle is the
  // organic recovery path.
  if (response.status === 429) return '';

  if (!response.ok) {
    throw new Error(`completion failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error('no response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  try {
    while (true) {
      if (signal.aborted) {
        // Cancel the reader so the underlying connection closes — that's
        // what fires the server's req.raw 'close' listener which aborts
        // the upstream Gemini call.
        await reader.cancel().catch(() => undefined);
        throw new DOMException('aborted', 'AbortError');
      }

      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line (\n\n). The trailing
      // partial frame stays in `buffer` until the next read fills it.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        let parsed: { delta?: string; done?: boolean; error?: string };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.done) return accumulated;
        if (parsed.delta) {
          accumulated += parsed.delta;
          onUpdate(accumulated);
        }
      }
    }
  } finally {
    // Defensive — make sure we don't leak the reader if we exit through
    // an unexpected branch.
    try {
      reader.releaseLock();
    } catch {
      // Already released or cancelled.
    }
  }

  return accumulated;
}
