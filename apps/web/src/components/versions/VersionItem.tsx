import { type JSX } from 'react';
import type { VersionRow } from './types';

interface Props {
  version: VersionRow;
  onClick: () => void;
  selected: boolean;
}

/**
 * One row in the versions sidebar list. Shows the manual comment (or a
 * fallback "Version N" label for auto-snapshots that didn't carry one),
 * then author + timestamp on the second line.
 *
 * Border-left accents the row on hover and stays purple when the row is
 * the one currently open in the diff view.
 */
export function VersionItem({ version, onClick, selected }: Props): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-4 py-2.5 transition-colors"
      style={{
        borderLeft: selected ? '2px solid var(--border-strong)' : '2px solid transparent',
        background: selected ? 'var(--surface-overlay)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = 'var(--interactive-ghost-hover)';
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
        {version.comment ?? `Version ${version.version}`}
      </div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
        {version.author_id ? (
          <span className="font-mono">{version.author_id.slice(0, 6)}</span>
        ) : (
          <span>system</span>
        )}
        <span> · </span>
        <span>{new Date(version.created_at).toLocaleString()}</span>
      </div>
    </button>
  );
}
