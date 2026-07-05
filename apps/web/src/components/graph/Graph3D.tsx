// apps/web/src/components/graph/Graph3D.tsx
'use client';
import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import ForceGraph2DLib from 'react-force-graph-2d';
import { forceRadial } from 'd3-force-3d';
// react-force-graph-2d's exported prop types are stricter than the runtime API.
// Cast to any so the documented props pass typecheck.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = ForceGraph2DLib as any;
import { drawNode, getPointerArea, getRadius } from './node-objects';
import { setHighlight, clearHighlight, highlightState } from './highlight';
import {
  generateStars, drawStars,
  generateBrainShell, drawBrainShell,
  type Star, type BrainPoint,
} from './environment';
import { NodeCard3D } from './NodeCard3D';
import { ENTITY_COLORS_CSS } from './constants';
import type { GraphNode, GraphEdge } from '../../lib/graph-types';

interface Props { nodes: GraphNode[]; edges: GraphEdge[]; }

export function Graph3D({ nodes, edges }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fg          = useRef<any>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);
  const starsRef    = useRef<Star[]>([]);
  const shellRef    = useRef<BrainPoint[]>([]);
  const iTimer      = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [dims,    setDims]    = useState({ w: 0, h: 0 });
  const [selNode, setSelNode] = useState<GraphNode | null>(null);

  // ── Canvas sizing ───────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Stars (generated once when dims are known) ──────────────────
  useEffect(() => {
    if (dims.w > 0 && starsRef.current.length === 0) {
      starsRef.current = generateStars(dims.w, dims.h);
    }
  }, [dims]);

  // ── Forces ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!fg.current) return;

    // Repulsion — pushes branches apart
    fg.current.d3Force('charge')?.strength(-80);

    // Tight link distance — branches stay bundled
    fg.current.d3Force('link')?.distance(() => 20).strength(1.0);

    // Radial force — hub nodes to centre, leaf nodes to periphery
    // This creates the dendritic branching structure
    fg.current.d3Force('radial', forceRadial(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: any) => {
        const deg = Math.min(node.degree ?? 0, 50);
        return (1 - deg / 50) * 200; // leaf node → 200 units out, hub → 0
      },
      0, 0,
    ).strength(0.4));

    // No z-layer force in 2D
    fg.current.d3Force('z-layer', null);
    fg.current.d3Force('confine', null);
  }, [nodes]);

  // ── Stable graphData ────────────────────────────────────────────
  const graphData = useMemo(() => ({
    nodes: nodes.map(n => ({ ...n, val: Math.max(n.degree ?? 1, 1) })),
    links: edges.map(e => ({
      ...e,
      source: e.fromNodeId,
      target: e.toNodeId,
      // Random curvature — long sweeping organic branches like the reference
      curvature:         (Math.random() - 0.5) * 0.6,
      curvatureRotation: Math.random() * Math.PI * 2,
    })),
  }), [nodes, edges]);

  // ── Node click ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onNodeClick = useCallback((raw: any) => {
    clearTimeout(iTimer.current);
    const node = raw as GraphNode;
    setSelNode(node);
    const conn = edges
      .filter(e => e.fromNodeId === node.id || e.toNodeId === node.id)
      .map(e => e.fromNodeId === node.id ? e.toNodeId : e.fromNodeId);
    setHighlight(node.id, conn);
  }, [edges]);

  const onBgClick = useCallback(() => {
    setSelNode(null);
    clearHighlight();
  }, []);

  // ── Custom click hit-testing (does NOT use force-graph's hit detection) ──
  // react-force-graph maps clicks to nodes via an OFFSCREEN "shadow" canvas. On
  // Retina that shadow canvas desyncs from the visible one on first paint, so
  // clicks/hover hit nothing until a window resize. Instead of fighting that, we
  // ignore it entirely: on a click we convert the pointer to GRAPH coordinates via
  // screen2GraphCoords (which uses the very same d3 zoom transform that draws the
  // visible nodes, so it can never desync) and select the nearest node. Pure
  // geometry against the on-screen positions — works regardless of dpr/resize.
  useEffect(() => {
    const el = wrapRef.current;
    if (el == null) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodesOf = () => graphData.nodes as any[];

    const nearest = (clientX: number, clientY: number) => {
      const canvas = el.querySelector('canvas');
      const inst = fg.current;
      if (!canvas || !inst || typeof inst.screen2GraphCoords !== 'function') return null;
      const rect = canvas.getBoundingClientRect();
      const g = inst.screen2GraphCoords(clientX - rect.left, clientY - rect.top);
      if (!g || !Number.isFinite(g.x)) return null;
      let best: GraphNode | null = null;
      let bestD = Infinity;
      for (const n of nodesOf()) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        const dd = Math.hypot(n.x - g.x, n.y - g.y);
        if (dd < bestD) { bestD = dd; best = n; }
      }
      if (!best) return null;
      const zoom = (typeof inst.zoom === 'function' ? inst.zoom() : 1) || 1;
      // Work in SCREEN pixels and size the click target to the whole VISIBLE node —
      // the bright dot PLUS its glow halo (drawNode draws the glow out to ~3.6× the
      // dot radius) — plus a small fixed slack. This is the key fix: the target now
      // matches what the user sees at any zoom (when zoomed out the dot is tiny but
      // the glow still reads as clickable). Nearest-node selection keeps it
      // unambiguous; a click in genuinely empty space falls outside every node's
      // glow and clears the selection.
      const dotPx = getRadius(best) * zoom;
      const screenThreshold = dotPx * 2.6 + 14; // ~glow extent + slack, in px
      const screenDist = bestD * zoom;
      return screenDist <= screenThreshold ? best : null;
    };

    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      const d = down; down = null;
      if (!d) return;
      // ignore pans/drags — only a (near-)stationary press counts as a click
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      if (e.target !== el.querySelector('canvas')) return; // not a click on the canvas (e.g. a panel)
      const hit = nearest(e.clientX, e.clientY);
      if (hit) onNodeClick(hit); else onBgClick();
    };
    let cursorRaf = 0;
    const onMove = (e: PointerEvent) => {
      if (down) return; // don't recompute the cursor mid-drag
      if (cursorRaf) return;
      cursorRaf = requestAnimationFrame(() => {
        cursorRaf = 0;
        const canvas = el.querySelector('canvas');
        if (canvas) canvas.style.cursor = nearest(e.clientX, e.clientY) ? 'pointer' : '';
      });
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      if (cursorRaf) cancelAnimationFrame(cursorRaf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, onNodeClick, onBgClick]);

  // ── nodeCanvasObject — draws each node on the 2D canvas ─────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const n         = node as GraphNode;
    const selected  = highlightState.selectedId === n.id;
    const connected = highlightState.connectedIds.has(n.id);
    const any       = highlightState.selectedId !== null;
    drawNode(n, ctx, selected, connected, any);
  }, []);

  // ── nodePointerAreaPaint — hit area MATCHING the visible dot ──────
  // Without this, react-force-graph uses a degree-based circle, so high-degree
  // hubs get huge click zones that swallow nearby small nodes (click a doc →
  // a task opens). Paint a tight hit circle at the node, sized to its dot.
  const nodePointerAreaPaint = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node: any,
    colour: string,
    ctx: CanvasRenderingContext2D,
  ) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, getPointerArea(node as GraphNode), 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  // ── onRenderFramePre — draws stars + brain shell before nodes ────
  // This callback runs inside ForceGraph2D's own render loop (no extra RAF)
  const onRenderFramePre = useCallback((ctx: CanvasRenderingContext2D) => {
    // Draw background stars
    if (starsRef.current.length > 0) drawStars(ctx, starsRef.current);
    // Draw brain shell if computed
    if (shellRef.current.length > 0) drawBrainShell(ctx, shellRef.current);
  }, []);

  // ── Memoised accessor props ──────────────────────────────────────
  // CRITICAL: these must be stable. If they're new functions on every render
  // (e.g. after a click sets state), react-force-graph resets canvas state, and
  // with redraw paused that blanks the canvas. They read the mutable
  // highlightState module object, so [] deps still see current selection.
  //
  // NOTE: do NOT pass a nodeCanvasObjectMode accessor — supplying one (even one
  // returning 'replace') makes react-force-graph-2d never call nodeCanvasObject,
  // so all nodes vanish. The library already defaults the mode to 'replace' when
  // nodeCanvasObject is set.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeLabel = useCallback((n: any) => (n as GraphNode).label, []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkColor = useCallback((link: any) => {
    const src = link.source;
    const col = ENTITY_COLORS_CSS[src?.entityType] ?? '#ffffff';
    if (highlightState.selectedId) {
      const sid = highlightState.selectedId;
      const fromId = src?.id ?? '';
      const toId   = link.target?.id ?? '';
      // col is a #rrggbb hex; dim unconnected links via an 8-digit alpha hex
      if (fromId !== sid && toId !== sid) return col.length === 7 ? `${col}14` : col;
    }
    return col;
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkWidth = useCallback((link: any) => {
    const e = link as GraphEdge;
    // Thin filaments — the reference connections are hair-thin bright curves.
    if (e.provenance === 'AMBIGUOUS') return 0.25;
    if (e.provenance === 'INFERRED')  return 0.55;
    return 1.0;
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkCurvature = useCallback((link: any) => link.curvature ?? 0, []);

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#000000' }}
    >
      {dims.w > 0 && (
        <ForceGraph2D
          ref={fg}
          width={dims.w}
          height={dims.h}
          graphData={graphData}
          backgroundColor="#000000"

          // ── Node rendering ────────────────────────────────────
          nodeCanvasObject={nodeCanvasObject}
          nodePointerAreaPaint={nodePointerAreaPaint}
          nodeLabel={nodeLabel}

          // ── Link styling ──────────────────────────────────────
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkCurvature={linkCurvature}
          linkOpacity={0.85}

          // ── Simulation ────────────────────────────────────────
          // No cooldownTicks — natural alpha decay
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.4}
          warmupTicks={80}

          // CRITICAL: keep the canvas live. With autoPauseRedraw=true (the default),
          // once the engine stops force-graph stops calling refreshShadowCanvas, so the
          // offscreen hit-test canvas freezes at a stale transform and every click resolves
          // to the wrong node (force-graph.js:613,647). Keeping redraw on also makes the
          // highlight/selection repaint immediately (no "vanish after a click").
          autoPauseRedraw={false}

          onEngineStop={() => {
            // NOTE: react-force-graph-2d's ref has NO graphData() method (only the
            // 3D build does). Read positions from the memoized graphData.nodes — the
            // library mutates those objects in place with x/y as it simulates.
            let maxR = 0, cx = 0, cy = 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ns = graphData.nodes as any[];
            ns.forEach((n) => {
              const r = Math.sqrt((n.x ?? 0) ** 2 + (n.y ?? 0) ** 2);
              if (r > maxR) maxR = r;
              cx += (n.x ?? 0);
              cy += (n.y ?? 0);
            });
            const count = ns.length || 1;
            cx /= count; cy /= count;

            if (maxR > 10) {
              shellRef.current = generateBrainShell(cx, cy, maxR);
              console.log(`[Graph2D] graphR=${maxR.toFixed(0)} shellR=${(maxR*1.5).toFixed(0)}`);
            }

            // Fit the view to show all nodes with padding
            fg.current?.zoomToFit(800, 60);
          }}

          // ── Background pass ───────────────────────────────────
          onRenderFramePre={onRenderFramePre}

          // ── Interaction ───────────────────────────────────────
          // NOTE: node/background clicks are handled by our own geometric
          // hit-testing effect above (force-graph's offscreen hit-test desyncs on
          // Retina). We still let the library own pan + zoom.
          showNavInfo={false}
          enablePointerInteraction={true}
          enableZoomInteraction={true}
          enablePanInteraction={true}
        />
      )}

      {selNode && (
        <NodeCard3D
          node={selNode}
          edges={edges}
          allNodes={nodes}
          fgRef={fg}
          containerRef={wrapRef}
          onClose={onBgClick}
          onOpenNode={(id) => {
            const n = nodes.find(x => x.id === id);
            if (n) onNodeClick(n);
          }}
        />
      )}
    </div>
  );
}
