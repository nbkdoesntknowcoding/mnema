import { type NodeProps } from '@xyflow/react';
import { NodeShell, PreviewButton } from './NodeShell';
import { FLOW_TOKENS as T } from '../tokens';
import { useFlowUI } from '../flow-ui-context';

interface CaptureData extends Record<string, unknown> {
  title: string;
  kind: 'capture';
  title_hint?: string;
  instruction?: string;
  target_folder_id?: string;
  autonomous?: boolean;
  isEntry?: boolean;
  hasOutgoingEdge?: boolean;
}

export function CaptureNode({ id, data, selected, isConnectable }: NodeProps) {
  const d = data as CaptureData;
  const { setPeek, onPreview, onComment, commentsByNode } = useFlowUI();
  const accent = T.capture.accent;
  const isExit = !d.hasOutgoingEdge;

  const body = d.instruction
    ? <>{d.title_hint ? <span style={{ color: accent }}>→ {d.title_hint}<br /></span> : null}{d.instruction}</>
    : (d.title_hint
        ? <span style={{ color: accent }}>→ {d.title_hint}</span>
        : <span style={{ fontStyle: 'italic', color: 'var(--ink-muted)' }}>No capture instruction written</span>);

  return (
    <div onMouseEnter={() => setPeek(id)} onMouseLeave={() => setPeek(null)}>
      <NodeShell
        id={id}
        accent={accent}
        eyebrow="CAPTURE"
        title={d.title}
        body={body}
        selected={!!selected}
        isCapture
        connectable={isConnectable}
        commentCount={commentsByNode[id]}
        onComment={() => onComment(id)}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isExit && <PreviewButton accent={accent} label="Preview capture" onClick={() => onPreview(id)} />}
            {d.autonomous && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--status-warn)',
                background: 'rgba(255,122,138,0.08)', border: '1px solid rgba(255,122,138,0.25)',
                borderRadius: 4, padding: '3px 7px',
              }}>⚠ Autonomous</span>
            )}
          </div>
        }
      />
    </div>
  );
}
