import { useEffect, useState } from 'react';
import { X, CheckCircle, Plus, Minus, Edit2 } from 'lucide-react';
import { MonoLabel } from '../ui/typography';
import { Button } from '../ui/Button';

interface PublishPreview {
  added_nodes: string[];
  removed_nodes: string[];
  changed_nodes: string[];
  added_edges: number;
  removed_edges: number;
}

interface Props {
  flowId: string;
  onClose: () => void;
  onPublished: () => void;
}

export function PublishModal({ flowId, onClose, onPublished }: Props) {
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch(`/api/flows/${flowId}/publish-preview`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) return null;
        return r.json() as Promise<PublishPreview>;
      })
      .then((data) => {
        if (data && 'added_nodes' in data) setPreview(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [flowId]);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ publish_message: message || undefined }),
      });
      if (!res.ok) throw new Error('Failed to publish');
      onPublished();
      onClose();
    } catch {
      alert('Failed to publish. Please try again.');
    } finally {
      setPublishing(false);
    }
  };

  const hasChanges =
    preview &&
    (preview.added_nodes.length > 0 ||
      preview.removed_nodes.length > 0 ||
      preview.changed_nodes.length > 0 ||
      preview.added_edges > 0 ||
      preview.removed_edges > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[480px] max-h-[80vh] bg-[var(--surface-overlay)] border border-[var(--border-strong)] rounded-[var(--radius-lg)] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} strokeWidth={1.75} className="text-[var(--status-success)]" />
            <h2 className="text-[15px] font-medium text-[var(--text-primary)]">Publish flow</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading && (
            <div className="text-[12px] text-[var(--text-quaternary)]">Computing diff…</div>
          )}

          {!loading && !preview && (
            <p className="text-[13px] text-[var(--text-secondary)]">
              This will be the first published version of this flow.
            </p>
          )}

          {!loading && preview && (
            <>
              <div>
                <MonoLabel className="block mb-2 text-[var(--text-tertiary)]">What changes</MonoLabel>
                {!hasChanges ? (
                  <p className="text-[13px] text-[var(--text-secondary)]">No changes from current published version.</p>
                ) : (
                  <div className="space-y-1.5">
                    {preview.added_nodes.map((name) => (
                      <div key={`add-${name}`} className="flex items-center gap-2 text-[12px]">
                        <Plus size={11} strokeWidth={2.5} className="text-[var(--status-success)] shrink-0" />
                        <span className="text-[var(--text-primary)]">{name}</span>
                        <MonoLabel className="text-[var(--text-quaternary)]">added</MonoLabel>
                      </div>
                    ))}
                    {preview.removed_nodes.map((name) => (
                      <div key={`rm-${name}`} className="flex items-center gap-2 text-[12px]">
                        <Minus size={11} strokeWidth={2.5} className="text-[var(--status-error)] shrink-0" />
                        <span className="text-[var(--text-primary)]">{name}</span>
                        <MonoLabel className="text-[var(--text-quaternary)]">removed</MonoLabel>
                      </div>
                    ))}
                    {preview.changed_nodes.map((name) => (
                      <div key={`ch-${name}`} className="flex items-center gap-2 text-[12px]">
                        <Edit2 size={11} strokeWidth={1.75} className="text-[var(--text-tertiary)] shrink-0" />
                        <span className="text-[var(--text-primary)]">{name}</span>
                        <MonoLabel className="text-[var(--text-quaternary)]">changed</MonoLabel>
                      </div>
                    ))}
                    {(preview.added_edges > 0 || preview.removed_edges > 0) && (
                      <div className="text-[12px] text-[var(--text-tertiary)] mt-1">
                        {preview.added_edges > 0 && `+${preview.added_edges} edge${preview.added_edges !== 1 ? 's' : ''}`}
                        {preview.added_edges > 0 && preview.removed_edges > 0 && ', '}
                        {preview.removed_edges > 0 && `-${preview.removed_edges} edge${preview.removed_edges !== 1 ? 's' : ''}`}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <MonoLabel className="block mb-1.5 text-[var(--text-tertiary)]">
                  Publish note <span className="text-[var(--text-quaternary)] font-normal">(optional)</span>
                </MonoLabel>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What changed in this version…"
                  rows={3}
                  className="w-full px-3 py-2 text-[13px] bg-[var(--surface-sunken)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)] outline-none focus:border-[var(--border-strong)] resize-none transition-colors"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-subtle)]">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={publishing}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handlePublish}
            disabled={publishing || loading}
          >
            {publishing ? 'Publishing…' : 'Publish now'}
          </Button>
        </div>
      </div>
    </div>
  );
}
