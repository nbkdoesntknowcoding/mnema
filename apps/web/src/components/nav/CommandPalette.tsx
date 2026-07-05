import { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';

type Mode = 'search' | 'command';
type SearchState = 'initial' | 'loading' | 'results' | 'empty';

interface SearchResult {
  type: 'doc' | 'flow' | 'comment';
  id: string;
  title: string;
  snippet?: string;
  path: string;
  highlight?: string;
}

interface CommandItem {
  group: string;
  name: string;
  label: string;
  kbd?: string[];
  icon: string;
  disabled?: boolean;
  meta?: string;
  danger?: boolean;
  href?: string;
  action?: () => void;
}

const RECENT_SEARCHES = ['how mnema syncs', 'onboarding playbook', 'claude connector setup'];

const COMMANDS: CommandItem[] = [
  { group: 'CREATE', name: 'new doc', label: 'New doc', kbd: ['⌘', 'N'], icon: 'doc', href: '/app/content' },
  { group: 'CREATE', name: 'new flow', label: 'New flow', kbd: ['⌘', '⇧', 'N'], icon: 'flow', href: '/app/flows' },
  { group: 'CREATE', name: 'new engineering doc', label: 'New engineering doc', icon: 'code', href: '/app/content' },
  { group: 'CREATE', name: 'new instruction', label: 'New instruction', icon: 'bolt', href: '/app/content' },
  { group: 'CREATE', name: 'new snippet', label: 'New snippet', icon: 'snippet', href: '/app/content' },
  { group: 'WORKSPACE', name: 'switch workspace', label: 'Switch workspace', kbd: ['⌘', 'O'], icon: 'switch' },
  { group: 'WORKSPACE', name: 'invite member', label: 'Invite member', kbd: ['⌘', 'I'], icon: 'user-plus' },
  { group: 'WORKSPACE', name: 'open settings', label: 'Open settings', kbd: ['⌘', ','], icon: 'settings', href: '/app/settings' },
  { group: 'FLOWS', name: 'walk flow', label: 'Walk a flow…', kbd: ['⌘', '⇧', 'F'], icon: 'play', href: '/app/flows' },
  { group: 'FLOWS', name: 'flow editor', label: 'Open flow editor', icon: 'edit', disabled: true, meta: 'SOON · 6.3' },
  { group: 'SETTINGS', name: 'open billing', label: 'Open billing', icon: 'card', href: '/app/settings' },
  { group: 'SETTINGS', name: 'change theme', label: 'Change theme…', kbd: ['⌘', '⇧', 'T'], icon: 'moon' },
  { group: 'SETTINGS', name: 'sign out', label: 'Sign out', icon: 'logout', danger: true, href: '/auth/logout' },
  { group: 'CONNECTIONS', name: 'open claude', label: 'Open Claude connector', icon: 'claude', href: '/app/connections/claude' },
  { group: 'CONNECTIONS', name: 'copy mcp url', label: 'Copy MCP URL', kbd: ['⌘', '⇧', 'C'], icon: 'copy', meta: 'api.mnema.app/mcp/workspace' },
];

function DocIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>;
}
function FlowIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M9 6h4a2 2 0 0 1 2 2v10M9 18h6"/></svg>;
}
function CommentIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
}

