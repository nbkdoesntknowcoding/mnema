import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  type OnConnect,
  ConnectionLineType,
  Position,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './flow-canvas.css';

import { DocNode }         from './nodes/DocNode';
import { DocsNode }        from './nodes/DocsNode';
import { InstructionNode } from './nodes/InstructionNode';
import { DecisionNode }    from './nodes/DecisionNode';
import { CaptureNode }     from './nodes/CaptureNode';
import { FlowEdge }        from './edges/FlowEdge';
import { BranchEdge }      from './edges/BranchEdge';
import { NodeInspector }   from './NodeInspector';
import { FlowHeader, type SaveState } from './FlowHeader';
import { WalkOverlay }          from './WalkOverlay';
import { DocSidebar }           from './DocSidebar';
import { NodePaletteBar }       from './NodePaletteBar';
import { VersionHistoryPanel }  from './VersionHistoryPanel';
import { RunHistoryPanel, stepStatusColor }      from './RunHistoryPanel';
import type { StepRow }         from './RunHistoryPanel';
import { PublishModal }         from './PublishModal';
import { detectCycle }          from '../../lib/flows/cycle-detect';
import { layeredLayout }        from '../../lib/flows/auto-layout';
import { FLOW_TOKENS as T, accentFor } from './tokens';
import { useFlowPresence } from './useFlowPresence';
import { PresenceCluster, PresenceWorld } from './PresenceLayer';
import { FlowUIContext }        from './flow-ui-context';
import { PeekTooltip }          from './PeekTooltip';
import { ExpandedDocPreview, FullDocPanel } from './DocPreviewLayers';
import { useFlowComments } from './useFlowComments';
import { FlowCommentThread } from './FlowCommentThread';

export interface Flow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  published_version_id: string | null;
  draft_version_id: string;
  has_unpublished_changes: boolean;
  is_published: boolean;
  /** Hub listing slug when this flow is published to the community; null otherwise. */
  community_slug: string | null;
  nodes: Array<{
    client_node_id: string;
    kind: 'doc' | 'docs' | 'instruction' | 'decision' | 'capture';
    title: string;
    position_x: number;
    position_y: number;
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    from_node_id: string;
    to_node_id: string;
    from_socket: string;
  }>;
}

type NodeKind = 'doc' | 'docs' | 'instruction' | 'decision' | 'capture';

// ─── Adapters ─────────────────────────────────────────────────────────────────

function mnemaNodeToRF(n: Flow['nodes'][number]): Node {
  return {
    id: n.client_node_id,
    type: n.kind,
    position: { x: n.position_x, y: n.position_y },
    data: { ...n.data, title: n.title, kind: n.kind },
    // Horizontal (left→right) flow: edges leave the right, enter the left.
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: true, selectable: true, connectable: true, deletable: true,
  };
}

function rfNodeToMnema(n: Node): Flow['nodes'][number] {
  return {
    client_node_id: n.id,
    kind:           n.data.kind as NodeKind,
    title:          n.data.title as string,
    position_x:     Math.round(n.position.x),
    position_y:     Math.round(n.position.y),
    data:           n.data as Record<string, unknown>,
  };
}

function rfEdgeToMnema(e: Edge): Flow['edges'][number] {
  return {
    from_node_id: e.source,
    to_node_id:   e.target,
    from_socket:  e.sourceHandle ?? 'default',
  };
}

function makeClientNodeId(prefix: string, nodes: Node[]): string {
  const kebab = prefix.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const base = kebab || 'node';
  const existing = new Set(nodes.map(n => n.id));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ─── Compute isEntry / isExit from edges ──────────────────────────────────────

function enrichNodes(nodes: Node[], edges: Edge[]): Node[] {
  const hasIncoming = new Set(edges.map(e => e.target));
  const hasOutgoing  = new Set(edges.map(e => e.source));
  return nodes.map(n => ({
    ...n,
    data: {
      ...n.data,
      isEntry:        !hasIncoming.has(n.id),
      hasOutgoingEdge: hasOutgoing.has(n.id),
    },
  }));
}

// ─── Node / Edge type maps ────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  doc: DocNode, docs: DocsNode, instruction: InstructionNode, decision: DecisionNode, capture: CaptureNode,
};

