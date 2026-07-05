import { type JSX, useEffect, useState } from 'react';

interface FNode {
  client_node_id: string;
  kind: string;
  title: string;
  position_x: number;
  position_y: number;
  data: Record<string, unknown>;
}
interface FEdge { from_node_id: string; to_node_id: string; from_socket: string }
interface Shared { name: string; description: string | null; published: boolean; nodes: FNode[]; edges: FEdge[] }

const ink = 'var(--ink, #e7e7e9)';
const soft = 'var(--ink-soft, #a1a1aa)';
const muted = 'var(--ink-muted, #71717a)';
const line = 'var(--line, rgba(255,255,255,0.1))';
const surface = 'var(--surface-1, rgba(255,255,255,0.02))';

const KIND_COLOR: Record<string, string> = {
  doc: '#6ea8fe', docs: '#6ea8fe', instruction: '#f0997b', decision: '#34d399',
};

/** Read-only view of a flow shared via link. Works for any logged-in Mnema user. */
export function SharedFlowView({ token }: { token: string }): JSX.Element {
  const [state, setState] = useState<Shared | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/flows/shared/${token}`);
        if (res.status === 404) { setErr('This shared flow link is invalid or was revoked.'); return; }
        if (res.status === 401) { setErr('Sign in to your Mnema account to view this shared flow.'); return; }
        if (!res.ok) throw new Error(String(res.status));
        setState((await res.json()) as Shared);
      } catch { setErr('Could not load this flow.'); }
    })();
  }, [token]);

  if (err) return <div style={{ padding: 40, color: soft, fontSize: 14, maxWidth: '34rem', margin: '0 auto' }}>{err}</div>;
  if (!state) return <div style={{ padding: 40, color: muted, fontSize: 14 }}>Loading…</div>;

  const ordered = [...state.nodes].sort((a, b) => a.position_y - b.position_y || a.position_x - b.position_x);
  const titleOf = new Map(state.nodes.map((n) => [n.client_node_id, n.title]));
  const nextOf = new Map<string, string[]>();
  for (const e of state.edges) {
    (nextOf.get(e.from_node_id) ?? nextOf.set(e.from_node_id, []).get(e.from_node_id)!).push(e.to_node_id);
  }

  return (
    <div style={{ maxWidth: '48rem', margin: '0 auto', padding: '40px 24px 80px' }}>
      <div style={{ fontSize: 11, color: muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Shared flow · read-only
      </div>
      <h1 style={{ margin: 0, font: '500 26px/1.2 var(--sans)', letterSpacing: '-0.02em', color: ink }}>{state.name}</h1>
      {state.description && <p style={{ margin: '8px 0 0', fontSize: 14, color: soft, maxWidth: '40rem' }}>{state.description}</p>}
      {!state.published && (
        <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--amber, #f0997b)' }}>
          This flow hasn’t been published yet — there’s nothing to show.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 26 }}>
        {ordered.map((n, i) => {
          const instr = typeof n.data?.instruction === 'string' ? (n.data.instruction as string)
            : typeof n.data?.text === 'string' ? (n.data.text as string) : null;
          const nexts = (nextOf.get(n.client_node_id) ?? []).map((id) => titleOf.get(id) ?? id);
          return (
            <div key={n.client_node_id} style={{ padding: '14px 16px', borderRadius: 12, background: surface, border: `0.5px solid ${line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: muted, fontFamily: 'var(--mono, monospace)' }}>{i + 1}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: KIND_COLOR[n.kind] ?? muted }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: KIND_COLOR[n.kind] ?? '#6b7280' }} />
                  {n.kind}
                </span>
                <span style={{ fontSize: 14, color: ink, fontWeight: 500 }}>{n.title}</span>
              </div>
              {instr && <div style={{ marginTop: 6, fontSize: 12.5, color: soft, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{instr}</div>}
              {nexts.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: muted }}>→ {nexts.join(' · ')}</div>
              )}
            </div>
          );
        })}
        {ordered.length === 0 && state.published && (
          <p style={{ color: muted, fontSize: 13 }}>This flow has no steps yet.</p>
        )}
      </div>
    </div>
  );
}
