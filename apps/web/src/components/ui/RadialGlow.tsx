import type { CSSProperties } from 'react';

interface Props {
  /** Center horizontal position as percent (0-100). Default 50. */
  cx?: number;
  /** Center vertical position as percent (0-100). Default 40. */
  cy?: number;
  /** Falloff radius — bigger = softer, more spread. Typically 40-80. */
  radius?: number;
  /** Color token. Default 'warm'. */
  tone?: 'warm' | 'neutral' | 'soft';
  /** Intensity multiplier. 1 = default, 1.5 = stronger, 0.5 = subtler. */
  intensity?: number;
  className?: string;
}

/**
 * Ambient radial light source — positioned absolutely inside a relative parent.
 *
 * Place inside a `position: relative` hero section. The glow sits at z-index 0
 * (absolute, pointer-events: none), content at z-index 1 (relative).
 *
 * Pure CSS — no images, no canvas. Zero runtime cost, zero JS.
 *
 * Reference: the soft circular bloom behind "One-click for Asset Defense" in
 * the 4.5.1 design reference.
 *
 * Phase 4.5.1.
 */
export function RadialGlow({
  cx = 50,
  cy = 40,
  radius = 60,
  tone = 'warm',
  intensity = 1,
  className = '',
}: Props) {
  const color = `var(--glow-color-${tone})`;
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
    backgroundImage: `radial-gradient(circle at ${cx}% ${cy}%, ${color}, transparent ${radius}%)`,
    opacity: intensity,
  };
  return <div aria-hidden="true" style={style} className={className} />;
}
