/**
 * Access-requests inbox. Incoming = requests routed to me (I own the doc) → approve/deny
 * with an optional expiry. Outgoing = requests I filed → their status. Backed by
 * /api/docs/access-requests + the approve/deny PATCH.
 */
import { type JSX, useEffect, useState } from 'react';
import { api, type AccessRequest } from '../../lib/api';

const ink = 'var(--ink)';
const soft = 'var(--ink-soft)';
const muted = 'var(--ink-muted, #8a8a8a)';
const line = 'var(--border, rgba(0,0,0,0.08))';
const surface = 'var(--surface, #fff)';
const accent = 'var(--accent, #6366f1)';

const EXPIRY = [
  { label: 'Permanent', days: 0 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

export function AccessRequestsInbox(): JSX.Element {
  const [box, setBox] = useState<'incoming' | 'outgoing'>('incoming');
  const [rows, setRows] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expiryDays, setExpiryDays] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);

  async function load(which: 'incoming' | 'outgoing') {
    setLoading(true); setErr(null);
    try {
      const r = await api.listAccessRequests(which);
      setRows(r.requests);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^API \d+: /, '') : 'Failed to load');
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(box); }, [box]);

  async function resolve(r: AccessRequest, action: 'approve' | 'deny') {
    setBusy(r.id); setErr(null);
    try {
      const days = expiryDays[r.id] ?? 0;
      const expiresAt = action === 'approve' && days > 0
        ? new Date(Date.now() + days * 86400_000).toISOString()
        : null;
      await api.resolveAccessRequest(r.id, { action, expiresAt });
      await load(box);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^API \d+: /, '') : 'Failed');
    } finally { setBusy(null); }
  }

  const pending = rows.filter((r) => r.status === 'pending');
  const resolved = rows.filter((r) => r.status !== 'pending');

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${line}`, marginBottom: 18 }}>
        {(['incoming', 'outgoing'] as const).map((t) => (
          <button key={t} onClick={() => setBox(t)} style={tabBtn(box === t)}>
            {t === 'incoming' ? 'Incoming' : 'My requests'}
            {t === 'incoming' && pending.length > 0 && box === 'incoming' && (
              <span style={badge}>{pending.length}</span>
            )}
          </button>
        ))}
      </div>

      {err && <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', marginBottom: 14 }}>{err}</div>}
      {loading && <div style={{ color: muted, fontSize: 13, padding: '20px 4px' }}>Loading…</div>}

      {!loading && rows.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: muted, padding: '48px 24px' }}>
          {box === 'incoming'
            ? 'No one has requested access to your documents.'
            : "You haven't requested access to any documents."}
        </div>
      )}

      {!loading && box === 'incoming' && pending.length > 0 && (
        <div style={{ marginBottom: resolved.length ? 28 : 0 }}>
          <SectionLabel>Pending — needs your decision</SectionLabel>
          {pending.map((r) => (
            <div key={r.id} style={{ ...card, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: ink }}>
                    <strong>{r.requester_name || r.requester_email || 'Someone'}</strong>
                    {' '}requested <Perm p={r.permission} /> access to{' '}
                    <a href={`/app/content/${r.doc_id}`} style={{ color: accent, textDecoration: 'none', fontWeight: 500 }}>
                      {r.doc_title || 'a document'}
                    </a>
                  </div>
                  {r.message && <div style={{ marginTop: 6, fontSize: 12.5, color: soft, borderLeft: `2px solid ${line}`, paddingLeft: 10 }}>{r.message}</div>}
                  <div style={{ marginTop: 6, fontSize: 11.5, color: muted }}>{fmt(r.created_at)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <select value={expiryDays[r.id] ?? 0} onChange={(e) => setExpiryDays((m) => ({ ...m, [r.id]: +e.target.value }))}
                    title="Access duration" style={{ padding: '5px 8px', borderRadius: 7, fontSize: 12, border: `0.5px solid ${line}`, background: surface, color: ink }}>
                    {EXPIRY.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
                  </select>
                  <button disabled={busy === r.id} onClick={() => resolve(r, 'approve')} style={btn(accent, true)}>
                    {busy === r.id ? '…' : 'Approve'}
                  </button>
                  <button disabled={busy === r.id} onClick={() => resolve(r, 'deny')} style={btn('#ef4444', false)}>Deny</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (box === 'outgoing' ? rows : resolved).length > 0 && (
        <div>
          {box === 'incoming' && <SectionLabel>Resolved</SectionLabel>}
          {(box === 'outgoing' ? rows : resolved).map((r) => (
            <div key={r.id} style={{ ...card, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0, fontSize: 13.5, color: ink }}>
                {box === 'incoming'
                  ? <><strong>{r.requester_name || r.requester_email || 'Someone'}</strong> · </>
                  : <>To <strong>{r.owner_name || r.owner_email || 'owner'}</strong> · </>}
                <a href={`/app/content/${r.doc_id}`} style={{ color: soft, textDecoration: 'none' }}>{r.doc_title || 'a document'}</a>
                {' '}<Perm p={r.permission} />
              </div>
              <span style={statusPill(r.status)}>{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ fontSize: 11, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 2px' }}>{children}</div>;
}
function Perm({ p }: { p: 'read' | 'write' }): JSX.Element {
  return <span style={{ fontSize: 11, fontWeight: 600, color: p === 'write' ? '#d97706' : accent }}>{p}</span>;
}

const card: React.CSSProperties = { background: surface, border: `0.5px solid ${line}`, borderRadius: 10, padding: 14 };
const badge: React.CSSProperties = { marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: '#fff', background: accent, borderRadius: 20, padding: '0 6px', minWidth: 16, display: 'inline-block', textAlign: 'center' };
function tabBtn(active: boolean): React.CSSProperties {
  return { padding: '8px 12px', fontSize: 13, fontWeight: active ? 600 : 400, color: active ? ink : muted, background: 'none', border: 'none', borderBottom: `2px solid ${active ? accent : 'transparent'}`, cursor: 'pointer', marginBottom: -1, display: 'inline-flex', alignItems: 'center' };
}
function btn(color: string, filled: boolean): React.CSSProperties {
  return { fontSize: 12.5, fontWeight: 500, color: filled ? '#fff' : color, background: filled ? color : 'none', border: `0.5px solid ${color}`, borderRadius: 7, padding: '5px 12px', cursor: 'pointer' };
}
function statusPill(s: string): React.CSSProperties {
  const c = s === 'approved' ? '#16a34a' : s === 'denied' ? '#ef4444' : muted;
  return { fontSize: 10.5, fontWeight: 600, color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, padding: '2px 9px', borderRadius: 20, textTransform: 'capitalize', flexShrink: 0 };
}
function fmt(s: string): string {
  try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
}
