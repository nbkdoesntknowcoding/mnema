import { type JSX, useEffect, useState } from 'react';
import { api, ApiError, type InvitationRow } from '../../lib/api';

/** Forces re-fetch via this counter so InviteMemberForm can poke us. */
interface Props {
  reloadKey?: number;
}

export function PendingInvitations({ reloadKey = 0 }: Props): JSX.Element {
  const [rows, setRows] = useState<InvitationRow[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    api
      .listInvitations()
      .then((res) => setRows(res.invitations))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          // Viewer-role caller — they can't see pending invites. Render empty.
          setRows([]);
        } else {
          setRows([]);
          setError('Could not load pending invitations.');
        }
      });
  }

  useEffect(() => {
    refresh();
  }, [reloadKey]);

  async function handleRevoke(id: string): Promise<void> {
    setRevoking(id);
    setError(null);
    try {
      await api.revokeInvitation(id);
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? null);
    } catch {
      setError('Could not revoke invitation.');
    } finally {
      setRevoking(null);
    }
  }

  if (rows === null) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Loading…
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        No pending invitations.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((inv) => {
        const expiresInDays = Math.max(
          0,
          Math.round(
            (new Date(inv.expiresAt).getTime() - Date.now()) /
              (24 * 60 * 60 * 1000),
          ),
        );
        return (
          <div
            key={inv.id}
            className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-md"
            style={{
              background: 'var(--surface-overlay)',
              border: '1px solid var(--border-default)',
            }}
          >
            <div className="min-w-0 flex-1">
              <div
                className="text-sm truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {inv.email}
              </div>
              <div
                className="text-xs mt-0.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Invited as {inv.role} · expires in {expiresInDays}{' '}
                {expiresInDays === 1 ? 'day' : 'days'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleRevoke(inv.id)}
              disabled={revoking === inv.id}
              className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-50"
              style={{
                color: 'var(--text-secondary)',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'var(--interactive-ghost-hover)';
                e.currentTarget.style.color = 'var(--danger-default)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              {revoking === inv.id ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        );
      })}
      {error && (
        <p className="text-sm" style={{ color: 'var(--danger-default)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
