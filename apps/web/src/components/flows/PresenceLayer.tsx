import { ViewportPortal, type Node } from '@xyflow/react';
import { FLOW_TOKENS as T } from './tokens';
import type { PresencePeer } from './useFlowPresence';

function initials(name: string): string {
  const at = name.indexOf('@');
  const base = at > 0 ? name.slice(0, at) : name;
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? base[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Screen-space presence cluster (top-left) — who else is in this flow. */
export function PresenceCluster({ peers }: { peers: PresencePeer[] }) {
  if (peers.length === 0) return null;
  const shown = peers.slice(0, 5);
  return (
    <div style={{
      position: 'absolute', top: 16, left: 16, zIndex: 25,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 999,
      padding: '5px 10px 5px 6px', boxShadow: '0 8px 24px rgba(0,0,0,.4)',
    }}>
      <div style={{ display: 'flex' }}>
        {shown.map((p, i) => (
          <span key={p.id} title={p.name} style={{
            width: 24, height: 24, borderRadius: '50%', background: p.color,
            color: 'var(--on-ink)', fontFamily: T.fontUI, fontSize: 10, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--surface-2)', marginLeft: i === 0 ? 0 : -8,
          }}>{initials(p.name)}</span>
        ))}
      </div>
      <span style={{ fontFamily: T.fontMono, fontSize: 10, color: 'var(--ink-muted)' }}>
        {peers.length} editing
      </span>
    </div>
  );
}

/** World-space live cursors + remote selection rings (ride the pan/zoom). */
export function PresenceWorld({ peers, nodes }: { peers: PresencePeer[]; nodes: Node[] }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <ViewportPortal>
      {/* remote selection rings */}
      {peers.map((p) => {
        if (!p.nodeId) return null;
        const n = byId.get(p.nodeId);
        if (!n) return null;
        const w = n.measured?.width ?? 248, h = n.measured?.height ?? 120;
        return (
          <div key={`sel-${p.id}`} style={{
            position: 'absolute', left: 0, top: 0,
            transform: `translate(${n.position.x - 4}px, ${n.position.y - 4}px)`,
            width: w + 8, height: h + 8, borderRadius: 16,
            border: `1.5px solid ${p.color}`, boxShadow: `0 0 14px ${p.color}55`,
            pointerEvents: 'none', zIndex: 5,
          }}>
            <span style={{
              position: 'absolute', top: -18, right: 0,
              fontFamily: T.fontMono, fontSize: 9.5, color: 'var(--on-ink)',
              background: p.color, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
            }}>{p.name.split('@')[0]}</span>
          </div>
        );
      })}

      {/* cursors */}
      {peers.map((p) => {
        if (p.x == null || p.y == null) return null;
        return (
          <div key={`cur-${p.id}`} style={{
            position: 'absolute', left: 0, top: 0,
            transform: `translate(${p.x}px, ${p.y}px)`,
            pointerEvents: 'none', zIndex: 40,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill={p.color} stroke="var(--canvas)" strokeWidth="1.5" style={{ display: 'block' }}>
              <path d="M5 3l6 15 2.5-6.5L20 9 5 3z" />
            </svg>
            <span style={{
              position: 'absolute', left: 16, top: 12,
              fontFamily: T.fontMono, fontSize: 9.5, color: 'var(--on-ink)',
              background: p.color, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
            }}>{p.name.split('@')[0]}</span>
          </div>
        );
      })}
    </ViewportPortal>
  );
}
