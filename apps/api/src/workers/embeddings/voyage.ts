import { createRequire } from 'node:module';
import type * as VoyageAITypes from 'voyageai';
import { config } from '../../config/env.js';

// voyageai@0.2.1 ships an ESM build that uses extensionless re-exports
// (`export * from "../api"`) which tsx's resolver can't follow — it tries
// to append `.jsx` and crashes. The CJS build is fine. Force the `require`
// condition in the package's exports map via createRequire so we land on
// the working CJS entry instead of the broken ESM one.
//
// Track upstream: https://github.com/voyage-ai/typescript-sdk/issues
// (when fixed, swap back to `import { VoyageAIClient } from 'voyageai'`).
const require = createRequire(import.meta.url);
const voyageaiCjs = require('voyageai') as typeof VoyageAITypes;
const VoyageAIClient = voyageaiCjs.VoyageAIClient;

/**
 * Voyage AI client wrapper for the embeddings worker.
 *
 * Verified against `voyageai@0.2.1`:
 *   - `client.embed({input, model, inputType?, outputDimension?, truncation?})`
 *     returns `HttpResponsePromise<EmbedResponse>` which extends Promise<T>,
 *     so `await client.embed(...)` resolves directly to EmbedResponse.
 *   - EmbedResponse is `{ data?: [{ embedding?: number[], index? }],
 *                          usage?: { totalTokens? }, model?, object? }`.
 *
 * Don't paper over the `data?` / `embedding?` optionals with `as`. We
 * validate the shape explicitly below — if Voyage ever returns malformed
 * batches we want the worker to fail loudly so BullMQ retries.
 */

const client = new VoyageAIClient({ apiKey: config.VOYAGE_API_KEY });

export interface EmbedBatchInput {
  texts: string[];
  inputType: 'document' | 'query';
}

export interface EmbedBatchOutput {
  vectors: number[][];
  totalTokens: number;
}

export async function embedBatch(input: EmbedBatchInput): Promise<EmbedBatchOutput> {
  const response = await client.embed({
    input: input.texts,
    model: config.EMBEDDING_MODEL,
    inputType: input.inputType,
    outputDimension: config.EMBEDDING_DIM,
    truncation: true,
  });

  const data = response.data ?? [];
  if (data.length !== input.texts.length) {
    throw new Error(
      `Voyage returned ${data.length} embeddings for ${input.texts.length} inputs`,
    );
  }

  // Voyage may not return data in input order; the SDK exposes `index` per item.
  // Reassemble strictly by index so vectors[i] always corresponds to texts[i].
  const vectors: number[][] = new Array<number[]>(input.texts.length);
  for (const item of data) {
    const embedding = item.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error(`Voyage embedding item missing 'embedding' field`);
    }
    if (embedding.length !== config.EMBEDDING_DIM) {
      throw new Error(
        `Voyage vector dim ${embedding.length} != expected ${config.EMBEDDING_DIM}`,
      );
    }
    const idx = typeof item.index === 'number' ? item.index : data.indexOf(item);
    if (idx < 0 || idx >= input.texts.length) {
      throw new Error(`Voyage returned out-of-range index ${idx}`);
    }
    vectors[idx] = embedding;
  }

  // Catch any holes in the index assignment.
  for (let i = 0; i < vectors.length; i += 1) {
    if (!vectors[i]) {
      throw new Error(`Voyage response missing vector at index ${i}`);
    }
  }

  return {
    vectors,
    totalTokens: response.usage?.totalTokens ?? 0,
  };
}
