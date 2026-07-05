/**
 * Dev-only test script for email templates.
 *
 * Usage:
 *   npx tsx src/emails/test-send.ts <template> <to>
 *
 * Example:
 *   npx tsx src/emails/test-send.ts welcome nischaybk@example.com
 *
 * Uses RESEND_API_KEY from .env — set it before running.
 * Never import this file from production code.
 */

// Load env vars from repo root .env
import { config as dotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv({ path: resolve(__dirname, '../../../../.env') });

import { emailSender } from '../lib/email.js';

const [, , template, to] = process.argv;

if (!to) {
  console.error('Usage: npx tsx src/emails/test-send.ts <template> <to-address>');
  process.exit(1);
}

const WEB = process.env.WEB_BASE_URL ?? 'http://localhost:4321';

const sends: Record<string, () => Promise<void>> = {
  welcome: () =>
    emailSender.sendWelcome(to, {
      firstName: 'Nischay',
      workspaceName: 'BOPPL Dev',
      openUrl: `${WEB}/app`,
    }),

  invitation: () =>
    emailSender.sendInvitation(to, {
      inviterName: 'Nischay',
      workspaceName: 'BOPPL Dev',
      acceptUrl: `${WEB}/invite/test-token`,
    }),

  invitation_accepted: () =>
    emailSender.sendInvitationAccepted(to, {
      inviteeName: 'teammate@example.com',
      workspaceName: 'BOPPL Dev',
      membersUrl: `${WEB}/app/settings/members`,
    }),

  payment_successful: () =>
    emailSender.sendPaymentSuccessful(to, {
      planName: 'Pro',
      amount: '₹999',
      date: '26 May 2026',
      nextBillingDate: '26 Jun 2026',
      billingUrl: `${WEB}/app/settings/billing`,
    }),

  payment_failed: () =>
    emailSender.sendPaymentFailed(to, {
      planName: 'Pro',
      amount: '₹999',
      date: '26 May 2026',
      gracePeriodEnd: '2 Jun 2026',
      updateUrl: `${WEB}/app/settings/billing`,
    }),

  subscription_cancelled: () =>
    emailSender.sendSubscriptionCancelled(to, {
      planName: 'Pro',
      accessEndDate: '26 Jun 2026',
      reactivateUrl: `${WEB}/app/settings/billing`,
    }),

  login_alert: () =>
    emailSender.sendLoginAlert(to, {
      loginTime: new Date().toLocaleString('en-GB'),
      ipLocation: '203.0.113.0 (Bengaluru, IN)',
      device: 'Chrome on macOS',
      secureUrl: `${WEB}/app/settings`,
    }),

  trial_ending: () =>
    emailSender.sendTrialEnding(to, {
      daysRemaining: '3',
      trialEndDate: '29 May 2026',
      upgradeUrl: `${WEB}/pricing`,
    }),

  renewal_reminder: () =>
    emailSender.sendRenewalReminder(to, {
      planName: 'Pro',
      renewalDate: '2 Jun 2026',
      amount: '₹999',
      paymentMethod: 'Visa ••4242',
      billingUrl: `${WEB}/app/settings/billing`,
    }),

  mcp_connected: () =>
    emailSender.sendMcpConnected(to, {
      workspaceName: 'BOPPL Dev',
      connectionTime: new Date().toLocaleString('en-GB'),
      device: 'Claude Desktop on macOS',
      claudeUrl: 'claude://open',
    }),
};

if (!template || !sends[template]) {
  console.error(`Unknown template: ${template ?? '(none)'}`);
  console.error(`Available: ${Object.keys(sends).join(', ')}`);
  process.exit(1);
}

sends[template]!()
  .then(() => console.log(`✓ ${template} sent to ${to}`))
  .catch((err: unknown) => {
    console.error('Send failed:', err);
    process.exit(1);
  });
