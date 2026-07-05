/**
 * Workspace notification dispatcher — Phase 4.
 *
 * Sends Slack/Discord messages for task state events.
 * Called fire-and-forget via setImmediate from task route handlers
 * and retry worker. Never throws — both webhook failures are caught.
 */

import { eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { budgetConfigs } from '../../../db/schema.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskLike {
  id: string;
  title: string;
  retryCount?: number | null;
}

export type WorkspaceNotificationEvent =
  | { type: 'task_completed'; task: TaskLike; developerId: string; githubPrUrl?: string | null }
  | { type: 'task_blocked';   task: TaskLike; developerId: string; blockerDescription: string }
  | { type: 'task_retrying';  task: TaskLike; attemptNumber: number; delayLabel: string }
  | { type: 'retry_exhausted'; task: TaskLike }
  | { type: 'budget_alert';   spendUsd: number; budgetUsd: number; pctUsed: number };

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function dispatchWorkspaceNotification(
  workspaceId: string,
  event: WorkspaceNotificationEvent,
): Promise<void> {
  let config: typeof budgetConfigs.$inferSelect | undefined;
  try {
    config = await db.query.budgetConfigs.findFirst({
      where: eq(budgetConfigs.workspaceId, workspaceId),
    });
  } catch {
    return; // DB unreachable — skip silently
  }

  if (!config) return;

  // Check per-event toggles
  if (event.type === 'task_completed' && !config.notifyOnTaskComplete) return;
  if (event.type === 'task_blocked'   && !config.notifyOnBlocker) return;
  if (event.type === 'task_retrying'  && !config.notifyOnRetry) return;
  if (event.type === 'retry_exhausted' && !config.notifyOnBlocker) return;

  const sends: Promise<void>[] = [];

  if (config.slackWebhookUrl) {
    sends.push(sendSlack(config.slackWebhookUrl, event).catch(() => {}));
  }
  if (config.discordWebhookUrl) {
    sends.push(sendDiscord(config.discordWebhookUrl, event).catch(() => {}));
  }

  if (sends.length > 0) {
    await Promise.allSettled(sends);
  }
}

// ── Slack ─────────────────────────────────────────────────────────────────────

function slackBlocks(event: WorkspaceNotificationEvent): object[] {
  switch (event.type) {
    case 'task_completed':
      return [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *${event.task.title}* completed by \`${event.developerId}\`` +
                (event.githubPrUrl ? `\n<${event.githubPrUrl}|View PR>` : ''),
        },
      }];

    case 'task_blocked':
      return [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⚠️ *${event.task.title}* blocked by \`${event.developerId}\`\n` +
                `_${event.blockerDescription}_\n` +
                `Retry attempt ${event.task.retryCount ?? 0} queued.`,
        },
      }];

    case 'task_retrying':
      return [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔄 *${event.task.title}* — retry #${event.attemptNumber} scheduled in ${event.delayLabel}`,
        },
      }];

    case 'retry_exhausted':
      return [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚫 *${event.task.title}* — all 5 retry attempts exhausted. Manual review required.`,
        },
      }];

    case 'budget_alert':
      return [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💰 *Budget alert* — ${event.pctUsed.toFixed(0)}% of $${event.budgetUsd} used ($${event.spendUsd.toFixed(2)} spent)`,
        },
      }];
  }
}

async function sendSlack(webhookUrl: string, event: WorkspaceNotificationEvent): Promise<void> {
  const body = { blocks: slackBlocks(event) };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status}`);
  }
}

// ── Discord ───────────────────────────────────────────────────────────────────

function discordContent(event: WorkspaceNotificationEvent): string {
  switch (event.type) {
    case 'task_completed':
      return `✅ **${event.task.title}** completed by \`${event.developerId}\`` +
             (event.githubPrUrl ? `\n${event.githubPrUrl}` : '');
    case 'task_blocked':
      return `⚠️ **${event.task.title}** blocked by \`${event.developerId}\`\n> ${event.blockerDescription}`;
    case 'task_retrying':
      return `🔄 **${event.task.title}** — retry #${event.attemptNumber} in ${event.delayLabel}`;
    case 'retry_exhausted':
      return `🚫 **${event.task.title}** — all 5 retries exhausted. Manual review required.`;
    case 'budget_alert':
      return `💰 **Budget alert** — ${event.pctUsed.toFixed(0)}% of $${event.budgetUsd} used`;
  }
}

async function sendDiscord(webhookUrl: string, event: WorkspaceNotificationEvent): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: discordContent(event) }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status}`);
  }
}
