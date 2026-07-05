import { type JSX, useEffect, useState } from 'react';
import { api, ApiError, type MemberRow, type Role } from '../../lib/api';

interface Props {
  /**
   * The signed-in user's id and role in this workspace. Used to:
   *   - Render "(you)" next to the self row.
   *   - Hide the role-change + remove buttons unless the caller is owner.
   *   - Friendly-error the "last owner can't demote/remove yourself" 409
   *     before the request fires.
   */
  currentUserId: string;
  currentUserRole: Role;
}

const ROLES: ReadonlyArray<Role> = ['owner', 'editor', 'viewer'];

export function MembersTable({ currentUserId, currentUserRole }: Props): JSX.Element {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    api
      .listMembers()
      .then((res) => setRows(res.members))
      .catch(() => {
        setRows([]);
        setError('Could not load members.');
      });
  }

  useEffect(() => {
    refresh();
  }, []);

  const ownerCount = rows?.filter((r) => r.role === 'owner').length ?? 0;
  const canManage = currentUserRole === 'owner';

  async function handleRoleChange(member: MemberRow, newRole: Role): Promise<void> {
    if (newRole === member.role) return;
    // Pre-flight: friendly-error the last-owner demote case before the API call.
    if (
      member.userId === currentUserId &&
      member.role === 'owner' &&
      newRole !== 'owner' &&
      ownerCount <= 1
    ) {
      setError(
        "You're the only owner. Promote someone else to owner first, then demote yourself.",
      );
      return;
    }

    setUpdating(member.userId);
    setError(null);
    try {
      const res = await api.updateMemberRole(member.userId, newRole);
      setRows((prev) =>
        prev?.map((r) =>
          r.userId === member.userId ? { ...r, role: res.member.role } : r,
        ) ?? null,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Can't demote the last owner.");
      } else {
        setError('Could not change role.');
      }
    } finally {
      setUpdating(null);
    }
  }

  async function handleRemove(member: MemberRow): Promise<void> {
    if (
      member.userId === currentUserId &&
      member.role === 'owner' &&
      ownerCount <= 1
    ) {
      setError(
        "You're the only owner. Promote someone else to owner first, then remove yourself.",
      );
      return;
    }
    if (
      !window.confirm(
        member.userId === currentUserId
          ? 'Remove yourself from this workspace? You will lose access immediately.'
          : `Remove ${member.email} from this workspace?`,
      )
    ) {
      return;
    }
    setUpdating(member.userId);
    setError(null);
    try {
      await api.removeMember(member.userId);
      if (member.userId === currentUserId) {
        // Removed self — bounce out of the app.
        window.location.href = '/auth/login';
        return;
      }
      setRows((prev) => prev?.filter((r) => r.userId !== member.userId) ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Can't remove the last owner.");
      } else {
        setError('Could not remove member.');
      }
    } finally {
      setUpdating(null);
    }
  }

  if (rows === null) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Loading…
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((m) => {
        const isSelf = m.userId === currentUserId;
        const displayName = m.displayName || m.email;
        return (
          <div
            key={m.userId}
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-md"
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
                {displayName}
                {isSelf && (
                  <span
                    className="ml-2 text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    (you)
                  </span>
                )}
              </div>
              {m.displayName && (
                <div
                  className="text-xs mt-0.5 truncate"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {m.email}
                </div>
              )}
            </div>

            {canManage ? (
              <>
                <select
                  value={m.role}
                  onChange={(e) =>
                    void handleRoleChange(m, e.target.value as Role)
                  }
                  disabled={updating === m.userId}
                  className="h-8 px-2 rounded text-xs focus:outline-none disabled:opacity-50"
                  style={{
                    background: 'var(--surface-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleRemove(m)}
                  disabled={updating === m.userId}
                  className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-50"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'var(--interactive-ghost-hover)';
                    e.currentTarget.style.color = 'var(--danger-default)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  Remove
                </button>
              </>
            ) : (
              <span
                className="text-xs px-2 py-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {m.role.charAt(0).toUpperCase() + m.role.slice(1)}
              </span>
            )}
          </div>
        );
      })}
      {error && (
        <p className="text-sm mt-2" style={{ color: 'var(--danger-default)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
