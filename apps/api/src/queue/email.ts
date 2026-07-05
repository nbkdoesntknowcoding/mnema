/**
 * BullMQ Queue declaration for the email pipeline.
 *
 * Imported by BOTH the api process (enqueuer) AND the worker process
 * (dequeuer). Keep this file free of side effects.
 *
 * 3 attempts with exponential backoff. On exhaustion BullMQ moves the job
 * to the failed set — manually reprocess via BullMQ dashboard or CLI.
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/env.js';
import type {
  WelcomeEmailParams,
  WorkspaceInvitationParams,
  InvitationAcceptedParams,
  PaymentSuccessfulParams,
  PaymentFailedParams,
  SubscriptionCancelledParams,
  LoginAlertParams,
  TrialEndingParams,
  RenewalReminderParams,
  McpConnectedParams,
  WaitlistEmailParams,
} from '../emails/templates.js';

export { type WelcomeEmailParams, type WorkspaceInvitationParams };

export const EMAIL_QUEUE_NAME = 'email';

export type EmailJobData =
  | { type: 'welcome';               to: string; params: WelcomeEmailParams }
  | { type: 'invitation';            to: string; params: WorkspaceInvitationParams }
  | { type: 'invitation_accepted';   to: string; params: InvitationAcceptedParams }
  | { type: 'payment_successful';    to: string; params: PaymentSuccessfulParams }
  | { type: 'payment_failed';        to: string; params: PaymentFailedParams }
  | { type: 'subscription_cancelled';to: string; params: SubscriptionCancelledParams }
  | { type: 'login_alert';           to: string; params: LoginAlertParams }
  | { type: 'trial_ending';          to: string; params: TrialEndingParams }
  | { type: 'renewal_reminder';      to: string; params: RenewalReminderParams }
  | { type: 'mcp_connected';         to: string; params: McpConnectedParams }
  | { type: 'waitlist';              to: string; params: WaitlistEmailParams };

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86400 },
  },
});
