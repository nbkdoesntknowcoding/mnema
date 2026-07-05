import type { PrepProgress } from './prep-storage';
import type { Status } from '../../lib/prep-types';

export const COMPANY_COLORS: Record<string, string> = {
  Deloitte: '#86BC25',
  KPMG: '#00A3A1',
  'Oracle NetSuite': '#F80000',
  Sapiens: '#6E5BE6',
  Capgemini: '#0070AD',
  Cognizant: '#1B6CF2',
};

export function companyColor(c: string) {
  return COMPANY_COLORS[c] ?? 'var(--accent)';
}

export function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500,
        fontFamily: 'var(--mono)', letterSpacing: '0.01em',
        background: 'rgba(255,255,255,0.05)',
        border: '0.5px solid rgba(255,255,255,0.12)',
        color: 'var(--ink-soft)', whiteSpace: 'nowrap',
      }}
    >
      {color && <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />}
      {children}
    </span>
  );
}

export function SourceChip({ source }: { source: string | null }) {
  if (!source) return null;
  return (
    <p style={{
      margin: '10px 0 0', fontSize: 11, lineHeight: 1.5, color: 'var(--ink-muted)',
      fontFamily: 'var(--mono)', display: 'flex', gap: 6,
    }}>
      <span style={{ flexShrink: 0, opacity: 0.7 }}>◇ source</span>
      <span>{source}</span>
    </p>
  );
}

export function BookmarkButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={active ? 'Remove bookmark' : 'Bookmark'}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: active ? 'var(--accent)' : 'var(--ink-muted)',
        padding: 2, display: 'inline-flex', lineHeight: 0,
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}

export function StatusPills({ id, progress }: { id: string; progress: PrepProgress }) {
  const cur = progress.statusOf(id);
  const pill = (s: Status, label: string, color: string) => {
    const on = cur === s;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); progress.setStatus(id, on ? 'new' : s); }}
        style={{
          padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
          fontFamily: 'var(--sans)',
          background: on ? color + '22' : 'transparent',
          border: `0.5px solid ${on ? color + '66' : 'rgba(255,255,255,0.12)'}`,
          color: on ? color : 'var(--ink-muted)',
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: 'inline-flex', gap: 6 }}>
      {pill('mastered', '✓ Mastered', '#4ade80')}
      {pill('review', '↻ Review', '#fbbf24')}
    </div>
  );
}
