/**
 * Subtle SVG fractal-noise overlay — prevents gradient banding in radial glows
 * on OLED and high-quality displays.
 *
 * Sits above the RadialGlow (z-index 1), below content (z-index 2).
 * Use sparingly — only on hero sections that already have a RadialGlow.
 *
 * Phase 4.5.1.
 */
export function NoiseOverlay({ opacity = 0.04 }: { opacity?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 w-full h-full"
      style={{
        opacity,
        mixBlendMode: 'overlay',
        zIndex: 1,
      }}
    >
      <filter id="mnema-noise">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves="3"
          stitchTiles="stitch"
        />
        <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.4 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#mnema-noise)" />
    </svg>
  );
}
