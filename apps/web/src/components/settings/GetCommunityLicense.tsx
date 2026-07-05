/**
 * CL-1 — "Get your free community license" (Settings). Shows the workspace's
 * activated state (tier + unlocks) and, when unregistered, an email form that
 * posts to OUR hosted licensing service (the only outbound call, by explicit user
 * action). The emailed key is redeemed via the sibling RedeemLicense card — which
 * verifies offline (airgapped instances activate with zero outbound calls).
 */
import { useEffect, useState } from 'react';

const SERVICE_URL =
  (import.meta.env.PUBLIC_COMMUNITY_LICENSE_URL as string | undefined) ?? 'https://api.theboringpeople.in/community-license';

interface Entitlements { tier: string; registered: boolean; features: string[]; }

export function GetCommunityLicense(): JSX.Element {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/entitlements')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEnt(d))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending'); setErr('');
    try {
      const r = await fetch(SERVICE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (r.ok) { setState('sent'); return; }
      if (r.status === 429) { setErr('Too many requests — try again later.'); }
      else { setErr('Could not send. Check the email and try again.'); }
      setState('error');
    } catch {
      setErr('Network error reaching the licensing service.'); setState('error');
    }
  }

  const registered = ent?.registered;
  const unlocks = (ent?.features ?? []).filter((f) => f === 'history' || f === 'export');

  return (
    <div style={{ border: '1px solid var(--line, #26262a)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Free community license</div>

      {registered ? (
        <p style={{ fontSize: 13, color: 'var(--muted, #9a9aa2)', margin: 0 }}>
          Registered — <strong>{ent?.tier}</strong> tier. Unlocked:{' '}
          {unlocks.length ? unlocks.join(', ') : 'version history, export'}.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--muted, #9a9aa2)', margin: '0 0 10px' }}>
            Version history and document export are free — we just ask for your email.
            Your history is already being recorded; registering reveals it.
          </p>
          {state === 'sent' ? (
            <p style={{ fontSize: 13, color: 'var(--ok, #6BE39B)', margin: 0 }}>
              Check your inbox — paste the key into “Have a license key?” below.
            </p>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
              <input
                type="email" required value={email} placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line,#2c2c31)', background: 'var(--bg,#1b1b1e)', color: 'inherit', fontSize: 14 }}
              />
              <button type="submit" disabled={state === 'sending'}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent,#6366f1)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {state === 'sending' ? 'Sending…' : 'Get my key'}
              </button>
            </form>
          )}
          {err && <p style={{ fontSize: 12, color: 'var(--err,#f87171)', margin: '8px 0 0' }}>{err}</p>}
        </>
      )}
    </div>
  );
}
