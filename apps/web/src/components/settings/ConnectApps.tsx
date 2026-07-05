// TODO: Claude Design — apply Mnema glassmorphism design system

import { type JSX, useEffect, useState } from 'react';

interface AgentSessionCount {
  agent: string;
  count: number;
}

interface DevConfig {
  mode: string;
  mcpConfigs?: {
    claude_desktop?: { file: string; snippet: unknown };
    cursor?:        { file: string; snippet: unknown };
    windsurf?:      { file: string; snippet: unknown };
    cline?:         { file: string; snippet: unknown };
    continue?:      { file: string; snippet: unknown };
    zed?:           { file: string; snippet: unknown };
  };
  installCommand?: string;
  cursorInstallCommand?: string;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
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

interface AppEntry {
  key: string;
  name: string;
  icon: string;
  hookSupport: 'full' | 'partial' | 'none' | 'coming_soon';
  hookNote?: string;
  configKey?: keyof NonNullable<DevConfig['mcpConfigs']>;
  installCommandKey?: 'installCommand' | 'cursorInstallCommand';
  apiOnly?: boolean;
}

const APPS: AppEntry[] = [
  {
    key: 'claude',
    name: 'Claude Desktop',
    icon: '✦',
    hookSupport: 'full',
    configKey: 'claude_desktop',
    installCommandKey: 'installCommand',
  },
  {
    key: 'chatgpt',
    name: 'ChatGPT',
    icon: '⟁',
    hookSupport: 'none',
    hookNote: 'Business/Pro/API',
  },
  {
    key: 'cursor',
    name: 'Cursor',
    icon: '⬤',
    hookSupport: 'full',
    configKey: 'cursor',
    installCommandKey: 'cursorInstallCommand',
  },
  {
    key: 'windsurf',
    name: 'Windsurf',
    icon: '◈',
    hookSupport: 'partial',
    hookNote: 'Use Cursor hooks script',
    configKey: 'windsurf',
    installCommandKey: 'cursorInstallCommand',
  },
  {
    key: 'cline',
    name: 'Cline',
    icon: '⬡',
    hookSupport: 'none',
    hookNote: 'MCP only — no session tracking',
    configKey: 'cline',
  },
  {
    key: 'continue',
    name: 'Continue.dev',
    icon: '→',
    hookSupport: 'none',
    hookNote: 'MCP only — no session tracking',
    configKey: 'continue',
  },
  {
    key: 'gemini',
    name: 'Gemini',
    icon: '◇',
    hookSupport: 'none',
    hookNote: 'REST API + function calling',
    apiOnly: true,
  },
  {
    key: 'zed',
    name: 'Zed',
    icon: '▲',
    hookSupport: 'none',
    hookNote: 'MCP via mcp-remote',
    configKey: 'zed',
  },
];

interface ConnectAppsProps {
  workspaceId: string;
}

export function ConnectApps({ workspaceId }: ConnectAppsProps): JSX.Element {
  const [config, setConfig] = useState<DevConfig | null>(null);
  const [sessionCounts, setSessionCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void Promise.allSettled([
      apiFetch<DevConfig>(`/api/workspaces/${workspaceId}/dev-config`),
      apiFetch<AgentSessionCount[]>(`/api/sessions/agent-counts`),
    ]).then(([configRes, countsRes]) => {
      if (configRes.status === 'fulfilled') setConfig(configRes.value);
      if (countsRes.status === 'fulfilled') {
        const map = new Map<string, number>();
        for (const row of countsRes.value) map.set(row.agent, row.count);
        setSessionCounts(map);
      }
      setLoading(false);
    });
  }, [workspaceId]);

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => { setCopied(null); }, 2000);
  }

  function isConnected(app: AppEntry): boolean {
    if (app.apiOnly) return false; // REST-only apps — can't detect
    return (sessionCounts.get(app.key) ?? 0) > 0;
  }

  function getSnippet(app: AppEntry): string | null {
    if (!config?.mcpConfigs || !app.configKey) return null;
    const entry = config.mcpConfigs[app.configKey];
    if (!entry) return null;
    return JSON.stringify(entry.snippet, null, 2);
  }

  function getInstallCmd(app: AppEntry): string | null {
    if (!app.installCommandKey || !config) return null;
    return config[app.installCommandKey] ?? null;
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>
          AI App Connections
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--text-secondary)' }}>
          Connect any AI app to your Mnema knowledge base and task board.
        </p>
      </div>

      {loading && <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading…</p>}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {APPS.map((app) => {
            const connected = isConnected(app);
            const count = sessionCounts.get(app.key) ?? 0;
            const isOpen = expanded === app.key;
            const snippet = getSnippet(app);
            const installCmd = getInstallCmd(app);

            return (
              <div
                key={app.key}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isOpen ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.07)'}`,
                  borderRadius: '10px',
                  overflow: 'hidden',
                  transition: 'border-color 0.15s',
                }}
              >
                {/* Row header */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: '14px',
                    padding: '14px 18px', cursor: 'pointer',
                  }}
                  onClick={() => { setExpanded(isOpen ? null : app.key); }}
                >
                  <span style={{ fontSize: '18px', width: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    {app.icon}
                  </span>

                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {app.name}
                    </span>
                    {app.hookNote && (
                      <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                        {app.hookNote}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {connected ? (
                      <span
                        style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          fontSize: '12px', color: '#86efac',
                          background: 'rgba(34,197,94,0.1)',
                          padding: '2px 10px', borderRadius: '20px',
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                        Connected · {count} sessions
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '12px', color: 'var(--text-tertiary)',
                          background: 'rgba(255,255,255,0.05)',
                          padding: '2px 10px', borderRadius: '20px',
                        }}
                      >
                        {app.key === 'gemini' ? 'Coming soon' : 'Not connected'}
                      </span>
                    )}
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </div>
                </div>

                {/* Expanded setup details */}
                {isOpen && (
                  <div
                    style={{
                      padding: '0 18px 18px',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {app.key === 'chatgpt' ? (
                      <div style={{ paddingTop: '14px' }}>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                          ChatGPT now supports MCP natively. Paste the URL below in your ChatGPT Business admin panel,
                          ChatGPT Developer Mode, or OpenAI API tools array.
                        </p>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <a
                            href="/connect/chatgpt"
                            target="_blank" rel="noopener noreferrer"
                            style={{
                              padding: '6px 14px', borderRadius: '6px',
                              background: 'rgba(99,102,241,0.15)',
                              border: '1px solid rgba(99,102,241,0.3)',
                              color: '#a5b4fc', fontSize: '13px', textDecoration: 'none',
                            }}
                          >
                            Setup guide →
                          </a>
                          <button
                            onClick={() => { void copyText('https://api.example.com/mcp/http', 'chatgpt-mcp-url'); }}
                            style={{
                              padding: '6px 14px', borderRadius: '6px',
                              border: '1px solid rgba(255,255,255,0.1)',
                              background: 'transparent', color: 'var(--text-secondary)',
                              fontSize: '13px', cursor: 'pointer',
                            }}
                          >
                            {copied === 'chatgpt-mcp-url' ? 'Copied!' : 'Copy MCP URL'}
                          </button>
                          <button
                            onClick={() => { void copyText('https://api.example.com/.well-known/ai-plugin.json', 'codex-plugin-url'); }}
                            style={{
                              padding: '6px 14px', borderRadius: '6px',
                              border: '1px solid rgba(255,255,255,0.1)',
                              background: 'transparent', color: 'var(--text-secondary)',
                              fontSize: '13px', cursor: 'pointer',
                            }}
                          >
                            {copied === 'codex-plugin-url' ? 'Copied!' : 'Copy Codex plugin URL'}
                          </button>
                        </div>
                      </div>
                    ) : app.key === 'gemini' ? (
                      <div style={{ paddingTop: '14px' }}>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                          Connect via Gemini function calling using your Mnema API key.
                        </p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <a
                            href="/app/settings/api-keys"
                            style={{
                              padding: '6px 14px', borderRadius: '6px',
                              background: 'rgba(99,102,241,0.15)',
                              border: '1px solid rgba(99,102,241,0.3)',
                              color: '#a5b4fc', fontSize: '13px', textDecoration: 'none',
                            }}
                          >
                            Manage API keys →
                          </a>
                          <button
                            onClick={() => { void copyText('https://mnema.example.com/api/public/gemini-functions.json', 'gemini-fn-url'); }}
                            style={{
                              padding: '6px 14px', borderRadius: '6px',
                              border: '1px solid rgba(255,255,255,0.1)',
                              background: 'transparent', color: 'var(--text-secondary)',
                              fontSize: '13px', cursor: 'pointer',
                            }}
                          >
                            {copied === 'gemini-fn-url' ? 'Copied!' : 'Copy function declarations URL'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {snippet && (
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                Add to {config?.mcpConfigs?.[app.configKey!]?.file ?? 'config file'}:
                              </p>
                              <button
                                onClick={() => { void copyText(snippet, `snippet-${app.key}`); }}
                                style={{
                                  padding: '3px 8px', borderRadius: '5px',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  background: 'transparent', color: 'var(--text-secondary)',
                                  fontSize: '11px', cursor: 'pointer',
                                }}
                              >
                                {copied === `snippet-${app.key}` ? 'Copied!' : 'Copy'}
                              </button>
                            </div>
                            <pre
                              style={{
                                margin: 0, padding: '10px 12px',
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.07)',
                                borderRadius: '6px',
                                fontSize: '12px', fontFamily: 'monospace',
                                color: 'var(--text-secondary)',
                                overflowX: 'auto', whiteSpace: 'pre',
                              }}
                            >
                              {snippet}
                            </pre>
                          </div>
                        )}

                        {/* One-click deep link for Cursor and Windsurf */}
                        {(app.key === 'cursor' || app.key === 'windsurf') && (
                          <div>
                            <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                              One-click install (opens {app.name} and adds Mnema automatically):
                            </p>
                            <a
                              href={`/install/${app.key}`}
                              style={{
                                display: 'inline-block', padding: '6px 14px', borderRadius: '6px',
                                background: 'rgba(99,102,241,0.15)',
                                border: '1px solid rgba(99,102,241,0.3)',
                                color: '#a5b4fc', fontSize: '13px', textDecoration: 'none',
                              }}
                            >
                              Connect {app.name} →
                            </a>
                          </div>
                        )}

                        {installCmd && (
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                Install session tracking hooks:
                              </p>
                              <button
                                onClick={() => { void copyText(installCmd, `cmd-${app.key}`); }}
                                style={{
                                  padding: '3px 8px', borderRadius: '5px',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  background: 'transparent', color: 'var(--text-secondary)',
                                  fontSize: '11px', cursor: 'pointer',
                                }}
                              >
                                {copied === `cmd-${app.key}` ? 'Copied!' : 'Copy'}
                              </button>
                            </div>
                            <pre
                              style={{
                                margin: 0, padding: '10px 12px',
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.07)',
                                borderRadius: '6px',
                                fontSize: '12px', fontFamily: 'monospace',
                                color: '#86efac',
                                overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                              }}
                            >
                              {installCmd}
                            </pre>
                          </div>
                        )}

                        {app.hookSupport === 'none' && !app.configKey && (
                          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                            MCP configuration not available for this app yet.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          marginTop: '24px', padding: '14px 18px',
          background: 'rgba(99,102,241,0.07)',
          border: '1px solid rgba(99,102,241,0.15)',
          borderRadius: '10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>🔑 API Keys</span>
          <span style={{ marginLeft: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            For ChatGPT, Gemini, and REST integrations
          </span>
        </div>
        <a
          href="/app/settings/api-keys"
          style={{
            padding: '6px 14px', borderRadius: '6px',
            background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.3)',
            color: '#a5b4fc', fontSize: '13px', textDecoration: 'none',
          }}
        >
          Manage keys →
        </a>
      </div>
    </div>
  );
}
