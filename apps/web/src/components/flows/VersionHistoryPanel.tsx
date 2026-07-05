import { useEffect, useState, useCallback } from 'react';
import { X, RotateCcw, CheckCircle, Clock } from 'lucide-react';
import { MonoLabel } from '../ui/typography';
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
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/flows/${flowId}/versions?limit=50`)
      .then((r) => r.json())
      .then((data) => setVersions(data.versions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [flowId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRestore = async (v: VersionEntry) => {
    if (!confirm(`Restore v${v.version_number}? This will create a new draft based on that version.`)) return;
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
    <aside className="w-[300px] h-full border-l border-[var(--border-subtle)] bg-[var(--surface-overlay)] flex flex-col">
      <div className="flex items-center justify-between px-5 h-14 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <Clock size={14} strokeWidth={1.75} className="text-[var(--text-secondary)]" />
          <MonoLabel>Version history</MonoLabel>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Close history"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-5 py-6 text-[12px] text-[var(--text-quaternary)]">Loading…</div>
        )}
        {!loading && versions.length === 0 && (
          <div className="px-5 py-6 text-[12px] text-[var(--text-quaternary)] italic">
            No versions yet
          </div>
        )}
        {versions.map((v) => (
          <div
            key={v.id}
            className="px-5 py-3 border-b border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] transition-colors group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">
                    v{v.version_number}
                  </span>
                  {v.is_published_version && (
                    <span className="flex items-center gap-0.5 text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--status-success)]">
                      <CheckCircle size={9} strokeWidth={2} />
                      published
                    </span>
                  )}
                  {v.is_current_draft && !v.is_published_version && (
                    <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                      current
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--text-tertiary)]">
                  {relativeTime(new Date(v.created_at))}
                  {v.created_by.display_name && (
                    <span className="text-[var(--text-quaternary)]"> · {v.created_by.display_name}</span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--text-quaternary)] mt-0.5">
                  {v.node_count} node{v.node_count !== 1 ? 's' : ''} · {v.edge_count} edge{v.edge_count !== 1 ? 's' : ''}
                </div>
                {v.publish_message && (
                  <div className="text-[11px] text-[var(--text-secondary)] mt-1 italic truncate">
                    "{v.publish_message}"
                  </div>
                )}
              </div>

              {!v.is_current_draft && (
                <button
                  type="button"
                  onClick={() => handleRestore(v)}
                  disabled={restoring === v.id}
                  className="shrink-0 opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-[opacity,color] disabled:opacity-40"
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
