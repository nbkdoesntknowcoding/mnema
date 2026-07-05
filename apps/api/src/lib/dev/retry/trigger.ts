import { and, eq } from 'drizzle-orm';
import pino from 'pino';
import { withSystemPrivilege } from '../../../db/with-system-privilege.js';
import { fixHistory, tasks } from '../../../db/schema.js';
import { retryQueue, RETRY_DELAYS_MS } from '../../../queue/retry.js';
import { generateFixPrompt } from './fix-prompt.js';

const log = pino({ name: 'retry-trigger' });

// Shape of the task row we need
interface TaskRow {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  retryCount: number;
  status: string;
}

export async function triggerRetry(task: TaskRow, blockerDescription: string): Promise<void> {
  const attemptNumber = task.retryCount; // Already incremented by /block handler

  if (attemptNumber > 5) {
    log.info({ taskId: task.id }, 'Max retries exhausted — no more auto-retry');
    await withSystemPrivilege((tx) =>
      tx
        .update(fixHistory)
        .set({ status: 'exhausted' })
        .where(and(eq(fixHistory.taskId, task.id), eq(fixHistory.status, 'pending'))),
    );
    // Phase 4: dispatch retry_exhausted notification (fire-and-forget)
    setImmediate(() => {
      import('../notifications/dispatcher.js').then(({ dispatchWorkspaceNotification }) => {
        dispatchWorkspaceNotification(task.workspaceId, { type: 'retry_exhausted', task }).catch(() => {});
      }).catch(() => {});
    });
    return;
  }

  const delayMs = RETRY_DELAYS_MS[attemptNumber - 1] ?? 900_000;
  const scheduledAt = new Date(Date.now() + delayMs);

  const { prompt, model, usedFallback } = await generateFixPrompt(
    task.title,
    task.description,
    blockerDescription,
    attemptNumber,
  );

  const [historyRow] = await withSystemPrivilege((tx) =>
    tx
      .insert(fixHistory)
      .values({
        taskId: task.id,
        workspaceId: task.workspaceId,
        attemptNumber,
        blockerDescription,
        fixPrompt: prompt,
        fixPromptModel: model,
        status: 'pending',
        scheduledAt,
      })
      .returning({ id: fixHistory.id }),
  );

  await withSystemPrivilege((tx) =>
    tx
      .update(tasks)
      .set({ retryFixHint: prompt })
      .where(eq(tasks.id, task.id)),
  );

  await retryQueue.add(
    'retry-task',
    { taskId: task.id, fixHistoryId: historyRow!.id },
    { delay: delayMs },
  );

  log.info({ taskId: task.id, attemptNumber, delayMs, usedFallback }, 'Retry scheduled');

  // Phase 4: dispatch task_retrying notification (fire-and-forget)
  const delayLabel = delayMs === 0 ? 'immediately' : delayMs < 60_000
    ? `${delayMs / 1000}s`
    : `${Math.round(delayMs / 60_000)}m`;
  setImmediate(() => {
    import('../notifications/dispatcher.js').then(({ dispatchWorkspaceNotification }) => {
      dispatchWorkspaceNotification(task.workspaceId, {
        type: 'task_retrying',
        task,
        attemptNumber,
        delayLabel,
      }).catch(() => {});
    }).catch(() => {});
  });
}
