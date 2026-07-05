'use client';
// DESIGN APPLIED: 2026-05-27

import { useEffect, useRef, useState } from 'react';
import { T, glassCard } from '../../lib/dev-tokens';

interface Finding {
  id: string;
  rule: string;
  description: string;
  suggestedAction: string;
  roiScore: number;
  applied: boolean;
  dismissed: boolean;
  taskId?: string | null;
  sessionId?: string | null;
  createdAt: string;
}

// ── Rule pill variant ─────────────────────────────────────────────────────────
// default = amber, danger = red, publish = purple

const RULE_VARIANT: Record<string, 'default' | 'danger' | 'publish'> = {
  stall:        'default',
  high_retry:   'danger',
  cost_overrun: 'danger',
  parallel:     'publish',
  token_bloat:  'default',
  context_wide: 'default',
};

const RULE_COLORS: Record<string, string> = {
  stall:        T.amber,
  high_retry:   T.red,
  cost_overrun: T.red,
  parallel:     T.violet,
  token_bloat:  T.amber,
  context_wide: T.amber,
};

const RULE_LABELS: Record<string, string> = {
  stall:        'Stall',
  high_retry:   'High Retry',
  cost_overrun: 'Cost Overrun',
  parallel:     'Parallel',
  token_bloat:  'Token Bloat',
  context_wide: 'Context Wide',
};

const ALL_RULES = ['stall', 'high_retry', 'cost_overrun', 'parallel', 'token_bloat', 'context_wide'];

// ── ROI circle (CSS-based, matching HTML spec) ────────────────────────────────

function RoiCircle({ score, rule }: { score: number; rule: string }) {
  const variant = RULE_VARIANT[rule] ?? 'default';
  let bg: string, border: string, color: string;
  if (variant === 'danger') {
    bg = T.stRedBg;  border = T.stRedBr;  color = T.red;
  } else if (variant === 'publish') {
    bg = T.stPurpleBg; border = T.stPurpleBr; color = T.violet;
  } else {
    bg = T.stAmberBg; border = T.stAmberBr; color = T.amber;
  }
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 50 }}>
      <span style={{
        width:          36,
        height:         36,
        borderRadius:   '50%',
        border:         `1.5px solid ${border}`,
        background:     bg,
        display:        'inline-flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontFamily:     T.fontMono,
        fontSize:       13,
        fontWeight:     500,
        color,
      }}>
        {score.toFixed(0)}
      </span>
      <span style={{
        fontFamily:    T.fontMono,
        fontSize:      9,
        fontWeight:    500,
        color:         T.textMuted,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        ROI
      </span>
    </div>
  );
}

// ── Rule pill ─────────────────────────────────────────────────────────────────

function RulePill({ rule }: { rule: string }) {
  const variant = RULE_VARIANT[rule] ?? 'default';
  let bg: string, border: string, color: string;
  if (variant === 'danger') {
    bg = T.stRedBg;     border = T.stRedBr;     color = T.red;
  } else if (variant === 'publish') {
    bg = T.stPurpleBg;  border = T.stPurpleBr;  color = T.violet;
  } else {
    bg = T.stAmberBg;   border = T.stAmberBr;   color = T.amber;
  }
  return (
    <span style={{
      display:       'inline-flex',
      alignItems:    'center',
      gap:           5,
      fontFamily:    T.fontMono,
      fontSize:      10,
      fontWeight:    500,
      padding:       '4px 9px',
      borderRadius:  6,
      border:        `0.5px solid ${border}`,
      background:    bg,
      color,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      whiteSpace:    'nowrap',
    }}>
      {RULE_LABELS[rule] ?? rule}
    </span>
  );
}

// ── OptimizationPage ──────────────────────────────────────────────────────────

