import { useEffect, useState, useCallback } from 'react';
import { FLOW_TOKENS as T, accentFor, type NodeKind } from './tokens';

interface PreviewStep {
  step_index: number;
  node_id: string;
  title: string;
  kind: string;
  instruction: string;
  content: string;
  content_type: string;
  source: { doc_id: string; doc_title: string } | null;
}
interface PreviewResponse {
  flow_name: string;
  total_steps: number;
  steps: PreviewStep[];
}

interface Props {
  flowSlug: string;
  version: 'draft' | 'published';
  /** focus a node — FlowCanvas pans the camera + dims the others. */
  onFocus: (nodeId: string | null) => void;
  onExit: () => void;
}

/**
 * In-canvas guided walk. Instead of a modal, it drives the canvas: the current
 * step's node stays lit (FlowCanvas dims the rest) and the camera pans to it,
 * while a top-center nav pill + a bottom-center reading card overlay the canvas.
 * Steps + content come from the real /preview walk (linear — the flow engine
 * doesn't branch yet, so there's no fake branch-picking here).
 */
export function WalkOverlay({ flowSlug, version, onFocus, onExit }: Props) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    fetch(`/api/flows/${flowSlug}/preview?version=${version}`, { credentials: 'include' })
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json() as Promise<PreviewResponse>; })
      .then(setPreview)
      .catch((e: unknown) => setError(String((e as Error).message ?? e)));
  }, [flowSlug, version]);

  const total = preview?.steps.length ?? 0;
  const cur = preview?.steps[step];

  // Focus the current step's node whenever it changes.
  useEffect(() => { onFocus(cur?.node_id ?? null); }, [cur?.node_id, onFocus]);
  // Clear focus on unmount.
  useEffect(() => () => onFocus(null), [onFocus]);

  const next = useCallback(() => setStep((s) => Math.min(s + 1, total - 1)), [total]);
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onExit(); }
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onExit]);

  const accent = cur ? accentFor(cur.kind as NodeKind, false) : T.directive.accent;

  return (
    <>
      {/* subtle scrim so overlays read against the canvas (nodes stay above via dimming) */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(5,6,7,.35)', pointerEvents: 'none', zIndex: 30 }} />

      {/* top-center nav pill */}
      <div style={{
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 38,
        display: 'inline-flex', alignItems: 'center', gap: 10,
        background: 'var(--surface-2)', border: '1px solid var(--line-strong)', borderRadius: 999,
        padding: '7px 12px', boxShadow: '0 12px 40px rgba(0,0,0,.5)',
      }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: '.14em', color: 'var(--ink-muted)' }}>WALK</span>
        <NavBtn label="Previous" disabled={step === 0} onClick={prev}>‹</NavBtn>
        <span style={{ fontFamily: T.fontMono, fontSize: 11, color: 'var(--ink)', minWidth: 44, textAlign: 'center' }}>
          {total ? `${step + 1} / ${total}` : '—'}
        </span>
        <NavBtn label="Next" disabled={step >= total - 1} highlight onClick={next}>›</NavBtn>
        <span style={{ width: 1, height: 16, background: 'var(--line-strong)' }} />
        <button onClick={onExit} style={{
          fontFamily: T.fontUI, fontSize: 12, color: 'var(--ink-soft)', background: 'transparent',
          border: 'none', cursor: 'pointer', padding: '0 2px',
        }}>Exit walk</button>
      </div>

      {/* bottom-center reading card */}
      <div style={{
        position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 38,
        width: 560, maxWidth: 'calc(100% - 48px)',
        background: 'var(--surface)', border: `1px solid ${accent}55`, borderRadius: 14,
        boxShadow: `0 24px 70px rgba(0,0,0,.6), 0 0 40px ${accent}22`, padding: '16px 20px',
        maxHeight: '42%', overflowY: 'auto',
      }}>
        {error ? (
          <p style={{ fontSize: 13, color: 'var(--status-warn)' }}>Couldn't load the walk: {error.slice(0, 80)}</p>
        ) : !cur ? (
          <p style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Loading walk…</p>
        ) : (
          <>
            <div style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: '.14em', textTransform: 'uppercase', color: accent, marginBottom: 6 }}>
              Step {String(cur.step_index).padStart(2, '0')} · {cur.kind}
            </div>
            <div style={{ fontFamily: T.fontUI, fontSize: 15, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3, marginBottom: 8 }}>
              {cur.title}
            </div>
            {cur.instruction && (
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink)', margin: '0 0 8px', fontStyle: 'italic' }}>{cur.instruction}</p>
            )}
            {cur.content && (
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-soft)', margin: 0, whiteSpace: 'pre-wrap' }}>
                {cur.content.length > 500 ? cur.content.slice(0, 500) + '…' : cur.content}
              </p>
            )}
            {cur.source && (
              <p style={{ fontFamily: T.fontMono, fontSize: 11, color: 'var(--ink-faint)', marginTop: 8 }}>
                source: <span style={{ color: 'var(--ink-muted)' }}>{cur.source.doc_title}</span>
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

function NavBtn({ children, label, disabled, highlight, onClick }: {
  children: React.ReactNode; label: string; disabled?: boolean; highlight?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, lineHeight: 1, borderRadius: 6,
        color: highlight ? 'var(--ink)' : 'var(--ink-soft)',
        background: highlight ? 'var(--surface-3)' : 'transparent',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1,
      }}
    >{children}</button>
  );
}
