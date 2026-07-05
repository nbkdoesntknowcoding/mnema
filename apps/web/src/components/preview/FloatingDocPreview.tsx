import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, ExternalLink, ChevronUp, ChevronDown, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import type { DocFull } from '@boppl/shared';
import { OriginalFileViewer } from '../editor/OriginalFileViewer';
import { MarkdownPreview } from './MarkdownPreview';

interface Props {
  docId: string;
  onClose: () => void;
}

const DEFAULT_W = 540;
const DEFAULT_H = 620;

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, borderRadius: 6, background: 'none', border: 'none',
  color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0, textDecoration: 'none',
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-quaternary)', fontSize: 12, fontFamily: 'var(--mono)' }}>
      {children}
    </div>
  );
}

export function FloatingDocPreview({ docId, onClose }: Props) {
  const [doc, setDoc] = useState<DocFull | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pos, setPos] = useState(() => ({
    x: Math.max(24, (typeof window !== 'undefined' ? window.innerWidth : 1200) - DEFAULT_W - 56),
    y: 84,
  }));
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [count, setCount] = useState(0);

  // Fetch the doc whenever the target changes.
  useEffect(() => {
    let alive = true;
    setStatus('loading'); setDoc(null); setQuery(''); setActive(0); setCount(0); setFindOpen(false);
    api.getDoc(docId)
      .then((r) => { if (alive) { setDoc(r.doc); setStatus('ready'); } })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, [docId]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Drag (by header) ──────────────────────────────────────────────
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const onHeaderDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHeaderMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({
      x: Math.min(Math.max(0, e.clientX - dragRef.current.dx), window.innerWidth - 120),
      y: Math.min(Math.max(0, e.clientY - dragRef.current.dy), window.innerHeight - 40),
    });
  };
  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // ── Resize (bottom-right handle) ──────────────────────────────────
  const resizeRef = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    resizeRef.current = { sx: e.clientX, sy: e.clientY, sw: size.w, sh: size.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const w = Math.max(340, resizeRef.current.sw + (e.clientX - resizeRef.current.sx));
    const h = Math.max(260, resizeRef.current.sh + (e.clientY - resizeRef.current.sy));
    setSize({
      w: Math.min(w, window.innerWidth - pos.x - 8),
      h: Math.min(h, window.innerHeight - pos.y - 8),
    });
  };
  const endResize = (e: React.PointerEvent) => {
    resizeRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const format = doc?.sourceAttachment?.format ?? null;
  const isMarkdown = status === 'ready' && !format;

  const onMatchCount = useCallback((n: number) => {
    setCount(n);
    setActive((a) => (n === 0 ? 0 : Math.min(a, n - 1)));
  }, []);
  const nextMatch = () => { if (count) setActive((a) => (a + 1) % count); };
  const prevMatch = () => { if (count) setActive((a) => (a - 1 + count) % count); };

  return createPortal(
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 1200,
      display: 'flex', flexDirection: 'column',
      background: 'var(--surface-overlay, rgba(14,14,16,0.97))',
      border: '0.5px solid var(--border-strong, rgba(255,255,255,0.14))',
      borderRadius: 12, boxShadow: '0 16px 60px rgba(0,0,0,0.6)',
      overflow: 'hidden', backdropFilter: 'blur(20px)', fontFamily: 'var(--sans)',
    }}>
      {/* Header (drag handle) */}
      <div
        onPointerDown={onHeaderDown} onPointerMove={onHeaderMove} onPointerUp={endDrag}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '0.5px solid var(--border-subtle, rgba(255,255,255,0.07))', cursor: 'grab', userSelect: 'none', flexShrink: 0 }}
      >
        <FileText size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} strokeWidth={1.75} />
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {doc?.title ?? (status === 'loading' ? 'Loading…' : 'Document')}
        </span>
        {isMarkdown && (
          <button data-no-drag onClick={() => setFindOpen((v) => !v)} title="Find in document" style={iconBtn}>
            <Search size={13} strokeWidth={1.75} />
          </button>
        )}
        <a data-no-drag href={`/app/content/${docId}`} title="Open in editor" style={iconBtn}>
          <ExternalLink size={13} strokeWidth={1.75} />
        </a>
        <button data-no-drag onClick={onClose} title="Close (Esc)" style={iconBtn}>
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>

      {/* Find bar (markdown only) */}
      {isMarkdown && findOpen && (
        <div data-no-drag style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '0.5px solid var(--border-subtle, rgba(255,255,255,0.07))', flexShrink: 0 }}>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.shiftKey ? prevMatch : nextMatch)(); } }}
            placeholder="Find in document…"
            style={{ flex: 1, background: 'var(--surface-sunken, rgba(255,255,255,0.05))', border: '0.5px solid var(--border-subtle, rgba(255,255,255,0.08))', borderRadius: 6, padding: '4px 8px', fontSize: 12, color: 'var(--text-primary)', outline: 'none' }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-quaternary)', minWidth: 40, textAlign: 'center', fontFamily: 'var(--mono)' }}>
            {count ? `${active + 1}/${count}` : '0/0'}
          </span>
          <button onClick={prevMatch} title="Previous (Shift+Enter)" style={iconBtn}><ChevronUp size={13} /></button>
          <button onClick={nextMatch} title="Next (Enter)" style={iconBtn}><ChevronDown size={13} /></button>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: format ? 'hidden' : 'auto', position: 'relative' }}>
        {status === 'loading' && <Centered>Loading…</Centered>}
        {status === 'error' && <Centered>Failed to load document</Centered>}
        {status === 'ready' && doc && (
          format && doc.sourceAttachment ? (
            <div style={{ position: 'absolute', inset: 0 }}>
              <OriginalFileViewer attachmentId={doc.sourceAttachment.id} format={format} />
            </div>
          ) : (
            <MarkdownPreview markdown={doc.markdown ?? ''} query={query} activeMatch={active} onMatchCount={onMatchCount} />
          )
        )}
      </div>

      {/* Resize handle */}
      <div
        onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={endResize}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 18, height: 18, cursor: 'nwse-resize', color: 'var(--text-quaternary)' }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" style={{ position: 'absolute', right: 1, bottom: 1 }}>
          <path d="M13 17L17 13M7 17L17 7" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        </svg>
      </div>
    </div>,
    document.body,
  );
}
