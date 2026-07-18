import { type NodeProps } from '@xyflow/react';
import { NodeShell, PreviewButton } from './NodeShell';
import { FLOW_TOKENS as T } from '../tokens';
import { useFlowUI } from '../flow-ui-context';

interface DocNodeData extends Record<string, unknown> {
  title: string;
  kind: 'doc';
  doc_id?: string;
  doc_title?: string;
  instruction?: string;
  isEntry?: boolean;
  hasOutgoingEdge?: boolean;
}

export function DocNode({ id, data, selected, isConnectable }: NodeProps) {
  const d = data as DocNodeData;
  const { setPeek, onPreview, onComment, commentsByNode } = useFlowUI();
  const accent = T.doc.accent;
  const hasDoc = !!d.doc_title || !!d.doc_id;

  const body = hasDoc
    ? (d.instruction || d.doc_title || d.title)
    : <span style={{ color: T.directive.accent }}>⚠ No doc linked — click to select</span>;

  return (
    <div onMouseEnter={() => setPeek(id)} onMouseLeave={() => setPeek(null)}>
      <NodeShell
        id={id}
        accent={accent}
        eyebrow="DOC"
        title={d.doc_title ?? d.title}
        body={body}
        selected={!!selected}
        connectable={isConnectable}
        commentCount={commentsByNode[id]}
        onComment={() => onComment(id)}
        footer={hasDoc ? <PreviewButton accent={accent} label="Preview doc" onClick={() => onPreview(id)} /> : undefined}
      />
    </div>
  );
}
