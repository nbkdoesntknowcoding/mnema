// DESIGN APPLIED: 2026-05-27

import { type JSX, useState } from 'react';
import { T, glassCard } from '../../lib/dev-tokens';

interface DevSetupBannerProps {
  workspaceId: string;
  hookToken: string; // plaintext — shown once
  onDismiss: () => void;
}

export function DevSetupBanner({ workspaceId, hookToken, onDismiss }: DevSetupBannerProps): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null);
  const webBase = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://mnema.example.com';

  const installCommand = `MNEMA_HOOK_TOKEN=${hookToken} MNEMA_WORKSPACE_ID=${workspaceId} bash <(curl -sf ${webBase}/install/claude-hooks.sh)`;
  const mcpSnippet = JSON.stringify({
    mcpServers: { mnema: { url: `${webBase}/mcp`, headers: { Authorization: 'Bearer <YOUR_MCP_TOKEN>' } } },
  }, null, 2);

  async function copyText(text: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  function handleDismiss(): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`mnema_setup_banner_${workspaceId}`, 'dismissed');
    }
    onDismiss();
  }

  return (
    <div style={{
      ...glassCard,
      background:   'rgba(255,179,112,0.05)',
      border:       `0.5px solid rgba(255,179,112,0.25)`,
      borderRadius: 16,
      padding:      '20px 22px',
      marginBottom: 20,
      fontFamily:   T.fontUI,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.textPrimary }}>
              Dev Project workspace created
            </h3>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: T.textMuted }}>
            Copy your hook token now — it won't be shown again.
          </p>

          {/* Hook token */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: T.textMuted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Hook Token (shown once)
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{
                flex:       1,
                padding:    '7px 10px',
                borderRadius: 10,
                background: T.surface2,
                border:     `0.5px solid ${T.glassBorder}`,
                fontSize:   12,
                color:      T.green,
                wordBreak:  'break-all',
                fontFamily: T.fontMono,
              }}>
                {hookToken}
              </code>
              <button
                onClick={() => void copyText(hookToken, 'token')}
                style={{ ...copyBtnStyle, background: copied === 'token' ? `${T.green}30` : T.glass, color: copied === 'token' ? T.green : T.textMuted }}
              >
                {copied === 'token' ? '✓' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Install command */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: T.textMuted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Install hooks in Claude Code
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <code style={{
                flex:       1,
                padding:    '7px 10px',
                borderRadius: 10,
                background: T.surface2,
                border:     `0.5px solid ${T.glassBorder}`,
                fontSize:   11,
                color:      T.textSecondary,
                wordBreak:  'break-all',
                fontFamily: T.fontMono,
              }}>
                {installCommand}
              </code>
              <button
                onClick={() => void copyText(installCommand, 'install')}
                style={{ ...copyBtnStyle, background: copied === 'install' ? `${T.green}30` : T.glass, color: copied === 'install' ? T.green : T.textMuted }}
              >
                {copied === 'install' ? '✓' : 'Copy'}
              </button>
            </div>
          </div>

          {/* MCP config snippet */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: T.textMuted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              MCP Config (~/.claude/mcp.json)
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <pre style={{
                flex:       1,
                margin:     0,
                padding:    '7px 10px',
                borderRadius: 10,
                background: T.surface2,
                border:     `0.5px solid ${T.glassBorder}`,
                fontSize:   11,
                color:      T.textSecondary,
                overflow:   'auto',
                fontFamily: T.fontMono,
              }}>
                {mcpSnippet}
              </pre>
              <button
                onClick={() => void copyText(mcpSnippet, 'mcp')}
                style={{ ...copyBtnStyle, background: copied === 'mcp' ? `${T.green}30` : T.glass, color: copied === 'mcp' ? T.green : T.textMuted }}
              >
                {copied === 'mcp' ? '✓' : 'Copy'}
              </button>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            style={{
              padding:      '8px 18px',
              borderRadius: 10,
              background:   'rgba(255,179,112,0.12)',
              border:       `0.5px solid rgba(255,179,112,0.30)`,
              color:        T.accent,
              fontSize:     12,
              fontWeight:   600,
              cursor:       'pointer',
              fontFamily:   T.fontUI,
            }}
          >
            I've copied my token
          </button>
        </div>
      </div>
    </div>
  );
}

const copyBtnStyle: React.CSSProperties = {
  padding:      '6px 11px',
  borderRadius: 8,
  border:       `0.5px solid ${T.glassBorder}`,
  fontSize:     11,
  cursor:       'pointer',
  flexShrink:   0,
  transition:   'all 0.15s ease',
  fontFamily:   T.fontUI,
};
