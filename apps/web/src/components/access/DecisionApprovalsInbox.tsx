/**
 * Phase 3b — decision approvals inbox. Meeting-proposed decisions awaiting the proposer's verdict:
 * Confirm (→ becomes the current decision + applies any deferred supersede) or Discard (→ archived,
 * invisible). A SIBLING of AccessRequestsInbox — reuses the card styling, NOT the row (no permission
 * badge, no expiry; the action is confirm/reject, not an ACL grant). The access-request inbox is
 * untouched.
 */
import { type JSX, useEffect, useState } from 'react';
import { api, type DecisionApproval } from '../../lib/api';

const ink = 'var(--ink)';
const soft = 'var(--ink-soft)';
const muted = 'var(--ink-muted, #8a8a8a)';
const line = 'var(--border, rgba(0,0,0,0.08))';
const surface = 'var(--surface, #fff)';
const accent = 'var(--accent, #6366f1)';

export function DecisionApprovalsInbox(): JSX.Element {
  const [rows, setRows] = useState<DecisionApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await api.listDecisionApprovals('incoming');
      setRows(r.approvals);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^API \d+: /, '') : 'Failed to load');
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function resolve(r: DecisionApproval, action: 'confirm' | 'reject') {
    setBusy(r.id); setErr(null);
    try {
      await api.resolveDecisionApproval(r.id, { action });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^API \d+: /, '') : 'Failed');
    } finally { setBusy(null); }
  }

  const pending = rows.filter((r) => r.status === 'pending');
  const resolved = rows.filter((r) => r.status !== 'pending');

  if (!loading && rows.length === 0) return <></>;   // nothing to review → render nothing

  return (
    <div style={{ marginTop: 36 }}>
      <h2 style={{ margin: '0 0 4px', font: '500 16px/1.2 var(--sans)', letterSpacing: '-0.01em', color: ink }}>
        Decisions to review
        {pending.length > 0 && <span style={badge}>{pending.length}</span>}
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: soft }}>
        Mnema captured these from your meetings. Confirm one to make it the standing decision, or discard it.
      </p>

      {err && <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', marginBottom: 14 }}>{err}</div>}
      {loading && <div style={{ color: muted, fontSize: 13, padding: '20px 4px' }}>Loading…</div>}

      {!loading && pending.length > 0 && (
        <div style={{ marginBottom: resolved.length ? 28 : 0 }}>
          <SectionLabel>Pending — needs your decision</SectionLabel>
          {pending.map((r) => (
            <div key={r.id} style={{ ...card, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: ink, lineHeight: 1.4 }}>
                    {r.decision_text || r.decision_label || 'A decision'}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11.5, color: muted }}>
                    {r.meeting_title ? <>from <strong style={{ color: soft }}>{r.meeting_title}</strong> · </> : null}
                    {fmt(r.created_at)}
                    {r.doc_id ? <> · <a href={`/app/content/${r.doc_id}`} style={{ color: accent, textDecoration: 'none' }}>open</a></> : null}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <button disabled={busy === r.id} onClick={() => resolve(r, 'confirm')} style={btn(accent, true)}>
                    {busy === r.id ? '…' : 'Confirm'}
                  </button>
                  <button disabled={busy === r.id} onClick={() => resolve(r, 'reject')} style={btn('#ef4444', false)}>Discard</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && resolved.length > 0 && (
        <div>
          <SectionLabel>Resolved</SectionLabel>
          {resolved.map((r) => (
            <div key={r.id} style={{ ...card, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0, fontSize: 13.5, color: ink }}>{r.decision_text || r.decision_label || 'A decision'}</div>
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

const card: React.CSSProperties = { background: surface, border: `0.5px solid ${line}`, borderRadius: 10, padding: 14 };
const badge: React.CSSProperties = { marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#fff', background: accent, borderRadius: 20, padding: '0 6px', minWidth: 16, display: 'inline-block', textAlign: 'center', verticalAlign: 'middle' };
function btn(color: string, filled: boolean): React.CSSProperties {
  return { fontSize: 12.5, fontWeight: 500, color: filled ? '#fff' : color, background: filled ? color : 'none', border: `0.5px solid ${color}`, borderRadius: 7, padding: '5px 12px', cursor: 'pointer' };
}
function statusPill(s: string): React.CSSProperties {
  const c = s === 'confirmed' ? '#16a34a' : s === 'rejected' ? '#ef4444' : muted;
  return { fontSize: 10.5, fontWeight: 600, color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, padding: '2px 9px', borderRadius: 20, textTransform: 'capitalize', flexShrink: 0 };
}
function fmt(s: string): string {
  try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
}
