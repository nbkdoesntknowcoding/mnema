import { type JSX, useEffect, useRef, useState } from 'react';
import { api, ApiError, type WorkspaceSummary } from '../../lib/api';

interface Props {
  /** UUID of the workspace this JWT is currently scoped to. */
  currentWorkspaceId: string;
}

/**
 * Workspace switcher dropdown for the app header.
 *
 * Fetches all workspaces the current user is a member of on mount.
 * Clicking another workspace calls /api/auth/switch-workspace which:
 *   1. Verifies membership server-side (rejects forging)
 *   2. Re-mints a JWT scoped to the new tenant
 *   3. Sets the boppl_jwt cookie
 *
 * Then we reload. Reload (not hot-swap) is intentional — Yjs collab
 * sessions are tenant-scoped and the editor state machine wasn't
 * designed to re-thread across a tenant change. Refresh is cleaner.
 *
 * Hidden entirely if the user only belongs to one workspace; no point
 * in showing a single-option dropdown.
 */
export function WorkspaceSwitcher({ currentWorkspaceId }: Props): JSX.Element | null {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fetch on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .listWorkspaces()
      .then((res) => {
        if (!cancelled) setWorkspaces(res.workspaces);
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Click-outside close.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (workspaces === null) {
    // Still loading — render a tiny skeleton so the header doesn't shift.
    return (
      <div
        className="h-8 w-32 rounded-md animate-pulse"
        style={{ background: 'var(--surface-overlay)' }}
      />
    );
  }

  // Single-workspace user — no need for a dropdown. The current workspace
  // name still belongs in the header (Chunk C ships that via the page),
  // so the switcher just doesn't render here.
  if (workspaces.length <= 1) {
    const ws = workspaces.find((w) => w.id === currentWorkspaceId);
    if (!ws) return null;
    return (
      <div
        className="px-3 h-8 inline-flex items-center rounded-md text-sm"
        style={{
          background: 'var(--surface-overlay)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
        }}
      >
        {ws.name}
      </div>
    );
  }

  const current = workspaces.find((w) => w.id === currentWorkspaceId);

  async function handleSwitch(workspaceId: string): Promise<void> {
    if (workspaceId === currentWorkspaceId) {
      setOpen(false);
      return;
    }
    setSwitching(workspaceId);
    try {
      await api.switchWorkspace(workspaceId);
      // Hard reload to /app — see comment at top about why we don't hot-swap.
      window.location.href = '/app';
    } catch (err) {
      setSwitching(null);
      if (err instanceof ApiError && err.status === 403) {
        // Membership revoked under us — refresh the list and bail.
        setWorkspaces(workspaces!.filter((w) => w.id !== workspaceId));
      }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-3 h-8 inline-flex items-center gap-2 rounded-md text-sm transition-colors"
        style={{
          background: open ? 'var(--surface-active)' : 'var(--surface-overlay)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{current?.name ?? 'Choose workspace'}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 4l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 mt-1 w-64 py-1 rounded-md shadow-lg z-50"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-default)',
          }}
        >
          {workspaces.map((ws) => {
            const isCurrent = ws.id === currentWorkspaceId;
            const isSwitching = switching === ws.id;
            return (
              <li key={ws.id}>
                <button
                  type="button"
                  onClick={() => void handleSwitch(ws.id)}
                  disabled={isSwitching}
                  className="w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors disabled:opacity-50"
                  style={{
                    color: 'var(--text-primary)',
                    background: isCurrent ? 'var(--surface-selected)' : 'transparent',
                  }}
                  onMouseOver={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = 'var(--interactive-ghost-hover)';
                  }}
                  onMouseOut={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span className="truncate">{ws.name}</span>
                  <span
                    className="text-xs ml-3 shrink-0"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {isSwitching ? '…' : ws.role}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
