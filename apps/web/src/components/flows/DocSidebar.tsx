import { useEffect, useState, useCallback } from 'react';
import { FileText, Search, GripVertical } from 'lucide-react';
import { MonoLabel } from '../ui/typography';

interface DocItem {
  id: string;
  title: string;
  path: string;
}

interface Props {
  onDragStart?: (doc: DocItem) => void;
}

export function DocSidebar({ onDragStart }: Props) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/docs?limit=200', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data.docs) ? data.docs : [];
        setDocs(list);
      })
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = query.trim()
    ? docs.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    : docs;

  const handleDragStart = useCallback(
    (e: React.DragEvent, doc: DocItem) => {
      e.dataTransfer.setData('application/mnema-doc', JSON.stringify(doc));
      e.dataTransfer.effectAllowed = 'copy';
      onDragStart?.(doc);
    },
    [onDragStart],
  );

  return (
    <aside className="w-[220px] shrink-0 border-r border-[var(--line)] bg-[var(--surface)] flex flex-col overflow-hidden">
      <div className="px-3 py-3 border-b border-[var(--border-subtle)]">
        <MonoLabel className="block mb-2 text-[var(--text-tertiary)]">Docs</MonoLabel>
        <div className="relative">
          <Search
            size={11}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-quaternary)]"
            strokeWidth={1.75}
          />
          <input
            type="text"
            placeholder="Filter docs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-[12px] bg-[var(--surface-sunken)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)] outline-none focus:border-[var(--border-strong)] transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="px-3 py-4 text-[11px] text-[var(--text-quaternary)]">Loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-[var(--text-quaternary)] italic">
            {query ? 'No matches' : 'No docs yet'}
          </div>
        )}
        {filtered.map((doc) => (
          <div
            key={doc.id}
            draggable
            onDragStart={(e) => handleDragStart(e, doc)}
            className="group flex items-center gap-2 px-3 py-1.5 cursor-grab active:cursor-grabbing hover:bg-[var(--surface-2)] transition-colors select-none"
            title={`Drag to add "${doc.title}" as a Doc node`}
          >
            <GripVertical
              size={10}
              className="text-[var(--text-quaternary)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              strokeWidth={1.75}
            />
            <FileText size={11} className="text-[var(--text-tertiary)] shrink-0" strokeWidth={1.75} />
            <span className="text-[12px] text-[var(--text-secondary)] truncate leading-[1.4]">
              {doc.title}
            </span>
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-[var(--border-subtle)]">
        <p className="text-[10px] text-[var(--text-quaternary)] leading-[1.4]">
          Drag a doc onto the canvas to add it as a node
        </p>
      </div>
    </aside>
  );
}
