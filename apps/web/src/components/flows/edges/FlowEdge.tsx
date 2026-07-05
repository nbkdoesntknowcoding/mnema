import { BaseEdge, getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { FLOW_TOKENS as T } from '../tokens';

export function FlowEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();

  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 12,
  });

  return (
    <>
      {/* Base static path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke:      selected ? T.edgeColorSelected : T.edgeColor,
          strokeWidth: T.edgeWidth,
        }}
      />

      {/* Animated flowing dash */}
      <path
        d={edgePath}
        fill="none"
        stroke={selected ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)'}
        strokeWidth={1.5}
        strokeDasharray="6 16"
        strokeLinecap="round"
        style={{ animation: `flowDash ${T.edgeAnimDuration} linear infinite` }}
        onClick={() => setEdges(es => es.filter(e => e.id !== id))}
      />
    </>
  );
}
