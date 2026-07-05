import type { CSSProperties } from 'react';

interface Props {
  /** Label text. Rendered mono uppercase by component. */
  label: string;
  /** Optional secondary tag — smaller and dimmer. Use for cryptic telemetry hints. */
  hint?: string;
  /** Absolute position inside a relative parent. */
  position: {
    top?: number | string;
    right?: number | string;
    bottom?: number | string;
    left?: number | string;
  };
  /** Shape of the marker icon. */
  marker?: 'triangle' | 'circle' | 'plus' | 'square';
  /** Which side the connecting wire appears on. */
  side?: 'left' | 'right';
}

function Marker({ shape }: { shape: NonNullable<Props['marker']> }) {
  const size = 6;
  const color = 'var(--text-tertiary)';
  switch (shape) {
    case 'triangle':
      return (
        <svg
          width={size + 2}
          height={size + 2}
          viewBox="0 0 8 8"
          fill="none"
          stroke={color}
          strokeWidth={1}
        >
          <polygon points="4,1 7,7 1,7" />
        </svg>
      );
    case 'plus':
      return (
        <svg
          width={size + 2}
          height={size + 2}
          viewBox="0 0 8 8"
          stroke={color}
          strokeWidth={1}
        >
          <line x1="4" y1="1" x2="4" y2="7" />
          <line x1="1" y1="4" x2="7" y2="4" />
        </svg>
      );
    case 'square':
      return (
        <div
          style={{
            width: size,
            height: size,
            border: `1px solid ${color}`,
            flexShrink: 0,
          }}
        />
      );
    case 'circle':
    default:
      return (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            border: `1px solid ${color}`,
            flexShrink: 0,
          }}
        />
      );
  }
}

/**
 * Tiny labeled node marker placed in absolute coordinates around a hero section.
 * Reads as a node in a constellation / system map — product surface callouts
 * that are visible only when the eye looks for them.
 *
 * Placement rules:
 *  - Never closer than 80px to hero text
 *  - Never directly above/below CTA buttons
 *  - At least 3 marks per page, at most 6
 *  - Use `hint` sparingly (1–2 per page) for the cryptic telemetry feel
 *
 * Reference: "Cortex", "Mostlbn", "Quark", "Asif" labels in the 4.5.1 reference.
 *
 * Phase 4.5.1.
 */
export function ConstellationMark({
  label,
  hint,
  position,
  marker = 'circle',
  side = 'left',
}: Props) {
  const style: CSSProperties = {
    position: 'absolute',
    zIndex: 2,
    ...position,
  };

  const wireWidth = 28;

  return (
    <div
      style={style}
      className="flex items-center gap-1.5 pointer-events-none select-none"
    >
      {side === 'left' && (
        <div
          style={{
            width: wireWidth,
            height: 1,
            background: 'var(--border-subtle)',
            flexShrink: 0,
          }}
        />
      )}
      <Marker shape={marker} />
      <div className="flex flex-col">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)] leading-none">
          {label}
        </span>
        {hint && (
          <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--text-quaternary)] mt-0.5 leading-none">
            {hint}
          </span>
        )}
      </div>
      {side === 'right' && (
        <div
          style={{
            width: wireWidth,
            height: 1,
            background: 'var(--border-subtle)',
            flexShrink: 0,
          }}
        />
      )}
    </div>
  );
}
