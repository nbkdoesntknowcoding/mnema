import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { VersionItem } from './VersionItem';
import type { VersionRow } from './types';

interface Props {
  docId: string;
  open: boolean;
  onClose: () => void;
  /** Called when a version row is clicked; parent owns the diff overlay. */
  onSelectVersion: (version: number) => void;
  selectedVersion: number | null;
  /** Bumped externally after a Save / Restore so the list refetches. */
  refreshKey?: number;
}

const POLL_INTERVAL_MS = 15_000; // re-check for new AI-written versions every 15 s

/**
 * Right-rail sidebar listing every snapshot in `doc_versions` for this doc.
 *
 * Auto-snapshots are written by the collab process every 50 store events
 * (Phase 1.2). Manual snapshots are written by the Save version button.
 * We fetch on open, whenever `refreshKey` bumps, and every 15 s while open
 * so AI-written versions appear without requiring a sidebar close/reopen.
 */
export function VersionsSidebar({
  docId,
  open,
  onClose,
  onSelectVersion,
  selectedVersion,
  refreshKey,
}: Props): JSX.Element | null {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchVersions = useCallback(
    async (isInitial: boolean) => {
      try {
        const res = await fetch(`/api/doc-versions?doc_id=${docId}`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const body = (await res.json()) as { versions: VersionRow[] };
        setVersions(body.versions ?? []);
      } finally {
        if (isInitial) setLoading(false);
      }
    },
    [docId],
  );

  // Fetch on open / refreshKey change, start polling while open.
  useEffect(() => {
    if (!open) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }

    setLoading(true);
    void fetchVersions(true);

    pollRef.current = setInterval(() => {
      void fetchVersions(false);
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [docId, open, refreshKey, fetchVersions]);

  if (!open) return null;

  return (
    <aside
      className="fixed top-0 right-0 bottom-0 w-80 flex flex-col z-40"
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
          Versions
        </h2>
        <button
          onClick={onClose}
          aria-label="Close versions sidebar"
          className="text-sm"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="px-4 py-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Loading…
          </div>
        )}
        {!loading && versions.length === 0 && (
          <div
            className="px-4 py-8 text-sm text-center"
            style={{ color: 'var(--text-tertiary)' }}
          >
            No saved versions yet.
            <br />
            Edits auto-snapshot every 50 changes.
          </div>
        )}
        {versions.map((v) => (
          <VersionItem
            key={v.version}
            version={v}
            selected={selectedVersion === v.version}
            onClick={() => onSelectVersion(v.version)}
          />
        ))}
      </div>
    </aside>
  );
}
