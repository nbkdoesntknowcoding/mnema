import { useEffect, useState } from 'react';
import type { Node } from '@xyflow/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { accentFor, type NodeKind, FLOW_TOKENS as T } from './tokens';

/**
 * Levels 2 & 3 of the doc preview (level 1 = PeekTooltip on hover):
 *   - expand-in-place: a floating 560px card with the doc's rendered markdown,
 *     over a light scrim; "Open fully" promotes it to the full-doc panel.
 *   - full-doc panel: a right-60% slide-in panel with a scrim behind it.
 *
 * Both read the node's `doc_id` from GET /api/docs/:id. Capture nodes (no doc
 * yet at edit time) fall back to their own instruction text.
 */

function useDocContent(node: Node | null) {
  const [state, setState] = useState<{ title: string; html: string; loading: boolean; error: string | null }>(
    { title: '', html: '', loading: false, error: null },
  );

  useEffect(() => {
    if (!node) return;
    const docId = node.data.doc_id as string | undefined;
    const fallbackTitle = (node.data.doc_title as string) ?? (node.data.title as string) ?? 'Preview';

    // Capture nodes / unlinked docs: no stored doc — preview the instruction.
    if (!docId) {
      const md = (node.data.instruction as string) ?? (node.data.text as string) ?? '_Nothing to preview yet._';
      setState({ title: fallbackTitle, html: renderMd(md), loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const res = await fetch(`/api/docs/${docId}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { title?: string; markdown?: string };
        if (cancelled) return;
        setState({
          title: body.title ?? fallbackTitle,
          html: renderMd(body.markdown ?? ''),
          loading: false, error: null,
        });
      } catch {
        if (!cancelled) setState({ title: fallbackTitle, html: '', loading: false, error: 'Could not load this document.' });
      }
    })();
    return () => { cancelled = true; };
  }, [node]);

  return state;
}

function renderMd(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

const proseStyle: React.CSSProperties = {
  fontFamily: T.fontUI, fontSize: 15, lineHeight: 1.7, color: 'var(--ink-soft)',
};

export function ExpandedDocPreview({ node, onOpenFull, onCollapse }: {
  node: Node; onOpenFull: () => void; onCollapse: () => void;
}) {
  const kind = node.data.kind as NodeKind;
  const accent = accentFor(kind, !!node.data.isEntry);
  const { title, html, loading, error } = useDocContent(node);
  const eyebrow = kind === 'capture' ? 'CAPTURE' : 'DOC';

  return (
    <div
      className="nowheel nodrag nopan"
      onClick={(e) => e.target === e.currentTarget && onCollapse()}
      style={{
        position: 'absolute', inset: 0, zIndex: 45,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(5,6,7,.45)',
      }}
    >
      <div style={{
        width: 560, maxHeight: '78%', display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: `1px solid ${accent}55`, borderRadius: 16,
        boxShadow: `0 30px 80px rgba(0,0,0,.6), 0 0 60px ${accent}22`,
      }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: '.14em', color: accent }}>{eyebrow}</span>
          <span style={{ fontFamily: T.fontMono, fontSize: 12, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <button onClick={onOpenFull} style={{
            fontFamily: T.fontUI, fontSize: 12, fontWeight: 500, color: 'var(--on-ink)',
            background: accent, border: 'none', borderRadius: 7, padding: '5px 10px', cursor: 'pointer',
          }}>Open fully</button>
          <button onClick={onCollapse} title="Collapse" aria-label="Collapse" style={{
            width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
          </button>
        </div>
        {/* body */}
        <div className="flow-doc-prose" style={{ ...proseStyle, padding: '18px 22px', overflowY: 'auto' }}>
          {loading ? <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
            : error ? <p style={{ color: 'var(--status-warn)' }}>{error}</p>
            : <div dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      </div>
    </div>
  );
}

export function FullDocPanel({ node, onClose }: { node: Node; onClose: () => void }) {
  const kind = node.data.kind as NodeKind;
  const { title, html, loading, error } = useDocContent(node);

  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(5,6,7,.55)' }} />
      <div className="nowheel" style={{
        position: 'absolute', top: 0, right: 0, height: '100%', width: '60%', zIndex: 51,
        background: 'var(--surface)', borderLeft: '1px solid var(--line-strong)',
        boxShadow: '-30px 0 90px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column',
        animation: 'flowPanelIn .38s cubic-bezier(.4,0,.2,1)',
      }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 56, padding: '0 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.doc.accent, flexShrink: 0 }} />
          <span style={{ fontFamily: T.fontUI, fontSize: 14, fontWeight: 500, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: T.fontMono, fontSize: 10, color: 'var(--status-sync)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-sync)', animation: 'flowBreathe 2.4s ease-in-out infinite' }} />
            Synced
          </span>
          <button onClick={onClose} title="Close" aria-label="Close" style={{
            width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        {/* body */}
        <div className="flow-doc-prose" style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ maxWidth: 640, margin: '0 auto', padding: '36px 56px 80px', ...proseStyle }}>
            {loading ? <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
              : error ? <p style={{ color: 'var(--status-warn)' }}>{error}</p>
              : <div dangerouslySetInnerHTML={{ __html: html }} />}
          </div>
        </div>
      </div>
    </>
  );
}
