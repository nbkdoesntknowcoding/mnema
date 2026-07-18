/**
 * Layered left-to-right auto-layout for flow graphs (no external dep).
 *
 * Longest-path layering (Kahn topological order) → each node sits one column to
 * the right of its deepest predecessor; nodes sharing a column are spread and
 * centered vertically. Good enough to turn a pile of (0,0) nodes into a readable
 * horizontal DAG. Cycles/disconnected nodes degrade gracefully (kept at their
 * computed/earliest column).
 */

export interface LayoutOpts {
  /** horizontal gap between successive layers (columns). */
  xGap?: number;
  /** vertical gap between siblings sharing a column. */
  yGap?: number;
  startX?: number;
  startY?: number;
}

export function layeredLayout(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
  opts: LayoutOpts = {},
): Record<string, { x: number; y: number }> {
  const xGap = opts.xGap ?? 360;
  const yGap = opts.yGap ?? 200;
  const startX = opts.startX ?? 0;
  const startY = opts.startY ?? 0;

  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const outs = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    outs.set(id, []);
    indeg.set(id, 0);
  }
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target) || e.source === e.target) continue;
    outs.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  // Longest-path layering via Kahn's algorithm.
  const layer = new Map<string, number>();
  for (const id of ids) layer.set(id, 0);
  const indegWork = new Map(indeg);
  const order: string[] = ids.filter((id) => (indegWork.get(id) ?? 0) === 0);
  let head = 0;
  while (head < order.length) {
    const u = order[head++]!;
    for (const v of outs.get(u) ?? []) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      indegWork.set(v, (indegWork.get(v) ?? 0) - 1);
      if ((indegWork.get(v) ?? 0) === 0) order.push(v);
    }
  }

  // Group nodes by row (keep a stable order within a row).
  const byLayer = new Map<number, string[]>();
  let maxLayer = 0;
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    maxLayer = Math.max(maxLayer, l);
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(id);
  }

  const pos: Record<string, { x: number; y: number }> = {};
  for (let l = 0; l <= maxLayer; l++) {
    const col = byLayer.get(l) ?? [];
    const colHeight = (col.length - 1) * yGap;
    col.forEach((id, i) => {
      // layer → x (column), sibling index → y (spread + centered)
      pos[id] = { x: startX + l * xGap, y: Math.round(startY + i * yGap - colHeight / 2) };
    });
  }
  return pos;
}
