import { useEffect, useState, useCallback } from 'react';
import { X, RotateCcw, CheckCircle, Clock } from 'lucide-react';
import { relativeTime } from '../../lib/relative-time';

interface VersionEntry {
  id: string;
  version_number: number;
  is_published: boolean;
  created_at: string;
  created_by: { id: string | null; display_name: string | null; email: string | null };
  publish_message: string | null;
  node_count: number;
  edge_count: number;
  is_current_draft: boolean;
  is_published_version: boolean;
}

interface Props {
  flowId: string;
  onClose: () => void;
  onRestored: () => void;
}

export function VersionHistoryPanel({ flowId, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/flows/${flowId}/versions?limit=50`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((data) => setVersions(data.versions ?? []))
      .catch(() => setError('Could not load version history.'))
      .finally(() => setLoading(false));
  }, [flowId]);

  useEffect(() => { load(); }, [load]);

  const handleRestore = async (v: VersionEntry) => {
    if (!confirm(`Restore v${v.version_number}? This creates a new draft based on that version.`)) return;
    setRestoring(v.id);
    try {
      const res = await fetch(`/api/flows/${flowId}/restore-version`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version_id: v.id }),
      });
      if (!res.ok) throw new Error('Failed to restore');
      onRestored();
      onClose();
    } catch {
      alert('Failed to restore version. Please try again.');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <aside
      className="w-[320px] h-full border-l border-[var(--line)] bg-[var(--surface)] flex flex-col"
      style={{ boxShadow: '-24px 0 60px rgba(0,0,0,.45)' }}
    >
      {/* header — matches NodeInspector */}
      <div className="flex items-center justify-between px-5 h-14 border-b border-[var(--line)] shrink-0">
        <div className="flex items-center gap-2">
          <Clock size={14} strokeWidth={1.75} className="text-[var(--ink-soft)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            Version history
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors"
          aria-label="Close history"
        >
          <X size={15} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-5 py-6 text-[12px] text-[var(--ink-muted)]">Loading…</div>
        )}

        {!loading && error && (
          <div className="px-5 py-6">
            <p className="text-[12.5px] text-[var(--status-warn)]">{error}</p>
            <button onClick={load} className="mt-2 text-[12px] text-[var(--ink-soft)] hover:text-[var(--ink)] underline">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && versions.length === 0 && (
          <div className="px-5 py-10 text-center">
            <Clock size={22} strokeWidth={1.5} className="mx-auto text-[var(--ink-faint)]" />
            <p className="mt-3 text-[13px] font-medium text-[var(--ink)]">No versions yet</p>
            <p className="mt-1 text-[12px] text-[var(--ink-muted)] leading-[1.5]">
              A version is snapshotted every time you <strong className="text-[var(--ink-soft)]">Publish</strong>.
              Publish this flow to start its history.
            </p>
          </div>
        )}

        {versions.map((v) => (
          <div
            key={v.id}
            className="px-5 py-3 border-b border-[var(--line)] hover:bg-[var(--surface-2)] transition-colors group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[12.5px] font-medium text-[var(--ink)]">v{v.version_number}</span>
                  {v.is_published_version && (
                    <span className="inline-flex items-center gap-1 text-[9.5px] font-mono uppercase tracking-[0.08em] text-[var(--status-sync)]">
                      <CheckCircle size={9} strokeWidth={2} />
                      published
                    </span>
                  )}
                  {v.is_current_draft && !v.is_published_version && (
                    <span className="text-[9.5px] font-mono uppercase tracking-[0.08em] text-[var(--ink-muted)]">
                      current draft
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--ink-muted)]">
                  {relativeTime(new Date(v.created_at))}
                  {v.created_by.display_name && (
                    <span className="text-[var(--ink-faint)]"> · {v.created_by.display_name}</span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">
                  {v.node_count} node{v.node_count !== 1 ? 's' : ''} · {v.edge_count} edge{v.edge_count !== 1 ? 's' : ''}
                </div>
                {v.publish_message && (
                  <div className="text-[11px] text-[var(--ink-soft)] mt-1 italic truncate" title={v.publish_message}>
                    "{v.publish_message}"
                  </div>
                )}
              </div>

              {!v.is_current_draft && (
                <button
                  type="button"
                  onClick={() => handleRestore(v)}
                  disabled={restoring === v.id}
                  className="shrink-0 opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-[opacity,color] disabled:opacity-40"
                  title={`Restore v${v.version_number}`}
                >
                  <RotateCcw size={11} strokeWidth={1.75} />
                  {restoring === v.id ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
