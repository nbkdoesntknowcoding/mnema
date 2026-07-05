import { type JSX, useMemo } from 'react';
import { marked } from 'marked';
import { sanitizeMarkup } from '../../lib/sanitize';

interface PublicDocViewerProps {
  markdown: string;
}

/**
 * Read-only renderer for the public share page.
 *
 * Previously this mounted Crepe (the full WYSIWYG editor) with `defaultValue: markdown` and
 * default features + no error handling — so any content Crepe's async `create()` choked on
 * (math, a table, a large body) failed SILENTLY and the page showed only the title. A public
 * read-only page doesn't need an editor: render the markdown to sanitized HTML with `marked`.
 * Reliable, synchronous, no silent failure.
 */
export function PublicDocViewer({ markdown }: PublicDocViewerProps): JSX.Element {
  const html = useMemo(
    () => sanitizeMarkup(marked.parse(markdown ?? '', { async: false }) as string),
    [markdown],
  );

  return (
    <>
      <div className="mn-public-doc" dangerouslySetInnerHTML={{ __html: html }} />
      <style>{`
        .mn-public-doc {
          padding: 8px 24px 0;
          font-family: var(--sans);
          font-size: 15px;
          line-height: 1.7;
          color: var(--text-secondary, #d4d4d8);
        }
        .mn-public-doc h1, .mn-public-doc h2, .mn-public-doc h3, .mn-public-doc h4 {
          color: var(--text-primary, #fafafa); font-weight: 600; line-height: 1.3; margin: 1.6em 0 0.5em; letter-spacing: -0.01em;
        }
        .mn-public-doc h1 { font-size: 1.6em; }
        .mn-public-doc h2 { font-size: 1.3em; }
        .mn-public-doc h3 { font-size: 1.1em; }
        .mn-public-doc p { margin: 0.7em 0; }
        .mn-public-doc a { color: var(--accent, #60a5fa); text-decoration: none; }
        .mn-public-doc a:hover { text-decoration: underline; }
        .mn-public-doc ul, .mn-public-doc ol { margin: 0.7em 0; padding-left: 1.5em; }
        .mn-public-doc li { margin: 0.3em 0; }
        .mn-public-doc code {
          font-family: var(--mono); font-size: 0.88em;
          background: var(--surface-sunken, rgba(255,255,255,0.06)); padding: 0.12em 0.36em; border-radius: 4px;
        }
        .mn-public-doc pre {
          background: var(--surface-sunken, rgba(255,255,255,0.05));
          border: 0.5px solid var(--border-subtle, rgba(255,255,255,0.08));
          border-radius: 8px; padding: 14px 16px; overflow-x: auto; margin: 1em 0;
        }
        .mn-public-doc pre code { background: none; padding: 0; }
        .mn-public-doc blockquote {
          border-left: 2px solid var(--border-strong, rgba(255,255,255,0.18));
          margin: 1em 0; padding-left: 14px; color: var(--text-tertiary, #a1a1aa);
        }
        .mn-public-doc table { border-collapse: collapse; margin: 1em 0; font-size: 0.95em; width: 100%; }
        .mn-public-doc th, .mn-public-doc td {
          border: 0.5px solid var(--border-subtle, rgba(255,255,255,0.12)); padding: 7px 11px; text-align: left;
        }
        .mn-public-doc th { background: var(--surface-sunken, rgba(255,255,255,0.04)); font-weight: 600; color: var(--text-primary, #fafafa); }
        .mn-public-doc hr { border: none; border-top: 0.5px solid var(--border-subtle, rgba(255,255,255,0.12)); margin: 1.6em 0; }
        .mn-public-doc img { max-width: 100%; border-radius: 6px; }
      `}</style>
    </>
  );
}
