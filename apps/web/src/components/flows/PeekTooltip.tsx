import { NodeToolbar, Position, type Node } from '@xyflow/react';
import { FLOW_TOKENS as T, accentFor, type NodeKind } from './tokens';

/**
 * Hover "peek" tooltip for doc/capture nodes — the first of the three doc
 * preview levels. Anchored to the node's right edge via xyflow's NodeToolbar
 * (which handles the world→screen transform), so it tracks pan/zoom.
 */
export function PeekTooltip({ node }: { node: Node }) {
  const kind = node.data.kind as NodeKind;
  const accent = accentFor(kind, !!node.data.isEntry);
  const eyebrow = kind === 'capture' ? 'CAPTURE' : 'DOC';
  const title = (node.data.doc_title as string) ?? (node.data.title as string) ?? '';
  const body = (node.data.instruction as string)
    ?? (node.data.title_hint as string)
    ?? (node.data.text as string)
    ?? '';

  return (
    <NodeToolbar nodeId={node.id} isVisible position={Position.Right} offset={18} className="nodrag nopan">
      <div style={{
        width: 260, background: 'var(--surface-2)', border: '1px solid var(--line-strong)',
        borderRadius: 11, padding: '12px 14px', pointerEvents: 'none',
        boxShadow: '0 18px 44px rgba(0,0,0,.55)', textAlign: 'left',
      }}>
        <div style={{
          fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: accent, marginBottom: 6,
        }}>PEEK · {eyebrow}</div>
        <div style={{ fontFamily: T.fontUI, fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>{title}</div>
        {body && (
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginTop: 6,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {body}
          </div>
        )}
      </div>
    </NodeToolbar>
  );
}
