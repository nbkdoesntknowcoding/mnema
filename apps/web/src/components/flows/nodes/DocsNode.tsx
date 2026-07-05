import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NodeShell, TypeBadge } from './NodeShell';
import { FLOW_TOKENS as T, handleStyle } from '../tokens';

interface DocsNodeData extends Record<string, unknown> {
  title: string;
  kind: 'docs';
  doc_ids?: string[];
  instruction?: string;
  isEntry?: boolean;
  hasOutgoingEdge?: boolean;
}

export function DocsNode({ data, selected, isConnectable }: NodeProps) {
  const d = data as DocsNodeData;
  const count = d.doc_ids?.length ?? 0;

  return (
    <NodeShell kind="docs" selected={!!selected} isEntry={d.isEntry} isExit={!d.hasOutgoingEdge}>
      <TypeBadge label="References" icon="📚" colour={T.docs.accent} />

      {count > 0
        ? <p style={{ fontSize: 13, color: '#fafafa', lineHeight: 1.5, margin: 0 }}>
            {count} doc{count === 1 ? '' : 's'} linked
          </p>
        : <div style={{
            fontSize: 12, color: '#fbbf24',
            background: 'rgba(251,191,36,0.08)',
            border: '0.5px solid rgba(251,191,36,0.2)',
            borderRadius: 6, padding: '6px 10px',
          }}>⚠ No docs linked — click to add</div>
      }

      {d.instruction && (
        <p style={{ fontSize: 11, color: '#52525b', marginTop: 6, marginBottom: 0, fontStyle: 'italic',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          "{d.instruction}"
        </p>
      )}

      <Handle type="target" position={Position.Top}    isConnectable={isConnectable} style={handleStyle()} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} style={handleStyle()} />
    </NodeShell>
  );
}
