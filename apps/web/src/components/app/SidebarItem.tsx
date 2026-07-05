import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  label: string;
  href: string;
  /** Indent the row by one icon-width — for filter chips under a parent item. */
  indent?: boolean;
  /** Highlights the row with the active surface treatment. */
  active?: boolean;
}

/**
 * One row in the new in-app sidebar.
 *
 * Visual contract:
 *  - 28px row, 13px label, 14px icon
 *  - Inactive: `--text-secondary`, icon at `--text-tertiary`, transparent bg
 *  - Hover: `--interactive-ghost-hover` bg, label promoted to `--text-primary`
 *  - Active: `--surface-overlay` bg, label at `--text-primary`
 *
 * Phase 5. The wrapper is intentionally a plain anchor — the sidebar is rendered
 * at SSR time on every app shell page so active state is determined server-side
 * from the URL, not from any client-side router.
 */
export function SidebarItem({ icon, label, href, indent, active }: Props) {
  const base =
    'flex items-center gap-2.5 h-7 rounded-[var(--radius-sm)] text-[13px] transition-colors ';
  const padding = indent ? 'pl-7 pr-2.5 ' : 'px-2.5 ';
  const state = active
    ? 'bg-[var(--surface-overlay)] text-[var(--text-primary)]'
    : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-ghost-hover)] hover:text-[var(--text-primary)]';
  return (
    <a href={href} className={base + padding + state}>
      <span
        className="shrink-0"
        style={{ color: active ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
      >
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </a>
  );
}
