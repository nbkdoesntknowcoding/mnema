/**
 * Real notifications page (replaces the former static mock). Fetches /api/notifications,
 * marks read, and — for `access_request` notifications — renders inline Approve/Deny by
 * matching the notification's doc to the caller's pending incoming request.
 */
import { type JSX, useEffect, useState } from 'react';
import { api, type AccessRequest } from '../../lib/api';

const ink = 'var(--ink)';
const soft = 'var(--ink-soft)';
const muted = 'var(--ink-muted, #8a8a8a)';
const line = 'var(--border, rgba(0,0,0,0.08))';
const surface = 'var(--surface, #fff)';
const accent = 'var(--accent, #6366f1)';

interface Notif {
  id: string; kind: string; title: string;
  body?: string | null; link?: string | null;
  readAt?: string | null; createdAt: string;
}

export function NotificationsPage(): JSX.Element {
  const [items, setItems] = useState<Notif[]>([]);
  const [reqByDoc, setReqByDoc] = useState<Record<string, AccessRequest>>({});
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=50', { credentials: 'include' });
      const data = res.ok ? ((await res.json()) as { notifications: Notif[] }) : { notifications: [] };
      setItems(data.notifications ?? []);
      try {
        const r = await api.listAccessRequests('incoming');
        const m: Record<string, AccessRequest> = {};
        for (const req of r.requests) if (req.status === 'pending') m[req.doc_id] = req;
        setReqByDoc(m);
      } catch { /* not a doc owner / endpoint unavailable */ }
    } catch { /* api offline */ }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const unread = items.filter((n) => !n.readAt).length;
  const shown = filter === 'unread' ? items.filter((n) => !n.readAt) : items;

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    await fetch(`/api/notifications/${id}/read`, { method: 'PATCH', credentials: 'include' }).catch(() => {});
  }
  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    await fetch('/api/notifications/read-all', { method: 'PATCH', credentials: 'include' }).catch(() => {});
  }
  function docIdFromLink(link?: string | null): string | null {
    const m = link?.match(/\/app\/docs\/([0-9a-fA-F-]{36})/);
    return m?.[1] ?? null;
  }
  async function resolve(req: AccessRequest, action: 'approve' | 'deny') {
    setBusy(req.id);
    try { await api.resolveAccessRequest(req.id, { action }); await load(); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {(['all', 'unread'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={chip(filter === f)}>
            {f === 'all' ? 'All' : 'Unread'}{f === 'unread' && unread > 0 ? ` (${unread})` : ''}
          </button>
        ))}
        {unread > 0 && (
          <button onClick={markAll} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: soft, fontSize: 12.5, cursor: 'pointer' }}>
            Mark all as read
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: muted, fontSize: 13, padding: '24px 4px' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: muted, padding: '48px 24px' }}>
          {filter === 'unread' ? 'Nothing unread.' : 'No notifications yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map((n) => {
            const docId = n.kind === 'access_request' ? docIdFromLink(n.link) : null;
            const req = docId ? reqByDoc[docId] : undefined;
            return (
              <div key={n.id} style={{ ...card, background: n.readAt ? surface : 'color-mix(in srgb, var(--accent, #6366f1) 5%, var(--surface, #fff))', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ marginTop: 6, width: 7, height: 7, borderRadius: 7, flexShrink: 0, background: n.readAt ? 'transparent' : accent }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: n.readAt ? 400 : 600, color: ink }}>{n.title}</div>
                  {n.body && <div style={{ marginTop: 3, fontSize: 12.5, color: soft }}>{n.body}</div>}
                  <div style={{ marginTop: 5, fontSize: 11, color: muted }}>{relTime(n.createdAt)}</div>

                  {req ? (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button disabled={busy === req.id} onClick={() => resolve(req, 'approve')} style={btn(accent, true)}>
                        {busy === req.id ? '…' : 'Approve'}
                      </button>
                      <button disabled={busy === req.id} onClick={() => resolve(req, 'deny')} style={btn('#ef4444', false)}>Deny</button>
                      <a href="/app/requests" style={{ fontSize: 11.5, color: muted, textDecoration: 'none' }}>More options →</a>
                    </div>
                  ) : n.link ? (
                    <a href={n.link} onClick={() => { if (!n.readAt) void markRead(n.id); }}
                      style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: accent, textDecoration: 'none' }}>
                      {n.kind === 'access_request' ? 'Review in Access requests' : 'Open'} →
                    </a>
                  ) : null}
                </div>
                {!n.readAt && (
                  <button onClick={() => markRead(n.id)} title="Mark read" style={{ background: 'none', border: 'none', color: muted, fontSize: 11.5, cursor: 'pointer', flexShrink: 0 }}>
                    Mark read
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: surface, border: `0.5px solid ${line}`, borderRadius: 10, padding: 14 };
function chip(active: boolean): React.CSSProperties {
  return { padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: active ? 600 : 400, color: active ? ink : muted, background: active ? 'var(--surface-2, #f4f4f5)' : 'transparent', border: `1px solid ${active ? line : 'transparent'}`, cursor: 'pointer' };
}
function btn(color: string, filled: boolean): React.CSSProperties {
  return { fontSize: 12.5, fontWeight: 500, color: filled ? '#fff' : color, background: filled ? color : 'none', border: `0.5px solid ${color}`, borderRadius: 7, padding: '5px 12px', cursor: 'pointer' };
}
function relTime(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const m = Math.floor(secs / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}
