import { useEffect, useRef, useState } from 'react';
import { FileText, Search, X, Eye } from 'lucide-react';
import { openDocPreview } from '../../lib/preview';

interface DocItem {
  id: string;
  title: string;
  path: string;
}

interface Props {
  value: string | null;
  onChange: (docId: string | null, docTitle?: string) => void;
}

export function DocPicker({ value, onChange }: Props) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/docs?limit=200', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        const list: DocItem[] = Array.isArray(data.docs) ? data.docs : [];
        setDocs(list);
        if (value) {
          const found = list.find((d) => d.id === value);
          setSelectedTitle(found?.title ?? null);
        }
      })
      .catch(() => {});
  }, []);

  // Sync selected title when value changes externally
  useEffect(() => {
    if (value && docs.length > 0) {
      const found = docs.find((d) => d.id === value);
      setSelectedTitle(found?.title ?? null);
    } else if (!value) {
      setSelectedTitle(null);
    }
  }, [value, docs]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = query.trim()
    ? docs.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    : docs;

  const handleSelect = (doc: DocItem) => {
    onChange(doc.id, doc.title);
    setSelectedTitle(doc.title);
    setOpen(false);
    setQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setSelectedTitle(null);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] bg-[var(--surface-sunken)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] hover:border-[var(--border-strong)] transition-colors text-left"
      >
        <FileText size={11} className="text-[var(--text-tertiary)] shrink-0" strokeWidth={1.75} />
        {selectedTitle ? (
          <>
            <span className="flex-1 truncate text-[var(--text-primary)]">{selectedTitle}</span>
            {value && (
              <span
                role="button"
                title="Preview doc"
                onClick={(e) => { e.stopPropagation(); openDocPreview(value); }}
                className="text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
              >
                <Eye size={11} strokeWidth={1.75} />
              </span>
            )}
            <span
              role="button"
              onClick={handleClear}
              className="text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <X size={10} strokeWidth={2} />
            </span>
          </>
        ) : (
          <span className="flex-1 text-[var(--text-quaternary)] italic">Select a doc…</span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[var(--surface-overlay)] border border-[var(--border-strong)] rounded-[var(--radius-md)] shadow-lg overflow-hidden">
          <div className="px-2 py-1.5 border-b border-[var(--border-subtle)]">
            <div className="relative">
              <Search
                size={10}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)]"
                strokeWidth={1.75}
              />
              <input
                autoFocus
                type="text"
                placeholder="Search docs…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-5 pr-2 py-1 text-[12px] bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)]"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-[var(--text-quaternary)] italic">
                {query ? 'No matches' : 'No docs'}
              </div>
            )}
            {filtered.map((doc) => (
              <div
                key={doc.id}
                className={
                  'group w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--surface-2)] transition-colors ' +
                  (doc.id === value ? 'bg-[var(--surface-2)]' : '')
                }
              >
                <button
                  type="button"
                  onClick={() => handleSelect(doc)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left"
                >
                  <FileText size={11} className="text-[var(--text-tertiary)] shrink-0" strokeWidth={1.75} />
                  <span className="text-[12px] text-[var(--text-primary)] truncate">{doc.title}</span>
                </button>
                <button
                  type="button"
                  title="Preview doc"
                  onClick={(e) => { e.stopPropagation(); openDocPreview(doc.id); }}
                  className="shrink-0 text-[var(--text-quaternary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Eye size={12} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
