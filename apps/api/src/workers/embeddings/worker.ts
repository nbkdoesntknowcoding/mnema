import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../../config/env.js';
import { type EmbeddingJobData, QUEUE_NAME } from '../../queue/embeddings.js';
import { processEmbeddingJob } from './job.js';

/**
 * BullMQ Worker setup for the embeddings queue.
 *
 * Concurrency comes from `EMBEDDING_WORKER_CONCURRENCY` (default 2). The
 * `limiter: { max: 3, duration: 1000 }` caps to 3 jobs/second across the
 * worker instance — keeps us comfortably under Voyage's free-tier rate
 * limits while still draining a backlog at reasonable speed.
 *
 * Retries (5 attempts with exponential backoff) are configured at the
 * Queue level in queue/embeddings.ts so they apply to enqueue-from-api
 * jobs as well as future enqueue paths.
 */
export function startEmbeddingsWorker(): Worker<EmbeddingJobData, ProcessReturn> {
  // A dedicated connection for the worker — sharing with the queue is OK
  // but ioredis pipelines poorly when one connection serves both pub/sub
  // (worker) and command (queue add) traffic.
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker<EmbeddingJobData, ProcessReturn>(
    QUEUE_NAME,
    async (job) => {
      const result = await processEmbeddingJob(job.data);
      return result;
    },
    {
      connection,
      concurrency: 1,
      limiter: {
        max: 3,
        duration: 60_000, // Voyage free tier = 3 RPM
      },
    },
  );

  worker.on('completed', (job, result) => {
    if (result.skipped) {
      // eslint-disable-next-line no-console
      console.log(`[embeddings] ${job.id} skipped (${result.reason ?? 'unknown'})`);
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[embeddings] ${job.id} done chunks=${result.chunks} tokens=${result.tokens}`,
      );
    }
  });
  worker.on('failed', (job, err) => {
    console.error(`[embeddings] ${job?.id ?? '?'} failed: ${err.message}`);
  });
  worker.on('error', (err) => {
    console.error('[embeddings] worker error:', err);
  });

  return worker;
}

interface ProcessReturn {
  chunks: number;
  tokens: number;
  skipped: boolean;
  reason?: string;
}
