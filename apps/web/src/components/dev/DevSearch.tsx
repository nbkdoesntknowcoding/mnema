'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeMarkup } from '../../lib/sanitize';

interface SearchResult {
  type: 'task' | 'session';
  id: string;
  title: string;
  preview: string;
  score: number;
  metadata: Record<string, unknown>;
}

export function DevSearch({ workspaceMode }: { workspaceMode?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isDevProject = workspaceMode === 'dev_project';

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setSelected(0);
  }, []);

  useEffect(() => {
    if (!isDevProject) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !target.matches('input, textarea, [contenteditable]')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isDevProject]);

  useEffect(() => {
    if (!isDevProject) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isDevProject, close]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/dev/search?q=${encodeURIComponent(q)}&types=tasks,sessions&limit=20`);
      const data = (await res.json()) as { results: SearchResult[] };
      setResults(data.results ?? []);
      setSelected(0);
    } catch { /* noop */ }
    setLoading(false);
  }, []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(v); }, 200);
  };

  const navigateResult = (r: SearchResult) => {
    close();
    if (r.type === 'task') window.location.href = '/app/kanban';
    else window.location.href = `/app/sessions/${r.id}`;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && results[selected]) { navigateResult(results[selected]!); }
    if (e.key === 'Escape') close();
  };

  if (!isDevProject || !open) return null;

  const taskResults = results.filter((r) => r.type === 'task');
  const sessionResults = results.filter((r) => r.type === 'session');

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
        zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh',
      }}
    >
      <div style={{
        background: 'rgba(14,14,14,0.97)', backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)',
        width: '100%', maxWidth: 560, maxHeight: '70vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
      }}>
        {/* Input */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth={2}>
            <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={onInput}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, sessions…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fafafa', fontSize: 15 }}
          />
          {loading && (
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#fbbf24',
              animation: 'devsearch-spin 0.6s linear infinite',
            }} />
          )}
          <kbd style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px', fontSize: 11, color: '#52525b' }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!query.trim() && (
            <div style={{ padding: 32, textAlign: 'center', color: '#52525b', fontSize: 13 }}>
              Type to search tasks and sessions
            </div>
          )}
          {query.trim() && results.length === 0 && !loading && (
            <div style={{ padding: 32, textAlign: 'center', color: '#52525b', fontSize: 13 }}>
              No results for '{query}'
            </div>
          )}

          {taskResults.length > 0 && (
            <section>
              <div style={{ padding: '8px 16px 4px', fontSize: 10, color: '#52525b', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tasks</div>
              {taskResults.map((r) => {
                const globalIdx = results.indexOf(r);
                return (
                  <ResultRow
                    key={r.id}
                    result={r}
                    isSelected={selected === globalIdx}
                    onClick={() => navigateResult(r)}
                    onHover={() => setSelected(globalIdx)}
                  />
                );
              })}
            </section>
          )}
          {sessionResults.length > 0 && (
            <section>
              <div style={{ padding: '8px 16px 4px', fontSize: 10, color: '#52525b', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sessions</div>
              {sessionResults.map((r) => {
                const globalIdx = results.indexOf(r);
                return (
                  <ResultRow
                    key={r.id}
                    result={r}
                    isSelected={selected === globalIdx}
                    onClick={() => navigateResult(r)}
                    onHover={() => setSelected(globalIdx)}
                  />
                );
              })}
            </section>
          )}
        </div>
      </div>

      <style>{`@keyframes devsearch-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ResultRow({
  result, isSelected, onClick, onHover,
}: {
  result: SearchResult;
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
}) {
  const m = result.metadata;
  // Highlight «term» → <mark>, then sanitize (the snippet is doc content — never inject raw)
  const previewHtml = sanitizeMarkup(
    result.preview
      .replace(/«/g, '<mark style="background:rgba(251,191,36,0.25);color:#fbbf24;border-radius:2px;padding:0 2px">')
      .replace(/»/g, '</mark>'),
  );

  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      style={{ padding: '10px 16px', background: isSelected ? 'rgba(255,255,255,0.07)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
    >
      {result.type === 'task' ? (
        <span style={{ fontSize: 10, color: '#a78bfa', background: 'rgba(167,139,250,0.15)', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace', flexShrink: 0 }}>
          {String(m.status ?? 'task')}
        </span>
      ) : (
        <span style={{ fontSize: 10, color: '#60a5fa', background: 'rgba(96,165,250,0.15)', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace', flexShrink: 0 }}>
          session
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#fafafa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {result.title}
        </div>
        {result.preview && (
          <div
            style={{ fontSize: 11, color: '#52525b', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>

      {result.type === 'session' && m.totalCostUsd !== undefined && (
        <span style={{ fontSize: 11, color: '#fbbf24', fontFamily: 'monospace', flexShrink: 0 }}>
          ${Number(m.totalCostUsd).toFixed(4)}
        </span>
      )}
    </div>
  );
}
