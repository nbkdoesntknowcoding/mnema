/**
 * Community settings (Community Flows — Phase 3, P3-6). Self-host surface.
 *
 * Shows this instance's community-hub status. The publish credential
 * (COMMUNITY_HUB_KEY) is an instance env var, so setting it stays out-of-band
 * (env + restart) — there is no browser-writable secret here by design. But we
 * DO surface a "get a free key" action: it emails a signed community-license key
 * (via our hosted licensing service) that the operator then sets as
 * COMMUNITY_HUB_KEY. This is the self-hoster's setup path for publishing.
 */
import { type JSX, useEffect, useState } from 'react';

const ink = 'var(--ink, #e7e7e9)';
const soft = 'var(--ink-soft, #a1a1aa)';
const muted = 'var(--ink-muted, #71717a)';
const line = 'var(--line, rgba(255,255,255,0.1))';
const surface = 'var(--surface, rgba(255,255,255,0.02))';
const mono = { fontFamily: 'var(--mono, monospace)', fontSize: 12 } as const;

// OUR hosted licensing service — the only outbound call, by explicit user action.
const LICENSE_SERVICE_URL =
  (import.meta.env.PUBLIC_COMMUNITY_LICENSE_URL as string | undefined) ?? 'https://mnema.app/community-license';

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

  // "Get a free key" email form.
  const [email, setEmail] = useState('');
  const [keyState, setKeyState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [keyErr, setKeyErr] = useState('');

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

  async function requestKey(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setKeyState('sending');
    setKeyErr('');
    try {
      const r = await fetch(LICENSE_SERVICE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (r.ok) { setKeyState('sent'); return; }
      setKeyErr(r.status === 429 ? 'Too many requests — try again later.' : 'Could not send. Check the email and try again.');
      setKeyState('error');
    } catch {
      setKeyErr('Network error reaching the licensing service.');
      setKeyState('error');
    }
  }

  if (err) return <div style={{ color: 'var(--status-warn, #ff7a8a)', fontSize: 13 }}>{err}</div>;
  if (!cfg) return <div style={{ color: muted, fontSize: 14 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ padding: '4px 16px', borderRadius: 10, background: surface, border: `1px solid ${line}` }}>
        <Row label="Community hub"><span>{cfg.enabled ? 'Enabled' : 'Disabled'}</span></Row>
        <Row label="Hub URL"><span style={mono}>{cfg.hub_url}</span></Row>
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
        this instance needs a community-license key set as the <code style={mono}>COMMUNITY_HUB_KEY</code> environment
        variable. To point at a different hub or disable the feature entirely, set{' '}
        <code style={mono}>COMMUNITY_HUB_URL</code> / <code style={mono}>COMMUNITY_HUB_ENABLED</code>.
      </p>

      <p style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.6, color: muted }}>
        Looking to unlock <strong>version history</strong> and <strong>document export</strong>? That's a separate,
        per-workspace step — redeem a community-license key under{' '}
        <a href="/app/settings/billing" style={{ color: 'var(--accent, #6366f1)' }}>Settings → Billing</a>.
      </p>

      {!cfg.can_publish && (
        <div style={{ marginTop: 16, border: `1px solid ${line}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: ink, marginBottom: 4 }}>Get a free community key</div>
          {keyState === 'sent' ? (
            <p style={{ fontSize: 13, color: 'var(--status-success, #6be39b)', margin: 0, lineHeight: 1.6 }}>
              Check your inbox for the signed key, then set it as <code style={mono}>COMMUNITY_HUB_KEY</code> in this
              instance's environment and restart the API. Publishing turns on once it's set.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: muted, margin: '0 0 10px', lineHeight: 1.6 }}>
                We'll email you a free signed community-license key. Set it as <code style={mono}>COMMUNITY_HUB_KEY</code> to
                enable publishing from this instance.
              </p>
              <form onSubmit={requestKey} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email" required value={email} placeholder="you@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${line}`, background: 'var(--bg, #1b1b1e)', color: 'inherit', fontSize: 14 }}
                />
                <button
                  type="submit" disabled={keyState === 'sending'}
                  style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #6366f1)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: keyState === 'sending' ? 'default' : 'pointer' }}
                >
                  {keyState === 'sending' ? 'Sending…' : 'Email me a key'}
                </button>
              </form>
              {keyErr && <p style={{ fontSize: 12, color: 'var(--status-warn, #ff7a8a)', margin: '8px 0 0' }}>{keyErr}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
