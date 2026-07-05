// DESIGN APPLIED: 2026-05-27

import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { T, glassCard } from '../../lib/dev-tokens';

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

interface AgentSession {
  id:               string;
  workspaceId:      string;
  taskId:           string | null;
  taskTitle:        string | null;
  developerId:      string;
  agent:            string;
  status:           string;
  startedAt:        string;
  endedAt:          string | null;
  durationMs:       number | null;
  totalInputTokens:  number;
  totalOutputTokens: number;
  totalCostUsd:      number;
  totalToolCalls:    number;
  model:             string | null;
  gitBranch:         string | null;
  gitCommitBefore:   string | null;
  gitCommitAfter:    string | null;
  filesModifiedCount: number;
}

interface ToolCallRow {
  id:           string;
  toolName:     string;
  filePath:     string | null;
  durationMs:   number | null;
  isError:      boolean;
  errorMessage: string | null;
  exitCode:     number | null;
  inputTokens:  number | null;
  outputTokens: number | null;
  costUsd:      number | null;
  timestamp:    string;
  truncated:    boolean;
  inputJson?:   unknown;
  outputJson?:  unknown;
}

interface FileDiffRow {
  id:           string;
  filePath:     string;
  linesAdded:   number | null;
  linesRemoved: number | null;
  truncated:    boolean;
  toolCallId:   string | null;
  timestamp:    string;
}

interface FileDiffDetail extends FileDiffRow {
  diffContent: string | null;
}

// ── SSE ───────────────────────────────────────────────────────────────────────

