import { type JSX, useState } from 'react';
import { api, ApiError } from '../../lib/api';

interface Props {
  /** Suggested workspace name — usually derived from the user's email domain. */
  suggestedName: string;
}

/**
 * Workspace-creation form for the onboarding step. Posts to
 * /api/auth/create-workspace; on success the server has already minted a
 * fresh JWT scoped to the new workspace and set the cookie, so we just
 * navigate to /app and the editor surface picks up.
 *
 * The slug is generated server-side from the name when omitted, so the
 * form is single-field. Power users can override the slug later in
 * Settings → Workspace (Chunk C).
 */
export function WorkspaceOnboarding({ suggestedName }: Props): JSX.Element {
  const [name, setName] = useState(suggestedName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e?: React.FormEvent): Promise<void> {
    e?.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError('Workspace name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createWorkspace({ name: trimmed });
      // Server set a fresh JWT cookie scoped to the new tenant — go.
      window.location.href = '/app';
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError('That name is already in use. Try another.');
        } else if (err.status === 401) {
          setError('Your session expired. Please sign in again.');
          setTimeout(() => {
            window.location.href = '/auth/login';
          }, 1500);
        } else {
          setError('Could not create workspace. Try again.');
        }
      } else {
        setError('Network error. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <label
          htmlFor="workspace-name"
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--text-primary)' }}
        >
          Workspace name
        </label>
        <input
          id="workspace-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Co"
          className="w-full px-3 py-2 rounded-md focus:outline-none transition-colors"
          style={{
            background: 'var(--surface-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
          maxLength={80}
          autoFocus
        />
      </div>
      <button
        type="submit"
        disabled={submitting || name.trim().length === 0}
        className="w-full px-4 py-2.5 rounded-md font-medium transition-opacity disabled:opacity-50"
        style={{
          background: 'var(--interactive-primary)',
          color: 'var(--text-inverse)',
        }}
      >
        {submitting ? 'Creating…' : 'Create workspace'}
      </button>
      {error && (
        <p className="text-sm" style={{ color: 'var(--danger-default)' }}>
          {error}
        </p>
      )}
    </form>
  );
}
