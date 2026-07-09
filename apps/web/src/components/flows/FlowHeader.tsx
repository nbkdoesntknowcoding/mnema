import { useEffect, useState } from 'react';
import { Play, ArrowLeft, Clock, CheckCircle, AlertCircle, Loader2, Save, Share2, Copy, Check, Globe } from 'lucide-react';
import { Button } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';
import { MonoLabel } from '../ui/typography';
import type { Flow } from './FlowCanvas';
import { relativeTime } from '../../lib/relative-time';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  flow: Flow;
  onWalkClick: () => void;
  saveState: SaveState;
  saveError?: string | null;
  isDirty: boolean;
  onSaveNow: () => void;
  lastSavedAt: Date | null;
  hasUnpublishedChanges: boolean;
  historyOpen: boolean;
  onHistoryToggle: () => void;
  onPublishClick: () => void;
}

export function FlowHeader({
  flow,
  onWalkClick,
  saveState,
  saveError,
  isDirty,
  onSaveNow,
  lastSavedAt,
  hasUnpublishedChanges,
  historyOpen,
  onHistoryToggle,
  onPublishClick,
}: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  return (
    <div className="shrink-0 bg-[var(--surface)] border-b border-[var(--line)] z-10">
      <div className="flex items-center justify-between px-6 h-14">
        <div className="flex items-center gap-4">
          <a
            href="/app/flows"
            className="flex items-center gap-1.5 text-[13px] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            All flows
          </a>
          <div className="h-4 w-px bg-[var(--line-strong)]" />
          <div className="flex items-center gap-3">
            <h1 className="text-[14px] font-medium text-[var(--ink)]">{flow.name}</h1>
            {flow.is_published ? (
              <StatusPill tone="success">Published</StatusPill>
            ) : (
              <StatusPill tone="neutral">Draft</StatusPill>
            )}
            {hasUnpublishedChanges && (
              <StatusPill tone="warning">Unsaved changes</StatusPill>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Save state indicator */}
          <div className="flex items-center gap-1.5 text-[12px]">
            {saveState === 'saving' && (
              <span className="flex items-center gap-1 text-[var(--ink-muted)]">
                <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />
                Saving…
              </span>
            )}
            {saveState === 'saved' && lastSavedAt && (
              <span className="flex items-center gap-1 text-[var(--ink-muted)]">
                <CheckCircle size={11} strokeWidth={1.75} className="text-[var(--status-success)]" />
                Saved {relativeTime(lastSavedAt)}
              </span>
            )}
            {saveState === 'error' && (
              <span
                className="flex items-center gap-1 text-[var(--status-error)] cursor-pointer hover:opacity-80"
                onClick={onSaveNow}
                title={saveError ?? 'Save failed — click to retry'}
              >
                <AlertCircle size={11} strokeWidth={1.75} />
                {saveError ? saveError.slice(0, 40) + (saveError.length > 40 ? '…' : '') : 'Save failed'} — Retry
              </span>
            )}
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={onSaveNow}
            disabled={!isDirty || saveState === 'saving'}
            title="Save draft now"
          >
            <Save size={12} strokeWidth={1.75} />
            Save
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={onWalkClick}
            disabled={!flow.is_published}
          >
            <Play size={12} strokeWidth={2} />
            Walk
          </Button>

          <Button
            variant={historyOpen ? 'primary' : 'secondary'}
            size="sm"
            onClick={onHistoryToggle}
            title="Version history"
          >
            <Clock size={12} strokeWidth={1.75} />
            History
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShareOpen(true)}
            title="Share this flow with anyone on Mnema"
          >
            <Share2 size={12} strokeWidth={1.75} />
            Share
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCommunityOpen(true)}
            title="Publish this flow to the community"
          >
            <Globe size={12} strokeWidth={1.75} />
            Community
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onPublishClick}
            disabled={!hasUnpublishedChanges && flow.is_published}
          >
            Publish
          </Button>
        </div>
      </div>

      {shareOpen && <ShareFlowModal flow={flow} onClose={() => setShareOpen(false)} />}
      {communityOpen && <PublishToCommunityModal flow={flow} onClose={() => setCommunityOpen(false)} />}

      {flow.description && (
        <div className="px-6 pb-3 text-[12px] text-[var(--ink-muted)] leading-[1.5] max-w-3xl">
          {flow.description}
        </div>
      )}
    </div>
  );
}

