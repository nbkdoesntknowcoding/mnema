import { eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { docs, embeddings } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import type { EmbeddingJobData } from '../../queue/embeddings.js';
import { type Chunk, chunkMarkdown } from './chunker.js';
import { embedBatch } from './voyage.js';

export interface ProcessResult {
  chunks: number;
  tokens: number;
  skipped: boolean;
  /** Why we skipped, when skipped===true. Useful in logs. */
  reason?: 'doc_not_found' | 'stale_job' | 'already_embedded';
}

/**
 * Process one embeddings job.
 *
 * Two intentional transactions, NOT one:
 *   1. Read tx — fetch the doc's current markdown + content_hash + check
 *      whether existing embeddings already match this hash.
 *   2. Voyage call(s) outside any transaction.
 *   3. Write tx — delete-then-insert.
 *
 * Holding a transaction open across the Voyage round-trip would tie up a
 * DB connection for hundreds of milliseconds per job. The classic
 * external-I/O-inside-transaction anti-pattern.
 *
 * Idempotency: keyed on `content_hash`. Three skip cases:
 *   - doc was deleted between enqueue and dequeue
 *   - doc's content_hash has moved on (a newer job will fire shortly)
 *   - existing embeddings already match this hash (duplicate enqueue)
 *
 * Re-embedding strategy: total replacement (delete then insert). Chunk
 * boundaries shift on every edit; trying to incrementally diff would mean
 * tracking unstable identifiers. At BOPPL scale, replace is correct +
 * cheap.
 */
export async function processEmbeddingJob(
  data: EmbeddingJobData,
): Promise<ProcessResult> {
  const { doc_id, tenant_id, content_hash } = data;

  type Stage1 =
    | { skip: true; reason: 'doc_not_found' | 'stale_job' | 'already_embedded' }
    | { skip: false; markdown: string; projectId: string | null };

  // Stage 1: read + idempotency check.
  const work: Stage1 = await withTenant(tenant_id, async (tx): Promise<Stage1> => {
    const docRows = await tx
      .select({ markdown: docs.markdown, contentHash: docs.contentHash, projectId: docs.projectId })
      .from(docs)
      .where(eq(docs.id, doc_id))
      .limit(1);

    if (docRows.length === 0) {
      return { skip: true, reason: 'doc_not_found' };
    }
    const doc = docRows[0]!;

    // Doc has moved on since the enqueue — a fresher job is already in
    // flight (or about to be). Don't waste tokens re-embedding stale content.
    if (doc.contentHash !== content_hash) {
      return { skip: true, reason: 'stale_job' };
    }

    // Existing rows already at this hash — duplicate enqueue.
    const existing = await tx
      .select({ contentHash: embeddings.contentHash })
      .from(embeddings)
      .where(eq(embeddings.docId, doc_id))
      .limit(1);

    if (existing.length > 0 && existing[0]!.contentHash === content_hash) {
      return { skip: true, reason: 'already_embedded' };
    }

    return { skip: false, markdown: doc.markdown ?? '', projectId: doc.projectId ?? null };
  });

  if (work.skip) {
    return { chunks: 0, tokens: 0, skipped: true, reason: work.reason };
  }

  // Stage 2: chunk (CPU-only, no DB I/O).
  const chunks = chunkMarkdown(work.markdown);

  if (chunks.length === 0) {
    // Empty doc — clear any stale embeddings so search doesn't return ghosts.
    await withTenant(tenant_id, async (tx) => {
      await tx.delete(embeddings).where(eq(embeddings.docId, doc_id));
    });
    return { chunks: 0, tokens: 0, skipped: false };
  }

  // Stage 3: embed in batches outside any transaction.
  const allVectors: Array<{ chunk: Chunk; vector: number[] }> = [];
  let totalTokens = 0;
  for (let i = 0; i < chunks.length; i += config.EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + config.EMBEDDING_BATCH_SIZE);
    const { vectors, totalTokens: batchTokens } = await embedBatch({
      texts: batch.map((c) => c.text),
      inputType: 'document',
    });
    for (let j = 0; j < batch.length; j += 1) {
      allVectors.push({ chunk: batch[j]!, vector: vectors[j]! });
    }
    totalTokens += batchTokens;
  }

  // Stage 4: delete-then-insert under one tenant-scoped tx.
  await withTenant(tenant_id, async (tx) => {
    await tx.delete(embeddings).where(eq(embeddings.docId, doc_id));
    const INSERT_BATCH = 100;
    for (let i = 0; i < allVectors.length; i += INSERT_BATCH) {
      const slice = allVectors.slice(i, i + INSERT_BATCH);
      await tx.insert(embeddings).values(
        slice.map(({ chunk, vector }) => ({
          workspaceId: tenant_id,
          docId: doc_id,
          projectId: work.projectId,
          chunkIndex: chunk.index,
          chunkText: chunk.text,
          tokenCount: chunk.tokenCount,
          headingPath: chunk.headingPath || null,
          embedding: vector,
          model: config.EMBEDDING_MODEL,
          contentHash: content_hash,
        })),
      );
    }
  });

  return { chunks: chunks.length, tokens: totalTokens, skipped: false };
}
