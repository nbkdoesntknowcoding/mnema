import { type NodeProps } from '@xyflow/react';
import { NodeShell } from './NodeShell';
import { FLOW_TOKENS as T } from '../tokens';
import { useFlowUI } from '../flow-ui-context';

interface DocsNodeData extends Record<string, unknown> {
  title: string;
  kind: 'docs';
  doc_ids?: string[];
  instruction?: string;
  isEntry?: boolean;
  hasOutgoingEdge?: boolean;
}

export function DocsNode({ id, data, selected, isConnectable }: NodeProps) {
  const d = data as DocsNodeData;
  const { setPeek, onComment, commentsByNode } = useFlowUI();
  const accent = T.docs.accent;
  const count = d.doc_ids?.length ?? 0;

  const body = count > 0
    ? (d.instruction || `${count} doc${count === 1 ? '' : 's'} linked`)
    : <span style={{ color: T.directive.accent }}>⚠ No docs linked — click to add</span>;

  return (
    <div onMouseEnter={() => setPeek(id)} onMouseLeave={() => setPeek(null)}>
      <NodeShell
        id={id}
        accent={accent}
        eyebrow="DOCS"
        title={d.title}
        body={body}
        selected={!!selected}
        connectable={isConnectable}
        commentCount={commentsByNode[id]}
        onComment={() => onComment(id)}
      />
    </div>
  );
}
