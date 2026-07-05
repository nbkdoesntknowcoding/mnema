import { useState } from 'react';
import type { JSX } from 'react';

interface Props {
  initialMode: string;
  workspaceId: string;
}

export function WorkspaceModeToggle({ initialMode, workspaceId }: Props): JSX.Element {
  const [mode, setMode] = useState(initialMode);
  const [loading, setLoading] = useState(false);

  const isDev = mode === 'dev_project';

  async function enable(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/convert-to-dev-project`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.ok) {
        setMode('dev_project');
        // Full reload so sidebar + page redirects update
        window.location.reload();
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  if (isDev) {
    return (
      <a
        href="/app/kanban"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 9px',
          borderRadius: 6,
          background: 'rgba(99,102,241,0.12)',
          border: '0.5px solid rgba(99,102,241,0.35)',
          color: '#818cf8',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#818cf8', boxShadow: '0 0 4px #818cf8' }} />
        Dev Mode
      </a>
    );
  }

  return (
    <button
      onClick={() => void enable()}
      disabled={loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        borderRadius: 6,
        background: 'transparent',
        border: '0.5px solid rgba(255,255,255,0.12)',
        color: 'var(--ink-muted)',
        fontSize: 11,
        fontWeight: 500,
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.6 : 1,
        transition: 'border-color 0.15s, color 0.15s',
      }}
      title="Enable AgentLens dev mode for this workspace"
    >
      {loading ? 'Enabling…' : (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          Dev Mode
        </>
      )}
    </button>
  );
}
