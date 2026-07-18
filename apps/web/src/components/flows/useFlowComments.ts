import { useCallback, useEffect, useMemo, useState } from 'react';

export interface FlowComment {
  id: string;
  node_id: string;
  body: string;
  resolved: boolean;
  created_at: string;
  author: { id: string | null; name: string };
}

/**
 * Loads a flow's node comments and exposes per-node counts + an add helper.
 * Comments are anchored to a client_node_id (see /api/flows/:id/comments).
 */
export function useFlowComments(flowId: string) {
  const [comments, setComments] = useState<FlowComment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/flows/${flowId}/comments`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => setComments(d.comments ?? []))
      .catch(() => { /* keep prior */ })
      .finally(() => setLoading(false));
  }, [flowId]);

  useEffect(() => { load(); }, [load]);

  const commentsByNode = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of comments) m[c.node_id] = (m[c.node_id] ?? 0) + 1;
    return m;
  }, [comments]);

  const threadFor = useCallback(
    (nodeId: string) => comments.filter((c) => c.node_id === nodeId),
    [comments],
  );

  const addComment = useCallback(async (nodeId: string, body: string) => {
    const res = await fetch(`/api/flows/${flowId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ client_node_id: nodeId, body }),
    });
    if (!res.ok) throw new Error('failed');
    load(); // refresh
  }, [flowId, load]);

  return { comments, commentsByNode, threadFor, addComment, loading };
}
