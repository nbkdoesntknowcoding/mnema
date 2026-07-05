import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/env.js';

export const MEETING_END_QUEUE_NAME = 'meeting-end';

export interface MeetingEndJobData {
  meetingId: string;
  workspaceId: string;
  recallBotId: string | null;
  /** 'end' (default) = post-meeting processing; 'brief' = pre-meeting brief on admit. */
  kind?: 'end' | 'brief';
}

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const meetingEndQueue = new Queue<MeetingEndJobData>(MEETING_END_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    // The recording/transcript may still be processing at meeting end, so retry
    // generously with backoff until Recall has it ready.
    attempts: 8,
    backoff: { type: 'exponential', delay: 20_000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

/**
 * Enqueue post-meeting processing (transcript → summary → doc). Remove-then-add
 * so a parked terminal job can't silently dedupe a re-trigger (same lesson as
 * the graph queue).
 */
export function enqueueMeetingEnd(meetingId: string, workspaceId: string, recallBotId: string | null): void {
  const jobId = `meeting-end-${meetingId}`;
  void (async () => {
    const existing = await meetingEndQueue.getJob(jobId);
    if (existing) await existing.remove().catch(() => { /* race / already gone */ });
    await meetingEndQueue.add('process', { meetingId, workspaceId, recallBotId, kind: 'end' }, { jobId });
  })();
}

/** Generate a pre-meeting brief when a meeting is admitted (fire-and-forget). */
export function enqueuePreBrief(meetingId: string, workspaceId: string, recallBotId: string | null): void {
  const jobId = `meeting-brief-${meetingId}`;
  void (async () => {
    const existing = await meetingEndQueue.getJob(jobId);
    if (existing) await existing.remove().catch(() => { /* race / already gone */ });
    await meetingEndQueue.add('brief', { meetingId, workspaceId, recallBotId, kind: 'brief' }, { jobId });
  })();
}
