import type { ReactNode } from 'react';

type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'sync' | 'edit';

const tones: Record<Tone, { bg: string; text: string; border: string }> = {
  success: {
    bg:     'bg-[var(--status-success-bg)]',
    text:   'text-[var(--status-success)]',
    border: 'border-[color:var(--status-success)]/30',
  },
  sync: {
    bg:     'bg-[var(--status-success-bg)]',
    text:   'text-[var(--status-sync)]',
    border: 'border-[color:var(--status-sync)]/30',
  },
  warning: {
    bg:     'bg-[var(--status-warning-bg)]',
    text:   'text-[var(--status-warning)]',
    border: 'border-[color:var(--status-warning)]/30',
  },
  edit: {
    bg:     'bg-[var(--accent-soft)]',
    text:   'text-[var(--accent)]',
    border: 'border-[var(--accent-line)]',
  },
  error: {
    bg:     'bg-[var(--status-error-bg)]',
    text:   'text-[var(--status-error)]',
    border: 'border-[color:var(--status-error)]/30',
  },
  info: {
    bg:     'bg-[var(--status-info-bg)]',
    text:   'text-[var(--status-info-color)]',
    border: 'border-[color:var(--status-info-color)]/30',
  },
  neutral: {
    bg:     'bg-[var(--surface-2)]',
    text:   'text-[var(--ink-muted)]',
    border: 'border-[var(--line-strong)]',
  },
};

interface Props {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
}

export function StatusPill({ tone = 'neutral', children, dot = true }: Props) {
  const { bg, text, border } = tones[tone];
  return (
    <span
      className={
        `inline-flex items-center gap-1.5 px-[9px] h-[20px] ` +
        `text-[11px] font-[500] font-mono tracking-[0.04em] uppercase ` +
        `rounded-[var(--r-pill)] border ` +
        `${bg} ${text} ${border}`
      }
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />}
      {children}
    </span>
  );
}
