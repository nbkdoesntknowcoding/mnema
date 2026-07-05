/**
 * Typed email template functions.
 *
 * Each function accepts a strongly-typed params object, renders the
 * corresponding HTML file via the CSS inliner, and returns
 * { subject, html } ready to pass to ResendEmailSender.
 *
 * Placeholder names mirror the {{double_curly}} vars in each HTML file —
 * see emails/html/<slug>.html for the authoritative list.
 *
 * unsubscribe_url is injected here; callers never supply it.
 */

import { renderTemplate } from './inliner.js';

const WEB_BASE_URL =
  process.env.WEB_BASE_URL ?? 'https://mnema.example.com';
const UNSUBSCRIBE_URL = `${WEB_BASE_URL}/unsubscribe`;

// ─── Param interfaces ─────────────────────────────────────────────────────────

export interface WelcomeEmailParams {
  firstName: string;        // {{first_name}}
  workspaceName: string;    // {{workspace_name}}
  openUrl: string;          // {{open_url}}
}

export interface WorkspaceInvitationParams {
  inviterName: string;      // {{inviter_name}}
  workspaceName: string;    // {{workspace_name}}
  acceptUrl: string;        // {{accept_url}}
  roleName?: string;        // {{role_name}}  — Phase B: org role / workspace role
  teamName?: string;        // {{team_name}}  — Phase B: team, or '—'
}

export interface InvitationAcceptedParams {
  inviteeName: string;      // {{invitee_name}}
  workspaceName: string;    // {{workspace_name}}
  membersUrl: string;       // {{members_url}}
}

export interface PaymentSuccessfulParams {
  planName: string;         // {{plan_name}}
  amount: string;           // {{amount}}
  date: string;             // {{date}}
  nextBillingDate: string;  // {{next_billing_date}}
  billingUrl: string;       // {{billing_url}}
}

export interface PaymentFailedParams {
  planName: string;         // {{plan_name}}
  amount: string;           // {{amount}}
  date: string;             // {{date}}
  gracePeriodEnd: string;   // {{grace_period_end}}
  updateUrl: string;        // {{update_url}}  (HTML uses update_url, not billing_url)
}

export interface SubscriptionCancelledParams {
  planName: string;         // {{plan_name}}
  accessEndDate: string;    // {{access_end_date}}
  reactivateUrl: string;    // {{reactivate_url}}
}

export interface LoginAlertParams {
  loginTime: string;        // {{login_time}}
  ipLocation: string;       // {{ip_location}}
  device: string;           // {{device}}
  secureUrl: string;        // {{secure_url}}
}

export interface TrialEndingParams {
  daysRemaining: string;    // {{days_remaining}}
  trialEndDate: string;     // {{trial_end_date}}
  upgradeUrl: string;       // {{upgrade_url}}
}

export interface RenewalReminderParams {
  planName: string;         // {{plan_name}}
  renewalDate: string;      // {{renewal_date}}
  amount: string;           // {{amount}}
  paymentMethod: string;    // {{payment_method}}
  billingUrl: string;       // {{billing_url}}
}

export interface McpConnectedParams {
  workspaceName: string;    // {{workspace_name}}
  connectionTime: string;   // {{connection_time}}
  device: string;           // {{device}}
  claudeUrl: string;        // {{claude_url}}  (HTML uses claude_url, not open_url)
}

export interface WaitlistEmailParams {
  /** Optional first name / display name for a warmer greeting. */
  name?: string | null;
}

// ─── Template functions ───────────────────────────────────────────────────────

