import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, useInternalNode, type EdgeProps } from '@xyflow/react';
import { FLOW_TOKENS as T } from '../tokens';

const rest = (accent: string) => accent + '4d';

/** Branch (If/Else) edge — red-tinted, with a mono label pill at the midpoint. */
export function BranchEdge({
  id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, label,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const accent = (data?.accent as string) ?? T.decision.accent;
  const active = !!data?.active;

  // Pin X to the node borders (see FlowEdge) so the branch line runs edge-to-edge.
  const sx = sourceNode ? sourceNode.internals.positionAbsolute.x + (sourceNode.measured?.width ?? 0) : sourceX;
  const tx = targetNode ? targetNode.internals.positionAbsolute.x : targetX;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: sx, sourceY, sourcePosition,
    targetX: tx, targetY, targetPosition,
    borderRadius: 12,
  });

  const branchLabel = (label as string) || (data?.branch as string) || '';

  return (
    <>
      <BaseEdge id={id} path={edgePath}
        style={{ stroke: active ? accent : rest(accent), strokeWidth: T.edgeWidth }} />

      {active && (
        <>
          <path d={edgePath} fill="none" stroke={accent} strokeWidth={5}
            style={{ opacity: 0.28, filter: 'blur(3px)' }} />
          <path d={edgePath} fill="none" stroke={accent} strokeWidth={1.6}
            strokeDasharray="5 7" strokeLinecap="round"
            style={{ animation: `mnDash ${T.edgeAnimDuration} linear infinite` }} />
        </>
      )}

      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={14}
        style={{ cursor: 'pointer' }} onClick={() => setEdges(es => es.filter(e => e.id !== id))} />

      {branchLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all', zIndex: 10,
            }}
          >
            <span style={{
              display: 'inline-block', fontFamily: T.fontMono, fontSize: 10, fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              background: T.branchPillBg, border: `1px solid ${T.branchPillBorder}`, color: T.branchPillText,
              borderRadius: 5, padding: '3px 8px', whiteSpace: 'nowrap', userSelect: 'none',
            }}>{branchLabel}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
