import { Queue } from 'bullmq';
import { redisConnection } from '../lib/redis.js';

export const RETRY_QUEUE_NAME = 'task-retry';

export interface RetryJobData {
  taskId: string;
  fixHistoryId: string;
}

export const retryQueue = new Queue<RetryJobData>(RETRY_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

// Backoff schedule (0-indexed attempt number → delay in ms)
export const RETRY_DELAYS_MS: number[] = [
  0,       // attempt 1: immediate
  60_000,  // attempt 2: 1 minute
  180_000, // attempt 3: 3 minutes
  420_000, // attempt 4: 7 minutes
  900_000, // attempt 5: 15 minutes
];
