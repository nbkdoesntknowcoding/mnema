import { useCallback, useEffect, useState } from 'react';
import type { Status } from '../../lib/prep-types';

const KEY = 'mnema:prep';

interface PrepState {
  bookmarks: Record<string, true>;
  status: Record<string, Status>;
}

function load(): PrepState {
  if (typeof window === 'undefined') return { bookmarks: {}, status: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { bookmarks: {}, status: {} };
    const parsed = JSON.parse(raw);
    return { bookmarks: parsed.bookmarks ?? {}, status: parsed.status ?? {} };
  } catch {
    return { bookmarks: {}, status: {} };
  }
}

function save(state: PrepState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — ignore */
  }
}

/** Bookmarks + per-question status, persisted to localStorage. */
export function usePrepProgress() {
  const [state, setState] = useState<PrepState>({ bookmarks: {}, status: {} });

  useEffect(() => { setState(load()); }, []);

  const update = useCallback((fn: (s: PrepState) => PrepState) => {
    setState((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  const toggleBookmark = useCallback((id: string) => {
    update((s) => {
      const bookmarks = { ...s.bookmarks };
      if (bookmarks[id]) delete bookmarks[id]; else bookmarks[id] = true;
      return { ...s, bookmarks };
    });
  }, [update]);

  const setStatus = useCallback((id: string, status: Status) => {
    update((s) => {
      const next = { ...s.status };
      if (status === 'new') delete next[id]; else next[id] = status;
      return { ...s, status: next };
    });
  }, [update]);

  const reset = useCallback(() => update(() => ({ bookmarks: {}, status: {} })), [update]);

  return {
    bookmarks: state.bookmarks,
    status: state.status,
    isBookmarked: (id: string) => !!state.bookmarks[id],
    statusOf: (id: string): Status => state.status[id] ?? 'new',
    toggleBookmark,
    setStatus,
    reset,
  };
}

export type PrepProgress = ReturnType<typeof usePrepProgress>;
