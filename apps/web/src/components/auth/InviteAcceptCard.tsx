import { type JSX, useState } from 'react';
import { api, ApiError } from '../../lib/api';

/**
 * Render states:
 *   1. Error lookup (invalid token / expired / revoked / already accepted)
 *      → red card explaining the problem.
 *   2. Not signed in → "Sign in to accept" CTA that round-trips to /auth/login
 *      with a `next` param so the user lands back at this page after auth.
 *   3. Signed in, email matches the invitation → "Accept invitation" button.
 *   4. Signed in, but email DOES NOT match → red explainer + sign-out link.
 *      This is the non-negotiable security gate from the backend (403 on
 *      email_mismatch); we surface it pre-emptively so the user doesn't
 *      hit a confusing error after clicking Accept.
 */

export interface LookupOk {
  workspace_name: string;
  workspace_slug: string;
  inviter_name: string;
  email: string;
  role: 'owner' | 'editor' | 'viewer';
}

export interface LookupErr {
  error: string;
}

type Lookup = LookupOk | LookupErr;

interface Props {
  token: string;
  lookup: Lookup;
  isSignedIn: boolean;
  signedInEmail: string | null;
}

function lookupErrorMessage(error: string): string {
  switch (error) {
    case 'expired':
      return 'This invitation has expired. Ask your teammate to send a fresh one.';
    case 'already_accepted':
      return 'This invitation was already accepted.';
    case 'revoked':
      return 'This invitation was revoked.';
    case 'not_found':
      return "Invitation not found. The link may be wrong or the workspace was deleted.";
    case 'invalid_token':
      return 'This link is not valid. Double-check the URL or ask for a fresh invitation.';
    case 'bad_request':
      return 'This invitation link is malformed.';
    default:
      return 'This invitation cannot be used right now.';
  }
}

export function InviteAcceptCard({
  token,
  lookup,
  isSignedIn,
  signedInEmail,
}: Props): JSX.Element {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // State 1: server-side lookup returned an error envelope.
  // -----------------------------------------------------------------------
  if ('error' in lookup) {
    return (
      <div
        className="max-w-md w-full p-6 rounded-lg"
        style={{
          background: 'var(--surface-overlay)',
          border: '1px solid var(--border-default)',
        }}
      >
        <h1
          className="text-lg font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Invitation problem
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {lookupErrorMessage(lookup.error)}
        </p>
      </div>
    );
  }

  const emailMismatch =
    isSignedIn && signedInEmail?.toLowerCase() !== lookup.email.toLowerCase();

  async function handleAccept(): Promise<void> {
    setAccepting(true);
    setError(null);
    try {
      await api.acceptInvitation(token);
      // Server set a fresh JWT cookie scoped to the newly-joined workspace.
      window.location.href = '/app';
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 410) {
          setError('This invitation is no longer valid.');
        } else if (err.status === 403) {
          setError('Email mismatch — sign out and sign back in with the right account.');
        } else {
          setError('Could not accept invitation. Try again.');
        }
      } else {
        setError('Network error. Try again.');
      }
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div
      className="max-w-md w-full p-6 rounded-lg"
      style={{
        background: 'var(--surface-overlay)',
        border: '1px solid var(--border-default)',
      }}
    >
      <h1
        className="text-lg font-medium mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {lookup.inviter_name} invited you to {lookup.workspace_name}
      </h1>
      <p
        className="text-sm mb-6"
        style={{ color: 'var(--text-secondary)' }}
      >
        {/* article-vowel agreement: "an editor" / "an owner" vs "a viewer" */}
        You'll join as {/^[aeiou]/i.test(lookup.role) ? 'an' : 'a'}{' '}
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          {lookup.role}
        </span>
        .
      </p>

      {!isSignedIn ? (
        <a
          href={`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`}
          className="block w-full text-center px-4 py-2.5 rounded-md font-medium transition-opacity"
          style={{
            background: 'var(--interactive-primary)',
            color: 'var(--text-inverse)',
          }}
        >
          Sign in to accept
        </a>
      ) : emailMismatch ? (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--danger-default)' }}>
            This invitation is for{' '}
            <span style={{ color: 'var(--text-primary)' }}>{lookup.email}</span>,
            but you're signed in as{' '}
            <span style={{ color: 'var(--text-primary)' }}>{signedInEmail}</span>.
          </p>
          <a
            href={`/auth/logout?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="block text-center text-sm underline transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            Sign out and try a different account
          </a>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleAccept}
          disabled={accepting}
          className="w-full px-4 py-2.5 rounded-md font-medium transition-opacity disabled:opacity-50"
          style={{
            background: 'var(--interactive-primary)',
            color: 'var(--text-inverse)',
          }}
        >
          {accepting ? 'Accepting…' : 'Accept invitation'}
        </button>
      )}
      {error && (
        <p className="mt-3 text-sm" style={{ color: 'var(--danger-default)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
