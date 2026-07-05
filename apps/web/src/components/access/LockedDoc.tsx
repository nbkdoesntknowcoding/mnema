/**
 * Shown when GET /api/docs/:id returns 403 access_denied. Lets the viewer file an
 * access request (POST /request-access), which notifies the doc owner.
 */
import { type JSX, useState } from 'react';
import { api } from '../../lib/api';

export function LockedDoc({ docId, title }: { docId: string; title: string }): JSX.Element {
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'err'>('idle');
  const [err, setErr] = useState('');

  async function send() {
    setState('busy'); setErr('');
    try {
      await api.requestDocAccess(docId, { permission, message: message.trim() || undefined });
      setState('sent');
    } catch (e) {
      setState('err');
      setErr(e instanceof Error ? e.message.replace(/^API \d+: /, '') : 'Could not send the request.');
    }
  }

  const ink = 'var(--ink)';
  const soft = 'var(--ink-soft)';
  const line = 'var(--border, rgba(0,0,0,0.08))';
  const surface = 'var(--surface, #fff)';
  const accent = 'var(--accent, #6366f1)';

  return (
    <div style={{ maxWidth: 460, margin: '8vh auto 0', textAlign: 'center', padding: '0 20px' }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, margin: '0 auto 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: surface, border: `0.5px solid ${line}`, color: soft }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h1 style={{ margin: '0 0 6px', font: '500 20px/1.2 var(--sans)', color: ink, letterSpacing: '-0.01em' }}>
        You don't have access
      </h1>
      <p style={{ margin: '0 0 22px', fontSize: 13.5, color: soft }}>
        <strong style={{ color: ink }}>{title}</strong> is restricted. Request access and the owner will be notified.
      </p>

      {state === 'sent' ? (
        <div style={{ background: 'color-mix(in srgb, #16a34a 10%, transparent)', border: '0.5px solid #16a34a', color: '#16a34a', borderRadius: 10, padding: '14px 16px', fontSize: 13 }}>
          Request sent. You'll get a notification when the owner responds.
        </div>
      ) : (
        <div style={{ background: surface, border: `0.5px solid ${line}`, borderRadius: 12, padding: 16, textAlign: 'left' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {(['read', 'write'] as const).map((p) => (
              <button key={p} onClick={() => setPermission(p)} style={{
                flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                border: `0.5px solid ${permission === p ? accent : line}`,
                color: permission === p ? '#fff' : ink, background: permission === p ? accent : 'transparent',
              }}>{p === 'read' ? 'Read access' : 'Edit access'}</button>
            ))}
          </div>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a note for the owner (optional)" rows={2}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, border: `0.5px solid ${line}`, background: 'var(--surface-2, #fafafa)', color: ink, resize: 'vertical', fontFamily: 'inherit' }} />
          {err && <div style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>{err}</div>}
          <button onClick={send} disabled={state === 'busy'} style={{ marginTop: 12, width: '100%', padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 500, color: '#fff', background: accent, border: 'none', cursor: 'pointer' }}>
            {state === 'busy' ? 'Sending…' : 'Request access'}
          </button>
        </div>
      )}

      <a href="/app/content" style={{ display: 'inline-block', marginTop: 18, fontSize: 12.5, color: soft, textDecoration: 'none' }}>← Back to documents</a>
    </div>
  );
}
