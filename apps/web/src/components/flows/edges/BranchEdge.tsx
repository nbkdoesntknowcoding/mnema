import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { FLOW_TOKENS as T } from '../tokens';

export function BranchEdge({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  selected, data, label,
}: EdgeProps) {
  const { setEdges } = useReactFlow();

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 12,
  });

  const branchLabel = (label as string) || (data?.branch as string) || '';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke:      selected ? T.edgeColorSelected : T.edgeColor,
          strokeWidth: T.edgeWidth,
        }}
      />

      {/* Violet animated dash for branch edges */}
      <path
        d={edgePath}
        fill="none"
        stroke={selected ? 'rgba(139,92,246,0.6)' : 'rgba(139,92,246,0.3)'}
        strokeWidth={1.5}
        strokeDasharray="6 16"
        strokeLinecap="round"
        style={{ animation: `flowDash ${T.edgeAnimDuration} linear infinite` }}
      />

      {/* Branch label pill at midpoint */}
      {branchLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 10,
            }}
            className="nodrag nopan"
          >
            <span style={{
              display: 'inline-block',
              fontFamily: T.fontMono,
              fontSize: 10, fontWeight: 500,
              textTransform: 'lowercase',
              letterSpacing: '0.02em',
              background: T.branchPillBg,
              border: `0.5px solid ${T.branchPillBorder}`,
              color: T.branchPillText,
              borderRadius: 5,
              padding: '3px 8px',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}>
              {branchLabel}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
