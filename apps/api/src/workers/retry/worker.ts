import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { fixHistory, tasks } from '../../db/schema.js';
import { RETRY_QUEUE_NAME, type RetryJobData } from '../../queue/retry.js';
import { emitWorkspaceEvent } from '../../lib/events.js';

const log = pino({ name: 'retry-worker' });

async function processRetry(job: Job<RetryJobData>): Promise<void> {
  const { taskId, fixHistoryId } = job.data;

  const [task] = await withSystemPrivilege((tx) =>
    tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1),
  );
  if (!task) return;

  // Human resolved it — don't interfere
  if (task.status !== 'audit_fix') {
    await withSystemPrivilege((tx) =>
      tx
        .update(fixHistory)
        .set({ status: 'succeeded', resolvedAt: new Date() })
        .where(eq(fixHistory.id, fixHistoryId)),
    );
    return;
  }

  // Move back to backlog
  await withSystemPrivilege((tx) =>
    tx
      .update(tasks)
      .set({ status: 'backlog', blockerDescription: null, updatedAt: new Date() })
      .where(eq(tasks.id, taskId)),
  );

  await withSystemPrivilege((tx) =>
    tx
      .update(fixHistory)
      .set({ status: 'dispatched', dispatchedAt: new Date() })
      .where(eq(fixHistory.id, fixHistoryId)),
  );

  emitWorkspaceEvent(task.workspaceId, {
    type: 'task_updated',
    data: {
      task: { ...task, status: 'backlog', blockerDescription: null },
      previousStatus: 'audit_fix',
      changedBy: 'agent',
    },
  });

  log.info({ taskId, fixHistoryId, retryCount: task.retryCount }, 'Task moved back to backlog for retry');
}

export function startRetryWorker(): Worker<RetryJobData> {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker<RetryJobData>(RETRY_QUEUE_NAME, processRetry, {
    connection,
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Retry job failed');
  });

  return worker;
}
