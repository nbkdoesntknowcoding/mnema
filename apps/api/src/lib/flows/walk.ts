import { and, eq, inArray, isNull } from 'drizzle-orm';
import { docs } from '../../db/schema.js';
import type { FlowNode, FlowEdge } from './validate.js';

/**
 * Phase 6.1 flow walk + render helpers.
 *
 * Two responsibilities split across the module:
 *
 *   1. topologicalWalk(nodes, edges)
 *      Kahn's algorithm. Returns nodes in an order an MCP client can call
 *      get_flow_step(1), get_flow_step(2), ... and have it correspond to
 *      "first to last" of the DAG. Position-Y is the tie-breaker when
 *      multiple nodes are ready, so the canvas's top-to-bottom intuition
 *      maps to step order.
 *
 *      Phase 6.1 ignores decision-node branching — a decision node is just
 *      a normal node here. Phase 6.4 introduces conditional traversal.
 *
 *   2. renderNodeContent(node, tx)
 *      Returns { instruction, content } for a single node. Doc nodes pull
 *      the markdown out of the docs table; instruction nodes use their
 *      text as content; docs nodes concatenate references; decision nodes
 *      render the condition as content (placeholder until 6.4).
 *
 *      tx is the active drizzle transaction (already scoped to the right
 *      tenant via withTenant) so reads go through RLS.
 */

interface DbNodeRow {
  client_node_id: string;
  kind: string;
  title: string;
  position_x: number;
  position_y: number;
  data: unknown;
}

interface DbEdgeRow {
  from_node_id: string;
  to_node_id: string;
  from_socket: string;
}

export type WalkNode = DbNodeRow;

export function topologicalWalk(nodes: DbNodeRow[], edges: DbEdgeRow[]): WalkNode[] {
  const incoming = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const byId = new Map<string, DbNodeRow>();

  for (const node of nodes) {
    incoming.set(node.client_node_id, 0);
    adjacency.set(node.client_node_id, []);
    byId.set(node.client_node_id, node);
  }
  for (const edge of edges) {
    incoming.set(edge.to_node_id, (incoming.get(edge.to_node_id) ?? 0) + 1);
    const adj = adjacency.get(edge.from_node_id);
    if (adj) adj.push(edge.to_node_id);
  }

  // Initial ready set: nodes with no incoming edges. Sort by position_y
  // for deterministic, top-to-bottom traversal when multiple are ready.
  const ready: string[] = [];
  for (const [id, count] of incoming.entries()) {
    if (count === 0) ready.push(id);
  }
  ready.sort((a, b) => {
    const na = byId.get(a);
    const nb = byId.get(b);
    return (na?.position_y ?? 0) - (nb?.position_y ?? 0);
  });

  const result: WalkNode[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    const node = byId.get(id);
    if (node) result.push(node);
    const neighbors = adjacency.get(id) ?? [];
    const newlyReady: string[] = [];
    for (const n of neighbors) {
      const c = (incoming.get(n) ?? 0) - 1;
      incoming.set(n, c);
      if (c === 0) newlyReady.push(n);
    }
    if (newlyReady.length > 0) {
      newlyReady.sort((a, b) => {
        const na = byId.get(a);
        const nb = byId.get(b);
        return (na?.position_y ?? 0) - (nb?.position_y ?? 0);
      });
      ready.unshift(...newlyReady);
    }
  }

  return result;
}

/**
 * Renders one node into the shape MCP clients (and the preview endpoint)
 * deliver: { instruction, content, source }.
 *
 * `tx` is the active drizzle transaction — already inside withTenant() so
 * RLS clamps the doc lookups to the caller's workspace. If a referenced
 * doc has been deleted or RLS-filtered out, content falls back to a
 * note string rather than throwing — flow walk should be tolerant of
 * referential rot.
 */
export interface RenderedStep {
  instruction: string;
  content: string;
  content_type: string;
  source: Record<string, unknown> | null;
}

