import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/env.js';

/**
 * BullMQ Queue declaration for the embeddings pipeline.
 *
 * Imported by BOTH the api process (which enqueues from
 * `storeDocumentState`) AND the worker process (which dequeues). Both sides
 * MUST agree on `QUEUE_NAME` and connection options — that's why this lives
 * in a shared module rather than being constructed twice.
 *
 * `maxRetriesPerRequest: null` is a hard requirement of BullMQ on its
 * Redis connection. Without it, BullMQ logs a deprecation warning and
 * misbehaves on transient Redis hiccups. Don't drop it.
 */
export const QUEUE_NAME = 'embeddings';

export interface EmbeddingJobData {
  doc_id: string;
  tenant_id: string;
  content_hash: string;
}

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const embeddingsQueue = new Queue<EmbeddingJobData>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 }, // start at 30s — respects Voyage RPM limits
    // Keep an hour of completed history + 24h of failures for debugging;
    // BullMQ trims older entries automatically.
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
  },
});

/**
 * Fire-and-forget enqueue. Uses `${doc_id}--${content_hash}` as the BullMQ
 * job ID so a duplicate enqueue (e.g., two collab clients firing the same
 * onStoreDocument with no actual content change) is silently deduped by
 * BullMQ — the second `add` becomes a no-op.
 *
 * Note: BullMQ rejects `:` in custom job IDs (it's a Redis key separator
 * internally). We use `--` instead.
 */
export async function enqueueEmbeddingJob(data: EmbeddingJobData): Promise<void> {
  const jobId = `${data.doc_id}--${data.content_hash}`;
  await embeddingsQueue.add('embed-doc', data, { jobId });
}
