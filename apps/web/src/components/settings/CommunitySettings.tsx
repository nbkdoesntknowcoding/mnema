/**
 * Community settings (Community Flows — Phase 3, P3-6).
 * Shows this instance's community-hub status. The publish credential
 * (COMMUNITY_HUB_KEY) is an instance env var, so this surface is read-only:
 * it reports the hub URL, whether the feature is enabled, and whether a key is
 * configured (i.e. whether publishing is available). Self-hosters set the key
 * via env; there is no browser-writable secret here by design.
 */
import { type JSX, useEffect, useState } from 'react';

const ink = 'var(--ink, #e7e7e9)';
const soft = 'var(--ink-soft, #a1a1aa)';
const muted = 'var(--ink-muted, #71717a)';
const line = 'var(--line, rgba(255,255,255,0.1))';
const surface = 'var(--surface, rgba(255,255,255,0.02))';

interface Config {
  enabled: boolean;
  hub_url: string;
  can_publish: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${line}` }}>
      <span style={{ fontSize: 13, color: soft }}>{label}</span>
      <span style={{ fontSize: 13, color: ink }}>{children}</span>
    </div>
  );
}

export function CommunitySettings(): JSX.Element {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/community/config', { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        setCfg((await res.json()) as Config);
      } catch {
        setErr('Could not load community settings.');
      }
    })();
  }, []);

  if (err) return <div style={{ color: 'var(--status-warn, #ff7a8a)', fontSize: 13 }}>{err}</div>;
  if (!cfg) return <div style={{ color: muted, fontSize: 14 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ padding: '4px 16px', borderRadius: 10, background: surface, border: `1px solid ${line}` }}>
        <Row label="Community hub"><span>{cfg.enabled ? 'Enabled' : 'Disabled'}</span></Row>
        <Row label="Hub URL"><span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12 }}>{cfg.hub_url}</span></Row>
        <Row label="Publishing">
          {cfg.can_publish ? (
            <span style={{ color: 'var(--status-success, #6be39b)' }}>Available ✓</span>
          ) : (
            <span style={{ color: 'var(--status-edit, #f0997b)' }}>Key not configured</span>
          )}
        </Row>
      </div>

      <p style={{ marginTop: 18, fontSize: 13, lineHeight: 1.6, color: soft }}>
        Browsing and importing community flows works out of the box. To <strong>publish</strong> your own flows,
        this instance needs a community-license key set as the <code style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12 }}>COMMUNITY_HUB_KEY</code> environment
        variable. Get a free key from the community sign-up. To point at a different hub or disable the feature
        entirely, set <code style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12 }}>COMMUNITY_HUB_URL</code> / <code style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12 }}>COMMUNITY_HUB_ENABLED</code>.
      </p>
    </div>
  );
}
