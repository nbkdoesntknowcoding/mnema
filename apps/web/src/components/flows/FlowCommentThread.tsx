import { useState } from 'react';
import { NodeToolbar, Position, type Node } from '@xyflow/react';
import { FLOW_TOKENS as T } from './tokens';
import type { FlowComment } from './useFlowComments';

function initials(name: string): string {
  const base = (name.split('@')[0] ?? name);
  const p = base.split(/[.\s_-]+/).filter(Boolean);
  return ((p[0]?.[0] ?? base[0] ?? '?') + (p[1]?.[0] ?? '')).toUpperCase();
}
function ago(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Screen-anchored comment thread popover for a node (anchored via NodeToolbar). */
export function FlowCommentThread({ node, comments, onSubmit, onClose }: {
  node: Node;
  comments: FlowComment[];
  onSubmit: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await onSubmit(body); setDraft(''); } catch { /* keep draft */ } finally { setBusy(false); }
  };

  return (
    <NodeToolbar nodeId={node.id} isVisible position={Position.Right} offset={16} className="nodrag nopan nowheel">
      <div style={{
        width: 290, background: 'var(--surface-2)', border: '1px solid var(--line-strong)', borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,.7)', overflow: 'hidden', textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: '.12em', color: 'var(--ink-muted)' }}>
            THREAD · {comments.length}
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer', lineHeight: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div style={{ maxHeight: 220, overflowY: 'auto', padding: comments.length ? '10px 12px' : '16px 12px' }}>
          {comments.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>No comments yet. Start the thread.</p>
          ) : comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <span style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)',
                color: 'var(--on-ink)', fontFamily: T.fontUI, fontSize: 9, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{initials(c.author.name)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontFamily: T.fontUI, fontSize: 11.5, fontWeight: 600, color: 'var(--ink)' }}>{c.author.name.split('@')[0]}</span>
                  <span style={{ fontFamily: T.fontMono, fontSize: 9.5, color: 'var(--ink-faint)' }}>{ago(c.created_at)}</span>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.45, margin: '2px 0 0', wordBreak: 'break-word' }}>{c.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderTop: '1px solid var(--line)' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            placeholder="Reply…"
            autoFocus
            style={{
              flex: 1, minWidth: 0, height: 30, padding: '0 10px', fontSize: 12.5,
              background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)',
              borderRadius: 7, outline: 'none',
            }}
          />
          <button
            onClick={() => void submit()}
            disabled={!draft.trim() || busy}
            style={{
              fontFamily: T.fontUI, fontSize: 12, fontWeight: 500, color: 'var(--on-ink)',
              background: 'var(--accent)', border: 'none', borderRadius: 7, padding: '0 12px',
              cursor: draft.trim() && !busy ? 'pointer' : 'not-allowed', opacity: draft.trim() && !busy ? 1 : 0.5,
            }}
          >{busy ? '…' : 'Send'}</button>
        </div>
      </div>
    </NodeToolbar>
  );
}
