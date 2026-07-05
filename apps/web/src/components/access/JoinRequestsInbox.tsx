/**
 * Join requests inbox — owners/admins review same-domain users who asked to join the workspace
 * (created by /api/_internal/request-join). Approving picks the access level (viewer/editor/admin),
 * which creates the membership; denying closes it. Sibling of DecisionApprovalsInbox — same card
 * styling, plus a role selector because the approver chooses what access to grant. Renders nothing
 * when there's nothing pending (so non-admins / empty inboxes show no section).
 */
import { type JSX, useEffect, useState } from 'react';
import { api, type JoinRequestRow } from '../../lib/api';

const ink = 'var(--ink)';
const soft = 'var(--ink-soft)';
const muted = 'var(--ink-muted, #8a8a8a)';
const line = 'var(--border, rgba(0,0,0,0.08))';
const surface = 'var(--surface, #fff)';
const accent = 'var(--accent, #6366f1)';

type Role = 'viewer' | 'editor' | 'admin';

export function JoinRequestsInbox(): JSX.Element {
  const [rows, setRows] = useState<JoinRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [roleById, setRoleById] = useState<Record<string, Role>>({});
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await api.listJoinRequests();
      setRows(r.requests);
    } catch (e) {
      // Non-admins get 403 — just render nothing, no error noise.
      setRows([]);
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function approve(r: JoinRequestRow) {
    setBusy(r.id); setErr(null);
    try {
      await api.approveJoinRequest(r.id, roleById[r.id] ?? 'viewer');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^API \d+: /, '') : 'Failed');
    } finally { setBusy(null); }
  }
  async function deny(r: JoinRequestRow) {
    setBusy(r.id); setErr(null);
    try {
      await api.denyJoinRequest(r.id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^API \d+: /, '') : 'Failed');
    } finally { setBusy(null); }
  }

  if (!loading && rows.length === 0) return <></>;

  return (
    <div style={{ marginTop: 36 }}>
      <h2 style={{ margin: '0 0 4px', font: '500 16px/1.2 var(--sans)', letterSpacing: '-0.01em', color: ink }}>
        Requests to join
        {rows.length > 0 && <span style={badge}>{rows.length}</span>}
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: soft }}>
        People from your domain who asked to join this workspace. Choose their access level, then approve — or deny.
      </p>

      {err && <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', marginBottom: 14 }}>{err}</div>}

      {rows.map((r) => (
        <div key={r.id} style={{ ...card, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, color: ink, lineHeight: 1.4 }}>{r.requester_name || r.requester_email}</div>
              <div style={{ marginTop: 4, fontSize: 11.5, color: muted }}>{r.requester_email} · {fmt(r.created_at)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <select
                value={roleById[r.id] ?? 'viewer'}
                onChange={(e) => setRoleById((m) => ({ ...m, [r.id]: e.target.value as Role }))}
                disabled={busy === r.id}
                title="Access to grant on approval"
                style={{ fontSize: 12.5, color: ink, background: surface, border: `0.5px solid ${line}`, borderRadius: 7, padding: '5px 8px' }}
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <button disabled={busy === r.id} onClick={() => approve(r)} style={btn(accent, true)}>
                {busy === r.id ? '…' : 'Approve'}
              </button>
              <button disabled={busy === r.id} onClick={() => deny(r)} style={btn('#ef4444', false)}>Deny</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const card: React.CSSProperties = { background: surface, border: `0.5px solid ${line}`, borderRadius: 10, padding: 14 };
const badge: React.CSSProperties = { marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: '#fff', background: accent, borderRadius: 20, padding: '0 6px', minWidth: 16, display: 'inline-block', textAlign: 'center', verticalAlign: 'middle' };
function btn(color: string, filled: boolean): React.CSSProperties {
  return { fontSize: 12.5, fontWeight: 500, color: filled ? '#fff' : color, background: filled ? color : 'none', border: `0.5px solid ${color}`, borderRadius: 7, padding: '5px 12px', cursor: 'pointer' };
}
function fmt(s: string): string {
  try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
}
