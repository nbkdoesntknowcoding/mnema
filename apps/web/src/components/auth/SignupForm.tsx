import { type JSX, useState } from 'react';

/**
 * Signup CTA — sends the user through the same WorkOS hosted-auth flow
 * the sign-in path uses. After the user creates an account (or, if they
 * already have one, signs in), the existing /auth/callback flow runs,
 * bootstraps the user row, and lands them at /app.
 *
 * We intentionally don't collect workspace name or display name here.
 * Workspace naming happens at /onboarding/workspace (the next step in
 * the flow); display name comes from WorkOS's firstName/lastName.
 *
 * Two intentional UX choices worth knowing:
 *
 *   1. Cached-session passthrough. If the user already has an active
 *      WorkOS session in this browser, WorkOS silently re-authenticates
 *      them — no sign-up screen, no sign-in screen. We accepted this as
 *      "returning user who forgot they have an account" UX. A future
 *      refinement could pass `screenHint: 'sign-up'` to WorkOS to force
 *      the create-account screen even with a cached session; we deferred
 *      until usage data justifies it.
 *
 *   2. Workspace auto-creation. The existing bootstrap auto-creates a
 *      workspace for net-new users. That means brand-new signups skip
 *      the /onboarding/workspace naming step and land in an auto-named
 *      workspace. Renaming is in Settings → Workspace (Chunk C).
 *
 * The `intent=signup` query param is a hint to /auth/login that's
 * currently ignored downstream — kept here so we can pick it up later
 * without changing the SignupForm contract.
 */
export function SignupForm(): JSX.Element {
  const [submitting, setSubmitting] = useState(false);

  function startSignup(): void {
    setSubmitting(true);
    window.location.href = '/auth/login?intent=signup';
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={startSignup}
        disabled={submitting}
        className="w-full px-4 py-2.5 rounded-md font-medium transition-opacity disabled:opacity-50"
        style={{
          background: 'var(--interactive-primary)',
          color: 'var(--text-inverse)',
        }}
      >
        {submitting ? 'Redirecting…' : 'Continue with email'}
      </button>
      <p
        className="text-xs text-center"
        style={{ color: 'var(--text-tertiary)' }}
      >
        By signing up you agree to our terms. We'll create your workspace on
        the next screen.
      </p>
    </div>
  );
}
