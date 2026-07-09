/**
 * Community flow detail + import (Community Flows — Phase 3, P3-2).
 * Read-only preview of a hub template, "Use this flow" import, and report.
 */
import { type JSX, useEffect, useState } from 'react';

const ink = 'var(--ink, #e7e7e9)';
const soft = 'var(--ink-soft, #a1a1aa)';
const muted = 'var(--ink-muted, #71717a)';
const line = 'var(--line, rgba(255,255,255,0.1))';
const surface = 'var(--surface, rgba(255,255,255,0.02))';

const KIND_COLOR: Record<string, string> = {
  doc: '#6ea8fe', docs: '#6ea8fe', instruction: '#f0997b', decision: '#34d399', capture: '#c084fc',
};

interface PNode {
  clientNodeId: string;
  kind: string;
  title: string;
  positionX: number;
  positionY: number;
  data: Record<string, unknown>;
}
interface PEdge { fromNodeId: string; toNodeId: string; fromSocket: string }
interface Detail {
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  schema_version: number;
  template_json: { nodes: PNode[]; edges: PEdge[] };
  node_count: number;
  import_count: number;
  publisher_handle: string | null;
}

export function CommunityFlowDetail({ slug }: { slug: string }): JSX.Element {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/community/flows/${encodeURIComponent(slug)}`, { credentials: 'include' });
        if (res.status === 404) { setErr('This community flow was not found or has been removed.'); return; }
        if (!res.ok) throw new Error(String(res.status));
        setDetail((await res.json()) as Detail);
      } catch {
        setErr('Could not load this community flow.');
      }
    })();
  }, [slug]);

  async function doImport(): Promise<void> {
    setImporting(true);
    try {
      const res = await fetch(`/api/community/flows/${encodeURIComponent(slug)}/import`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (res.status === 403) { alert('Only workspace editors can import flows.'); return; }
      if (!res.ok) { alert('Import failed.'); return; }
      const body = (await res.json()) as { flow_slug: string };
      window.location.href = `/app/flows/${body.flow_slug}?imported=1`;
    } finally {
      setImporting(false);
    }
  }

  async function doReport(reason: string): Promise<void> {
    setReporting(true);
    try {
      await fetch(`/api/community/flows/${encodeURIComponent(slug)}/report`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      alert('Thanks — this flow has been reported.');
    } finally {
      setReporting(false);
    }
  }

  if (err) return <div style={{ maxWidth: 720, margin: '0 auto', padding: 48, color: soft, fontSize: 14 }}>{err}</div>;
  if (!detail) return <div style={{ maxWidth: 720, margin: '0 auto', padding: 48, color: muted, fontSize: 14 }}>Loading…</div>;

  const nodes = detail.template_json.nodes ?? [];
  const edges = detail.template_json.edges ?? [];
  const ordered = [...nodes].sort((a, b) => a.positionY - b.positionY || a.positionX - b.positionX);
  const titleOf = new Map(nodes.map((n) => [n.clientNodeId, n.title]));
  const nextOf = new Map<string, string[]>();
  for (const e of edges) {
    const arr = nextOf.get(e.fromNodeId) ?? [];
    arr.push(e.toNodeId);
    nextOf.set(e.fromNodeId, arr);
  }
  const bindCount = nodes.filter((n) => n.data && n.data.requiresBinding).length;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div style={{ fontSize: 11, color: muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Community flow · read-only
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
        <div>
          <h1 style={{ margin: 0, font: '500 26px/1.2 var(--sans)', letterSpacing: '-0.02em', color: ink }}>{detail.name}</h1>
          {detail.description && <p style={{ margin: '8px 0 0', fontSize: 14, color: soft, maxWidth: '40rem' }}>{detail.description}</p>}
          <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 12, color: muted }}>
            <span>{detail.node_count} steps</span>
            <span>↓ {detail.import_count} imports</span>
            {detail.publisher_handle && <span>by @{detail.publisher_handle}</span>}
          </div>
        </div>
        <button
          onClick={() => void doImport()}
          disabled={importing}
          style={{
            flexShrink: 0, marginTop: 4, padding: '9px 14px', borderRadius: 7, cursor: 'pointer',
            background: ink, color: 'var(--on-ink, #0b0b0d)', border: 0, font: '500 13px/1 var(--sans)',
            opacity: importing ? 0.6 : 1,
          }}
        >
          {importing ? 'Importing…' : 'Use this flow'}
        </button>
      </div>

      {detail.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
          {detail.tags.map((t) => (
            <span key={t} style={{ fontSize: 11, color: muted, background: 'var(--surface-2, rgba(255,255,255,0.05))', padding: '3px 8px', borderRadius: 5 }}>{t}</span>
          ))}
        </div>
      )}

      {bindCount > 0 && (
        <div style={{ marginTop: 18, padding: '10px 14px', borderRadius: 8, background: 'rgba(240,153,123,0.08)', border: '1px solid rgba(240,153,123,0.28)', fontSize: 13, color: 'var(--status-edit, #f0997b)' }}>
          {bindCount} step{bindCount === 1 ? '' : 's'} reference docs or folders. After importing, you'll pick your own
          workspace docs to bind them — no content from the original workspace is included.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 26 }}>
        {ordered.map((n, i) => {
          const instr = typeof n.data?.instruction === 'string' ? n.data.instruction
            : typeof n.data?.text === 'string' ? (n.data.text as string) : null;
          const nexts = (nextOf.get(n.clientNodeId) ?? []).map((id) => titleOf.get(id) ?? id);
          const needsBind = Boolean(n.data?.requiresBinding);
          return (
            <div key={n.clientNodeId} style={{ padding: '14px 16px', borderRadius: 12, background: surface, border: `0.5px solid ${line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: muted, fontFamily: 'var(--mono, monospace)' }}>{i + 1}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: KIND_COLOR[n.kind] ?? muted }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: KIND_COLOR[n.kind] ?? '#6b7280' }} />
                  {n.kind}
                </span>
                <span style={{ fontSize: 14, color: ink, fontWeight: 500 }}>{n.title}</span>
                {needsBind && (
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--status-edit, #f0997b)', border: '1px solid rgba(240,153,123,0.4)', borderRadius: 999, padding: '2px 7px' }}>
                    needs binding
                  </span>
                )}
              </div>
              {instr && <div style={{ marginTop: 6, fontSize: 12.5, color: soft, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{instr}</div>}
              {nexts.length > 0 && <div style={{ marginTop: 8, fontSize: 11.5, color: muted }}>→ {nexts.join(' · ')}</div>}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${line}`, fontSize: 12, color: muted }}>
        <button
          onClick={() => { if (confirm('Report this flow as spam / inappropriate / broken?')) void doReport('inappropriate'); }}
          disabled={reporting}
          style={{ background: 'transparent', border: 0, color: muted, cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}
        >
          Report this flow
        </button>
      </div>
    </div>
  );
}
