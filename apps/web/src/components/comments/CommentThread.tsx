import { type JSX, useState } from 'react';
import type { ThreadDTO } from './types';

interface Props {
  thread: ThreadDTO;
  /** PM absolute position of the thread's anchor, or null if orphaned. */
  anchorPmPos: number | null;
  /** Called after a successful mutation (reply / resolve / unresolve) so
   *  the parent can refetch + repaint anchors. */
  onChange: () => void;
  onHoverChange?: (threadId: string, hovering: boolean) => void;
}

/**
 * One thread card in the comments sidebar. Shows the original comment plus
 * any replies, with Reply / Resolve actions. Orphaned threads (anchor's
 * target was deleted) get a "⚠ Context removed" badge but stay readable.
 *
 * Author names are abbreviated to a 6-char id slug for now — a future
 * polish pass can hydrate this from /api/members once we cache that
 * map at the doc page level.
 */
export function CommentThread({ thread, anchorPmPos, onChange, onHoverChange }: Props): JSX.Element {
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orphaned = anchorPmPos === null;

  async function postReply(): Promise<void> {
    if (!replyBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ thread_id: thread.id, body: replyBody.trim() }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? 'Viewers cannot reply.' : 'Could not post reply.');
        return;
      }
      setReplyBody('');
      setReplying(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function toggleResolved(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/comment-threads/${thread.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ resolved: !thread.resolved }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? 'Viewers cannot resolve threads.' : 'Could not update.');
        return;
      }
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="rounded-md p-3"
      onMouseEnter={() => onHoverChange?.(thread.id, true)}
      onMouseLeave={() => onHoverChange?.(thread.id, false)}
      style={{
        background: 'var(--surface-overlay)',
        border: thread.resolved ? 'none' : '1px solid var(--border-default)',
        opacity: thread.resolved ? 0.55 : 1,
      }}
    >
      {orphaned && (
        <div
          className="text-xs mb-2 flex items-center gap-1"
          style={{ color: 'var(--warning-default)' }}
        >
          <span>⚠</span>
          <span>Context removed</span>
        </div>
      )}
      {thread.comments.map((c, i) => (
        <div
          key={c.id}
          className={i > 0 ? 'mt-3 pt-3' : ''}
          style={{ borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}
        >
          <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
            <span className="font-mono">{c.author_id.slice(0, 6)}</span>
            <span> · </span>
            <span>{formatDate(c.created_at)}</span>
          </div>
          <div
            className="text-sm whitespace-pre-wrap"
            style={{ color: 'var(--text-primary)' }}
          >
            {c.body}
          </div>
        </div>
      ))}
      <div className="mt-3 flex items-center gap-3">
        {!thread.resolved && !replying && (
          <button
            onClick={() => setReplying(true)}
            disabled={busy}
            className="text-xs hover:underline"
            style={{ color: 'var(--text-secondary)' }}
          >
            Reply
          </button>
        )}
        <button
          onClick={toggleResolved}
          disabled={busy}
          className="text-xs hover:underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          {thread.resolved ? 'Reopen' : 'Resolve'}
        </button>
      </div>
      {replying && (
        <div className="mt-3 space-y-2">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setReplying(false);
                setReplyBody('');
              } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void postReply();
              }
            }}
            placeholder="Add a reply…"
            className="w-full px-2 py-1.5 text-sm rounded-md focus:outline-none resize-none"
            style={{
              background: 'var(--surface-base)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
            }}
            rows={3}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={postReply}
              disabled={busy || !replyBody.trim()}
              className="px-3 py-1 text-xs rounded-md disabled:opacity-50"
              style={{ background: 'var(--interactive-primary)', color: 'var(--text-inverse)' }}
            >
              {busy ? 'Sending…' : 'Reply'}
            </button>
            <button
              onClick={() => {
                setReplying(false);
                setReplyBody('');
              }}
              className="px-3 py-1 text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--danger-default)' }}>
          {error}
        </p>
      )}
    </article>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}
