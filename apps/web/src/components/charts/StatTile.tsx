import type { JSX, ReactNode } from 'react';
import { MonoLabel } from '../ui/typography';

interface Props {
  /** Large numeric value — pre-formatted (e.g. "98.2%", "~50ms", "Live"). */
  value: string;
  /** Small uppercase mono label below the value. */
  label: string;
  /** Optional supplementary tag (delta, units, secondary stat). */
  hint?: string;
  /** Optional decoration component to the right (DialRing, mini chart, etc.) */
  decoration?: ReactNode;
  /** Surface treatment. 'card' = --surface-overlay with border. */
  surface?: 'card' | 'flat';
}

/**
 * Large stat tile — Geist Sans Medium numeral + MonoLabel below.
 *
 * Reference: "98.2%", "Step 01", "~50ms" large stats.
 * Use for honest product properties, never vanity social-proof numbers.
 *
 * Phase 4.5.1 (display face simplified in 4.5.2 to Geist Sans).
 */
export function StatTile({
  value,
  label,
  hint,
  decoration,
  surface = 'card',
}: Props): JSX.Element {
  const surfaceStyle =
    surface === 'card'
      ? {
          background: 'var(--surface-overlay)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
        }
      : {};

  return (
    <div
      className="flex items-center justify-between gap-4"
      style={surfaceStyle}
    >
      <div className="flex flex-col">
        <div className="flex items-baseline gap-2">
          <span
            className="font-sans font-medium"
            style={{
              fontSize: 'var(--display-sm)',
              lineHeight: 1,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
            }}
          >
            {value}
          </span>
          {hint && (
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
              {hint}
            </span>
          )}
        </div>
        <MonoLabel className="mt-3">{label}</MonoLabel>
      </div>
      {decoration && <div className="shrink-0">{decoration}</div>}
    </div>
  );
}
