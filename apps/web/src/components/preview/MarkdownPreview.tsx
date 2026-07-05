import { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import { sanitizeMarkup } from '../../lib/sanitize';

interface Props {
  markdown: string;
  /** Find-in-doc query (case-insensitive). */
  query: string;
  /** Index of the active match to scroll to / highlight. */
  activeMatch: number;
  /** Reports how many matches the current query produced. */
  onMatchCount: (n: number) => void;
}

/**
 * Read-only markdown preview rendered with `marked`, with find-in-doc
 * highlighting. Kept lightweight (no Milkdown/collab) so it's cheap to mount
 * inside the floating preview window.
 */
export function MarkdownPreview({ markdown, query, activeMatch, onMatchCount }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => sanitizeMarkup(marked.parse(markdown, { async: false }) as string), [markdown]);

  // Render base HTML, then (re)apply highlights when the query changes.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.innerHTML = html;

    const q = query.trim();
    if (!q) { onMatchCount(0); return; }
    const needle = q.toLowerCase();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as Text);

    let count = 0;
    for (const tn of textNodes) {
      const text = tn.nodeValue ?? '';
      const lower = text.toLowerCase();
      if (!lower.includes(needle)) continue;
      const frag = document.createDocumentFragment();
      let i = 0;
      let idx: number;
      while ((idx = lower.indexOf(needle, i)) !== -1) {
        if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
        const mark = document.createElement('mark');
        mark.className = 'mn-find';
        mark.dataset.mi = String(count);
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        count++;
        i = idx + q.length;
      }
      if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
      tn.parentNode?.replaceChild(frag, tn);
    }
    onMatchCount(count);
  }, [query, html, onMatchCount]);

  // Highlight + scroll the active match into view.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('mark.mn-find-active').forEach((m) => m.classList.remove('mn-find-active'));
    const el = root.querySelector(`mark.mn-find[data-mi="${activeMatch}"]`) as HTMLElement | null;
    if (el) {
      el.classList.add('mn-find-active');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeMatch, query, html]);

  return (
    <>
      <div ref={ref} className="mn-md-preview" />
      <style>{`
        .mn-md-preview {
          padding: 18px 22px;
          font-family: var(--sans);
          font-size: 14px;
          line-height: 1.65;
          color: var(--text-secondary, #d4d4d8);
        }
        .mn-md-preview h1, .mn-md-preview h2, .mn-md-preview h3,
        .mn-md-preview h4 { color: var(--text-primary, #fafafa); font-weight: 600; line-height: 1.3; margin: 1.4em 0 0.5em; }
        .mn-md-preview h1 { font-size: 1.5em; }
        .mn-md-preview h2 { font-size: 1.25em; }
        .mn-md-preview h3 { font-size: 1.08em; }
        .mn-md-preview p { margin: 0.6em 0; }
        .mn-md-preview a { color: var(--accent, #60a5fa); text-decoration: none; }
        .mn-md-preview a:hover { text-decoration: underline; }
        .mn-md-preview ul, .mn-md-preview ol { margin: 0.6em 0; padding-left: 1.4em; }
        .mn-md-preview li { margin: 0.25em 0; }
        .mn-md-preview code {
          font-family: var(--mono); font-size: 0.88em;
          background: var(--surface-sunken, rgba(255,255,255,0.06));
          padding: 0.12em 0.36em; border-radius: 4px;
        }
        .mn-md-preview pre {
          background: var(--surface-sunken, rgba(255,255,255,0.05));
          border: 0.5px solid var(--border-subtle, rgba(255,255,255,0.08));
          border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0.8em 0;
        }
        .mn-md-preview pre code { background: none; padding: 0; }
        .mn-md-preview blockquote {
          border-left: 2px solid var(--border-strong, rgba(255,255,255,0.18));
          margin: 0.8em 0; padding-left: 12px; color: var(--text-tertiary, #a1a1aa);
        }
        .mn-md-preview table { border-collapse: collapse; margin: 0.8em 0; font-size: 0.92em; }
        .mn-md-preview th, .mn-md-preview td {
          border: 0.5px solid var(--border-subtle, rgba(255,255,255,0.1)); padding: 5px 9px;
        }
        .mn-md-preview hr { border: none; border-top: 0.5px solid var(--border-subtle, rgba(255,255,255,0.1)); margin: 1.2em 0; }
        .mn-md-preview img { max-width: 100%; border-radius: 6px; }
        mark.mn-find { background: rgba(251,191,36,0.32); color: inherit; border-radius: 2px; }
        mark.mn-find-active { background: rgba(251,191,36,0.9); color: #000; }
      `}</style>
    </>
  );
}
