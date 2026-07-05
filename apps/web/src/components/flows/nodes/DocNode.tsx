import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NodeShell, TypeBadge } from './NodeShell';
import { FLOW_TOKENS as T, handleStyle } from '../tokens';
import { openDocPreview } from '../../../lib/preview';

interface DocNodeData extends Record<string, unknown> {
  title: string;
  kind: 'doc';
  doc_id?: string;
  doc_title?: string;
  instruction?: string;
  isEntry?: boolean;
  hasOutgoingEdge?: boolean;
}

export function DocNode({ data, selected, isConnectable }: NodeProps) {
  const d = data as DocNodeData;
  const hasDoc = !!d.doc_title || !!d.doc_id;

  return (
    <NodeShell kind="doc" selected={!!selected} isEntry={d.isEntry} isExit={!d.hasOutgoingEdge}>
      <TypeBadge label="Reference" icon="📄" colour={T.doc.accent} />

      {hasDoc
        ? <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <p style={{ flex: 1, fontSize: 13, color: '#fafafa', lineHeight: 1.5, margin: 0 }}>
              {d.doc_title ?? (d.doc_id ? d.doc_id.slice(0, 8) + '…' : '')}
            </p>
            {d.doc_id && (
              <button
                className="nodrag nopan"
                title="Preview doc"
                onClick={(e) => { e.stopPropagation(); openDocPreview(d.doc_id!); }}
                style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#a1a1aa', padding: 0, marginTop: 1, lineHeight: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            )}
          </div>
        : <div style={{
            fontSize: 12, color: '#fbbf24',
            background: 'rgba(251,191,36,0.08)',
            border: '0.5px solid rgba(251,191,36,0.2)',
            borderRadius: 6, padding: '6px 10px',
          }}>⚠ No doc linked — click to select</div>
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
