/**
 * BullMQ queue for Google Drive folder sync (Phase 10).
 *
 * Enqueued from routes/drive.ts (manual "Sync now"); a reconcile cron can enqueue
 * with reason 'cron' as a follow-up. The drive-sync worker runs syncLink() for the
 * link. A stable jobId per link debounces concurrent syncs of the same folder.
 */
import { Queue } from 'bullmq';
import { redisConnection } from '../lib/redis.js';

export const DRIVE_SYNC_QUEUE_NAME = 'drive-sync';

export interface DriveSyncJobData {
  linkId: string;
  reason: 'manual' | 'cron';
}

export const driveSyncQueue = new Queue<DriveSyncJobData>(DRIVE_SYNC_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export async function enqueueDriveSync(data: DriveSyncJobData): Promise<void> {
  // jobId dedupes: a queued/active sync for the same link absorbs new triggers.
  await driveSyncQueue.add('sync', data, { jobId: `drive-sync:${data.linkId}` });
}