function ShareFlowModal({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Enabling the share link is idempotent — POST returns the existing token or
  // mints one. We do it on open so the link is ready to copy immediately.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/flows/${flow.id}/share`, { method: 'POST' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { url: string };
        setUrl(body.url);
      } catch {
        setErr('Could not create a share link. Try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [flow.id]);

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }
  async function stopSharing() {
    await fetch(`/api/flows/${flow.id}/share`, { method: 'DELETE' }).catch(() => {});
    onClose();
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="w-[min(520px,92vw)] rounded-2xl p-5"
        style={{ background: 'var(--surface-2, #16161a)', border: '0.5px solid var(--line)' }}
      >
        <h2 className="text-[16px] font-medium" style={{ color: 'var(--ink)' }}>Share “{flow.name}”</h2>
        <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          Anyone with a Mnema account who has this link can view the published flow (read-only).
        </p>

        {!flow.is_published && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--amber, #f0997b)' }}>
            Heads up: this flow isn’t published yet, so people you share with will see an empty flow until you publish.
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <input
            readOnly
            value={loading ? 'Creating link…' : (url ?? '')}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 h-9 px-3 rounded-md text-[12.5px] outline-none"
            style={{ background: 'var(--surface-input, rgba(255,255,255,0.04))', color: 'var(--ink)', border: '0.5px solid var(--line)' }}
          />
          <Button variant="secondary" size="sm" onClick={copy} disabled={!url}>
            {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.75} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        {err && <p className="mt-2 text-[12px]" style={{ color: 'var(--red, #f87171)' }}>{err}</p>}

        <div className="mt-5 flex items-center justify-between">
          <button onClick={stopSharing} className="text-[12px]" style={{ color: 'var(--ink-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Stop sharing
          </button>
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

function PublishToCommunityModal({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const [tagInput, setTagInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function publish() {
    setSubmitting(true);
    setErr(null);
    try {
      const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
      const res = await fetch(`/api/flows/${flow.id}/publish-to-community`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      if (res.status === 400) { setErr('Publishing to the community hub is not configured on this instance.'); return; }
      if (res.status === 409) { setErr('Publish a version of this flow first, then publish it to the community.'); return; }
      if (res.status === 403) { setErr('Only workspace owners, admins, and editors can publish.'); return; }
      if (!res.ok) { setErr('Publish failed. Try again.'); return; }
      const body = (await res.json()) as { community_url: string };
      setPublishedUrl(body.community_url);
    } finally {
      setSubmitting(false);
    }
  }

  async function unpublish() {
    await fetch(`/api/flows/${flow.id}/publish-to-community`, { method: 'DELETE' }).catch(() => {});
    onClose();
  }

  async function copy() {
    if (!publishedUrl) return;
    try { await navigator.clipboard.writeText(publishedUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="w-[min(520px,92vw)] rounded-2xl p-5"
        style={{ background: 'var(--surface-2, #16161a)', border: '0.5px solid var(--line)' }}
      >
        <h2 className="text-[16px] font-medium" style={{ color: 'var(--ink)' }}>Publish “{flow.name}” to the community</h2>
        <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          Your flow’s structure and instructions become public and importable by anyone. Doc and folder
          references are <strong>stripped</strong> — no content from your workspace is shared; importers re-bind their own.
        </p>

        {!flow.is_published && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--amber, #f0997b)' }}>
            Publish a version of this flow first — only the published version is uploaded.
          </p>
        )}

        {publishedUrl ? (
          <>
            <p className="mt-4 text-[12.5px]" style={{ color: 'var(--ink)' }}>Published. Anyone can now find it here:</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={publishedUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 h-9 px-3 rounded-md text-[12.5px] outline-none"
                style={{ background: 'var(--surface-input, rgba(255,255,255,0.04))', color: 'var(--ink)', border: '0.5px solid var(--line)' }}
              />
              <Button variant="secondary" size="sm" onClick={copy}>
                {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.75} />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button onClick={unpublish} className="text-[12px]" style={{ color: 'var(--ink-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                Unpublish
              </button>
              <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
            </div>
          </>
        ) : (
          <>
            <label className="mt-4 block text-[11px]" style={{ color: 'var(--ink-muted)' }}>Tags (comma-separated)</label>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="research, onboarding, qa"
              className="mt-1.5 w-full h-9 px-3 rounded-md text-[12.5px] outline-none"
              style={{ background: 'var(--surface-input, rgba(255,255,255,0.04))', color: 'var(--ink)', border: '0.5px solid var(--line)' }}
            />
            {err && <p className="mt-3 text-[12px]" style={{ color: 'var(--red, #f87171)' }}>{err}</p>}
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={publish} disabled={submitting || !flow.is_published}>
                {submitting ? 'Publishing…' : 'Publish to community'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
