/**
 * Email sender abstraction.
 *
 * EmailSender interface defines 10 named send methods (one per template)
 * plus a generic send() for one-offs. All named methods delegate to the
 * template functions in emails/templates.ts and then call send().
 *
 * Two implementations:
 *   StdoutEmailSender  — local dev without RESEND_API_KEY; prints to stdout
 *   ResendEmailSender  — production; uses the Resend SDK
 *
 * The exported singleton emailSender selects automatically based on env.
 */

import { Resend } from 'resend';
import {
  welcomeEmail,
  workspaceInvitationEmail,
  invitationAcceptedEmail,
  paymentSuccessfulEmail,
  paymentFailedEmail,
  subscriptionCancelledEmail,
  loginAlertEmail,
  trialEndingEmail,
  renewalReminderEmail,
  mcpConnectedEmail,
  waitlistEmail,
  type WelcomeEmailParams,
  type WorkspaceInvitationParams,
  type InvitationAcceptedParams,
  type PaymentSuccessfulParams,
  type PaymentFailedParams,
  type SubscriptionCancelledParams,
  type LoginAlertParams,
  type TrialEndingParams,
  type RenewalReminderParams,
  type McpConnectedParams,
  type WaitlistEmailParams,
} from '../emails/templates.js';

// ── Public interface ───────────────────────────────────────────────────────────

export interface EmailSender {
  /** Low-level send — used for one-offs or when building subject/html externally. */
  send(to: string, subject: string, html: string, from?: string): Promise<void>;

  sendWelcome(to: string, params: WelcomeEmailParams): Promise<void>;
  sendInvitation(to: string, params: WorkspaceInvitationParams): Promise<void>;
  sendInvitationAccepted(to: string, params: InvitationAcceptedParams): Promise<void>;
  sendPaymentSuccessful(to: string, params: PaymentSuccessfulParams): Promise<void>;
  sendPaymentFailed(to: string, params: PaymentFailedParams): Promise<void>;
  sendSubscriptionCancelled(to: string, params: SubscriptionCancelledParams): Promise<void>;
  sendLoginAlert(to: string, params: LoginAlertParams): Promise<void>;
  sendTrialEnding(to: string, params: TrialEndingParams): Promise<void>;
  sendRenewalReminder(to: string, params: RenewalReminderParams): Promise<void>;
  sendMcpConnected(to: string, params: McpConnectedParams): Promise<void>;
  sendWaitlist(to: string, params: WaitlistEmailParams): Promise<void>;
}

// ── StdoutEmailSender ──────────────────────────────────────────────────────────

class StdoutEmailSender implements EmailSender {
  async send(to: string, subject: string, _html: string): Promise<void> {
    console.log('\n========== EMAIL (dev — stdout) ==========');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log('==========================================\n');
  }

  async sendWelcome(to: string, p: WelcomeEmailParams) {
    const { subject, html } = welcomeEmail(p);
    await this.send(to, subject, html);
  }
  async sendInvitation(to: string, p: WorkspaceInvitationParams) {
    const { subject, html } = workspaceInvitationEmail(p);
    await this.send(to, subject, html);
  }
  async sendInvitationAccepted(to: string, p: InvitationAcceptedParams) {
    const { subject, html } = invitationAcceptedEmail(p);
    await this.send(to, subject, html);
  }
  async sendPaymentSuccessful(to: string, p: PaymentSuccessfulParams) {
    const { subject, html } = paymentSuccessfulEmail(p);
    await this.send(to, subject, html);
  }
  async sendPaymentFailed(to: string, p: PaymentFailedParams) {
    const { subject, html } = paymentFailedEmail(p);
    await this.send(to, subject, html);
  }
  async sendSubscriptionCancelled(to: string, p: SubscriptionCancelledParams) {
    const { subject, html } = subscriptionCancelledEmail(p);
    await this.send(to, subject, html);
  }
  async sendLoginAlert(to: string, p: LoginAlertParams) {
    const { subject, html } = loginAlertEmail(p);
    await this.send(to, subject, html);
  }
  async sendTrialEnding(to: string, p: TrialEndingParams) {
    const { subject, html } = trialEndingEmail(p);
    await this.send(to, subject, html);
  }
  async sendRenewalReminder(to: string, p: RenewalReminderParams) {
    const { subject, html } = renewalReminderEmail(p);
    await this.send(to, subject, html);
  }
  async sendMcpConnected(to: string, p: McpConnectedParams) {
    const { subject, html } = mcpConnectedEmail(p);
    await this.send(to, subject, html);
  }
  async sendWaitlist(to: string, p: WaitlistEmailParams) {
    const { subject, html } = waitlistEmail(p);
    await this.send(to, subject, html);
  }
}