// Drizzle transaction type — kept loose because the exact generic shape
// depends on the schema and isn't worth importing here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export async function renderNodeContent(node: DbNodeRow, tx: Tx): Promise<RenderedStep> {
  const data = (node.data ?? {}) as Record<string, unknown>;

  switch (node.kind) {
    case 'doc': {
      const docId = typeof data.doc_id === 'string' ? data.doc_id : null;
      const instruction = typeof data.instruction === 'string' ? data.instruction : '';
      if (!docId) {
        return {
          instruction,
          content: '_(no doc referenced — this step has no content)_',
          content_type: 'doc',
          source: null,
        };
      }
      const rows: Array<{ id: string; title: string; markdown: string }> = await tx
        .select({ id: docs.id, title: docs.title, markdown: docs.markdown })
        .from(docs)
        .where(and(eq(docs.id, docId), isNull(docs.deletedAt)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return {
          instruction,
          content: `_(referenced doc ${docId} not found — it may have been deleted)_`,
          content_type: 'doc',
          source: { doc_id: docId },
        };
      }
      return {
        instruction,
        content: row.markdown,
        content_type: 'doc',
        source: { doc_id: row.id, doc_title: row.title },
      };
    }

    case 'docs': {
      const instruction = typeof data.instruction === 'string' ? data.instruction : '';
      const docIds = Array.isArray(data.doc_ids)
        ? (data.doc_ids.filter((d) => typeof d === 'string') as string[])
        : [];
      const filter = (data.filter ?? null) as { type?: string } | null;

      // Either explicit ids OR a filter — both already validated upstream.
      let rows: Array<{ id: string; title: string; markdown: string; type: string }> = [];
      if (docIds.length > 0) {
        rows = await tx
          .select({
            id: docs.id,
            title: docs.title,
            markdown: docs.markdown,
            type: docs.type,
          })
          .from(docs)
          .where(and(inArray(docs.id, docIds), isNull(docs.deletedAt)));
      } else if (filter && typeof filter.type === 'string') {
        rows = await tx
          .select({
            id: docs.id,
            title: docs.title,
            markdown: docs.markdown,
            type: docs.type,
          })
          .from(docs)
          .where(and(eq(docs.type, filter.type), isNull(docs.deletedAt)));
      }

      if (rows.length === 0) {
        return {
          instruction,
          content: '_(no docs matched this step)_',
          content_type: 'docs',
          source: { doc_ids: docIds, filter },
        };
      }

      // Concatenate with a separator + a small heading per doc so Claude
      // can tell where one doc ends and the next begins.
      const content = rows
        .map((r) => `## ${r.title}\n\n${r.markdown}`)
        .join('\n\n---\n\n');
      return {
        instruction,
        content,
        content_type: 'docs',
        source: { doc_ids: rows.map((r) => r.id), filter, count: rows.length },
      };
    }

    case 'instruction': {
      const text = typeof data.text === 'string' ? data.text : '';
      return {
        instruction: text,
        // Instruction nodes have no separate content; the text IS the step.
        content: '',
        content_type: 'instruction',
        source: null,
      };
    }

    case 'decision': {
      // Phase 6.4 will turn condition into real routing. For 6.1 the node
      // is rendered as informational content describing the branch point.
      const condition = typeof data.condition === 'string' ? data.condition : '(no condition)';
      return {
        instruction: `Decision point. The author has marked this as a branch on: ${condition}`,
        content:
          '_(Decision nodes are scheduled for Phase 6.4. The flow continues linearly through this step in the current release.)_',
        content_type: 'decision',
        source: { condition },
      };
    }

    default:
      return {
        instruction: '',
        content: `_(unknown node kind: ${node.kind})_`,
        content_type: 'unknown',
        source: null,
      };
  }
}

/**
 * Light wrapper so test code outside the API process can import the same
 * function signature as the validators expect.
 */
export function fromValidateShape(nodes: FlowNode[], edges: FlowEdge[]): {
  dbNodes: DbNodeRow[];
  dbEdges: DbEdgeRow[];
} {
  return {
    dbNodes: nodes.map((n) => ({
      client_node_id: n.client_node_id,
      kind: n.kind,
      title: n.title,
      position_x: n.position_x,
      position_y: n.position_y,
      data: n.data,
    })),
    dbEdges: edges.map((e) => ({
      from_node_id: e.from_node_id,
      to_node_id: e.to_node_id,
      from_socket: e.from_socket,
    })),
  };
}
