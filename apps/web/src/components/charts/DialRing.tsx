import type { JSX } from 'react';

interface Props {
  /** Percentage 0-100. */
  value: number;
  /** Diameter in px. */
  size?: number;
  /** Stroke thickness. */
  stroke?: number;
}

/**
 * Circular progress arc — pure SVG, no Recharts dependency.
 *
 * Used inside StatTile or standalone as a "Step 01" onboarding indicator.
 * Reference: the large circular dial in the "DeFi Wallet" panel of the
 * 4.5.1 design reference.
 *
 * Phase 4.5.1.
 */
export function DialRing({ value, size = 80, stroke = 1.5 }: Props): JSX.Element {
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, value));
  const offset = c * (1 - clamped / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block"
      aria-hidden="true"
    >
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="var(--border-subtle)"
        strokeWidth={stroke}
        fill="none"
      />
      {/* Progress arc — starts at 12 o'clock, sweeps clockwise */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="var(--text-primary)"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
