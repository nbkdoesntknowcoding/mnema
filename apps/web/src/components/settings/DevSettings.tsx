// TODO: Claude Design — apply Mnema glassmorphism design system
// Background: var(--bg) #0a0a0a
// Cards: rgba(255,255,255,0.04) + backdrop-filter: blur(24px)
// See BOPPL_Context_Engine_Prompt_UI_Redesign_All_MCP_Panels for token system

import { type JSX, useEffect, useState } from 'react';

interface DevConfig {
  mode: string;
  hookTokenSet: boolean;
  hookReceiverUrl: string;
  mcpConfigSnippet: string;
  installCommand: string;
}

interface DevSettingsProps {
  workspaceId: string;
  isOwner: boolean;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  // Use relative URL — goes through the Astro /api proxy, which injects the JWT
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function DevSettings({ workspaceId, isOwner }: DevSettingsProps): JSX.Element {
  const [config, setConfig] = useState<DevConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<DevConfig>(`/api/workspaces/${workspaceId}/dev-config`)
      .then((data) => { setConfig(data); setError(null); })
      .catch((err: Error) => { setError(err.message); })
      .finally(() => { setLoading(false); });
  }, [workspaceId]);

  async function copyText(text: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => { setCopied(null); }, 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function handleRegenerate(): Promise<void> {
    setRegenerating(true);
    setError(null);
    try {
      const res = await apiFetch<{ hookToken: string }>(
        `/api/workspaces/${workspaceId}/regenerate-hook-token`,
        { method: 'POST' },
      );
      setNewToken(res.hookToken);
      setConfig((prev) => prev ? { ...prev, hookTokenSet: true } : prev);
      setConfirmRegen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate token');
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--ink-muted)', fontSize: 13, padding: '20px 0' }}>Loading…</div>;
  }

  if (error && !config) {
    return <div style={{ color: '#ef4444', fontSize: 13, padding: '20px 0' }}>{error}</div>;
  }

  async function handleEnable(): Promise<void> {
    setEnabling(true);
    setEnableError(null);
    try {
      const res = await apiFetch<{ mode: string; hookToken: string }>(
        `/api/workspaces/${workspaceId}/convert-to-dev-project`,
        { method: 'POST', body: '{}' },
      );
      setNewToken(res.hookToken);
      // Reload full config now that mode is dev_project
      const updated = await apiFetch<DevConfig>(`/api/workspaces/${workspaceId}/dev-config`);
      setConfig(updated);
    } catch (err) {
      setEnableError(err instanceof Error ? err.message : 'Failed to enable dev mode');
    } finally {
      setEnabling(false);
    }
  }

  if (!config || config.mode !== 'dev_project') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          padding: 20, borderRadius: 10,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--line)',
        }}>
          <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            Dev mode is not enabled
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--ink-muted)' }}>
            Enable AgentLens to track Claude Code sessions, manage tasks on a Kanban board,
            monitor costs, and run optimization analysis.
          </p>
          {isOwner ? (
            <>
              <button
                onClick={() => void handleEnable()}
                disabled={enabling}
                style={{
                  padding: '8px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600,
                  border: 'none', background: '#6366f1', color: '#fff',
                  cursor: enabling ? 'wait' : 'pointer', opacity: enabling ? 0.7 : 1,
                }}
              >
                {enabling ? 'Enabling…' : 'Enable Dev Mode →'}
              </button>
              {enableError && (
                <p style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>{enableError}</p>
              )}
            </>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Only workspace owners can enable dev mode.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Mode badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderRadius: 8,
        background: 'rgba(99,102,241,0.08)',
        border: '1px solid rgba(99,102,241,0.25)',
      }}>
        <span style={{
          padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
          background: 'rgba(99,102,241,0.2)', color: '#818cf8',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          dev_project
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
          AgentLens task layer is active for this workspace.
        </span>
      </div>

      {/* New token display (shown after regeneration) */}
      {newToken && (
        <div style={{
          padding: 16, borderRadius: 8,
          background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.3)',
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: '#10b981' }}>
            ✓ New hook token generated — copy it now, it won't be shown again.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{
              flex: 1, padding: '6px 10px', borderRadius: 6,
              background: 'rgba(0,0,0,0.4)', border: '1px solid var(--line)',
              fontSize: 12, color: '#10b981', wordBreak: 'break-all',
            }}>
              {newToken}
            </code>
            <button
              onClick={() => void copyText(newToken, 'newtoken')}
              style={copyBtnStyle(copied === 'newtoken')}
            >
              {copied === 'newtoken' ? '✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Hook token section */}
      <section>
        <h3 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          Hook Token
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-muted)' }}>
          Used by Claude Code hooks to authenticate with this workspace.
          The plaintext is shown only once — after that, only the status is shown.
        </p>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 7,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--line)',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: config.hookTokenSet ? '#10b981' : '#6b7280',
          }} />
          <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            {config.hookTokenSet ? 'Token set — hook receiver is armed' : 'No token set yet'}
          </span>
          {isOwner && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {confirmRegen ? (
                <>
                  <span style={{ fontSize: 11, color: '#f97316', alignSelf: 'center' }}>
                    This will invalidate the old token.
                  </span>
                  <button
                    onClick={() => void handleRegenerate()}
                    disabled={regenerating}
                    style={{
                      padding: '5px 12px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                      border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer',
                      opacity: regenerating ? 0.6 : 1,
                    }}
                  >
                    {regenerating ? 'Regenerating…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => { setConfirmRegen(false); }}
                    style={{
                      padding: '5px 10px', borderRadius: 5, fontSize: 11,
                      border: '1px solid var(--line)', background: 'transparent',
                      color: 'var(--ink-muted)', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setConfirmRegen(true); }}
                  style={{
                    padding: '5px 12px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                    border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)',
                    color: '#ef4444', cursor: 'pointer',
                  }}
                >
                  {config.hookTokenSet ? 'Regenerate' : 'Generate token'}
                </button>
              )}
            </div>
          )}
        </div>
        {error && (
          <p style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>{error}</p>
        )}
      </section>

      {/* Install command */}
      <section>
        <h3 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          Install Claude Code Hooks
        </h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)' }}>
          Run this in your project directory after generating a hook token.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <code style={{
            flex: 1, padding: '8px 12px', borderRadius: 6,
            background: 'rgba(0,0,0,0.4)', border: '1px solid var(--line)',
            fontSize: 11, color: 'var(--ink-soft)', wordBreak: 'break-all',
            fontFamily: 'var(--mono)',
          }}>
            {config.installCommand}
          </code>
          <button
            onClick={() => void copyText(config.installCommand, 'install')}
            style={copyBtnStyle(copied === 'install')}
          >
            {copied === 'install' ? '✓' : 'Copy'}
          </button>
        </div>
      </section>

      {/* Hook receiver URL */}
      <section>
        <h3 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          Hook Receiver URL
        </h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)' }}>
          The endpoint that Claude Code posts hook events to.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code style={{
            flex: 1, padding: '7px 10px', borderRadius: 6,
            background: 'rgba(0,0,0,0.4)', border: '1px solid var(--line)',
            fontSize: 12, color: 'var(--ink-soft)', wordBreak: 'break-all',
            fontFamily: 'var(--mono)',
          }}>
            {config.hookReceiverUrl}
          </code>
          <button
            onClick={() => void copyText(config.hookReceiverUrl, 'hookurl')}
            style={copyBtnStyle(copied === 'hookurl')}
          >
            {copied === 'hookurl' ? '✓' : 'Copy'}
          </button>
        </div>
      </section>

      {/* MCP config snippet */}
      <section>
        <h3 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          MCP Config Snippet
        </h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)' }}>
          Add to <code style={{ fontSize: 11, color: 'var(--ink)' }}>~/.claude/mcp.json</code> to
          enable the Mnema MCP tools in Claude Code.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <pre style={{
            flex: 1, margin: 0, padding: '8px 12px', borderRadius: 6,
            background: 'rgba(0,0,0,0.4)', border: '1px solid var(--line)',
            fontSize: 11, color: 'var(--ink-soft)', overflow: 'auto',
            fontFamily: 'var(--mono)',
          }}>
            {config.mcpConfigSnippet}
          </pre>
          <button
            onClick={() => void copyText(config.mcpConfigSnippet, 'mcp')}
            style={copyBtnStyle(copied === 'mcp')}
          >
            {copied === 'mcp' ? '✓' : 'Copy'}
          </button>
        </div>
      </section>

    </div>
  );
}

function copyBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 10px', borderRadius: 5,
    border: '1px solid var(--line)',
    background: active ? '#10b981' : 'var(--surface-2)',
    color: active ? '#fff' : 'var(--ink-muted)',
    fontSize: 11, cursor: 'pointer', flexShrink: 0,
    transition: 'background 0.2s, color 0.2s',
  };
}
