import { type JSX, useState } from 'react';

interface Props {
  docId: string;
  onSaved: () => void;
}

/**
 * Toolbar dropdown that lets the user name a manual snapshot of the
 * current doc. Sits next to the Versions toggle and shows the inline
 * input as a small popover when opened.
 *
 * Auto-snapshots happen every 50 store events under the hood (Phase 1.2
 * persistence), so this is for "name this milestone" use cases rather
 * than for routine saves.
 */
export function SaveVersionMenu({ docId, onSaved }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(): Promise<void> {
    if (!comment.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ doc_id: docId, comment: comment.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        setError(
          res.status === 403
            ? 'Viewers cannot save versions.'
            : `Save failed (${res.status})${body.error ? `: ${String(body.error)}` : ''}.`,
        );
        return;
      }
      // Show brief success state before closing.
      setSaved(true);
      setComment('');
      setTimeout(() => {
        setSaved(false);
        setOpen(false);
        onSaved();
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
          setSaved(false);
        }}
        className="text-sm px-3 py-1.5 rounded-md transition-colors"
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-default)',
          background: open ? 'var(--surface-selected)' : 'transparent',
          cursor: 'pointer',
        }}
        aria-expanded={open}
      >
        Save version
      </button>
      {open && (
        <div
          className="absolute right-0 w-72 p-3 rounded-md shadow-lg"
          style={{
            top: 'calc(100% + 6px)',
            background: 'var(--surface-overlay)',
            border: '1px solid var(--border-default)',
            zIndex: 200,
          }}
        >
          {saved ? (
            <div
              className="flex items-center gap-2 py-2 text-sm"
              style={{ color: 'var(--status-success)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Version saved!
            </div>
          ) : (
            <>
              <label
                className="block text-xs mb-1.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                What changed?
              </label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setOpen(false);
                    setComment('');
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder="e.g. Initial draft"
                maxLength={200}
                className="w-full px-2 py-1.5 text-sm rounded-md focus:outline-none"
                style={{
                  background: 'var(--surface-base)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
              {error && (
                <p className="mt-2 text-xs" style={{ color: 'var(--danger-default, #ef4444)' }}>
                  {error}
                </p>
              )}
              <div className="mt-2 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setComment('');
                    setError(null);
                  }}
                  className="px-3 py-1 text-xs"
                  style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={submitting || !comment.trim()}
                  className="px-3 py-1 text-xs rounded-md disabled:opacity-50"
                  style={{
                    background: 'var(--accent-primary, #6366f1)',
                    color: '#fff',
                    cursor: submitting || !comment.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
