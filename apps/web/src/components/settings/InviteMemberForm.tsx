import { type JSX, useState } from 'react';
import { api, ApiError, type Role } from '../../lib/api';

interface Props {
  /**
   * The current user's role in this workspace. Editors can only invite as
   * editor/viewer; the role-selector hides "Owner" for them. The backend
   * also enforces this (Chunk A), so this is purely a UX guard.
   */
  currentUserRole: Role;
  /** Called after a successful invitation so the parent can refresh the list. */
  onSuccess?: () => void;
}

const ROLES_FOR_OWNER: ReadonlyArray<Role> = ['owner', 'editor', 'viewer'];
const ROLES_FOR_EDITOR: ReadonlyArray<Role> = ['editor', 'viewer'];

export function InviteMemberForm({
  currentUserRole,
  onSuccess,
}: Props): JSX.Element {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const availableRoles =
    currentUserRole === 'owner' ? ROLES_FOR_OWNER : ROLES_FOR_EDITOR;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Email is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.createInvitation({ email: trimmed, role });
      setSuccess(`Invitation sent to ${trimmed}.`);
      setEmail('');
      setRole('editor');
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409 && /already_a_member/.test(err.message)) {
          setError('That person is already a member of this workspace.');
        } else if (err.status === 409 && /already_invited/.test(err.message)) {
          setError(
            'There is already a pending invitation for that email. Revoke it first if you need to change the role.',
          );
        } else if (err.status === 403) {
          setError("You don't have permission to invite at that role level.");
        } else if (err.status === 400) {
          setError('That email looks invalid.');
        } else if (err.status === 402) {
          setError(err.message); // seat/entitlement limit — show the server's reason
        } else {
          setError('Could not send invitation. Try again.');
        }
      } else {
        setError('Network error. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-start">
      <div className="flex-1">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className="w-full h-9 px-3 rounded-md text-sm focus:outline-none transition-colors"
          style={{
            background: 'var(--surface-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
          required
          autoComplete="email"
        />
      </div>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        className="h-9 px-3 rounded-md text-sm focus:outline-none"
        style={{
          background: 'var(--surface-input)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
        }}
      >
        {availableRoles.map((r) => (
          <option key={r} value={r}>
            {r.charAt(0).toUpperCase() + r.slice(1)}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={submitting || email.trim().length === 0}
        className="h-9 px-4 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
        style={{
          background: 'var(--interactive-primary)',
          color: 'var(--text-inverse)',
        }}
      >
        {submitting ? 'Sending…' : 'Send invite'}
      </button>
      {error && (
        <p
          className="absolute mt-12 text-sm"
          style={{ color: 'var(--danger-default)' }}
        >
          {error}
        </p>
      )}
      {success && (
        <p
          className="absolute mt-12 text-sm"
          style={{ color: 'var(--success-default)' }}
        >
          {success}
        </p>
      )}
    </form>
  );
}
