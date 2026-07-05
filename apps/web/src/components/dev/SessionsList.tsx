// DESIGN APPLIED: 2026-05-27

import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { T } from '../../lib/dev-tokens';

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionSummary {
  id:             string;
  status:         string;
  developerId:    string;
  agent:          string;
  taskId:         string | null;
  taskTitle:      string | null;
  totalCostUsd:   number;
  totalToolCalls: number;
  durationMs:     number | null;
  model:          string | null;
  gitBranch:      string | null;
  startedAt:      string;
  endedAt:        string | null;
}

interface SessionsResponse {
  sessions:    SessionSummary[];
  next_cursor: string | null;
  totals: {
    count:        number;
    totalCostUsd: number;
  };
}

interface Filters {
  status:      string;
  developerId: string;
  agent:       string;
  from:        string;
  to:          string;
}

// ── SSE event types ───────────────────────────────────────────────────────────

interface SessionStartedEvent {
  sessionId:   string;
  developerId: string;
  agent:       string;
  taskId?:     string;
}

interface SessionEndedEvent {
  sessionId:    string;
  totalCostUsd: number;
  status:       string;
}

interface SessionCostUpdatedEvent {
  sessionId:      string;
  developerId:    string;
  totalCostUsd:   number;
  totalToolCalls: number;
  latestToolName: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

function buildQueryString(filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.status)      params.set('status', filters.status);
  if (filters.developerId) params.set('developerId', filters.developerId);
  if (filters.agent)       params.set('agent', filters.agent);
  if (filters.from)        params.set('from', filters.from);
  if (filters.to)          params.set('to', filters.to);
  if (cursor)              params.set('cursor', cursor);
  params.set('limit', '20');
  return params.toString() ? `?${params.toString()}` : '';
}

// ── Status dot config ─────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, { color: string; pulse: boolean }> = {
  active:    { color: T.green,        pulse: true  },
  completed: { color: T.textMuted,    pulse: false },
  failed:    { color: T.red,          pulse: false },
  stalled:   { color: T.amber,        pulse: false },
  error:     { color: T.red,          pulse: false },
};

// ── Grid column definition (matches Sessions.html spec) ───────────────────────
// 28px | 110px | 160px | 110px | minmax(0,1fr) | 80px | 90px | 110px
const GRID = '28px 110px 160px 110px minmax(0,1fr) 80px 90px 110px';

// ── Component ─────────────────────────────────────────────────────────────────

interface SessionsListProps {
  workspaceId: string;
}

