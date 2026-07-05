import { useEffect, useState } from 'react';
import { ENTITY_LABELS, ENTITY_COLORS_CSS, EDGE_LABELS } from './constants';
import { openDocPreview } from '../../lib/preview';
import type { GraphNode, GraphEdge } from '../../lib/graph-types';

interface Props {
  node: GraphNode | null;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: React.RefObject<any>;  // the ForceGraph2D ref
  containerRef: React.RefObject<HTMLDivElement | null>;  // the graph wrapper (for canvas offset)
  onClose: () => void;
  onOpenNode: (id: string) => void;
}

export function NodeCard3D({ node, edges, allNodes, fgRef, containerRef, onClose, onOpenNode }: Props) {
  const [pos, setPos] = useState<{x:number;y:number}|null>(null);

  useEffect(() => {
    if (!node || !fgRef) { setPos(null); return; }

    // ForceGraph2D: graph2ScreenCoords returns coords RELATIVE TO THE CANVAS
    // (0,0 = canvas top-left), not the viewport. The card is position:fixed, so we
    // must add the canvas's viewport offset — otherwise the card opens shifted by
    // the sidebar/topbar (e.g. 220px left, 44px up) and is easy to miss entirely.
    const screenPt = fgRef.current?.graph2ScreenCoords(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node as any).x ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node as any).y ?? 0,
    );
    if (!screenPt) { setPos(null); return; }

    const rect = containerRef?.current?.getBoundingClientRect();
    const offX = rect?.left ?? 0;
    const offY = rect?.top ?? 0;
    const sx = screenPt.x + offX;
    const sy = screenPt.y + offY;

    setPos({
      x: sx > window.innerWidth / 2
        ? Math.max(sx - 370, 10)          // open to the LEFT when node is right-side
        : Math.min(sx + 20, window.innerWidth - 350),  // open to the RIGHT when left-side
      y: Math.max(Math.min(sy - 80, window.innerHeight - 520), 20),
    });
  }, [node]); // fgRef excluded — snapshot at click time

  if (!pos || !node) return null;
  const color = ENTITY_COLORS_CSS[node.entityType]??'#888';
  const label = ENTITY_LABELS[node.entityType]??node.entityType;
  const conns = edges.filter(e=>e.fromNodeId===node.id||e.toNodeId===node.id).slice(0,5);

  return (
    <div style={{ position:'fixed', left:pos.x, top:pos.y, width:320, zIndex:1000,
      maxHeight:'calc(100vh - 32px)', overflowY:'auto', overflowX:'hidden',
      background:'rgba(8,8,8,0.94)', backdropFilter:'blur(20px)',
      border:`0.5px solid ${color}44`, borderRadius:14, padding:20,
      fontFamily:'var(--sans)' }}>
      <button onClick={onClose} style={{ position:'absolute',top:10,right:12,background:'none',border:'none',cursor:'pointer',color:'#52525b',fontSize:18 }}>×</button>
      <div style={{ display:'inline-flex',alignItems:'center',background:`${color}18`,border:`0.5px solid ${color}40`,borderRadius:6,padding:'3px 10px',marginBottom:10,fontSize:10,fontFamily:"'Geist Mono',monospace",color,textTransform:'uppercase' as const,letterSpacing:'0.04em' }}>{label}</div>
      <h3 style={{ fontSize:15,fontWeight:500,color:'#fafafa',margin:'0 0 6px',lineHeight:1.35 }}>{node.label}</h3>
      {node.summary && <p style={{ fontSize:12,color:'#a1a1aa',lineHeight:1.55,margin:'0 0 12px' }}>{node.summary}</p>}
      {node.isGodNode && <div style={{ fontSize:11,color:'#fbbf24',background:'rgba(251,191,36,0.08)',border:'0.5px solid rgba(251,191,36,0.2)',borderRadius:6,padding:'5px 10px',marginBottom:12 }}>⚡ Highly connected — central to this knowledge base</div>}
      <div style={{ height:'0.5px',background:'rgba(255,255,255,0.06)',margin:'0 0 10px' }} />
      {conns.length>0 && (<>
        <p style={{ fontSize:10,color:'#52525b',fontFamily:"'Geist Mono',monospace",textTransform:'uppercase' as const,letterSpacing:'0.04em',margin:'0 0 8px' }}>Connections</p>
        <div style={{ display:'flex',flexDirection:'column',gap:5,marginBottom:14 }}>
          {conns.map(edge=>{
            const out=edge.fromNodeId===node.id; const othId=out?edge.toNodeId:edge.fromNodeId;
            const oth=allNodes.find(n=>n.id===othId); if(!oth) return null;
            const oc=ENTITY_COLORS_CSS[oth.entityType]??'#888';
            return (<div key={edge.id} onClick={()=>onOpenNode(othId)} style={{ background:'rgba(255,255,255,0.03)',border:'0.5px solid rgba(255,255,255,0.07)',borderRadius:7,padding:'7px 10px',cursor:'pointer' }}>
              <div style={{ fontSize:10,color:'#52525b',fontFamily:"'Geist Mono',monospace",marginBottom:3 }}>{out?'→':'←'} {EDGE_LABELS[edge.edgeType ?? '']??edge.edgeType}</div>
              <div style={{ fontSize:12,color:'#fafafa' }}><span style={{ display:'inline-block',width:6,height:6,borderRadius:'50%',background:oc,marginRight:6,verticalAlign:'middle' }}/>{oth.label}</div>
              {edge.rationale && <div style={{ fontSize:11,color:'#a1a1aa',fontStyle:'italic',lineHeight:1.4,marginTop:3 }}>"{edge.rationale}"</div>}
            </div>);
          })}
        </div>
      </>)}
      {['doc','flow','task'].includes(node.entityType) && (
        <div style={{ display:'flex', gap:6 }}>
          {node.entityType==='doc' && node.entityId && (
            <button
              onClick={() => openDocPreview(node.entityId!)}
              style={{ flex:'0 0 auto',background:'rgba(255,255,255,0.05)',border:'0.5px solid rgba(255,255,255,0.10)',borderRadius:8,padding:'9px 12px',cursor:'pointer',color:'#fafafa',fontSize:12 }}>
              Preview
            </button>
          )}
          <a href={`/app/${node.entityType==='doc'?'docs':node.entityType==='flow'?'flows':'kanban'}/${node.entityId}`}
            style={{ flex:1,display:'block',textAlign:'center' as const,background:'rgba(255,255,255,0.05)',border:'0.5px solid rgba(255,255,255,0.10)',borderRadius:8,padding:9,textDecoration:'none',color:'#fafafa',fontSize:12 }}>
            Open {label.split(' ').pop()} →
          </a>
        </div>
      )}
    </div>
  );
}
