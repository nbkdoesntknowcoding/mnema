/**
 * Community flows browse grid (Community Flows — Phase 3, P3-1).
 * Fetches the hub catalog via the instance proxy (/api/community/flows), with
 * search, tag filter, and popular/new sort. Disabled instances get a notice.
 */
import { type JSX, useEffect, useState, useCallback } from 'react';

const ink = 'var(--ink, #e7e7e9)';
const soft = 'var(--ink-soft, #a1a1aa)';
const muted = 'var(--ink-muted, #71717a)';
const line = 'var(--line, rgba(255,255,255,0.1))';
const surface = 'var(--surface, rgba(255,255,255,0.02))';

interface HubListItem {
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  nodeCount: number;
  importCount: number;
  publisherHandle: string | null;
  createdAt: string;
}

export function CommunityBrowse(): JSX.Element {
  const [items, setItems] = useState<HubListItem[]>([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'popular' | 'new'>('popular');
  const [tag, setTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set('q', q.trim());
      if (tag) qs.set('tag', tag);
      qs.set('sort', sort);
      const res = await fetch(`/api/community/flows?${qs.toString()}`, { credentials: 'include' });
      if (res.status === 404) {
        setDisabled(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { flows: HubListItem[] };
      setItems(body.flows);
    } catch {
      setError('Could not load community flows.');
    } finally {
      setLoading(false);
    }
  }, [q, tag, sort]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  if (disabled) {
    return (
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 32px', color: soft, fontSize: 14 }}>
        The community hub is disabled on this instance.
      </div>
    );
  }

  const allTags = Array.from(new Set(items.flatMap((i) => i.tags))).slice(0, 16);

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '48px 32px 80px' }}>
      <div style={{ font: '500 11px/1 var(--mono)', letterSpacing: '0.08em', textTransform: 'uppercase', color: muted, marginBottom: 14 }}>
        Community
      </div>
      <h1 style={{ margin: 0, font: '500 28px/1.2 var(--sans)', letterSpacing: '-0.02em', color: ink }}>
        Flows from the community
      </h1>
      <p style={{ margin: '12px 0 28px', fontSize: 15, lineHeight: 1.6, color: soft, maxWidth: '36rem' }}>
        Browse flows others have published, and use them in your workspace in one click. Doc and folder
        references are stripped on publish — you re-bind them to your own after importing.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search flows…"
          style={{
            flex: 1, minWidth: 200, padding: '9px 12px', borderRadius: 8, background: surface,
            border: `1px solid ${line}`, color: ink, fontSize: 14, outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 4, background: surface, border: `1px solid ${line}`, borderRadius: 8, padding: 3 }}>
          {(['popular', 'new'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              style={{
                padding: '6px 12px', borderRadius: 6, border: 0, cursor: 'pointer', fontSize: 12.5,
                background: sort === s ? 'var(--surface-2, rgba(255,255,255,0.06))' : 'transparent',
                color: sort === s ? ink : muted, textTransform: 'capitalize',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 24 }}>
          <Chip active={tag === null} onClick={() => setTag(null)}>All</Chip>
          {allTags.map((t) => (
            <Chip key={t} active={tag === t} onClick={() => setTag(t)}>{t}</Chip>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ color: muted, fontSize: 14, padding: '24px 0' }}>Loading…</div>
      ) : error ? (
        <div style={{ color: 'var(--status-warn, #ff7a8a)', fontSize: 13 }}>{error}</div>
      ) : items.length === 0 ? (
        <div style={{ padding: '40px 24px', textAlign: 'center', border: `1px solid ${line}`, borderRadius: 10, background: surface }}>
          <h3 style={{ margin: '0 0 8px', font: '500 16px/1.3 var(--sans)', color: ink }}>No community flows yet</h3>
          <p style={{ margin: 0, fontSize: 13, color: soft }}>Be the first — publish one of your flows from its editor.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => (
            <a
              key={it.slug}
              href={`/app/community/${it.slug}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderRadius: 8,
                background: surface, border: `1px solid ${line}`, textDecoration: 'none', color: 'inherit',
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ font: '500 14px/1.3 var(--sans)', color: ink }}>{it.name}</span>
                {it.description && (
                  <span style={{ font: '400 13px/1.4 var(--sans)', color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.description}
                  </span>
                )}
                {it.tags.length > 0 && (
                  <span style={{ display: 'flex', gap: 5, marginTop: 2 }}>
                    {it.tags.slice(0, 4).map((t) => (
                      <span key={t} style={{ fontSize: 10.5, color: muted, background: 'var(--surface-2, rgba(255,255,255,0.05))', padding: '2px 6px', borderRadius: 4 }}>{t}</span>
                    ))}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, font: '500 11px/1 var(--mono)', color: muted }}>
                <span>{it.nodeCount} steps</span>
                <span>↓ {it.importCount}</span>
                {it.publisherHandle && <span style={{ color: soft }}>@{it.publisherHandle}</span>}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12,
        border: `1px solid ${active ? 'transparent' : line}`,
        background: active ? ink : 'transparent',
        color: active ? 'var(--on-ink, #0b0b0d)' : soft,
      }}
    >
      {children}
    </button>
  );
}
