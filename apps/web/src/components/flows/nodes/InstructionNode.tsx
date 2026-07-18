import { type NodeProps } from '@xyflow/react';
import { NodeShell } from './NodeShell';
import { accentFor } from '../tokens';
import { useFlowUI } from '../flow-ui-context';

interface InstructionData extends Record<string, unknown> {
  title: string;
  kind: 'instruction';
  text?: string;
  pause_for_user_input?: boolean;
  isEntry?: boolean;
  hasOutgoingEdge?: boolean;
}

export function InstructionNode({ id, data, selected, isConnectable }: NodeProps) {
  const d = data as InstructionData;
  const { setPeek, onComment, commentsByNode } = useFlowUI();
  const isDirective = !!d.isEntry;
  const accent = accentFor('instruction', isDirective);

  const body = d.text
    ? d.text
    : <span style={{ fontStyle: 'italic', color: 'var(--ink-muted)' }}>No instruction written</span>;

  return (
    <div onMouseEnter={() => setPeek(id)} onMouseLeave={() => setPeek(null)}>
      <NodeShell
        id={id}
        accent={accent}
        eyebrow={isDirective ? 'DIRECTIVE' : 'STEP'}
        title={d.title}
        body={body}
        selected={!!selected}
        isStart={isDirective}
        connectable={isConnectable}
        commentCount={commentsByNode[id]}
        onComment={() => onComment(id)}
        footer={d.pause_for_user_input ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontFamily: 'var(--mono)', fontSize: 9.5, color: accent,
            background: accent + '14', border: `1px solid ${accent}33`,
            borderRadius: 4, padding: '3px 7px',
          }}>⏸ Pause for user</span>
        ) : undefined}
      />
    </div>
  );
}
