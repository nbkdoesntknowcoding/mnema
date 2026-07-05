import { type JSX, useEffect, useState } from 'react';
import type { DiffChunk } from './types';
import { MarkdownPreview } from '../preview/MarkdownPreview';

interface Props {
  docId: string;
  version: number;
  /** owner / editor / viewer — drives the Restore button visibility. */
  role: 'owner' | 'editor' | 'viewer' | null;
  onClose: () => void;
  /** Called after a successful restore so the parent can refetch the
   *  versions list (a new "Restored to version N" snapshot just landed). */
  onRestored: () => void;
}

/**
 * Centered overlay that shows the line-level diff between a saved version
 * and the current doc. Each chunk gets one of three classes:
 *   - .diff-add     (insertion vs. the saved version)
 *   - .diff-remove  (removal vs. the saved version)
 *   - .diff-context (unchanged, shown for context)
 *
 * The Restore button is owner/editor-only — viewers see the diff but no
 * restore action. The backend enforces the same gate (POST
 * /api/doc-versions/restore returns 403 for viewers); the UI hide is
 * just to avoid showing a button that always fails.
 */
export function VersionDiffView({
  docId,
  version,
  role,
  onClose,
  onRestored,
}: Props): JSX.Element {
  const [diff, setDiff] = useState<DiffChunk[] | null>(null);
  const [versionMarkdown, setVersionMarkdown] = useState<string>('');
  const [view, setView] = useState<'preview' | 'diff'>('preview');
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/doc-versions/diff?doc_id=${docId}&version=${version}`,
          { credentials: 'include' },
        );
        if (!res.ok) {
          setError('Could not load version.');
          return;
        }
        // The endpoint returns the diff AND the raw markdown of both sides; we render
        // version_markdown for the Preview tab so users see the document as it looked,
        // not raw markdown source.
        const body = (await res.json()) as { diff: DiffChunk[]; version_markdown?: string };
        if (!cancelled) {
          setDiff(body.diff ?? []);
          setVersionMarkdown(body.version_markdown ?? '');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, version]);

  async function handleRestore(): Promise<void> {
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-versions/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ doc_id: docId, version }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? 'Viewers cannot restore versions.' : 'Restore failed.');
        return;
      }
      onRestored();
      onClose();
    } finally {
      setRestoring(false);
    }
  }

  const canRestore = role === 'owner' || role === 'editor';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10"
      style={{ background: 'rgba(0, 0, 0, 0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-full rounded-lg flex flex-col"
        style={{
          background: 'var(--surface-base)',
          border: '1px solid var(--border-default)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <div>
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Version {version}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {view === 'preview'
                ? 'The document as it looked at this version.'
                : 'Changes between this version and the current doc.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
              {(['preview', 'diff'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className="px-2.5 py-1 text-xs"
                  style={{
                    background: view === v ? 'var(--surface-overlay)' : 'transparent',
                    color: view === v ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  }}
                  aria-pressed={view === v}
                >
                  {v === 'preview' ? 'Preview' : 'Diff'}
                </button>
              ))}
            </div>
            {canRestore && (
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoring}
                className="px-3 py-1.5 text-xs rounded-md disabled:opacity-50"
                style={{
                  background: 'var(--interactive-primary)',
                  color: 'var(--text-inverse)',
                }}
              >
                {restoring ? 'Restoring…' : 'Restore this version'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close diff"
              className="text-sm px-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              ✕
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-0">
          {loading && (
            <div className="px-5 py-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Loading version…
            </div>
          )}
          {!loading && view === 'preview' && (
            versionMarkdown.trim()
              ? <MarkdownPreview markdown={versionMarkdown} query="" activeMatch={0} onMatchCount={() => {}} />
              : <div className="px-5 py-8 text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>This version has no content.</div>
          )}
          {!loading && view === 'diff' && diff && diff.length === 0 && (
            <div
              className="px-5 py-8 text-sm text-center"
              style={{ color: 'var(--text-tertiary)' }}
            >
              No differences — this version matches the current doc.
            </div>
          )}
          {!loading && view === 'diff' && diff && diff.length > 0 && (
            <pre
              className="text-xs font-mono px-4 py-3 leading-relaxed"
              style={{ color: 'var(--text-primary)' }}
            >
              {diff.map((c, i) => (
                <div
                  key={i}
                  className={
                    c.type === 'add'
                      ? 'diff-add'
                      : c.type === 'remove'
                        ? 'diff-remove'
                        : 'diff-context'
                  }
                >
                  <span style={{ opacity: 0.5, marginRight: 8 }}>
                    {c.type === 'add' ? '+' : c.type === 'remove' ? '-' : ' '}
                  </span>
                  {c.text || ' '}
                </div>
              ))}
            </pre>
          )}
          {error && (
            <p
              className="px-5 py-3 text-xs"
              style={{ color: 'var(--danger-default)' }}
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
