import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { CommentThread } from './CommentThread';
import { relativeToPmPos } from './relative-position';
import { setCommentAnchors, type AnchorRange } from './CommentAnchorPlugin';
import type { ThreadDTO } from './types';

interface Props {
  docId: string;
  view: EditorView | null;
  open: boolean;
  onClose: () => void;
  /** Bumped externally (by the parent) when a new comment was just created
   *  so the sidebar refetches immediately instead of waiting for the poll. */
  refreshKey?: number;
  /** Notify parent of the current open-thread count for header badging. */
  onUnresolvedCountChange?: (count: number) => void;
}

const POLL_INTERVAL_MS = 5000;

/**
 * Right-rail sidebar listing all open (unresolved) comment threads for the
 * current doc. Polls /api/comment-threads every 5 seconds (the 4.2 contract
 * — Phase 5 may swap this for a push channel).
 *
 * For each thread we resolve the stored RelativePosition back to a current
 * ProseMirror absolute position via the y-prosemirror helpers. Threads
 * whose anchor target was deleted resolve to null and are surfaced as
 * orphaned ("⚠ Context removed") rather than hidden — Phase 4 spec.
 *
 * The list is ordered by anchor position (top-of-doc first), with orphans
 * falling to the bottom.
 */
export function CommentsSidebar({
  docId,
  view,
  open,
  onClose,
  refreshKey,
  onUnresolvedCountChange,
}: Props): JSX.Element | null {
  const [threads, setThreads] = useState<ThreadDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverThreadId, setHoverThreadId] = useState<string | null>(null);
  // Refs used by the poll loop so we don't have to redeclare the effect
  // on every threads/loading change.
  const mountedRef = useRef(true);

  const fetchThreads = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/comment-threads?doc_id=${docId}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const body = (await res.json()) as { threads: ThreadDTO[] };
      if (!mountedRef.current) return;
      setThreads(body.threads ?? []);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [docId]);

  // Poll while open. Closed sidebars don't poll — wasted bytes.
  useEffect(() => {
    mountedRef.current = true;
    if (!open) {
      return () => {
        mountedRef.current = false;
      };
    }
    void fetchThreads();
    const interval = window.setInterval(() => {
      void fetchThreads();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      mountedRef.current = false;
    };
  }, [open, fetchThreads]);

  // External refresh trigger (composer just posted a new thread).
  // fetchThreads is memoized on docId so its identity is stable across
  // renders that don't change the doc, which keeps this effect quiet
  // outside of explicit refreshKey bumps.
  useEffect(() => {
    if (!open) return;
    void fetchThreads();
  }, [refreshKey, open, fetchThreads]);

  // Compute the [{thread, pmPos}] list once per render. Threads whose
  // anchor resolves to null are orphaned and pushed to the end.
  const orderedThreads = useMemo(() => {
    const items = threads.map((t) => ({
      thread: t,
      pmPos: view ? relativeToPmPos(view, t.anchor_start) : null,
    }));
    items.sort((a, b) => {
      const ax = a.pmPos ?? Number.POSITIVE_INFINITY;
      const bx = b.pmPos ?? Number.POSITIVE_INFINITY;
      return ax - bx;
    });
    return items;
  }, [threads, view]);

  // Push the active anchor ranges into the ProseMirror decoration plugin.
  // Re-runs on every poll tick (cheap — the plugin diffs by reference and
  // only repaints if the array shape changed).
  useEffect(() => {
    if (!view) return;
    const ranges: AnchorRange[] = [];
    for (const { thread, pmPos } of orderedThreads) {
      if (pmPos === null) continue; // orphaned — no highlight to render
      const endPos = relativeToPmPos(view, thread.anchor_end) ?? pmPos;
      const from = Math.min(pmPos, endPos);
      const to = Math.max(pmPos, endPos);
      if (from === to) continue;
      ranges.push({
        from,
        to,
        threadId: thread.id,
        active: hoverThreadId === thread.id,
      });
    }
    setCommentAnchors(view, ranges);
  }, [orderedThreads, hoverThreadId, view]);

  // Notify parent of the unresolved count for header badging.
  useEffect(() => {
    onUnresolvedCountChange?.(threads.length);
  }, [threads.length, onUnresolvedCountChange]);

  if (!open) return null;

  return (
    <aside
      className="fixed top-0 right-0 bottom-0 w-96 flex flex-col z-40"
      style={{
        background: 'var(--surface-base)',
        borderLeft: '1px solid var(--border-default)',
      }}
    >
      <header
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border-default)' }}
      >
        <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Comments
        </h2>
        <button
          onClick={onClose}
          aria-label="Close comments sidebar"
          className="text-sm"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading && (
          <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Loading…
          </div>
        )}
        {!loading && orderedThreads.length === 0 && (
          <div
            className="text-sm text-center py-8"
            style={{ color: 'var(--text-tertiary)' }}
          >
            No comments yet.
            <br />
            Select text and press ⌘⇧M to start one.
          </div>
        )}
        {orderedThreads.map(({ thread, pmPos }) => (
          <CommentThread
            key={thread.id}
            thread={thread}
            anchorPmPos={pmPos}
            onChange={fetchThreads}
            onHoverChange={(id, hovering) => setHoverThreadId(hovering ? id : null)}
          />
        ))}
      </div>
    </aside>
  );
}
