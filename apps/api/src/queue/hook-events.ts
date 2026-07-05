/**
 * BullMQ Queue for hook event processing (Phase 2 AgentLens).
 *
 * The hook receiver (POST /api/hooks/claude-code) enqueues here immediately
 * after validating the token, then returns 202. The hook-events worker
 * does all the actual DB writes asynchronously.
 *
 * Retry policy: 3 attempts with exponential backoff. After exhaustion the
 * job moves to the failed set (kept for 500 jobs / 24h inspection window)
 * but the agent is NEVER blocked — fail-open is enforced at the route level.
 */

import { Queue } from 'bullmq';
import { redisConnection } from '../lib/redis.js';

export const HOOK_EVENTS_QUEUE_NAME = 'hook-events';

export interface HookEventJobData {
  workspaceId: string;
  adapter:     'claude-code' | 'aider' | 'cursor' | 'generic';
  payload:     unknown;
  receivedAt:  string; // ISO-8601
}

export const hookEventQueue = new Queue<HookEventJobData>(HOOK_EVENTS_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,  // keep last 100 completed for debugging
    removeOnFail:     500,  // keep last 500 failed for inspection
  },
});

export async function enqueueHookEvent(data: HookEventJobData): Promise<void> {
  await hookEventQueue.add('hook', data);
}
