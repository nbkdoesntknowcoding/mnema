import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NodeShell, TypeBadge } from './NodeShell';
import { FLOW_TOKENS as T, handleStyle } from '../tokens';

interface InstructionData extends Record<string, unknown> {
  title: string;
  kind: 'instruction';
  text?: string;
  pause_for_user_input?: boolean;
  isEntry?: boolean;
  hasOutgoingEdge?: boolean;
}

export function InstructionNode({ data, selected, isConnectable }: NodeProps) {
  const d = data as InstructionData;
  const preview = d.text
    ? (d.text.length > 80 ? d.text.slice(0, 78) + '…' : d.text)
    : null;

  return (
    <NodeShell kind="instruction" selected={!!selected} isEntry={d.isEntry} isExit={!d.hasOutgoingEdge}>
      <TypeBadge label="Directive" icon="⚡" colour={T.instruction.accent} />

      {preview
        ? <p style={{ fontSize: 13, color: '#fafafa', lineHeight: 1.5, margin: 0 }}>{preview}</p>
        : <p style={{ fontSize: 13, color: '#52525b', lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>No instruction written</p>
      }

      {d.pause_for_user_input && (
        <div style={{
          marginTop: 8, display: 'flex', alignItems: 'center', gap: 5,
          fontFamily: T.fontMono, fontSize: 9.5, color: T.instruction.accent,
          background: 'rgba(234,179,8,0.08)', border: '0.5px solid rgba(234,179,8,0.2)',
          borderRadius: 4, padding: '3px 7px',
        }}>
          ⏸ Pause for user
        </div>
      )}

      <Handle type="target" position={Position.Top}    isConnectable={isConnectable} style={handleStyle()} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} style={handleStyle()} />
    </NodeShell>
  );
}
