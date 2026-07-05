/**
 * NotificationBell — real-time notification bell for the app header.
 *
 * Features:
 *  - Bell icon with unread count badge (red dot, max "9+")
 *  - Dropdown panel: last 20 notifications with relative timestamps
 *  - Unread notifications: brighter background
 *  - "Mark all read" button at top
 *  - Click on notification: marks read + navigates to link if present
 *  - SSE connection: appends new notifications in real time
 *  - Empty state: "No notifications yet"
 */

import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface Notification {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    void fetchNotifications();
  }, []);

  // ── SSE stream ────────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/notifications/stream', { withCredentials: true });

    es.addEventListener('notification', (e) => {
      try {
        const n = JSON.parse(e.data) as Notification;
        setItems((prev) => {
          // Avoid duplicates
          if (prev.some((x) => x.id === n.id)) return prev;
          return [n, ...prev];
        });
        if (!n.readAt) {
          setUnreadCount((c) => c + 1);
        }
      } catch {
        // ignore malformed event
      }
    });

    es.onerror = () => {
      // SSE auto-reconnects on error — no action needed
    };

    return () => es.close();
  }, []);

  // ── Close panel on outside click ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  async function fetchNotifications() {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=20', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications: Notification[];
        unread_count: number;
      };
      setItems(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } catch {
      // API offline
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch(`/api/notifications/${id}/read`, { method: 'PATCH', credentials: 'include' });
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    await fetch('/api/notifications/read-all', { method: 'PATCH', credentials: 'include' });
  }

  async function handleItemClick(n: Notification) {
    if (!n.readAt) await markRead(n.id);
    if (n.link) window.location.href = n.link;
    setOpen(false);
  }

  const badgeLabel = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }} ref={panelRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        style={{
          width: 26,
          height: 26,
          borderRadius: 5,
          background: 'transparent',
          border: 0,
          color: open ? 'var(--ink)' : 'var(--ink-muted)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 14,
              height: 14,
              borderRadius: 7,
              background: '#ef4444',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
              fontFamily: 'var(--sans)',
            }}
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 32,
            right: 0,
            width: 320,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  background: 'none',
                  border: 0,
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--accent)',
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Items */}
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {loading ? (
              <p style={{ textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13, padding: '24px 0', margin: 0 }}>
                Loading…
              </p>
            ) : items.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13, padding: '32px 0', margin: 0 }}>
                No notifications yet
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void handleItemClick(n)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: n.readAt ? 'transparent' : 'var(--surface-2)',
                    border: 0,
                    borderBottom: '1px solid var(--line)',
                    padding: '10px 14px',
                    cursor: n.link ? 'pointer' : 'default',
                    color: 'var(--ink)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {!n.readAt && (
                      <span
                        style={{
                          flexShrink: 0,
                          marginTop: 5,
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: '#3b82f6',
                          display: 'inline-block',
                        }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          fontWeight: n.readAt ? 400 : 500,
                          color: 'var(--ink)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {n.title}
                      </p>
                      {n.body && (
                        <p
                          style={{
                            margin: '2px 0 0',
                            fontSize: 12,
                            color: 'var(--ink-muted)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {n.body}
                        </p>
                      )}
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-soft)' }}>
                        {relativeTime(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
