import { BaseEdge, getSmoothStepPath, useReactFlow, useInternalNode, type EdgeProps } from '@xyflow/react';
import { FLOW_TOKENS as T } from '../tokens';

/** resting edge stroke — accent at ~30% so it reads without washing out. */
const rest = (accent: string) => accent + '4d';

/**
 * Horizontal flow edge. The endpoints are pinned to the exact node borders
 * (source's right edge → target's left edge) rather than xyflow's handle
 * position, which insets short of the node and leaves a visible gap. This makes
 * the line run edge-to-edge, meeting the connection dot that sits on the border.
 * When "active" (source/target hovered/selected/walk-focus, via data.active) it
 * gains a blurred glow + a travelling animated dash.
 */
export function FlowEdge({
  id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const accent = (data?.accent as string) ?? '#b8bcc4';
  const active = !!data?.active;

  // X pinned to the node borders; Y kept from the handle (so branch/height
  // offsets stay correct).
  const sx = sourceNode ? sourceNode.internals.positionAbsolute.x + (sourceNode.measured?.width ?? 0) : sourceX;
  const tx = targetNode ? targetNode.internals.positionAbsolute.x : targetX;

  const [edgePath] = getSmoothStepPath({
    sourceX: sx, sourceY, sourcePosition,
    targetX: tx, targetY, targetPosition,
    borderRadius: 12,
  });

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

      {/* invisible wide hit-target: click to delete */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={14}
        style={{ cursor: 'pointer' }} onClick={() => setEdges(es => es.filter(e => e.id !== id))} />
    </>
  );
}
