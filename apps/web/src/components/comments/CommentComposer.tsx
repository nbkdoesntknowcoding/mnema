import { type JSX, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { pmPosToRelative } from './relative-position';

interface Props {
  view: EditorView;
  docId: string;
  selectionStart: number;
  selectionEnd: number;
  onPosted: () => void;
  onCancel: () => void;
}

/**
 * Inline composer rendered when a user with a selection presses ⌘⇧M.
 *
 * On submit we resolve the selection to start + end Yjs RelativePositions
 * (base64) via `pmPosToRelative` and POST to /api/comment-threads. If the
 * editor isn't fully synced yet (no binding) the anchor resolution returns
 * null and we bail with a console warning rather than posting a thread we
 * can't render.
 *
 * Positioning is fixed top-right for 4.2 — Phase 5 polish will absolute-
 * position near the selection via view.coordsAtPos.
 */
export function CommentComposer({
  view,
  docId,
  selectionStart,
  selectionEnd,
  onPosted,
  onCancel,
}: Props): JSX.Element {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (!body.trim()) return;
    const anchorStart = pmPosToRelative(view, selectionStart);
    const anchorEnd = pmPosToRelative(view, selectionEnd);
    if (!anchorStart || !anchorEnd) {
      // Mount race — sync plugin hasn't bound yet. Surface to the user
      // rather than silently posting a useless thread.
      setError('Editor not ready yet. Try again in a moment.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/comment-threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          doc_id: docId,
          anchor_start: anchorStart,
          anchor_end: anchorEnd,
          body: body.trim(),
        }),
      });
      if (!res.ok) {
        if (res.status === 403) {
          setError("Viewers can read comments but can't post them.");
        } else {
          setError('Could not post comment.');
        }
        return;
      }
      onPosted();
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <div
      className="absolute top-4 right-4 w-80 p-3 rounded-md shadow-lg z-40"
      style={{
        background: 'var(--surface-overlay)',
        border: '1px solid var(--border-default)',
      }}
    >
      <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
        New comment
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What's on your mind?"
        className="w-full px-2 py-1.5 text-sm rounded-md focus:outline-none resize-none"
        style={{
          background: 'var(--surface-base)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
        }}
        rows={3}
        autoFocus
      />
      {error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--danger-default)' }}>
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !body.trim()}
          className="px-3 py-1 text-xs rounded-md disabled:opacity-50"
          style={{
            background: 'var(--interactive-primary)',
            color: 'var(--text-inverse)',
          }}
        >
          {submitting ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