function CommandIcon({ name, danger }: { name: string; danger?: boolean }) {
  if (name === 'claude') return (
    <span style={{ background: 'linear-gradient(135deg,#FFB370,#FF7A8A)', color: 'white', borderColor: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6 }}>
      <span style={{ font: '700 11px var(--sans)' }}>C</span>
    </span>
  );
  const color = danger ? 'var(--status-error)' : undefined;
  const iconMap: Record<string, ReactElement> = {
    doc: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/></svg>,
    flow: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M9 6h4a2 2 0 0 1 2 2v10"/></svg>,
    code: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
    bolt: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>,
    snippet: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6M9 13h4"/></svg>,
    switch: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17l-4-4 4-4M3 13h11"/><path d="M17 7l4 4-4 4M21 11H10"/></svg>,
    'user-plus': <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>,
    settings: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    play: <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>,
    edit: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>,
    card: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>,
    moon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/></svg>,
    logout: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>,
    copy: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  };
  return (
    <span style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line)', color: color ?? 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {iconMap[name] ?? iconMap['doc']}
    </span>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>('initial');
  const [filter, setFilter] = useState('all');
  const [searchMode, setSearchMode] = useState<'hybrid' | 'keyword' | 'semantic'>('hybrid');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Open on ⌘K, or when the top-bar search box dispatches `mnema:open-palette`.
  useEffect(() => {
    const openSearch = () => {
      setOpen(true);
      setMode('search');
      setQuery('');
      setResults([]);
      setSearchState('initial');
      setSelectedIdx(0);
    };
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('mnema:open-palette', openSearch);
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('mnema:open-palette', openSearch); };
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => i + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(0, i - 1)); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const handleInput = useCallback((val: string) => {
    setSelectedIdx(0);
    // ">" toggles into command mode; otherwise the fetch effect below drives search state.
    if (mode === 'search' && val.startsWith('>')) {
      setMode('command');
      setQuery(val.slice(1).trimStart());
      return;
    }
    setQuery(val);
  }, [mode]);

  // Live doc search: debounced fetch to /api/search (cookie-auth, same searchDocs as the MCP/API).
  useEffect(() => {
    if (mode !== 'search') return;
    const term = query.trim();
    if (term.length < 2) { setSearchState('initial'); setResults([]); return; }
    setSearchState('loading');
    const ctl = new AbortController();
    const t = setTimeout(() => {
      void (async () => {
        try {
          const r = await fetch(
            `/api/search?q=${encodeURIComponent(term)}&mode=${searchMode}&limit=12`,
            { credentials: 'include', signal: ctl.signal },
          );
          if (!r.ok) { setResults([]); setSearchState('empty'); return; }
          const data = await r.json();
          const mapped: SearchResult[] = (data.results ?? []).map((d: {
            id: string; title: string | null; snippet?: string; project_name?: string | null; decision_status?: string | null;
          }) => ({
            type: 'doc',
            id: d.id,
            title: d.title || 'Untitled',
            snippet: (d.snippet || '').replace(/<\/?mark>/g, ''),
            path: d.decision_status ? `Decision · ${d.decision_status}` : (d.project_name ? d.project_name : ''),
          }));
          setResults(mapped);
          setSearchState(mapped.length ? 'results' : 'empty');
        } catch (e) {
          if ((e as { name?: string })?.name !== 'AbortError') { setResults([]); setSearchState('empty'); }
        }
      })();
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query, searchMode, mode]);

  if (!open) return null;

  // App search currently covers docs (the searchDocs engine). 'all'/'docs' show results; the
  // flows/comments/engineering pills have no hits yet (kept for forward-compat).
  const filteredResults = (filter === 'all' || filter === 'docs') ? results : [];

  const filteredCmds = mode === 'command' && query
    ? COMMANDS.filter(c => c.name.includes(query.toLowerCase()) || c.label.toLowerCase().includes(query.toLowerCase()))
    : COMMANDS;

  const cmdGroups = filteredCmds.reduce<Record<string, CommandItem[]>>((acc, cmd) => {
    if (!acc[cmd.group]) acc[cmd.group] = [];
    acc[cmd.group]!.push(cmd);
    return acc;
  }, {});

  const resultsByType = filteredResults.reduce<Record<string, SearchResult[]>>((acc, r) => {
    const key = r.type === 'doc' ? 'Docs' : r.type === 'flow' ? 'Flows' : 'Comments';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const S: React.CSSProperties = {};

  return (
    <>
      <style>{`
        .cmdk-overlay {
          position: fixed; inset: 0;
          background: rgba(10,11,13,0.50);
          backdrop-filter: blur(8px) saturate(140%);
          display: flex; justify-content: center; align-items: flex-start;
          padding: 80px 24px 24px;
          z-index: 80;
          animation: cmdk-fade 160ms ease;
        }
        @keyframes cmdk-fade { from { opacity:0; } to { opacity:1; } }
        .cmdk-box {
          width: 100%; max-width: 672px;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 14px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 30px 80px -20px rgba(0,0,0,0.65);
          overflow: hidden;
          animation: cmdk-pop 220ms cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes cmdk-pop { from{opacity:0;transform:scale(0.97) translateY(-6px);} to{opacity:1;transform:scale(1) translateY(0);} }
        .cmdk-search {
          display: flex; align-items: center; gap: 10px;
          padding: 0 16px; height: 48px;
          border-bottom: 1px solid var(--line);
        }
        .cmdk-search-inp {
          flex: 1; border: 0; outline: 0; background: transparent;
          font: 400 14.5px/1 var(--sans); color: var(--ink); padding: 0;
        }
        .cmdk-search-inp::placeholder { color: var(--ink-muted); }
        .cmdk-esc-badge {
          font: 500 10.5px/1 var(--mono); color: var(--ink-muted);
          padding: 3px 6px; border-radius: 4px;
          background: var(--surface-2); border: 1px solid var(--line);
        }
        .cmdk-filters {
          display: flex; gap: 5px; padding: 8px 14px;
          border-bottom: 1px solid var(--line); overflow-x: auto;
        }
        .cmdk-filter-pill {
          font: 500 12px/1 var(--sans); padding: 5px 10px; border-radius: 999px;
          background: transparent; border: 1px solid transparent;
          color: var(--ink-muted); cursor: pointer; white-space: nowrap; flex-shrink: 0;
        }
        .cmdk-filter-pill:hover { color: var(--ink); background: var(--surface-2); }
        .cmdk-filter-pill.active { background: var(--surface-2); color: var(--ink); border-color: var(--line); }
        .cmdk-body { max-height: 60vh; overflow-y: auto; padding: 6px 0; }
        .cmdk-section-label {
          font: 500 10px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--ink-muted); padding: 10px 16px 6px;
          display: flex; align-items: center; gap: 8px;
        }
        .cmdk-section-label::after { content: ""; flex: 1; height: 1px; background: var(--line); }
        .cmdk-row {
          display: flex; align-items: center; gap: 12px; padding: 8px 16px;
          cursor: pointer; border-left: 2px solid transparent;
        }
        .cmdk-row:hover, .cmdk-row.sel { background: var(--surface-2); border-left-color: var(--accent); }
        .cmdk-row.disabled { cursor: not-allowed; opacity: 0.5; }
        .cmdk-row.disabled:hover { background: transparent; border-left-color: transparent; }
        .cmdk-row-body { flex: 1; min-width: 0; }
        .cmdk-row-title { font: 500 14px/1.3 var(--sans); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cmdk-row-snippet { font: 400 12.5px/1.4 var(--sans); color: var(--ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
        .cmdk-row-path { font: 500 11px/1 var(--mono); color: var(--ink-muted); letter-spacing: 0.02em; flex-shrink: 0; }
        .cmdk-kbd-end { display: inline-flex; gap: 3px; flex-shrink: 0; }
        .cmdk-kbd-end kbd { font: 500 10.5px/1 var(--mono); color: var(--ink-soft); padding: 3px 6px; border-radius: 4px; background: var(--surface); border: 1px solid var(--line); min-width: 18px; text-align: center; }
        .cmdk-meta { font: 500 11px/1 var(--mono); color: var(--ink-muted); padding: 2px 5px; border-radius: 3px; background: var(--surface-3); border: 1px solid var(--line); letter-spacing: 0.04em; }
        .cmdk-state-msg { padding: 40px 16px; text-align: center; color: var(--ink-muted); font-size: 13px; }
        .cmdk-state-spinner { width: 18px; height: 18px; border: 2px solid var(--line-strong); border-top-color: var(--accent); border-radius: 50%; margin: 0 auto 10px; animation: cmdk-spin 0.8s linear infinite; }
        @keyframes cmdk-spin { to { transform: rotate(360deg); } }
        .cmdk-foot {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 14px; border-top: 1px solid var(--line); background: var(--surface-2);
        }
        .cmdk-hints { display: flex; gap: 14px; }
        .cmdk-hint { display: flex; align-items: center; gap: 6px; font: 500 11px/1 var(--sans); color: var(--ink-muted); }
        .cmdk-hint kbd { font: 500 10px/1 var(--mono); color: var(--ink-soft); padding: 2px 5px; border-radius: 3px; background: var(--surface); border: 1px solid var(--line); min-width: 16px; text-align: center; }
        .cmdk-mode-seg { display: inline-flex; padding: 2px; background: var(--surface); border: 1px solid var(--line); border-radius: 5px; }
        .cmdk-mode-btn { font: 500 11px/1 var(--sans); padding: 4px 8px; border: 0; background: transparent; color: var(--ink-muted); cursor: pointer; border-radius: 3px; }
        .cmdk-mode-btn.active { background: var(--surface-2); color: var(--ink); }
        .cmdk-mode-label { font: 500 10.5px/1 var(--mono); color: var(--ink-muted); letter-spacing: 0.06em; display: inline-flex; align-items: center; gap: 6px; }
        .cmdk-mode-label .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
        .recent-row { display: flex; align-items: center; gap: 10px; padding: 7px 16px; cursor: pointer; color: var(--ink-soft); }
        .recent-row:hover { background: var(--surface-2); color: var(--ink); }
      `}</style>

      <div className="cmdk-overlay" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        <div className="cmdk-box">

          {/* SEARCH INPUT */}
          <div className="cmdk-search">
            {mode === 'command' ? (
              <span style={{ font: '500 16px/1 var(--mono)', color: 'var(--ink-muted)', width: 14, textAlign: 'center', flexShrink: 0 }}>{'>'}</span>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--ink-muted)', flexShrink: 0 }}>
                <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
              </svg>
            )}
            <input
              ref={inputRef}
              className="cmdk-search-inp"
              placeholder={mode === 'command' ? 'Type a command…' : 'Search docs, flows, comments…'}
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              autoComplete="off"
            />
            <span className="cmdk-esc-badge">ESC</span>
          </div>

          {/* FILTER PILLS (search mode only) */}
          {mode === 'search' && (
            <div className="cmdk-filters">
              {['all', 'docs', 'flows', 'comments', 'engineering', 'instructions', 'snippets'].map((f) => (
                <button
                  key={f}
                  className={`cmdk-filter-pill${filter === f ? ' active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          )}

          {/* BODY */}
          <div className="cmdk-body" ref={bodyRef}>

            {mode === 'search' && searchState === 'initial' && (
              <>
                <div className="cmdk-section-label">Recent searches</div>
                {RECENT_SEARCHES.map((q) => (
                  <div key={q} className="recent-row" onClick={() => { setQuery(q); handleInput(q); }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--ink-faint)' }}>
                      <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
                    </svg>
                    <span style={{ font: '500 13px/1 var(--sans)', flex: 1 }}>{q}</span>
                  </div>
                ))}
                <div className="cmdk-section-label">Quick actions</div>
                {[
                  { label: 'Create new doc', href: '/app/content', kbd: '⌘ N' },
                  { label: 'Create new flow', href: '/app/flows', kbd: '⌘ ⇧ N' },
                  { label: 'Open settings', href: '/app/settings', kbd: '⌘ ,' },
                ].map((a, i) => (
                  <div key={i} className={`cmdk-row${i === selectedIdx ? ' sel' : ''}`} onClick={() => window.location.href = a.href}>
                    <DocIcon />
                    <div className="cmdk-row-body"><div className="cmdk-row-title">{a.label}</div></div>
                    <span className="cmdk-kbd-end"><kbd>{a.kbd}</kbd></span>
                  </div>
                ))}
              </>
            )}

            {mode === 'search' && searchState === 'loading' && (
              <div className="cmdk-state-msg">
                <div className="cmdk-state-spinner"></div>
                Searching…
              </div>
            )}

            {mode === 'search' && searchState === 'empty' && (
              <div className="cmdk-state-msg">
                No matches for <span style={{ color: 'var(--ink-soft)', fontFamily: 'var(--mono)' }}>"{query}"</span>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-faint)' }}>Try different terms or switch to Semantic mode</div>
              </div>
            )}

            {mode === 'search' && searchState === 'results' && (
              <>
                {Object.entries(resultsByType).map(([section, results]) => (
                  <div key={section}>
                    <div className="cmdk-section-label">{section}</div>
                    {results.map((r, i) => (
                      <div
                        key={r.id || i}
                        className={`cmdk-row${i === 0 && section === Object.keys(resultsByType)[0] ? ' sel' : ''}`}
                        onClick={() => { if (r.id) window.location.href = `/app/content/${r.id}`; }}
                      >
                        <span style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {r.type === 'doc' ? <DocIcon /> : r.type === 'flow' ? <FlowIcon /> : <CommentIcon />}
                        </span>
                        <div className="cmdk-row-body">
                          <div className="cmdk-row-title">{r.title}</div>
                          {r.snippet && <div className="cmdk-row-snippet">{r.snippet}</div>}
                        </div>
                        <span className="cmdk-row-path">{r.path}</span>
                        {i === 0 && <span className="cmdk-kbd-end"><kbd>↵</kbd></span>}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}

            {mode === 'command' && (
              <>
                {Object.entries(cmdGroups).map(([group, cmds]) => (
                  <div key={group}>
                    <div className="cmdk-section-label">{group}</div>
                    {cmds.map((cmd, i) => (
                      <div
                        key={cmd.name}
                        className={`cmdk-row${cmd.disabled ? ' disabled' : ''}${i === 0 && group === Object.keys(cmdGroups)[0] && !query ? ' sel' : ''}`}
                        onClick={() => {
                          if (cmd.disabled) return;
                          if (cmd.href) window.location.href = cmd.href;
                          if (cmd.action) cmd.action();
                          if (!cmd.disabled) setOpen(false);
                        }}
                      >
                        <CommandIcon name={cmd.icon} danger={cmd.danger} />
                        <div className="cmdk-row-body" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span className="cmdk-row-title" style={{ color: cmd.danger ? 'var(--status-error)' : undefined }}>{cmd.label}</span>
                          {cmd.meta && <span className="cmdk-meta">{cmd.meta}</span>}
                          {cmd.disabled && cmd.meta === undefined && <span className="cmdk-meta">SOON</span>}
                        </div>
                        {cmd.kbd && (
                          <span className="cmdk-kbd-end">
                            {cmd.kbd.map((k, ki) => <kbd key={ki}>{k}</kbd>)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {filteredCmds.length === 0 && (
                  <div className="cmdk-state-msg">
                    No command matches <span style={{ color: 'var(--ink-soft)', fontFamily: 'var(--mono)' }}>"{query}"</span>
                  </div>
                )}
              </>
            )}

          </div>

          {/* FOOTER */}
          <div className="cmdk-foot">
            <div className="cmdk-hints">
              <span className="cmdk-hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
              <span className="cmdk-hint"><kbd>↵</kbd> {mode === 'command' ? 'run' : 'open'}</span>
              <span className="cmdk-hint"><kbd>esc</kbd> dismiss</span>
            </div>
            {mode === 'search' ? (
              <div className="cmdk-mode-seg">
                {(['hybrid', 'keyword', 'semantic'] as const).map((m) => (
                  <button key={m} className={`cmdk-mode-btn${searchMode === m ? ' active' : ''}`} onClick={() => setSearchMode(m)}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            ) : (
              <span className="cmdk-mode-label"><span className="dot"></span>COMMAND MODE</span>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