// ── ResendEmailSender ──────────────────────────────────────────────────────────

class ResendEmailSender implements EmailSender {
  private client: Resend;
  private defaultFrom: string;
  private securityFrom: string;

  constructor() {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
    this.client = new Resend(process.env.RESEND_API_KEY);
    this.defaultFrom =
      process.env.RESEND_FROM_ADDRESS ?? 'noreply@example.com';
    // Login alerts use a distinct security address so they stand out in the inbox
    this.securityFrom = 'security@mnema.example.com';
  }

  async send(to: string, subject: string, html: string, from?: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: from ?? this.defaultFrom,
      to,
      subject,
      html,
    });
    if (error) {
      throw new Error(
        `Resend error: ${(error as { message?: string }).message ?? String(error)}`,
      );
    }
  }

  async sendWelcome(to: string, p: WelcomeEmailParams) {
    const { subject, html } = welcomeEmail(p);
    await this.send(to, subject, html);
  }
  async sendInvitation(to: string, p: WorkspaceInvitationParams) {
    const { subject, html } = workspaceInvitationEmail(p);
    await this.send(to, subject, html);
  }
  async sendInvitationAccepted(to: string, p: InvitationAcceptedParams) {
    const { subject, html } = invitationAcceptedEmail(p);
    await this.send(to, subject, html);
  }
  async sendPaymentSuccessful(to: string, p: PaymentSuccessfulParams) {
    const { subject, html } = paymentSuccessfulEmail(p);
    await this.send(to, subject, html);
  }
  async sendPaymentFailed(to: string, p: PaymentFailedParams) {
    const { subject, html } = paymentFailedEmail(p);
    await this.send(to, subject, html);
  }
  async sendSubscriptionCancelled(to: string, p: SubscriptionCancelledParams) {
    const { subject, html } = subscriptionCancelledEmail(p);
    await this.send(to, subject, html);
  }
  async sendLoginAlert(to: string, p: LoginAlertParams) {
    const { subject, html } = loginAlertEmail(p);
    // Security emails use a distinct from address
    await this.send(to, subject, html, this.securityFrom);
  }
  async sendTrialEnding(to: string, p: TrialEndingParams) {
    const { subject, html } = trialEndingEmail(p);
    await this.send(to, subject, html);
  }
  async sendRenewalReminder(to: string, p: RenewalReminderParams) {
    const { subject, html } = renewalReminderEmail(p);
    await this.send(to, subject, html);
  }
  async sendMcpConnected(to: string, p: McpConnectedParams) {
    const { subject, html } = mcpConnectedEmail(p);
    await this.send(to, subject, html);
  }
  async sendWaitlist(to: string, p: WaitlistEmailParams) {
    const { subject, html } = waitlistEmail(p);
    await this.send(to, subject, html);
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

// Use the real Resend sender only when a key is actually configured. Self-host
// runs NODE_ENV=production without RESEND_API_KEY — gate on the key alone so the
// api/workers boot cleanly there and just log emails to stdout instead of crashing.
export const emailSender: EmailSender = process.env.RESEND_API_KEY
  ? new ResendEmailSender()
  : new StdoutEmailSender();

// Re-export param types so callers can import from a single place
export type {
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
};
