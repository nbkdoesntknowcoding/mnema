import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NodeShell } from './NodeShell';
import { FLOW_TOKENS as T, handleStyle } from '../tokens';
import { useFlowUI } from '../flow-ui-context';

interface DecisionNodeData extends Record<string, unknown> {
  title: string;
  kind: 'decision';
  condition?: string;
  question?: string;
  branches?: Record<string, unknown>;
  isEntry?: boolean;
}

export function DecisionNode({ id, data, selected, isConnectable }: NodeProps) {
  const d = data as DecisionNodeData;
  const { setPeek, onComment, commentsByNode } = useFlowUI();
  const accent = T.decision.accent;

  const branches = Object.keys(d.branches ?? { if: null, else: null });
  const n = branches.length;
  // 2 branches → 30% / 70% (matches the design fork); N → evenly spaced.
  const yFor = (i: number) => (n === 2 ? (i === 0 ? 30 : 70) : ((i + 1) / (n + 1)) * 100);
  const question = d.question ?? d.condition ?? d.title;

  const customHandles = (
    <>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable}
        style={handleStyle(accent, { top: 30 })} />
      {branches.map((branch, i) => (
        <div key={branch}>
          <span style={{
            position: 'absolute', right: 8, top: `${yFor(i)}%`, transform: 'translateY(-140%)',
            fontFamily: T.fontMono, fontSize: 8.5, letterSpacing: '0.08em',
            color: i === 0 ? accent : 'var(--ink-muted)', pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>{branch.toUpperCase()} →</span>
          <Handle
            id={branch}
            type="source"
            position={Position.Right}
            isConnectable={isConnectable}
            style={handleStyle(accent, { top: `${yFor(i)}%` })}
          />
        </div>
      ))}
    </>
  );

  return (
    <div onMouseEnter={() => setPeek(id)} onMouseLeave={() => setPeek(null)}>
      <NodeShell
        id={id}
        accent={accent}
        eyebrow="IF / ELSE"
        title={question}
        body={d.title !== question ? d.title : undefined}
        selected={!!selected}
        notched
        connectable={isConnectable}
        commentCount={commentsByNode[id]}
        onComment={() => onComment(id)}
        width={220}
        customHandles={customHandles}
      />
    </div>
  );
}