export function welcomeEmail(p: WelcomeEmailParams) {
  return {
    subject: `Welcome to Mnema, ${p.firstName}`,
    html: renderTemplate('welcome', {
      first_name: p.firstName,
      workspace_name: p.workspaceName,
      open_url: p.openUrl,
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

export function workspaceInvitationEmail(p: WorkspaceInvitationParams) {
  return {
    subject: `${p.inviterName} invited you to ${p.workspaceName} on Mnema`,
    html: renderTemplate('workspace-invitation', {
      inviter_name: p.inviterName,
      workspace_name: p.workspaceName,
      accept_url: p.acceptUrl,
      role_name: p.roleName ?? 'Member',
      team_name: p.teamName ?? '—',
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

/** Alias kept so older imports of invitationEmail() still compile. */
export const invitationEmail = workspaceInvitationEmail;

/**
 * Waitlist confirmation. Sent once when someone joins the pre-launch waitlist.
 * Built inline (no HTML template file) — a short, warm confirmation.
 */
export function waitlistEmail(p: WaitlistEmailParams) {
  const greeting = p.name && p.name.trim() ? `Hi ${escapeHtml(p.name.trim())},` : 'Hi there,';
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0A0B0D;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0B0D;padding:40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#131418;border:1px solid #24272D;border-radius:16px;padding:36px;">
            <tr><td style="font-size:18px;font-weight:600;color:#F4F5F7;letter-spacing:-0.01em;padding-bottom:18px;">Mnema</td></tr>
            <tr><td style="font-size:20px;font-weight:600;color:#F4F5F7;letter-spacing:-0.02em;padding-bottom:14px;">You're on the waitlist.</td></tr>
            <tr><td style="font-size:14px;line-height:1.65;color:#B8BCC4;">
              ${greeting}<br/><br/>
              Thanks for your interest in Mnema — the live context engine for AI-native teams.
              You're on the list, and we'll reach out with an invite as soon as your spot opens up.
              <br/><br/>
              We're letting people in gradually around our launch, so it won't be long.
              <br/><br/>
              — The Mnema team
            </td></tr>
            <tr><td style="padding-top:28px;font-size:11px;color:#6E737C;border-top:1px solid #24272D;margin-top:24px;">
              Mnema, by BOPPL · You received this because you joined the waitlist at mnema.example.com
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject: "You're on the Mnema waitlist", html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function invitationAcceptedEmail(p: InvitationAcceptedParams) {
  return {
    subject: `${p.inviteeName} joined ${p.workspaceName}`,
    html: renderTemplate('invitation-accepted', {
      invitee_name: p.inviteeName,
      workspace_name: p.workspaceName,
      members_url: p.membersUrl,
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

export function paymentSuccessfulEmail(p: PaymentSuccessfulParams) {
  return {
    subject: `Payment confirmed — ${p.planName} plan`,
    html: renderTemplate('payment-successful', {
      plan_name: p.planName,
      amount: p.amount,
      date: p.date,
      next_billing_date: p.nextBillingDate,
      billing_url: p.billingUrl,
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

export function paymentFailedEmail(p: PaymentFailedParams) {
  return {
    subject: 'Action needed — payment failed',
    html: renderTemplate('payment-failed', {
      plan_name: p.planName,
      amount: p.amount,
      date: p.date,
      grace_period_end: p.gracePeriodEnd,
      update_url: p.updateUrl,
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

export function subscriptionCancelledEmail(p: SubscriptionCancelledParams) {
  return {
    subject: 'Your Mnema subscription has been cancelled',
    html: renderTemplate('subscription-cancelled', {
      plan_name: p.planName,
      access_end_date: p.accessEndDate,
      reactivate_url: p.reactivateUrl,
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

export function loginAlertEmail(p: LoginAlertParams) {
  return {
    subject: 'New sign-in to your Mnema account',
    html: renderTemplate('login-alert', {
      login_time: p.loginTime,
      ip_location: p.ipLocation,
      device: p.device,
      secure_url: p.secureUrl,
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

export function trialEndingEmail(p: TrialEndingParams) {
  return {
    subject: `Your Mnema trial ends in ${p.daysRemaining} days`,
    html: renderTemplate('trial-ending', {
      days_remaining: p.daysRemaining,
      trial_end_date: p.trialEndDate,
      upgrade_url: p.upgradeUrl,
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

export function renewalReminderEmail(p: RenewalReminderParams) {
  return {
    subject: 'Your Mnema subscription renews in 7 days',
    html: renderTemplate('renewal-reminder', {
      plan_name: p.planName,
      renewal_date: p.renewalDate,
      amount: p.amount,
      payment_method: p.paymentMethod,
      billing_url: p.billingUrl,
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

export function mcpConnectedEmail(p: McpConnectedParams) {
  return {
    subject: `Claude is now connected to ${p.workspaceName}`,
    html: renderTemplate('mcp-connected', {
      workspace_name: p.workspaceName,
      connection_time: p.connectionTime,
      device: p.device,
      claude_url: p.claudeUrl,
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  };
}

// ─── Legacy inline templates (kept for any direct callers not yet on queue) ───

/** @deprecated Use workspaceInvitationEmail() via the email queue instead. */
export function passwordResetEmail(_params: { resetUrl: string }): {
  subject: string;
  html: string;
} {
  return {
    subject: 'Reset your Mnema password',
    html: '<p>Password reset is handled by WorkOS — this stub should not be called.</p>',
  };
}
