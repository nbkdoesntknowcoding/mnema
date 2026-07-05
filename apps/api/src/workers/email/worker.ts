/**
 * BullMQ Worker for the email queue.
 *
 * Concurrency 2 — email sends are fast I/O but we don't want to hammer
 * Resend's rate limits on burst enqueues.
 *
 * On retry exhaustion BullMQ keeps the job in the failed set.
 * Error logs intentionally omit the recipient address — log userId instead
 * to avoid PII leaking into log aggregators.
 */

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../../config/env.js';
import { emailSender } from '../../lib/email.js';
import type { EmailJobData } from '../../queue/email.js';
import { EMAIL_QUEUE_NAME } from '../../queue/email.js';

export function startEmailWorker(): Worker<EmailJobData> {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job) => {
      const { type, to, params } = job.data;

      switch (type) {
        case 'welcome':
          await emailSender.sendWelcome(to, params);
          break;
        case 'invitation':
          await emailSender.sendInvitation(to, params);
          break;
        case 'invitation_accepted':
          await emailSender.sendInvitationAccepted(to, params);
          break;
        case 'payment_successful':
          await emailSender.sendPaymentSuccessful(to, params);
          break;
        case 'payment_failed':
          await emailSender.sendPaymentFailed(to, params);
          break;
        case 'subscription_cancelled':
          await emailSender.sendSubscriptionCancelled(to, params);
          break;
        case 'login_alert':
          await emailSender.sendLoginAlert(to, params);
          break;
        case 'trial_ending':
          await emailSender.sendTrialEnding(to, params);
          break;
        case 'renewal_reminder':
          await emailSender.sendRenewalReminder(to, params);
          break;
        case 'mcp_connected':
          await emailSender.sendMcpConnected(to, params);
          break;
        case 'waitlist':
          await emailSender.sendWaitlist(to, params);
          break;
        default:
          console.error(`[email-worker] unknown job type: ${String(type)}`);
      }
    },
    { connection, concurrency: 2 },
  );

  worker.on('completed', (job) => {
    console.log(`[email] ${job.id} sent type=${job.data.type}`);
  });
  worker.on('failed', (job, err) => {
    // Omit `to` from error log — avoid PII in aggregators
    console.error(
      `[email] ${job?.id ?? '?'} failed type=${job?.data.type}: ${err.message}`,
    );
  });
  worker.on('error', (err) => {
    console.error('[email] worker error:', err);
  });

  return worker;
}
