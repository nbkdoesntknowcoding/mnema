import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NodeShell, TypeBadge } from './NodeShell';
import { FLOW_TOKENS as T, handleStyle } from '../tokens';

interface DecisionNodeData extends Record<string, unknown> {
  title: string;
  kind: 'decision';
  condition?: string;
  question?: string;
  branches?: Record<string, unknown>;
  isEntry?: boolean;
  // Decision nodes never get isExit
}

export function DecisionNode({ data, selected, isConnectable }: NodeProps) {
  const d = data as DecisionNodeData;
  const branches = Object.keys(d.branches ?? { yes: null, no: null });
  const branchCount = branches.length;
  // Evenly space handles: 2 branches → 33%/67%, 3 → 25%/50%/75%
  const branchPositions = branches.map((_, i) => ((i + 1) / (branchCount + 1)) * 100);
  const question = d.question ?? d.condition;

  return (
    <NodeShell kind="decision" selected={!!selected} isEntry={d.isEntry}>
      <TypeBadge label="Decision" icon="⑂" colour={T.decision.accent} />

      {question
        ? <p style={{
            fontSize: 14, fontFamily: T.fontDisplay,
            color: '#fafafa', lineHeight: 1.4,
            margin: '0 0 10px 0', fontWeight: 400,
          }}>{question}</p>
        : <p style={{ fontSize: 13, color: '#52525b', fontStyle: 'italic', margin: '0 0 10px 0' }}>
            No question written
          </p>
      }

      {/* Branch chips */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 4 }}>
        {branches.map(branch => (
          <span key={branch} style={{
            fontFamily: T.fontMono, fontSize: 10,
            background: T.branchPillBg,
            border: `0.5px solid ${T.branchPillBorder}`,
            color: T.branchPillText,
            borderRadius: 5, padding: '3px 8px',
          }}>{branch}</span>
        ))}
      </div>

      {/* Single target handle — top centre */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={isConnectable}
        style={handleStyle()}
      />

      {/* One source handle per branch, evenly spaced at bottom */}
      {branches.map((branch, i) => (
        <Handle
          key={branch}
          id={branch}
          type="source"
          position={Position.Bottom}
          isConnectable={isConnectable}
          style={handleStyle({
            left:      `${branchPositions[i]}%`,
            transform: 'translateX(-50%)',
            bottom:    -6,
          })}
        />
      ))}
    </NodeShell>
  );
}
