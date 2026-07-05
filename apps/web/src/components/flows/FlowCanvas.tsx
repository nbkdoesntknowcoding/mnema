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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './flow-canvas.css';

import { DocNode }         from './nodes/DocNode';
import { DocsNode }        from './nodes/DocsNode';
import { InstructionNode } from './nodes/InstructionNode';
import { DecisionNode }    from './nodes/DecisionNode';
import { FlowEdge }        from './edges/FlowEdge';
import { BranchEdge }      from './edges/BranchEdge';
import { NodeInspector }   from './NodeInspector';
import { FlowHeader, type SaveState } from './FlowHeader';
import { WalkSimulator }        from './WalkSimulator';
import { DocSidebar }           from './DocSidebar';
import { AddNodePalette }       from './AddNodePalette';
import { VersionHistoryPanel }  from './VersionHistoryPanel';
import { PublishModal }         from './PublishModal';
import { detectCycle }          from '../../lib/flows/cycle-detect';
import { FLOW_TOKENS as T }     from './tokens';

export interface Flow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  published_version_id: string | null;
  draft_version_id: string;
  has_unpublished_changes: boolean;
  is_published: boolean;
  nodes: Array<{
    client_node_id: string;
    kind: 'doc' | 'docs' | 'instruction' | 'decision';
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

type NodeKind = 'doc' | 'docs' | 'instruction' | 'decision';

// ─── Adapters ─────────────────────────────────────────────────────────────────

function mnemaNodeToRF(n: Flow['nodes'][number]): Node {
  return {
    id: n.client_node_id,
    type: n.kind,
    position: { x: n.position_x, y: n.position_y },
    data: { ...n.data, title: n.title, kind: n.kind },
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
  doc: DocNode, docs: DocsNode, instruction: InstructionNode, decision: DecisionNode,
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
  }
}

// ─── Inner canvas ─────────────────────────────────────────────────────────────

interface InnerProps { flow: Flow }

function InnerCanvas({ flow }: InnerProps) {
  const initialNodes = useMemo(() => flow.nodes.map(mnemaNodeToRF), [flow.nodes]);
  const initialEdges = useMemo(() =>
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

  const [selectedNodeId, setSelectedNodeId]       = useState<string | null>(null);
  const [walkMode,       setWalkMode]             = useState(false);
  const [historyOpen,    setHistoryOpen]          = useState(false);
  const [publishOpen,    setPublishOpen]          = useState(false);
  const [saveState,      setSaveState]            = useState<SaveState>('idle');
  const [saveError,      setSaveError]            = useState<string | null>(null);
  const [isDirty,        setIsDirty]              = useState(false);
  const [lastSavedAt,    setLastSavedAt]          = useState<Date | null>(null);
  const [isPublished,    setIsPublished]          = useState(!!flow.is_published);
  const [hasUnpublished, setHasUnpublished]       = useState(flow.has_unpublished_changes ?? !flow.is_published);

  const rfInstance   = useRef<{ getViewport: () => { x: number; y: number; zoom: number }; setCenter: (x: number, y: number, opts?: { zoom?: number; duration?: number }) => void } | null>(null);
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
    const lastNode = nodesRef.current.reduce<Node | null>(
      (prev, n) => (!prev || n.position.y > prev.position.y ? n : prev), null,
    );
    const pos = lastNode
      ? { x: lastNode.position.x, y: lastNode.position.y + 180 }
      : { x: 400, y: 200 };

    const label = kind === 'doc' ? 'New Doc' : kind === 'docs' ? 'New Docs'
      : kind === 'instruction' ? 'New Instruction' : 'New Decision';
    const id = makeClientNodeId(label, nodesRef.current);
    const newNode: Node = {
      id, type: kind,
      position: pos,
      data: { ...defaultData(kind), title: label, kind },
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

  const handleNodeClick  = useCallback((_: unknown, node: Node) => { setSelectedNodeId(node.id); setHistoryOpen(false); }, []);
  const handlePaneClick  = useCallback(() => setSelectedNodeId(null), []);
  const handleRestored   = useCallback(() => window.location.reload(), []);
  const handlePublished  = useCallback(() => { setIsPublished(true); setHasUnpublished(false); setIsDirty(false); }, []);

  // ─── Empty state ──────────────────────────────────────────────────────────

  const isEmpty = enrichedNodes.length === 0;

  return (
    <div className="h-[calc(100vh-48px)] flex">
      <DocSidebar />

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
        >
          {/* Add node palette */}
          <div className="absolute top-4 right-4 z-20">
            <AddNodePalette onAdd={handleAddNode} />
          </div>

          <ReactFlow
            style={{ width: '100%', height: '100%' }}
            nodes={enrichedNodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onInit={instance => {
              rfInstance.current = {
                getViewport: () => instance.getViewport(),
                setCenter:   (x, y, opts) => instance.setCenter(x, y, opts),
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
                  docs: '#60a5fa', decision: '#a78bfa',
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
          </ReactFlow>
        </div>
      </div>

      {/* Right panels */}
      {historyOpen && !selectedNodeId && (
        <VersionHistoryPanel flowId={flow.id} onClose={() => setHistoryOpen(false)} onRestored={handleRestored} />
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
      {walkMode && (
        <WalkSimulator
          flowSlug={flow.slug}
          version={isPublished ? 'published' : 'draft'}
          onClose={() => setWalkMode(false)}
        />
      )}
      {publishOpen && (
        <PublishModal flowId={flow.id} onClose={() => setPublishOpen(false)} onPublished={handlePublished} />
      )}
    </div>
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
