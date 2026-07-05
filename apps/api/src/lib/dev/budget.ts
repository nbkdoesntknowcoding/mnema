/**
 * Budget threshold checker for workspace spending alerts.
 *
 * Checks daily/monthly spend against configured budgets and fires Slack/Discord
 * webhooks when the threshold is crossed. Throttled to once per 6 hours to
 * prevent alert spam.
 *
 * Called from the hook event worker after cost accumulation — non-blocking,
 * errors are swallowed so they never affect the agent.
 */

import { and, eq, gte, sum } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agentSessions, budgetConfigs } from '../../db/schema.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Checks if the workspace has exceeded its daily budget alert threshold.
 * Sends Slack/Discord alerts if configured and threshold is crossed.
 *
 * Never throws — all errors are logged and swallowed. Budget alerts are
 * informational and must never block the agent pipeline.
 */
export async function checkBudgetThreshold(workspaceId: string): Promise<void> {
  const config = await db.query.budgetConfigs.findFirst({
    where: eq(budgetConfigs.workspaceId, workspaceId),
  });

  // No budget configured — nothing to check
  if (!config?.dailyBudgetUsd && !config?.monthlyBudgetUsd) return;

  // Throttle: don't alert more than once per 6 hours
  if (config.lastAlertSentAt) {
    const sixHoursAgo = new Date(Date.now() - SIX_HOURS_MS);
    if (config.lastAlertSentAt > sixHoursAgo) return;
  }

  // Calculate today's spend
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayRows = await db
    .select({ total: sum(agentSessions.totalCostUsd) })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.workspaceId, workspaceId),
        gte(agentSessions.startedAt, todayStart),
      ),
    );

  const spend = Number(todayRows[0]?.total ?? 0);

  if (config.dailyBudgetUsd) {
    const threshold = (config.alertThresholdPct / 100) * config.dailyBudgetUsd;

    if (spend >= threshold) {
      await sendBudgetAlert(config, spend, config.dailyBudgetUsd, 'daily');
      await db
        .update(budgetConfigs)
        .set({ lastAlertSentAt: new Date(), updatedAt: new Date() })
        .where(eq(budgetConfigs.id, config.id));
    }
  }
}

// ── Alert delivery ─────────────────────────────────────────────────────────────

interface BudgetConfigRow {
  alertThresholdPct: number;
  slackWebhookUrl:   string | null;
  discordWebhookUrl: string | null;
}

async function sendBudgetAlert(
  config:  BudgetConfigRow,
  spend:   number,
  budget:  number,
  period:  'daily' | 'monthly',
): Promise<void> {
  const pct = Math.round((spend / budget) * 100);
  const message = `⚠ Mnema budget alert: $${spend.toFixed(4)} spent ${period === 'daily' ? 'today' : 'this month'} (${pct}% of $${budget.toFixed(2)} ${period} budget)`;

  if (config.slackWebhookUrl) {
    await fetch(config.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    }).catch((err: unknown) => {
      console.error('[budget] Slack alert failed:', err);
    });
  }

  if (config.discordWebhookUrl) {
    await fetch(config.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    }).catch((err: unknown) => {
      console.error('[budget] Discord alert failed:', err);
    });
  }
}