const edgeTypes: EdgeTypes = {
  flow: FlowEdge, branch: BranchEdge,
};

const defaultEdgeOptions = { type: 'flow', animated: false, deletable: true };

// ─── Default data per kind ────────────────────────────────────────────────────

function defaultData(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case 'doc':         return { doc_id: null, instruction: '' };
    case 'docs':        return { doc_ids: [], instruction: '' };
    case 'instruction': return { text: '', pause_for_user_input: false };
    case 'decision':    return { question: '', branches: { yes: null, no: null }, default_branch: 'yes' };
    case 'capture':     return { title_hint: '', instruction: '', autonomous: false };
  }
}

// ─── Inner canvas ─────────────────────────────────────────────────────────────

interface InnerProps { flow: Flow }

function InnerCanvas({ flow }: InnerProps) {
  const initialNodes = useMemo(() => flow.nodes.map(mnemaNodeToRF), [flow.nodes]);
  const initialEdges = useMemo<Edge[]>(() =>
    flow.edges.map((e, i) => ({
      id:           `${e.from_node_id}__${e.to_node_id}__${e.from_socket}__${i}`,
      source:       e.from_node_id,
      target:       e.to_node_id,
      sourceHandle: e.from_socket === 'default' ? undefined : e.from_socket,
      type:         e.from_socket !== 'default' && e.from_socket ? 'branch' : 'flow',
      label:        e.from_socket !== 'default' && e.from_socket ? e.from_socket : undefined,
      deletable:    true,
    })),
    [flow.edges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Enriched nodes with isEntry/isExit computed from edges
  const enrichedNodes = useMemo(() => enrichNodes(nodes, edges), [nodes, edges]);

  // ─── Run-execution overlay (n8n-style replay on the canvas) ────────────────
  // When a run is open in the RunHistoryPanel, its steps drive per-node styling:
  // nodes light up by status; nodes not touched by the run dim out.
  const [runOverlay, setRunOverlay] = useState<StepRow[] | null>(null);
  const [runFocusNodeId, setRunFocusNodeId] = useState<string | null>(null);

  const runStatusByNode = useMemo(() => {
    if (!runOverlay) return null;
    const m = new Map<string, string>();
    for (const s of runOverlay) m.set(s.nodeId, s.status);
    return m;
  }, [runOverlay]);

  // Overlay styling is applied last so it composes on top of enrichment.
  const displayNodes = useMemo(() => {
    if (!runStatusByNode) return enrichedNodes;
    return enrichedNodes.map((n) => {
      const status = runStatusByNode.get(n.id);
      const touched = status && status !== 'pending';
      const color = status ? stepStatusColor(status) : '#52525b';
      return {
        ...n,
        style: {
          ...(n.style ?? {}),
          opacity: touched ? 1 : 0.4,
          outline: touched ? `2px solid ${color}` : '2px solid transparent',
          outlineOffset: 2,
          borderRadius: 12,
          boxShadow: touched ? `0 0 0 4px ${color}22` : 'none',
          transition: 'opacity 150ms, outline-color 150ms',
        },
      };
    });
  }, [enrichedNodes, runStatusByNode]);

  const [selectedNodeId, setSelectedNodeId]       = useState<string | null>(null);

  // ─── Live presence (cursors / avatars / remote selection) ──────────────────
  const rf = useReactFlow();
  const { peers, sendCursor, sendSelection } = useFlowPresence(flow.id);
  useEffect(() => { sendSelection(selectedNodeId); }, [selectedNodeId, sendSelection]);
  const handlePresenceMouseMove = useCallback((e: React.MouseEvent) => {
    if (!peers.length) return;                       // no one to broadcast to
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    sendCursor(p.x, p.y);
  }, [rf, sendCursor, peers.length]);

  // ─── Node comment threads ──────────────────────────────────────────────────
  const { commentsByNode, threadFor, addComment } = useFlowComments(flow.id);
  const [threadNodeId, setThreadNodeId] = useState<string | null>(null);
  const [walkMode,       setWalkMode]             = useState(false);
  const [walkFocusNodeId, setWalkFocusNodeId]     = useState<string | null>(null);
  const [docsOpen,       setDocsOpen]             = useState(false);
  const [runsOpen,       setRunsOpen]             = useState(false);
  const [historyOpen,    setHistoryOpen]          = useState(false);
  const [publishOpen,    setPublishOpen]          = useState(false);
  const [saveState,      setSaveState]            = useState<SaveState>('idle');
  const [saveError,      setSaveError]            = useState<string | null>(null);
  const [isDirty,        setIsDirty]              = useState(false);
  const [lastSavedAt,    setLastSavedAt]          = useState<Date | null>(null);
  const [isPublished,    setIsPublished]          = useState(!!flow.is_published);
  const [hasUnpublished, setHasUnpublished]       = useState(flow.has_unpublished_changes ?? !flow.is_published);

  // ─── Hifi interaction state (hover peek + edge lighting + doc preview) ─────
  const [hoverNodeId,    setHoverNodeId]    = useState<string | null>(null);
  const [peekNodeId,     setPeekNodeId]     = useState<string | null>(null);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null); // level 2
  const [panelNodeId,    setPanelNodeId]    = useState<string | null>(null); // level 3

  // Accent per node (directive/step split on isEntry) — drives edge colour.
  const accentByNode = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of enrichedNodes) {
      m.set(n.id, accentFor(n.data.kind as NodeKind, !!n.data.isEntry));
    }
    return m;
  }, [enrichedNodes]);

  // An edge is "active" when its source or target node is hovered or selected.
  const activeNodeIds = useMemo(() => {
    const s = new Set<string>();
    if (hoverNodeId) s.add(hoverNodeId);
    if (selectedNodeId) s.add(selectedNodeId);
    return s;
  }, [hoverNodeId, selectedNodeId]);

  // Inject accent + active into each edge's data for FlowEdge/BranchEdge.
  const displayEdges = useMemo(() =>
    edges.map(e => ({
      ...e,
      data: {
        ...e.data,
        accent: accentByNode.get(e.source) ?? '#b8bcc4',
        active: activeNodeIds.has(e.source) || activeNodeIds.has(e.target),
      },
    })),
    [edges, accentByNode, activeNodeIds],
  );

  // setPeek doubles as the hover signal (drives edge lighting for every node)
  // and the doc/capture peek tooltip.
  const handleSetPeek = useCallback((nodeId: string | null) => {
    setHoverNodeId(nodeId);
    if (!nodeId) { setPeekNodeId(null); return; }
    const n = nodesRef.current.find(x => x.id === nodeId);
    const kind = n?.data.kind as NodeKind | undefined;
    setPeekNodeId(kind === 'doc' || kind === 'capture' ? nodeId : null);
  }, []);

  // Esc precedence for the doc-preview layers: full panel → expanded card.
  useEffect(() => {
    if (!panelNodeId && !expandedNodeId) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (panelNodeId) setPanelNodeId(null);
      else if (expandedNodeId) setExpandedNodeId(null);
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [panelNodeId, expandedNodeId]);

  const rfInstance   = useRef<{ getViewport: () => { x: number; y: number; zoom: number }; setCenter: (x: number, y: number, opts?: { zoom?: number; duration?: number }) => void; fitView: (opts?: { padding?: number; duration?: number; maxZoom?: number }) => void } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nodesRef     = useRef(nodes);
  const edgesRef     = useRef(edges);

  // History stack for undo (last 20 states)
  const historyStack = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  // ─── Save logic (handles 409 gracefully) ──────────────────────────────────

  const save = useCallback(async (currentNodes?: Node[], currentEdges?: Edge[]) => {
    const n = currentNodes ?? nodesRef.current;
    const e = currentEdges ?? edgesRef.current;
    setSaveState('saving');
    try {
      let res = await fetch(`/api/flows/${flow.id}/draft`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodes: n.map(rfNodeToMnema), edges: e.map(rfEdgeToMnema) }),
      });
      // 409: flow is published with no draft yet — create draft first
      if (res.status === 409) {
        await fetch(`/api/flows/${flow.id}/draft`, { method: 'POST' });
        res = await fetch(`/api/flows/${flow.id}/draft`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nodes: n.map(rfNodeToMnema), edges: e.map(rfEdgeToMnema) }),
        });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; errors?: { message: string }[] };
        const msg = body.errors?.[0]?.message ?? body.error ?? 'Save failed';
        throw new Error(msg);
      }
      setSaveState('saved');
      setLastSavedAt(new Date());
      setIsDirty(false);
      setHasUnpublished(true);
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }, [flow.id]);

  const pushHistory = useCallback((n: Node[], e: Edge[]) => {
    historyStack.current.push({ nodes: [...n], edges: [...e] });
    if (historyStack.current.length > 20) historyStack.current.shift();
  }, []);

  const markDirty = useCallback(() => {
    setIsDirty(true);
    setSaveState('idle');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => save(), 1500);
  }, [save]);

  // ─── Undo ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const prev = historyStack.current.pop();
        if (prev) { setNodes(prev.nodes); setEdges(prev.edges as Parameters<typeof setEdges>[0]); }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F') && e.shiftKey) {
        e.preventDefault();
        // fit handled by Controls
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setNodes, setEdges]);

  // ─── Node change handlers ─────────────────────────────────────────────────

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    const hasMeaningful = changes.some(c => c.type === 'position' || c.type === 'remove' || c.type === 'add');
    if (hasMeaningful) pushHistory(nodesRef.current, edgesRef.current);
    onNodesChange(changes);
    if (hasMeaningful) markDirty();
  }, [onNodesChange, markDirty, pushHistory]);

  const handleEdgesChange = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    if (changes.some(c => c.type === 'remove' || c.type === 'add')) {
      pushHistory(nodesRef.current, edgesRef.current);
    }
    onEdgesChange(changes);
    if (changes.some(c => c.type === 'remove' || c.type === 'add')) markDirty();
  }, [onEdgesChange, markDirty, pushHistory]);

  // ─── Connect validation ───────────────────────────────────────────────────

  const handleConnect: OnConnect = useCallback((connection: Connection) => {
    const { source, target, sourceHandle } = connection;
    if (!source || !target) return;
    if (source === target) return;
    const dup = edgesRef.current.some(e => e.source === source && e.target === target && e.sourceHandle === (sourceHandle ?? undefined));
    if (dup) return;
    const tentative = [
      ...edgesRef.current.map(e => ({ source: e.source, target: e.target })),
      { source, target },
    ];
    if (detectCycle(tentative)) {
      alert('This connection would create a cycle, which is not allowed in flows.');
      return;
    }
    pushHistory(nodesRef.current, edgesRef.current);

    // Determine edge type: branch if coming from a named handle
    const isBranch = !!sourceHandle && sourceHandle !== 'default';
    setEdges(eds => addEdge({
      ...connection,
      type:  isBranch ? 'branch' : 'flow',
      label: isBranch ? sourceHandle : undefined,
      deletable: true,
    }, eds));
    markDirty();
  }, [setEdges, markDirty, pushHistory]);

  // ─── Node add ────────────────────────────────────────────────────────────

  const handleAddNode = useCallback((kind: NodeKind) => {
    // Horizontal flow: place the new node to the right of the right-most node.
    const lastNode = nodesRef.current.reduce<Node | null>(
      (prev, n) => (!prev || n.position.x > prev.position.x ? n : prev), null,
    );
    const pos = lastNode
      ? { x: lastNode.position.x + 340, y: lastNode.position.y }
      : { x: 200, y: 300 };

    const label = kind === 'doc' ? 'New Doc' : kind === 'docs' ? 'New Docs'
      : kind === 'instruction' ? 'New Instruction' : kind === 'capture' ? 'New Capture' : 'New Decision';
    const id = makeClientNodeId(label, nodesRef.current);
    const newNode: Node = {
      id, type: kind,
      position: pos,
      data: { ...defaultData(kind), title: label, kind },
      sourcePosition: Position.Right, targetPosition: Position.Left,
      draggable: true, selectable: true, connectable: true, deletable: true,
    };
    pushHistory(nodesRef.current, edgesRef.current);
    setNodes(ns => [...ns, newNode]);
    setSelectedNodeId(id);
    markDirty();
    // Pan to new node
    setTimeout(() => {
      rfInstance.current?.setCenter(pos.x + 120, pos.y + 60, { zoom: 1, duration: 300 });
    }, 50);
  }, [setNodes, markDirty, pushHistory]);

  // ─── Auto-arrange ─────────────────────────────────────────────────────────

  const handleAutoArrange = useCallback(() => {
    const cur = nodesRef.current;
    if (!cur.length) return;
    const pos = layeredLayout(
      cur.map(n => ({ id: n.id })),
      edgesRef.current.map(e => ({ source: e.source, target: e.target })),
      { startX: 120, startY: 420 },
    );
    pushHistory(cur, edgesRef.current);
    setNodes(ns => ns.map(n => { const p = pos[n.id]; return p ? { ...n, position: p } : n; }));
    markDirty();
    setTimeout(() => rfInstance.current?.fitView({ padding: 0.2, duration: 400 }), 60);
  }, [setNodes, markDirty, pushHistory]);

  // ─── Drop from DocSidebar ─────────────────────────────────────────────────

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/mnema-doc');
    if (!raw) return;
    let doc: { id: string; title: string };
    try { doc = JSON.parse(raw); } catch { return; }
    const rfEl = document.querySelector('.react-flow') as HTMLElement | null;
    if (!rfEl) return;
    const bounds  = rfEl.getBoundingClientRect();
    const vp      = rfInstance.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
    const x = (event.clientX - bounds.left - vp.x) / vp.zoom;
    const y = (event.clientY - bounds.top  - vp.y) / vp.zoom;
    const id = makeClientNodeId(doc.title, nodesRef.current);
    const newNode: Node = {
      id, type: 'doc',
      position: { x: x - 120, y: y - 40 },
      data: { doc_id: doc.id, doc_title: doc.title, title: doc.title, kind: 'doc', instruction: '' },
      sourcePosition: Position.Right, targetPosition: Position.Left,
      draggable: true, selectable: true, connectable: true, deletable: true,
    };
    pushHistory(nodesRef.current, edgesRef.current);
    setNodes(ns => [...ns, newNode]);
    setSelectedNodeId(id);
    markDirty();
  }, [setNodes, markDirty, pushHistory]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  }, []);

  // ─── Inspector updates ────────────────────────────────────────────────────

  const handleUpdateTitle = useCallback((nodeId: string, title: string) => {
    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, title } } : n));
    markDirty();
  }, [setNodes, markDirty]);

  const handleUpdateData = useCallback((nodeId: string, patch: Partial<Record<string, unknown>>) => {
    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
    // If branch labels changed, drop edges whose sourceHandle no longer exists
    if (patch.branches) {
      const branches = patch.branches as Record<string, unknown>;
      setEdges(es => es.filter(e => {
        if (e.source !== nodeId) return true;
        if (e.sourceHandle && !(e.sourceHandle in branches)) return false;
        return true;
      }));
    }
    markDirty();
  }, [setNodes, setEdges, markDirty]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    pushHistory(nodesRef.current, edgesRef.current);
    setNodes(ns => ns.filter(n => n.id !== nodeId));
    setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId));
    markDirty();
  }, [setNodes, setEdges, markDirty, pushHistory]);

  // ─── Selected node ────────────────────────────────────────────────────────

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const rfNode = nodes.find(n => n.id === selectedNodeId);
    if (!rfNode) return null;
    return {
      client_node_id: rfNode.id,
      kind:      rfNode.data.kind as NodeKind,
      title:     rfNode.data.title as string,
      position_x: Math.round(rfNode.position.x),
      position_y: Math.round(rfNode.position.y),
      data:      rfNode.data as Record<string, unknown>,
    };
  }, [nodes, selectedNodeId]);

  const handleNodeClick  = useCallback((_: unknown, node: Node) => {
    // While a run is being replayed, a node click inspects that step in the panel
    // (keeps the execution view open) rather than opening the node editor.
    if (runOverlay) { setRunFocusNodeId(node.id); return; }
    setSelectedNodeId(node.id);
    setHistoryOpen(false);
  }, [runOverlay]);
  const handlePaneClick  = useCallback(() => setSelectedNodeId(null), []);
  const handleRestored   = useCallback(() => window.location.reload(), []);
  const handlePublished  = useCallback(() => { setIsPublished(true); setHasUnpublished(false); setIsDirty(false); }, []);

  // ─── Empty state ──────────────────────────────────────────────────────────

  const isEmpty = enrichedNodes.length === 0;

  // ─── Walk mode: dim non-focus nodes + pan camera to the focus node ─────────
  const walkNodes = useMemo(() => {
    if (!walkMode) return displayNodes;
    return displayNodes.map((n) => ({
      ...n,
      style: {
        ...(n.style ?? {}),
        opacity: walkFocusNodeId && n.id !== walkFocusNodeId ? 0.28 : 1,
        transition: 'opacity .3s cubic-bezier(.4,0,.2,1)',
      },
    }));
  }, [walkMode, walkFocusNodeId, displayNodes]);

  const handleWalkFocus = useCallback((nodeId: string | null) => {
    setWalkFocusNodeId(nodeId);
    if (!nodeId) return;
    const n = nodesRef.current.find((x) => x.id === nodeId);
    if (!n) return;
    const w = (n.measured?.width ?? 248), h = (n.measured?.height ?? 120);
    rfInstance.current?.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 0.95, duration: 500 });
  }, []);

  const exitWalk = useCallback(() => {
    setWalkMode(false);
    setWalkFocusNodeId(null);
    setTimeout(() => rfInstance.current?.fitView({ padding: 0.2, duration: 400 }), 20);
  }, []);

  // ─── FlowUI context value (peek + preview + comment) ───────────────────────
  // onPreview/onComment are filled in by the doc-preview + comment-thread work;
  // for now they select the node so the inspector/thread surface opens.
  const flowUI = useMemo(() => ({
    setPeek: handleSetPeek,
    // "Preview doc/capture" → expand-in-place (level 2). Suppress peek; don't
    // open the node inspector (the preview surface stands on its own).
    onPreview: (id: string) => { setPeekNodeId(null); setExpandedNodeId(id); },
    onComment: (id: string) => setThreadNodeId((cur) => (cur === id ? null : id)),
    commentsByNode,
  }), [handleSetPeek, commentsByNode]);

  const peekNode     = peekNodeId && !expandedNodeId && !panelNodeId ? nodes.find(n => n.id === peekNodeId) ?? null : null;
  const threadNode   = threadNodeId ? nodes.find(n => n.id === threadNodeId) ?? null : null;
  const expandedNode = expandedNodeId ? nodes.find(n => n.id === expandedNodeId) ?? null : null;
  const panelNode    = panelNodeId ? nodes.find(n => n.id === panelNodeId) ?? null : null;

  return (
   <FlowUIContext.Provider value={flowUI}>
    <div className="h-[calc(100vh-48px)] flex">
      <div
        className="flex-none flex flex-col items-center py-3 border-r"
        style={{ width: 36, background: '#121317', borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <button
          onClick={() => setDocsOpen(o => !o)}
          title={docsOpen ? 'Hide docs' : 'Show docs to drag onto the canvas'}
          style={{
            width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
            background: docsOpen ? '#22252b' : 'transparent',
            border: '0.5px solid rgba(255,255,255,0.12)', color: '#a1a1aa', fontSize: 14, lineHeight: 1,
          }}
        >{docsOpen ? '‹' : '☰'}</button>
      </div>
      {docsOpen && <DocSidebar />}

      <div className="flex-1 relative flex flex-col overflow-hidden">
        <FlowHeader
          flow={{ ...flow, is_published: isPublished, has_unpublished_changes: hasUnpublished }}
          onWalkClick={() => setWalkMode(true)}
          saveState={saveState}
          saveError={saveError}
          isDirty={isDirty}
          onSaveNow={() => save()}
          lastSavedAt={lastSavedAt}
          hasUnpublishedChanges={hasUnpublished}
          historyOpen={historyOpen}
          onHistoryToggle={() => { setHistoryOpen(v => !v); setSelectedNodeId(null); }}
          onPublishClick={() => setPublishOpen(true)}
        />

        <div
          className="flex-1 relative overflow-hidden"
          style={{ background: T.canvasBg }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onMouseMove={handlePresenceMouseMove}
        >
          {/* Node-type palette — one accent icon per kind */}
          <div className="absolute top-4 right-4 z-20">
            <NodePaletteBar onAdd={handleAddNode} />
          </div>

          {/* Live presence — who else is editing */}
          <PresenceCluster peers={peers} />

          <ReactFlow
            style={{ width: '100%', height: '100%' }}
            nodes={walkNodes}
            edges={displayEdges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onInit={instance => {
              rfInstance.current = {
                getViewport: () => instance.getViewport(),
                setCenter:   (x, y, opts) => instance.setCenter(x, y, opts),
                fitView:     (opts) => instance.fitView(opts),
              };
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{ stroke: 'rgba(255,255,255,0.4)', strokeWidth: 1.5, strokeDasharray: '5,3' }}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
            minZoom={0.2}
            maxZoom={2}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={T.canvasDotGap}
              size={T.canvasDotSize}
              color={T.canvasDot}
            />

            {/* Remote cursors + selection rings (world space, ride pan/zoom) */}
            <PresenceWorld peers={peers} nodes={nodes} />

            <Panel position="top-left">
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={handleAutoArrange}
                  title="Lay the graph out top-to-bottom"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 30, padding: '0 11px', fontSize: 12, fontWeight: 500,
                    color: '#e4e4e7', background: '#18181b',
                    border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 7, cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 14, lineHeight: 1 }}>⤵</span> Auto-arrange
                </button>
                <button
                  onClick={() => rfInstance.current?.fitView({ padding: 0.2, duration: 400 })}
                  title="Fit all nodes in view"
                  style={{
                    height: 30, padding: '0 11px', fontSize: 12, fontWeight: 500,
                    color: '#a1a1aa', background: '#18181b',
                    border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 7, cursor: 'pointer',
                  }}
                >
                  Fit
                </button>
                <button
                  onClick={() => { setRunsOpen(o => { if (o) { setRunOverlay(null); setRunFocusNodeId(null); } return !o; }); setHistoryOpen(false); }}
                  title="Run history — see past executions and what each produced"
                  style={{
                    height: 30, padding: '0 11px', fontSize: 12, fontWeight: 500,
                    color: runsOpen ? '#2dd4bf' : '#a1a1aa', background: '#18181b',
                    border: `0.5px solid ${runsOpen ? 'rgba(45,212,191,0.4)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 7, cursor: 'pointer',
                  }}
                >
                  Runs
                </button>
              </div>
            </Panel>
            <Controls
              position="bottom-left"
              showInteractive={false}
              style={{
                background: '#18181b',
                border: '0.5px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
              }}
            />
            <MiniMap
              position="bottom-right"
              nodeColor={node => {
                const colors: Record<string, string> = {
                  instruction: '#fbbf24', doc: '#60a5fa',
                  docs: '#60a5fa', decision: '#a78bfa', capture: '#2dd4bf',
                };
                return colors[node.type ?? ''] || '#52525b';
              }}
              style={{
                background: '#111111',
                border: '0.5px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
              }}
              maskColor="rgba(10,10,10,0.6)"
              pannable zoomable
            />

            {/* Empty state */}
            {isEmpty && (
              <Panel position="top-center">
                <div style={{
                  marginTop: 120,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  pointerEvents: 'none',
                }}>
                  <div style={{ fontSize: 32 }}>⑂</div>
                  <p style={{ fontFamily: T.fontDisplay, fontSize: 22, color: '#fafafa', margin: 0 }}>
                    Start building a flow
                  </p>
                  <p style={{ fontSize: 14, color: '#52525b', margin: 0 }}>
                    Add an Instruction to tell Claude what to do first.
                  </p>
                </div>
              </Panel>
            )}
            {peekNode && <PeekTooltip node={peekNode} />}
            {threadNode && (
              <FlowCommentThread
                node={threadNode}
                comments={threadFor(threadNode.id)}
                onSubmit={(body) => addComment(threadNode.id, body)}
                onClose={() => setThreadNodeId(null)}
              />
            )}
          </ReactFlow>

          {/* Doc preview levels 2 & 3 (level 1 = peek tooltip above) */}
          {expandedNode && (
            <ExpandedDocPreview
              node={expandedNode}
              onOpenFull={() => { setPanelNodeId(expandedNode.id); setExpandedNodeId(null); }}
              onCollapse={() => setExpandedNodeId(null)}
            />
          )}
          {panelNode && <FullDocPanel node={panelNode} onClose={() => setPanelNodeId(null)} />}

          {/* In-canvas guided walk */}
          {walkMode && (
            <WalkOverlay
              flowSlug={flow.slug}
              version={isPublished ? 'published' : 'draft'}
              onFocus={handleWalkFocus}
              onExit={exitWalk}
            />
          )}
        </div>
      </div>

      {/* Right panels */}
      {historyOpen && !selectedNodeId && (
        <VersionHistoryPanel flowId={flow.id} onClose={() => setHistoryOpen(false)} onRestored={handleRestored} />
      )}
      {runsOpen && !selectedNodeId && (
        <RunHistoryPanel
          flowId={flow.id}
          onClose={() => { setRunsOpen(false); setRunOverlay(null); setRunFocusNodeId(null); }}
          onRunActive={(_runId, steps) => setRunOverlay(steps.length ? steps : null)}
          focusNodeId={runFocusNodeId}
          onFocusConsumed={() => setRunFocusNodeId(null)}
        />
      )}
      {selectedNode && !historyOpen && (
        <NodeInspector
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          onUpdateTitle={handleUpdateTitle}
          onUpdateData={handleUpdateData}
          onDeleteNode={handleDeleteNode}
        />
      )}
      {publishOpen && (
        <PublishModal flowId={flow.id} onClose={() => setPublishOpen(false)} onPublished={handlePublished} />
      )}
    </div>
   </FlowUIContext.Provider>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export function FlowCanvas({ flow }: { flow: Flow }) {
  return (
    <ReactFlowProvider>
      <InnerCanvas flow={flow} />
    </ReactFlowProvider>
  );
}
