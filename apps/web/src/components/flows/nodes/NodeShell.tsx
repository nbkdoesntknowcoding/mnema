import { useEffect, useRef, type ReactNode } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { FLOW_TOKENS as T, accentSoft, cardShadow, handleStyle } from '../tokens';

const BrainGlyph = ({ colour }: { colour: string }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colour} strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M12 5a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0 1 5 3 3 0 0 0 5 1 3 3 0 0 0 5-1 3 3 0 0 0 1-5 3 3 0 0 0-3-3 3 3 0 0 0-3-3Z"/>
    <path d="M12 5v14M9 8h6M7 11h10M8 16h8"/>
  </svg>
);

const ChatGlyph = ({ colour }: { colour: string }) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={colour} strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
);

// Vertical anchor for the in/out ports — aligned with the title row so every
// node exposes its handles at the same height regardless of card height.
const HANDLE_TOP = 30;

export interface NodeShellProps {
  /** the client node id — used to re-sync handle positions on resize. */
  id: string;
  /** design node-type accent (already resolved for directive/step). */
  accent: string;
  /** mono eyebrow text, e.g. DIRECTIVE / STEP / CAPTURE / DOC / IF / ELSE. */
  eyebrow: string;
  title: string;
  body?: ReactNode;
  selected: boolean;
  /** brighten bloom + border (walk focus / remote selection). */
  lit?: boolean;
  width?: number;
  isCapture?: boolean;      // brain glyph in the eyebrow (writes-to-brain)
  isStart?: boolean;        // START pill (directive / entry)
  commentCount?: number;
  onComment?: () => void;
  /** footer row — Preview doc / Preview capture buttons. */
  footer?: ReactNode;
  connectable?: boolean;
  /** notched silhouette + caller-owned handles (decision / fork). */
  notched?: boolean;
  /** when set, NodeShell renders no default handles — the node owns them. */
  customHandles?: ReactNode;
}

export function NodeShell({
  id, accent, eyebrow, title, body, selected, lit,
  width = T.nodeWidth, isCapture, isStart, commentCount, onComment,
  footer, connectable = true, notched, customHandles,
}: NodeShellProps) {
  const forkClip = notched
    ? 'polygon(0 18%,7% 0,93% 0,100% 18%,100% 82%,93% 100%,7% 100%,0 82%)'
    : undefined;
  const borderCol = selected || lit ? T.nodeSelectedBorder : T.nodeRestBorder;

  // Handles sit at the vertical centre of a variable-height card. Whenever the
  // card resizes (multi-line titles, fonts settling, content edits) the handle
  // moves — so tell xyflow to re-measure, or edges route to a stale position
  // and visibly detach from the node.
  const rootRef = useRef<HTMLDivElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateNodeInternals(id));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, updateNodeInternals]);

  return (
    <div ref={rootRef} style={{ position: 'relative', width }}>
      {/* accent bloom behind the card — kept tight (inset + small blur) so it
          doesn't spill over the connecting edges near the handles. */}
      <div aria-hidden style={{
        position: 'absolute', inset: 12, borderRadius: 14,
        background: accent, filter: 'blur(16px)',
        opacity: selected || lit ? 0.16 : 0.08,
        zIndex: 0, pointerEvents: 'none',
        transition: 'opacity .2s ease',
      }} />

      {/* card */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: 'var(--surface)',
        border: `1px solid ${notched ? accent + '88' : borderCol}`,
        borderRadius: notched ? 6 : T.nodeBorderRadius,
        boxShadow: cardShadow(accent, selected || lit),
        clipPath: forkClip,
        transition: 'border-color .2s ease, box-shadow .2s ease',
      }}>
        {/* eyebrow row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 14px 0' }}>
          {isCapture && <BrainGlyph colour={accent} />}
          <span style={{
            fontFamily: T.fontMono, fontSize: 9.5, fontWeight: 500,
            letterSpacing: '0.14em', textTransform: 'uppercase', color: accent,
          }}>{eyebrow}</span>

          {isStart && (
            <span style={{
              fontFamily: T.fontMono, fontSize: 8.5, fontWeight: 600, letterSpacing: '0.1em',
              color: 'var(--on-ink)', background: accent, borderRadius: 4, padding: '2px 5px',
            }}>START</span>
          )}

          {commentCount ? (
            <button
              className="nodrag nopan"
              title={`${commentCount} comment${commentCount === 1 ? '' : 's'}`}
              onClick={(e) => { e.stopPropagation(); onComment?.(); }}
              style={{
                marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: T.fontMono, fontSize: 10, color: 'var(--ink-soft)',
                background: 'var(--surface-2)', border: '1px solid var(--line)',
                borderRadius: 999, padding: '2px 7px', cursor: 'pointer', lineHeight: 1,
              }}
            >
              <ChatGlyph colour="var(--ink-soft)" /> {commentCount}
            </button>
          ) : null}
        </div>

        {/* title */}
        <p style={{
          fontFamily: T.fontUI, fontSize: 14, fontWeight: 500, lineHeight: 1.3,
          color: 'var(--ink)', margin: '7px 14px 0',
        }}>{title}</p>

        {/* body with bottom fade */}
        {body != null && (
          <div style={{ position: 'relative', margin: '5px 14px 0', maxHeight: 60, overflow: 'hidden' }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>{body}</div>
            <div aria-hidden style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, height: 22,
              background: 'linear-gradient(transparent, var(--surface))', pointerEvents: 'none',
            }} />
          </div>
        )}

        {/* footer (preview buttons) */}
        {footer ? <div style={{ padding: '10px 14px 12px' }}>{footer}</div> : <div style={{ height: 12 }} />}
      </div>

      {/* default handles — left-in / right-out, coloured to the node accent.
          Anchored at a fixed offset from the TOP (the title row) rather than the
          card's centre, so connectors between top-aligned nodes of different
          heights stay dead-horizontal instead of slanting. */}
      {customHandles ?? (
        <>
          <Handle type="target" position={Position.Left}  isConnectable={connectable}
            style={handleStyle(accent, { top: HANDLE_TOP })} />
          <Handle type="source" position={Position.Right} isConnectable={connectable}
            style={handleStyle(accent, { top: HANDLE_TOP })} />
        </>
      )}
    </div>
  );
}

/** Small accent-tinted button used for "Preview doc" / "Preview capture" / "Open fully". */
export function PreviewButton({ accent, label, onClick, filled }: {
  accent: string; label: string; onClick: () => void; filled?: boolean;
}) {
  return (
    <button
      className="nodrag nopan"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500,
        color: filled ? 'var(--on-ink)' : accent,
        background: filled ? accent : accentSoft(accent),
        border: `1px solid ${filled ? accent : accent + '55'}`,
        borderRadius: 7, padding: '5px 10px', cursor: 'pointer', lineHeight: 1,
      }}
    >{label}</button>
  );
}
