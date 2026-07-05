import type { ReactNode } from 'react';
import { FLOW_TOKENS as T, type NodeKind } from '../tokens';

interface NodeShellProps {
  kind: NodeKind;
  selected: boolean;
  isEntry?: boolean;
  isExit?: boolean;
  children: ReactNode;
}

export function NodeShell({ kind, selected, isEntry, isExit, children }: NodeShellProps) {
  const palette = T[kind];

  return (
    <div style={{
      width:        T.nodeWidth,
      minHeight:    T.nodeMinHeight,
      borderRadius: T.nodeBorderRadius,
      background:   palette.bg,
      border:       `0.5px solid ${selected ? T.nodeSelectedBorder : palette.border}`,
      boxShadow:    selected ? T.nodeSelectedShadow : 'none',
      fontFamily:   T.fontUI,
      position:     'relative',
      overflow:     'hidden',
      transition:   'border-color 120ms ease, box-shadow 120ms ease',
    }}>
      {/* Top accent strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 3, background: palette.accent,
        borderRadius: `${T.nodeBorderRadius}px ${T.nodeBorderRadius}px 0 0`,
      }} />

      {/* Entry badge */}
      {isEntry && (
        <div style={{
          position: 'absolute', top: 8, right: 10,
          fontFamily: T.fontMono, fontSize: 9,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: T.entryColor,
          background: 'rgba(74,222,128,0.10)',
          border: '0.5px solid rgba(74,222,128,0.22)',
          borderRadius: 4, padding: '2px 6px',
          pointerEvents: 'none',
        }}>START</div>
      )}

      {/* Exit badge */}
      {isExit && !isEntry && (
        <div style={{
          position: 'absolute', top: 8, right: 10,
          fontFamily: T.fontMono, fontSize: 9,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          color: T.exitColor,
          background: 'rgba(82,82,91,0.15)',
          border: '0.5px solid rgba(82,82,91,0.30)',
          borderRadius: 4, padding: '2px 6px',
          pointerEvents: 'none',
        }}>END</div>
      )}

      {/* Content */}
      <div style={{ padding: T.nodePadding, paddingTop: 18 }}>
        {children}
      </div>
    </div>
  );
}

export function TypeBadge({ label, icon, colour }: { label: string; icon: string; colour: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      marginBottom: 8,
      fontFamily: T.fontMono,
      fontSize: 10, fontWeight: 500,
      textTransform: 'uppercase', letterSpacing: '0.04em',
      color: colour,
    }}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}