export function OptimizationPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    try {
      const res = await fetch('/api/optimization/findings?dismissed=false');
      const data = (await res.json()) as { findings: Finding[] };
      setFindings(data.findings ?? []);
    } catch { /* noop */ }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const es = new EventSource('/api/notifications/stream');
    es.addEventListener('optimization_findings_updated', () => { void load(); });
    return () => es.close();
  }, []);

  const apply = async (id: string) => {
    setApplying(id);
    await fetch(`/api/optimization/findings/${id}/apply`, { method: 'POST' });
    setFindings((prev) => prev.map((f) => f.id === id ? { ...f, applied: true } : f));
    setApplying(null);
  };

  const dismiss = async (id: string) => {
    setDismissing(id);
    const el = rowRefs.current[id];
    if (el) {
      const h = el.offsetHeight;
      el.style.height = `${h}px`;
      el.style.overflow = 'hidden';
      await new Promise((r) => setTimeout(r, 20));
      el.style.transition = 'opacity 0.2s ease, height 0.2s ease, margin 0.2s ease, padding 0.2s ease';
      el.style.opacity = '0';
      el.style.height = '0';
      el.style.marginBottom = '0';
      await new Promise((r) => setTimeout(r, 230));
    }
    await fetch(`/api/optimization/findings/${id}/dismiss`, { method: 'POST' });
    setFindings((prev) => prev.filter((f) => f.id !== id));
    setDismissing(null);
  };

  const runManual = async () => {
    setRunning(true);
    const res = await fetch('/api/optimization/run', { method: 'POST' });
    if (res.status === 429) {
      showToast('Analysis already ran recently. Try again later.');
    } else {
      const data = (await res.json()) as { newFindings: number };
      showToast(`Found ${data.newFindings} new finding${data.newFindings === 1 ? '' : 's'}`);
      if (data.newFindings > 0) void load();
    }
    setRunning(false);
  };

  const visible = filter ? findings.filter((f) => f.rule === filter) : findings;

  if (loading) {
    return (
      <div style={{ padding: '22px 24px', background: T.bg, minHeight: '100%', fontFamily: T.fontUI }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{
            ...glassCard,
            height:       72,
            marginBottom: 8,
            borderRadius: 10,
          }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{
      background:  T.bg,
      minHeight:   '100%',
      color:       T.textPrimary,
      fontFamily:  T.fontUI,
      position:    'relative',
      display:     'flex',
      flexDirection: 'column',
    }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position:      'fixed',
          top:           24,
          right:         24,
          background:    T.surface2,
          backdropFilter: 'blur(12px)',
          border:        `0.5px solid ${T.glassBorderStrong}`,
          borderRadius:  10,
          padding:       '10px 16px',
          fontSize:      13,
          color:         T.textPrimary,
          zIndex:        9999,
          fontFamily:    T.fontUI,
        }}>
          {toast}
        </div>
      )}

      {/* Page header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '14px 24px',
        borderBottom:   `1px solid ${T.line}`,
        background:     T.bg,
        flexShrink:     0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: T.textPrimary, letterSpacing: '-0.01em' }}>
            Optimization
          </h1>
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
            {findings.length} finding{findings.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily:    T.fontMono,
            fontSize:      11,
            fontWeight:    500,
            color:         T.textMuted,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            SORT · ROI ↓
          </span>
          <button
            onClick={() => { void runManual(); }}
            disabled={running}
            style={{
              background:   T.surface1,
              border:       `0.5px solid ${T.glassBorder}`,
              borderRadius: 6,
              padding:      '7px 12px',
              color:        T.textPrimary,
              fontSize:     12,
              fontWeight:   500,
              fontFamily:   T.fontUI,
              cursor:       running ? 'wait' : 'pointer',
              opacity:      running ? 0.6 : 1,
            }}
          >
            {running ? 'Analysing…' : '↻ Run analysis'}
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          4,
        padding:      '10px 24px',
        borderBottom: `1px solid ${T.line}`,
        background:   T.bg,
        flexShrink:   0,
        flexWrap:     'wrap',
      }}>
        <button
          onClick={() => setFilter(null)}
          style={{
            ...chipBase,
            background: filter === null ? T.surface3 : 'transparent',
            color:      filter === null ? T.textPrimary : T.textMuted,
          }}
        >
          All
        </button>
        {ALL_RULES.map((rule) => (
          <button
            key={rule}
            onClick={() => setFilter(filter === rule ? null : rule)}
            style={{
              ...chipBase,
              background: filter === rule ? T.surface3 : 'transparent',
              color:      filter === rule ? T.textPrimary : T.textMuted,
            }}
          >
            {RULE_LABELS[rule] ?? rule}
          </button>
        ))}
      </div>

      {/* Scrollable findings */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Empty state */}
        {visible.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 80, fontFamily: T.fontUI }}>
            <div style={{ fontSize: 28, color: T.green, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 8, color: T.textPrimary }}>
              No optimizations needed
            </div>
            <div style={{ fontSize: 14, color: T.textMuted }}>
              All sessions within normal parameters.
            </div>
          </div>
        )}

        {/* Finding rows */}
        {visible.map((f) => (
          <div
            key={f.id}
            ref={(el) => { rowRefs.current[f.id] = el; }}
          >
            {/* Main row */}
            <div
              onClick={() => setExpanded(expanded === f.id ? null : f.id)}
              style={{
                display:             'grid',
                gridTemplateColumns: '110px minmax(0,1fr) 120px',
                alignItems:          'center',
                gap:                 18,
                padding:             '16px 24px',
                borderBottom:        `0.5px solid rgba(255,255,255,0.04)`,
                background:          T.bg,
                cursor:              'pointer',
                transition:          'background 120ms ease',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = T.surface1; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = T.bg; }}
            >
              {/* Rule pill */}
              <div>
                <RulePill rule={f.rule} />
              </div>

              {/* Description */}
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{
                  fontSize:   13.5,
                  fontWeight: 500,
                  color:      T.textPrimary,
                  lineHeight: '1.35',
                  display:           '-webkit-box',
                  WebkitLineClamp:   1,
                  WebkitBoxOrient:   'vertical',
                  overflow:          'hidden',
                }}>
                  {f.description}
                </span>
                {(f.taskId ?? f.sessionId) && (
                  <span style={{
                    fontFamily:    T.fontMono,
                    fontSize:      11,
                    fontWeight:    500,
                    color:         T.textMuted,
                    letterSpacing: '0.04em',
                    marginTop:     2,
                  }}>
                    {f.taskId ? `TASK: ` : `SESSION: `}
                    <span style={{ color: T.textSecondary }}>
                      {f.taskId ? f.taskId.slice(0, 8) : f.sessionId?.slice(0, 8)}
                    </span>
                  </span>
                )}
              </div>

              {/* ROI + action */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14 }}>
                <RoiCircle score={f.roiScore} rule={f.rule} />
                {f.applied ? (
                  <span style={{
                    fontFamily:    T.fontMono,
                    fontSize:      11.5,
                    fontWeight:    500,
                    color:         T.green,
                    display:       'inline-flex',
                    alignItems:    'center',
                    gap:           5,
                    letterSpacing: '0.04em',
                    minWidth:      80,
                    textAlign:     'center',
                    justifyContent: 'center',
                  }}>
                    ✓ Applied
                    {f.taskId && (
                      <span style={{ display: 'block', fontSize: 10, color: T.textMuted }}>on task</span>
                    )}
                  </span>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); void apply(f.id); }}
                    disabled={applying === f.id}
                    style={{
                      background:   T.surface2,
                      color:        T.textPrimary,
                      border:       `0.5px solid ${T.glassBorder}`,
                      fontFamily:   T.fontUI,
                      fontSize:     11.5,
                      fontWeight:   500,
                      padding:      '6px 14px',
                      borderRadius: 6,
                      cursor:       applying === f.id ? 'wait' : 'pointer',
                      minWidth:     80,
                      opacity:      applying === f.id ? 0.6 : 1,
                    }}
                  >
                    {applying === f.id ? '…' : 'Apply'}
                  </button>
                )}
              </div>
            </div>

            {/* Expanded detail */}
            {expanded === f.id && (
              <div style={{
                padding:    '14px 24px',
                background: T.surface1,
                borderBottom: `0.5px solid rgba(255,255,255,0.04)`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily:    T.fontMono,
                      fontSize:      11,
                      fontWeight:    500,
                      color:         T.textMuted,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      marginBottom:  8,
                    }}>
                      Suggested Action
                    </div>
                    <div style={{
                      padding:    '10px 12px',
                      background: '#111111',
                      borderRadius: 6,
                      border:     `0.5px solid ${T.line}`,
                      fontFamily: T.fontMono,
                      fontSize:   11.5,
                      lineHeight: '1.55',
                      color:      T.textSecondary,
                      whiteSpace: 'pre-wrap',
                    }}>
                      <span style={{ color: T.amber }}>SUGGESTED ACTION · </span>
                      {f.suggestedAction}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); void dismiss(f.id); }}
                    disabled={dismissing === f.id}
                    title="Dismiss"
                    style={{
                      background: 'none',
                      border:     'none',
                      color:      T.textMuted,
                      cursor:     'pointer',
                      fontSize:   16,
                      padding:    4,
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shared chip style ─────────────────────────────────────────────────────────

const chipBase: React.CSSProperties = {
  fontFamily:   T.fontUI,
  fontSize:     11.5,
  fontWeight:   500,
  color:        T.textMuted,
  padding:      '6px 11px',
  borderRadius: 6,
  background:   'transparent',
  border:       0,
  cursor:       'pointer',
};