export function SessionsList({ workspaceId: _workspaceId }: SessionsListProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [totals, setTotals] = useState<{ count: number; totalCostUsd: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    status:      '',
    developerId: '',
    agent:       '',
    from:        '',
    to:          '',
  });

  const esRef = useRef<EventSource | null>(null);

  // ── Fetch sessions ──────────────────────────────────────────────────────────
  const fetchSessions = useCallback(async (f: Filters, cursor: string | null = null) => {
    const qs = buildQueryString(f, cursor);
    if (!cursor) setLoading(true);
    else setLoadingMore(true);

    try {
      const data = await apiFetch<SessionsResponse>(`/api/sessions${qs}`);
      if (cursor) {
        setSessions((prev) => [...prev, ...data.sessions]);
      } else {
        setSessions(data.sessions);
        setTotals(data.totals);
      }
      setNextCursor(data.next_cursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void fetchSessions(filters);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch on filter change
  const handleFilterChange = useCallback(
    (key: keyof Filters, value: string) => {
      const next = { ...filters, [key]: value };
      setFilters(next);
      setNextCursor(null);
      void fetchSessions(next);
    },
    [filters, fetchSessions],
  );

  // ── SSE subscription ────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/notifications/stream', {
      withCredentials: true,
    } as EventSourceInit);
    esRef.current = es;

    const handleSessionStarted = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as SessionStartedEvent;
        // Prepend new session stub to list
        const newSession: SessionSummary = {
          id:             data.sessionId,
          status:         'active',
          developerId:    data.developerId,
          agent:          data.agent,
          taskId:         data.taskId ?? null,
          taskTitle:      null,
          totalCostUsd:   0,
          totalToolCalls: 0,
          durationMs:     null,
          model:          null,
          gitBranch:      null,
          startedAt:      new Date().toISOString(),
          endedAt:        null,
        };
        setSessions((prev) => [newSession, ...prev]);
        setTotals((prev) => prev ? { ...prev, count: prev.count + 1 } : null);
      } catch { /* ignore parse errors */ }
    };

    const handleSessionEnded = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as SessionEndedEvent;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === data.sessionId
              ? { ...s, status: data.status, totalCostUsd: data.totalCostUsd, endedAt: new Date().toISOString() }
              : s,
          ),
        );
      } catch { /* ignore */ }
    };

    const handleCostUpdated = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as SessionCostUpdatedEvent;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === data.sessionId
              ? { ...s, totalCostUsd: data.totalCostUsd, totalToolCalls: data.totalToolCalls }
              : s,
          ),
        );
        setTotals((prev) =>
          prev ? { ...prev, totalCostUsd: prev.totalCostUsd + (data.totalCostUsd - 0) } : null,
        );
      } catch { /* ignore */ }
    };

    es.addEventListener('session_started', handleSessionStarted);
    es.addEventListener('session_ended', handleSessionEnded);
    es.addEventListener('session_cost_updated', handleCostUpdated);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  // ── Load more ───────────────────────────────────────────────────────────────
  const loadMore = () => {
    if (nextCursor && !loadingMore) {
      void fetchSessions(filters, nextCursor);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      height:        '100%',
      display:       'flex',
      flexDirection: 'column',
      background:    T.bg,
      fontFamily:    T.fontUI,
      overflow:      'hidden',
    }}>
      {/* Page header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '14px 24px',
        borderBottom:   `1px solid ${T.line}`,
        flexShrink:     0,
        background:     T.bg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: T.textPrimary, letterSpacing: '-0.01em' }}>
            Sessions
          </h1>
          {totals && (
            <span style={{
              fontFamily:    T.fontMono,
              fontSize:      10.5,
              padding:       '3px 7px',
              borderRadius:  999,
              background:    T.surface2,
              border:        `1px solid ${T.line}`,
              color:         T.textSecondary,
              letterSpacing: '0.04em',
            }}>
              {totals.count}
            </span>
          )}
        </div>
        {totals && (
          <span style={{
            display:       'inline-flex',
            alignItems:    'center',
            gap:           6,
            fontFamily:    T.fontMono,
            fontSize:      13,
            color:         T.amber,
            padding:       '5px 10px',
            borderRadius:  6,
            background:    T.stAmberBg,
            border:        `0.5px solid ${T.stAmberBr}`,
          }}>
            ${totals.totalCostUsd.toFixed(2)} total
          </span>
        )}
      </div>

      {/* Filter row */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          8,
        padding:      '10px 24px',
        borderBottom: `1px solid ${T.line}`,
        background:   T.bg,
        flexShrink:   0,
      }}>
        {/* Agent filter */}
        <select
          value={filters.agent}
          onChange={(e) => handleFilterChange('agent', e.target.value)}
          style={ddStyle}
        >
          <option value="">All agents</option>
          <option value="claude_code">Claude Code</option>
          <option value="cursor">Cursor</option>
          <option value="aider">Aider</option>
        </select>

        {/* Status filter */}
        <select
          value={filters.status}
          onChange={(e) => handleFilterChange('status', e.target.value)}
          style={ddStyle}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>

        {/* Developer filter */}
        <input
          type="text"
          placeholder="Developer ID…"
          value={filters.developerId}
          onChange={(e) => handleFilterChange('developerId', e.target.value)}
          style={{ ...ddStyle, width: 140 }}
        />

        <span style={{ flex: 1 }} />

        <span style={{
          fontFamily:    T.fontMono,
          fontSize:      10,
          color:         T.textMuted,
          fontWeight:    500,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          SORT · STARTED ↓
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding:      '10px 24px',
          background:   T.stRedBg,
          border:       `0.5px solid ${T.stRedBr}`,
          color:        T.red,
          fontSize:     13,
          flexShrink:   0,
        }}>
          {error}
        </div>
      )}

      {/* Table head */}
      <div style={{
        display:               'grid',
        gridTemplateColumns:   GRID,
        alignItems:            'center',
        padding:               '0 24px',
        gap:                   14,
        height:                36,
        background:            T.surface1,
        fontFamily:            T.fontMono,
        fontSize:              10,
        fontWeight:            500,
        color:                 T.textMuted,
        letterSpacing:         '0.06em',
        textTransform:         'uppercase',
        borderBottom:          `1px solid ${T.line}`,
        flexShrink:            0,
        position:              'sticky',
        top:                   0,
        zIndex:                2,
      }}>
        <span />
        <span>SESSION</span>
        <span>DEVELOPER</span>
        <span>AGENT</span>
        <span>TASK</span>
        <span>DURATION</span>
        <span style={{ textAlign: 'right' }}>COST</span>
        <span>STARTED</span>
      </div>

      {/* Scrollable session list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '28px 24px', color: T.textMuted, fontSize: 13 }}>
            Loading sessions…
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div style={{ padding: '28px 24px', color: T.textMuted, fontSize: 13 }}>
            No sessions found.
          </div>
        )}

        {!loading && sessions.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}

        {/* Load more */}
        {nextCursor && (
          <div style={{ padding: '12px 24px' }}>
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{
                padding:      '7px 16px',
                fontSize:     12,
                background:   T.glass,
                border:       `0.5px solid ${T.glassBorder}`,
                borderRadius: 8,
                color:        T.textSecondary,
                cursor:       loadingMore ? 'wait' : 'pointer',
                fontFamily:   T.fontUI,
              }}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionRow({ session }: { session: SessionSummary }): JSX.Element {
  const dot = STATUS_DOT[session.status] ?? STATUS_DOT.completed!;

  const handleClick = () => {
    window.location.href = `/app/sessions/${session.id}`;
  };

  return (
    <div
      onClick={handleClick}
      style={{
        display:             'grid',
        gridTemplateColumns: GRID,
        alignItems:          'center',
        padding:             '0 24px',
        gap:                 14,
        height:              52,
        borderBottom:        `0.5px solid rgba(255,255,255,0.04)`,
        cursor:              'pointer',
        transition:          'background 120ms ease',
        fontFamily:          T.fontUI,
        background:          session.status === 'active' ? 'rgba(74,222,128,0.03)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background =
          session.status === 'active' ? 'rgba(74,222,128,0.03)' : 'transparent';
      }}
    >
      {/* Status dot */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span
          style={{
            width:        8,
            height:       8,
            borderRadius: '50%',
            background:   dot.color,
            display:      'inline-block',
            flexShrink:   0,
            boxShadow:    dot.pulse ? `0 0 6px ${dot.color}` : 'none',
          }}
        />
      </div>

      {/* Session ID */}
      <span style={{
        fontFamily:    T.fontMono,
        fontSize:      12,
        color:         T.textSecondary,
        letterSpacing: '0.02em',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        whiteSpace:    'nowrap',
      }}>
        {session.id.slice(0, 10)}
      </span>

      {/* Developer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <DeveloperAvatar id={session.developerId} />
        <span style={{
          fontSize:     12.5,
          fontWeight:   500,
          color:        T.textPrimary,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>
          {session.developerId.slice(0, 12)}
        </span>
      </div>

      {/* Agent badge */}
      <span>
        <span style={{
          display:       'inline-flex',
          alignItems:    'center',
          fontFamily:    T.fontMono,
          fontSize:      10,
          fontWeight:    500,
          padding:       '3px 7px',
          borderRadius:  4,
          background:    T.surface2,
          border:        `0.5px solid ${T.line}`,
          color:         T.textSecondary,
          letterSpacing: '0.04em',
          whiteSpace:    'nowrap',
        }}>
          {session.agent}
        </span>
      </span>

      {/* Task title */}
      <span style={{
        fontSize:     12.5,
        color:        session.taskTitle ? T.textSecondary : T.textDisabled,
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        whiteSpace:   'nowrap',
      }}>
        {session.taskTitle ?? '—'}
        {session.gitBranch && (
          <span style={{ marginLeft: 8, color: T.violet, fontFamily: T.fontMono, fontSize: 10 }}>
            {session.gitBranch}
          </span>
        )}
      </span>

      {/* Duration */}
      <span style={{
        fontFamily:    T.fontMono,
        fontSize:      12,
        color:         T.textMuted,
        fontWeight:    500,
      }}>
        {formatDuration(session.durationMs)}
      </span>

      {/* Cost */}
      <span style={{
        fontFamily:    T.fontMono,
        fontSize:      12,
        fontWeight:    500,
        color:         session.totalCostUsd > 0 ? T.amber : T.textMuted,
        textAlign:     'right',
      }}>
        {formatCost(session.totalCostUsd)}
      </span>

      {/* Started */}
      <span style={{
        fontFamily:    T.fontMono,
        fontSize:      11,
        color:         T.textDisabled,
      }}>
        {new Date(session.startedAt).toLocaleString(undefined, {
          month:  'short',
          day:    'numeric',
          hour:   '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  );
}

// ── Mini developer avatar (colour-hash based on string) ───────────────────────

function DeveloperAvatar({ id }: { id: string }): JSX.Element {
  const gradients = [
    'linear-gradient(135deg,#FFB370,#FF7A8A)',
    'linear-gradient(135deg,#7C9CFF,#C8A2FF)',
    'linear-gradient(135deg,#6BE39B,#2B9B9B)',
    'linear-gradient(135deg,#FF7A8A,#B847C0)',
    'linear-gradient(135deg,#C8A2FF,#7C9CFF)',
  ];
  const idx = id.charCodeAt(0) % gradients.length;
  const initials = id.slice(0, 2).toUpperCase();
  return (
    <span style={{
      width:          24,
      height:         24,
      borderRadius:   '50%',
      background:     gradients[idx],
      color:          'white',
      fontFamily:     T.fontUI,
      fontSize:       10.5,
      fontWeight:     700,
      display:        'inline-flex',
      alignItems:     'center',
      justifyContent: 'center',
      flexShrink:     0,
    }}>
      {initials}
    </span>
  );
}

// ── Shared dropdown / input style ────────────────────────────────────────────

const ddStyle: React.CSSProperties = {
  display:      'inline-flex',
  alignItems:   'center',
  gap:          8,
  padding:      '6px 12px',
  background:   T.surface2,
  border:       `0.5px solid ${T.line}`,
  borderRadius: 6,
  color:        T.textPrimary,
  fontFamily:   T.fontUI,
  fontSize:     12.5,
  fontWeight:   500,
  cursor:       'pointer',
  outline:      'none',
  appearance:   'none' as const,
  WebkitAppearance: 'none' as const,
};
