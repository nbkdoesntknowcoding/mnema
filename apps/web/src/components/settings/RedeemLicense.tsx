/** Redeem a license key onto the current workspace (owner only). Compact card. */
import { type JSX, useState } from 'react';
import { api } from '../../lib/api';

export function RedeemLicense(): JSX.Element {
  const [key, setKey] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');

  async function redeem() {
    if (!key.trim()) return;
    setState('busy'); setMsg('');
    try {
      const r = await api.redeemLicense(key.trim());
      setState('ok'); setMsg(`Activated — ${r.plan} plan, ${r.seats} seat${r.seats === 1 ? '' : 's'}.`);
      setKey('');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setState('err');
      setMsg(e instanceof Error ? e.message.replace(/^API \d+: /, '') : 'Could not redeem this key.');
    }
  }

  return (
    <div style={{ marginTop: 32, padding: 16, border: '0.5px solid var(--border, rgba(0,0,0,0.08))', borderRadius: 10, maxWidth: 460 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Have a license key?</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>Enter it to activate your plan.</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="MNEMA-XXXX-XXXX-XXXX-XXXX"
          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 12.5, fontFamily: 'var(--mono, monospace)', border: '0.5px solid var(--border, rgba(0,0,0,0.08))', background: 'var(--surface, #fff)', color: 'var(--ink)' }} />
        <button onClick={redeem} disabled={state === 'busy' || !key.trim()}
          style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, color: '#fff', background: 'var(--accent, #6366f1)', border: 'none', cursor: 'pointer' }}>
          {state === 'busy' ? 'Redeeming…' : 'Redeem'}
        </button>
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 12.5, color: state === 'ok' ? '#16a34a' : '#ef4444' }}>{msg}</div>}
    </div>
  );
}