interface SessionCostUpdatedEvent {
  sessionId:      string;
  totalCostUsd:   number;
  totalToolCalls: number;
  latestToolName: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

// Parse unified diff into coloured lines
function parseDiff(diff: string): Array<{ type: 'add' | 'remove' | 'context' | 'header'; text: string }> {
  return diff.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ')) {
      return { type: 'header' as const, text: line };
    }
    if (line.startsWith('+')) return { type: 'add' as const, text: line };
    if (line.startsWith('-')) return { type: 'remove' as const, text: line };
    return { type: 'context' as const, text: line };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps): JSX.Element {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [toolCallRows, setToolCallRows] = useState<ToolCallRow[]>([]);
  const [diffRows, setDiffRows] = useState<FileDiffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedToolCall, setExpandedToolCall] = useState<string | null>(null);
  const [expandedToolCallData, setExpandedToolCallData] = useState<{ inputJson?: unknown; outputJson?: unknown } | null>(null);
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<FileDiffDetail | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // ── Fetch session data ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      setLoading(true);
      try {
        const [sess, toolCalls, diffs] = await Promise.all([
          apiFetch<AgentSession>(`/api/sessions/${sessionId}`),
          apiFetch<{ toolCalls: ToolCallRow[] }>(`/api/sessions/${sessionId}/tool-calls`),
          apiFetch<{ fileDiffs: FileDiffRow[] }>(`/api/sessions/${sessionId}/file-diffs`),
        ]);
        if (cancelled) return;
        setSession(sess);
        setToolCallRows(toolCalls.toolCalls);
        setDiffRows(diffs.fileDiffs);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchAll();
    return () => { cancelled = true; };
  }, [sessionId]);

  // ── SSE for active sessions ─────────────────────────────────────────────────
  useEffect(() => {
    if (session?.status !== 'active') return;

    const es = new EventSource('/api/notifications/stream', {
      withCredentials: true,
    } as EventSourceInit);
    esRef.current = es;

    const handleCostUpdated = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as SessionCostUpdatedEvent;
        if (data.sessionId !== sessionId) return;

        // Update session cost + tool count
        setSession((prev) =>
          prev
            ? { ...prev, totalCostUsd: data.totalCostUsd, totalToolCalls: data.totalToolCalls }
            : prev,
        );

        // Append new tool call row (minimal data — no IO)
        const newRow: ToolCallRow = {
          id:           `live-${Date.now()}`,
          toolName:     data.latestToolName,
          filePath:     null,
          durationMs:   null,
          isError:      false,
          errorMessage: null,
          exitCode:     null,
          inputTokens:  null,
          outputTokens: null,
          costUsd:      null,
          timestamp:    new Date().toISOString(),
          truncated:    false,
        };
        setToolCallRows((prev) => [...prev, newRow]);
      } catch { /* ignore */ }
    };

    es.addEventListener('session_cost_updated', handleCostUpdated);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [session?.status, sessionId]);

  // ── Expand tool call with IO ────────────────────────────────────────────────
  const handleExpandToolCall = useCallback(async (id: string) => {
    if (expandedToolCall === id) {
      setExpandedToolCall(null);
      setExpandedToolCallData(null);
      return;
    }

    setExpandedToolCall(id);
    try {
      const data = await apiFetch<{ toolCalls: ToolCallRow[] }>(
        `/api/sessions/${sessionId}/tool-calls?include_io=true&limit=500`,
      );
      const row = data.toolCalls.find((tc) => tc.id === id);
      if (row) {
        setExpandedToolCallData({ inputJson: row.inputJson, outputJson: row.outputJson });
      }
    } catch { /* show what we have */ }
  }, [expandedToolCall, sessionId]);

  // ── Load diff content ───────────────────────────────────────────────────────
  const handleSelectDiff = useCallback(async (diffId: string) => {
    if (selectedDiffId === diffId) {
      setSelectedDiffId(null);
      setSelectedDiff(null);
      return;
    }
    setSelectedDiffId(diffId);
    setLoadingDiff(true);
    try {
      const diff = await apiFetch<FileDiffDetail>(`/api/sessions/${sessionId}/file-diffs/${diffId}`);
      setSelectedDiff(diff);
    } catch { /* show error */ } finally {
      setLoadingDiff(false);
    }
  }, [selectedDiffId, sessionId]);

  // ── Export ──────────────────────────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);

  const handleExport = useCallback((format: 'md' | 'json' | 'csv') => {
    const suffix = format === 'md' ? '' : `?format=${format}`;
    window.location.href = `/api/sessions/${sessionId}/export${suffix}`;
    setExportOpen(false);
  }, [sessionId]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        padding:    40,
        color:      T.textMuted,
        fontSize:   13,
        fontFamily: T.fontUI,
        background: T.bg,
        height:     '100%',
      }}>
        Loading session…
      </div>
    );
  }

  if (error || !session) {
    return (
      <div style={{
        padding:    40,
        color:      T.red,
        fontSize:   13,
        fontFamily: T.fontUI,
        background: T.bg,
        height:     '100%',
      }}>
        {error ?? 'Session not found'}
      </div>
    );
  }

  return (
    <div style={{
      display:             'grid',
      gridTemplateColumns: '280px 1fr 320px',
      flex:                1,
      overflow:            'hidden',
      background:          T.bg,
      fontFamily:          T.fontUI,
      height:              '100%',
    }}>

      {/* ── LEFT PANEL — session metadata ─────────────────────────────── */}
      <div style={{
        borderRight: `1px solid ${T.line}`,
        overflowY:   'auto',
        padding:     '18px 18px 28px',
        display:     'flex',
        flexDirection: 'column',
        gap:         12,
        background:  T.bg,
      }}>

        {/* Session identity card */}
        <div style={{ ...sdCard }}>
          {/* Big cost */}
          <div style={{
            fontFamily:    T.fontMono,
            fontSize:      22,
            fontWeight:    500,
            color:         T.amber,
            letterSpacing: '-0.01em',
            margin:        '0 0 2px',
          }}>
            {formatCost(session.totalCostUsd)}
          </div>
          <div style={{
            fontFamily: T.fontMono,
            fontSize:   11.5,
            color:      T.textSecondary,
            marginBottom: 14,
          }}>
            {session.durationMs !== null
              ? `${Math.round(session.durationMs / 1000)}s`
              : 'ongoing'}
            {' · '}
            {session.totalToolCalls} tool calls
          </div>

          {/* Status badge */}
          <div style={{ marginBottom: 12 }}>
            {(() => {
              const sc = T.sbadge[session.status as keyof typeof T.sbadge] ?? T.sbadge.idle;
              return (
                <span style={{
                  display:       'inline-flex',
                  alignItems:    'center',
                  fontFamily:    T.fontMono,
                  fontSize:      10.5,
                  fontWeight:    500,
                  padding:       '4px 9px',
                  borderRadius:  6,
                  background:    sc.bg,
                  border:        `0.5px solid ${sc.border}`,
                  color:         sc.text,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}>
                  {session.status}
                </span>
              );
            })()}
          </div>

          {/* Meta rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <MetaRow label="ID"        value={session.id.slice(0, 14) + '…'} mono />
            <MetaRow label="Developer" value={session.developerId} />
            <MetaRow label="Agent"     value={session.agent} mono />
            {session.taskTitle && <MetaRow label="Task" value={session.taskTitle} />}
            {session.model && <MetaRow label="Model" value={session.model} mono />}
            <MetaRow label="Started" value={new Date(session.startedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })} mono />
            {session.endedAt && <MetaRow label="Ended" value={new Date(session.endedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })} mono />}
          </div>
        </div>

        {/* Git card */}
        {(session.gitBranch ?? session.gitCommitBefore ?? session.gitCommitAfter) && (
          <div style={{ ...sdCard }}>
            <div style={sdLabel}>Git</div>
            <div style={{ fontFamily: T.fontMono, fontSize: 12, color: T.textSecondary, display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
              {session.gitBranch && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: T.textMuted, width: 56, flexShrink: 0 }}>branch</span>
                  <span>{session.gitBranch}</span>
                </div>
              )}
              {session.gitCommitBefore && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: T.textMuted, width: 56, flexShrink: 0 }}>before</span>
                  <span>{session.gitCommitBefore.slice(0, 8)}</span>
                </div>
              )}
              {session.gitCommitAfter && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: T.textMuted, width: 56, flexShrink: 0 }}>after</span>
                  <span style={{ color: T.green }}>{session.gitCommitAfter.slice(0, 8)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats card */}
        <div style={{ ...sdCard }}>
          <div style={sdLabel}>Stats</div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <MetaRow label="Files changed" value={String(session.filesModifiedCount)} />
            <MetaRow label="Tokens in"    value={session.totalInputTokens.toLocaleString()} mono />
            <MetaRow label="Tokens out"   value={session.totalOutputTokens.toLocaleString()} mono />
          </div>
        </div>

        {/* Export button */}
        <div style={{ position: 'relative', marginTop: 4 }}>
          <button
            onClick={() => { setExportOpen((v) => !v); }}
            style={{
              width:          '100%',
              padding:        '9px 12px',
              fontSize:       12,
              fontFamily:     T.fontUI,
              fontWeight:     500,
              background:     'transparent',
              border:         `0.5px solid ${T.glassBorder}`,
              borderRadius:   6,
              color:          T.textSecondary,
              cursor:         'pointer',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            6,
            }}
          >
            ↓ Export ▾
          </button>
          {exportOpen && (
            <div
              style={{
                position:  'absolute',
                left:      0,
                bottom:    '110%',
                zIndex:    10,
                background: T.surface2,
                border:     `0.5px solid ${T.glassBorderStrong}`,
                borderRadius: 8,
                overflow:  'hidden',
                minWidth:  160,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}
            >
              {[
                { fmt: 'md' as const,   label: 'Markdown (.md)' },
                { fmt: 'json' as const, label: 'JSON (.json)' },
                { fmt: 'csv' as const,  label: 'CSV (.csv)' },
              ].map(({ fmt, label }) => (
                <button
                  key={fmt}
                  onClick={() => { handleExport(fmt); }}
                  style={{
                    display:    'block',
                    width:      '100%',
                    textAlign:  'left',
                    padding:    '8px 14px',
                    fontSize:   12,
                    fontFamily: T.fontUI,
                    background: 'transparent',
                    border:     'none',
                    color:      T.textSecondary,
                    cursor:     'pointer',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = T.glass; }}
                  onMouseOut={(e)  => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── CENTRE PANEL — tool call timeline ─────────────────────────── */}
      <div style={{
        overflowY:  'auto',
        padding:    '18px 22px 28px',
        background: T.bg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontUI }}>
            Timeline
          </h2>
          <span style={{
            fontFamily:    T.fontMono,
            fontSize:      10,
            padding:       '2px 6px',
            borderRadius:  999,
            background:    T.surface2,
            border:        `0.5px solid ${T.line}`,
            color:         T.textSecondary,
          }}>
            {toolCallRows.length}
          </span>
        </div>

        {toolCallRows.length === 0 && (
          <div style={{ color: T.textMuted, fontSize: 13 }}>No tool calls yet.</div>
        )}

        {/* Timeline list */}
        <div style={{ position: 'relative', paddingLeft: 60 }}>
          {/* Vertical rule */}
          <div style={{
            position:    'absolute',
            left:        50,
            top:         4,
            bottom:      4,
            width:       1,
            background:  T.surface3,
          }} />

          {toolCallRows.map((tc) => (
            <ToolCallEntry
              key={tc.id}
              tc={tc}
              expanded={expandedToolCall === tc.id}
              expandedData={expandedToolCall === tc.id ? expandedToolCallData : null}
              onToggle={() => void handleExpandToolCall(tc.id)}
            />
          ))}
        </div>
      </div>

      {/* ── RIGHT PANEL — file diffs ───────────────────────────────────── */}
      <div style={{
        borderLeft: `1px solid ${T.line}`,
        overflowY:  'auto',
        padding:    '18px 18px 28px',
        background: T.bg,
      }}>
        <h2 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontUI }}>
          Files changed
          <span style={{
            marginLeft:    6,
            fontFamily:    T.fontMono,
            fontSize:      10,
            padding:       '2px 6px',
            borderRadius:  999,
            background:    T.surface2,
            border:        `0.5px solid ${T.line}`,
            color:         T.textSecondary,
            fontWeight:    400,
          }}>
            {session.filesModifiedCount}
          </span>
        </h2>

        {diffRows.length === 0 && (
          <div style={{ color: T.textMuted, fontSize: 13 }}>No file changes recorded.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {diffRows.map((d) => (
            <div key={d.id}>
              <div
                onClick={() => void handleSelectDiff(d.id)}
                style={{
                  display:       'flex',
                  alignItems:    'center',
                  gap:           10,
                  padding:       '9px 12px',
                  borderRadius:  6,
                  cursor:        'pointer',
                  background:    selectedDiffId === d.id ? T.surface2 : 'transparent',
                  transition:    'background 120ms ease',
                }}
                onMouseEnter={(e) => {
                  if (selectedDiffId !== d.id) (e.currentTarget as HTMLDivElement).style.background = T.glass;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = selectedDiffId === d.id ? T.surface2 : 'transparent';
                }}
              >
                <span style={{
                  fontFamily:   T.fontMono,
                  fontSize:     11.5,
                  color:        T.textSecondary,
                  flex:         1,
                  minWidth:     0,
                  wordBreak:    'break-all',
                  lineHeight:   '1.4',
                }}>
                  {d.filePath}
                </span>
                <span style={{ fontFamily: T.fontMono, fontSize: 10.5, fontWeight: 500, color: T.green, flexShrink: 0 }}>
                  +{d.linesAdded ?? 0}
                </span>
                <span style={{ fontFamily: T.fontMono, fontSize: 10.5, fontWeight: 500, color: T.red, flexShrink: 0 }}>
                  -{d.linesRemoved ?? 0}
                </span>
                {d.truncated && (
                  <span style={{ color: T.amber, fontSize: 10, flexShrink: 0 }}>⚠</span>
                )}
              </div>

              {selectedDiffId === d.id && (
                <div style={{ marginBottom: 8, borderRadius: 8, overflow: 'hidden', border: `0.5px solid ${T.line}` }}>
                  {loadingDiff && (
                    <div style={{ padding: '8px 12px', fontSize: 12, color: T.textMuted, fontFamily: T.fontUI }}>Loading diff…</div>
                  )}
                  {!loadingDiff && selectedDiff?.diffContent && (
                    <DiffViewer
                      diff={selectedDiff.diffContent}
                      truncated={selectedDiff.truncated}
                    />
                  )}
                  {!loadingDiff && !selectedDiff?.diffContent && (
                    <div style={{ padding: '8px 12px', fontSize: 12, color: T.textMuted }}>No diff content available.</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-component card style ──────────────────────────────────────────

const sdCard: React.CSSProperties = {
  ...glassCard,
  borderRadius: 12,
  padding:      '14px 16px',
};

const sdLabel: React.CSSProperties = {
  fontFamily:    T.fontMono,
  fontSize:      10,
  fontWeight:    500,
  color:         T.textMuted,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

// ── MetaRow ───────────────────────────────────────────────────────────────────

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: T.textMuted, flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize:     mono ? 11 : 12,
        color:        T.textPrimary,
        fontFamily:   mono ? T.fontMono : T.fontUI,
        textAlign:    'right',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        whiteSpace:   'nowrap',
        maxWidth:     '160px',
      }}>
        {value}
      </span>
    </div>
  );
}

// ── ToolCallEntry ─────────────────────────────────────────────────────────────

function ToolCallEntry({
  tc,
  expanded,
  expandedData,
  onToggle,
}: {
  tc:           ToolCallRow;
  expanded:     boolean;
  expandedData: { inputJson?: unknown; outputJson?: unknown } | null;
  onToggle:     () => void;
}): JSX.Element {
  const isMilestone = tc.toolName === '_milestone';
  const milestoneMsg = isMilestone && tc.inputJson && typeof tc.inputJson === 'object'
    ? (tc.inputJson as Record<string, unknown>).message as string
    : null;

  // Format timestamp as short HH:MM:SS
  const ts = new Date(tc.timestamp).toLocaleTimeString(undefined, {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  if (isMilestone) {
    return (
      <div style={{
        display:    'flex',
        alignItems: 'center',
        gap:        10,
        padding:    '6px 0',
        color:      T.violet,
        fontSize:   12,
        fontFamily: T.fontUI,
        marginBottom: 8,
      }}>
        <div style={{ height: 1, flex: 1, background: `${T.violet}40` }} />
        <span>🏁 {milestoneMsg ?? 'Milestone'}</span>
        <div style={{ height: 1, flex: 1, background: `${T.violet}40` }} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', marginBottom: 8 }}>
      {/* Timestamp + connector dot */}
      <div style={{
        position:  'absolute',
        left:      -60,
        top:       11,
        width:     42,
        textAlign: 'right',
        fontFamily: T.fontMono,
        fontSize:  10.5,
        color:     T.textMuted,
        letterSpacing: '0.02em',
      }}>
        {ts}
      </div>
      {/* Connector dot */}
      <div style={{
        position:  'absolute',
        left:      -13,
        top:       14,
        width:     8,
        height:    8,
        borderRadius: '50%',
        background: T.surface3,
        border:    `2px solid ${T.bg}`,
        zIndex:    1,
      }} />

      {/* Card */}
      <div style={{
        padding:       '10px 14px',
        background:    tc.isError ? `${T.red}08` : T.surface2,
        borderRadius:  8,
        border:        `0.5px solid ${tc.isError ? `${T.red}30` : T.line}`,
        overflow:      'hidden',
      }}>
        <div
          onClick={onToggle}
          style={{
            display:   'flex',
            alignItems: 'center',
            gap:       10,
            cursor:    'pointer',
          }}
        >
          {/* Tool name + file */}
          <span style={{
            fontFamily: T.fontMono,
            fontSize:   13,
            fontWeight: 500,
            color:      tc.isError ? T.red : T.textPrimary,
            flexShrink: 0,
          }}>
            {tc.toolName}
          </span>
          {tc.filePath && (
            <span style={{
              fontFamily:   T.fontMono,
              fontSize:     11,
              color:        T.textSecondary,
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
              flex:         1,
            }}>
              {tc.filePath.split('/').pop()}
            </span>
          )}
          {/* Duration chip */}
          {tc.durationMs !== null && (
            <span style={{
              fontFamily:    T.fontMono,
              fontSize:      10,
              padding:       '3px 6px',
              borderRadius:  4,
              background:    T.surface3,
              border:        `0.5px solid ${T.line}`,
              color:         T.textSecondary,
              letterSpacing: '0.04em',
              flexShrink:    0,
              marginLeft:    'auto',
            }}>
              {tc.durationMs}ms
            </span>
          )}
          {/* Tokens */}
          {tc.inputTokens !== null && (
            <span style={{
              fontFamily: T.fontMono,
              fontSize:   10.5,
              color:      T.textMuted,
              flexShrink: 0,
            }}>
              {tc.inputTokens.toLocaleString()} tok
            </span>
          )}
        </div>

        {/* File path (full, below first row) */}
        {tc.filePath && (
          <div style={{
            marginTop:  4,
            fontFamily: T.fontMono,
            fontSize:   11,
            color:      T.textSecondary,
            lineHeight: '1.4',
            wordBreak:  'break-all',
          }}>
            {tc.filePath}
          </div>
        )}

        {/* Error message */}
        {tc.errorMessage && (
          <div style={{
            marginTop:  6,
            fontSize:   11.5,
            color:      T.red,
            fontFamily: T.fontUI,
            lineHeight: '1.4',
          }}>
            {tc.errorMessage}
          </div>
        )}

        {/* Expanded IO */}
        {expanded && (
          <div style={{
            marginTop:   8,
            padding:     '10px 12px',
            borderTop:   `0.5px solid ${T.line}`,
            borderRadius: 6,
            background:  '#0d1117',
            border:      `0.5px solid ${T.line}`,
            fontFamily:  T.fontMono,
            fontSize:    11,
            lineHeight:  '1.55',
            color:       T.textSecondary,
            overflowX:   'auto',
          }}>
            {expandedData ? (
              <>
                {expandedData.inputJson !== undefined && (
                  <div>
                    <div style={{ color: T.textMuted, marginBottom: 4, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>INPUT</div>
                    <pre style={{ color: T.textSecondary, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                      {JSON.stringify(expandedData.inputJson, null, 2)}
                    </pre>
                  </div>
                )}
                {expandedData.outputJson !== undefined && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ color: T.textMuted, marginBottom: 4, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>OUTPUT</div>
                    <pre style={{ color: T.textSecondary, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                      {JSON.stringify(expandedData.outputJson, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: T.textMuted }}>Loading IO data…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── DiffViewer ────────────────────────────────────────────────────────────────

function DiffViewer({ diff, truncated }: { diff: string; truncated: boolean }): JSX.Element {
  const lines = parseDiff(diff);

  const lineStyle: Record<string, React.CSSProperties> = {
    add:     { background: 'rgba(34,197,94,0.08)',   color: T.green },
    remove:  { background: 'rgba(239,68,68,0.08)',   color: T.red },
    context: { color: T.textMuted },
    header:  { color: T.violet, background: T.stPurpleBg },
  };

  return (
    <div style={{
      background:  '#0d1117',
      fontFamily:  T.fontMono,
      fontSize:    11,
      maxHeight:   300,
      overflowY:   'auto',
      padding:     '8px 0',
    }}>
      {truncated && (
        <div style={{
          padding:    '4px 8px',
          background: T.stAmberBg,
          color:      T.amber,
          fontSize:   11,
        }}>
          ⚠ Diff truncated at 100KB
        </div>
      )}
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            padding:      '1px 12px',
            whiteSpace:   'pre-wrap',
            wordBreak:    'break-all',
            lineHeight:   '1.5',
            ...lineStyle[line.type],
          }}
        >
          {line.text || ' '}
        </div>
      ))}
    </div>
  );
}
