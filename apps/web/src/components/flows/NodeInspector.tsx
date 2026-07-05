import { useState } from 'react';
import { X, FileText, Layers, MessageSquare, GitBranch, Trash2, Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { MonoLabel } from '../ui/typography';
import { DocPicker } from './DocPicker';

interface FlowNode {
  client_node_id: string;
  kind: 'doc' | 'docs' | 'instruction' | 'decision';
  title: string;
  position_x: number;
  position_y: number;
  data: Record<string, unknown>;
}

interface Props {
  node: FlowNode;
  onClose: () => void;
  onUpdateTitle: (nodeId: string, title: string) => void;
  onUpdateData: (nodeId: string, data: Partial<Record<string, unknown>>) => void;
  onDeleteNode: (nodeId: string) => void;
}

function InlineWarning({ msg }: { msg: string }) {
  return (
    <p style={{
      fontSize: 11.5, color: '#fbbf24',
      background: 'rgba(251,191,36,0.07)',
      border: '0.5px solid rgba(251,191,36,0.18)',
      borderRadius: 5, padding: '5px 9px', marginTop: 5,
    }}>⚠ {msg}</p>
  );
}

export function NodeInspector({ node, onClose, onUpdateTitle, onUpdateData, onDeleteNode }: Props) {
  const handleDelete = () => {
    if (!confirm(`Delete node "${node.title}"?`)) return;
    onDeleteNode(node.client_node_id);
    onClose();
  };

  return (
    <aside
      className="w-[360px] h-full border-l border-[var(--line)] bg-[var(--surface)] flex flex-col"
      style={{ boxShadow: '-16px 0 40px -16px rgba(0,0,0,0.5)' }}
    >
      <div className="flex items-center justify-between px-5 h-14 border-b border-[var(--line)]">
        <div className="flex items-center gap-2">
          <KindIcon kind={node.kind} />
          <MonoLabel>{node.kind}</MonoLabel>
        </div>
        <button onClick={onClose} className="text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors" aria-label="Close">
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Title */}
        <div>
          <MonoLabel className="block mb-1.5">Title</MonoLabel>
          <input
            type="text"
            value={node.title}
            onChange={e => onUpdateTitle(node.client_node_id, e.target.value)}
            className="w-full text-[15px] font-medium text-[var(--ink)] bg-transparent border border-transparent rounded-[var(--radius-sm)] px-1 py-0.5 -mx-1 focus:bg-[var(--canvas)] focus:border-[var(--line-bright)] outline-none transition-colors leading-[1.3]"
            placeholder="Node title"
          />
        </div>

        {/* Node ID — no canvas coordinates */}
        <div>
          <MonoLabel className="block mb-1.5">Node ID</MonoLabel>
          <code className="text-[12px] font-mono text-[var(--ink-soft)] bg-[var(--canvas)] px-2 py-1 rounded-[var(--radius-sm)]">
            {node.client_node_id}
          </code>
        </div>

        {node.kind === 'doc'         && <DocInspectorBody         data={node.data} onChange={p => onUpdateData(node.client_node_id, p)} />}
        {node.kind === 'docs'        && <DocsInspectorBody        data={node.data} onChange={p => onUpdateData(node.client_node_id, p)} />}
        {node.kind === 'instruction' && <InstructionInspectorBody data={node.data} onChange={p => onUpdateData(node.client_node_id, p)} />}
        {node.kind === 'decision'    && <DecisionInspectorBody    data={node.data} onChange={p => onUpdateData(node.client_node_id, p)} />}
      </div>

      <div className="border-t border-[var(--line)] px-5 py-3">
        <Button variant="danger" size="sm" className="w-full" onClick={handleDelete}>
          <Trash2 size={12} strokeWidth={1.75} /> Delete this node
        </Button>
      </div>
    </aside>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const cls = 'text-[var(--ink-soft)]';
  switch (kind) {
    case 'doc':         return <FileText    size={14} strokeWidth={1.75} className={cls} />;
    case 'docs':        return <Layers      size={14} strokeWidth={1.75} className={cls} />;
    case 'instruction': return <MessageSquare size={14} strokeWidth={1.75} className={cls} />;
    case 'decision':    return <GitBranch   size={14} strokeWidth={1.75} className="text-[var(--status-warning)]" />;
    default:            return null;
  }
}

// ─── Instruction ─────────────────────────────────────────────────────────────

function InstructionInspectorBody({ data, onChange }: { data: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const text  = typeof data.text  === 'string'  ? data.text  : '';
  const pause = !!data.pause_for_user_input;
  const MAX   = 2000;

  return (
    <>
      <div>
        <MonoLabel className="block mb-1.5">Instruction</MonoLabel>
        <textarea
          value={text}
          onChange={e => onChange({ text: e.target.value })}
          placeholder={"Write a directive for Claude.\nE.g. 'Read the PRD before starting.'"}
          rows={8}
          maxLength={MAX}
          className="w-full px-2.5 py-2 text-[13px] bg-[var(--canvas)] border border-[var(--line)] rounded-[var(--radius-md)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--line-bright)] resize-none transition-colors leading-[1.65]"
        />
        <p className="text-[11px] text-[var(--ink-faint)] mt-0.5 text-right">{text.length}/{MAX}</p>
        {!text.trim() && <InlineWarning msg="Claude needs a directive to act on." />}
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={pause}
          onChange={e => onChange({ pause_for_user_input: e.target.checked })}
          className="mt-0.5 accent-[var(--accent)]"
        />
        <div>
          <p className="text-[13px] text-[var(--ink)] leading-tight">Pause for user input</p>
          <p className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">When on, Claude waits for the user to continue.</p>
        </div>
      </label>
    </>
  );
}

// ─── Doc ──────────────────────────────────────────────────────────────────────

function DocInspectorBody({ data, onChange }: { data: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const docId      = typeof data.doc_id === 'string' ? data.doc_id : null;
  const instruction = typeof data.instruction === 'string' ? data.instruction : '';

  return (
    <>
      <div>
        <MonoLabel className="block mb-1.5">Doc reference</MonoLabel>
        <DocPicker value={docId} onChange={(id, title) => onChange({ doc_id: id ?? undefined, doc_title: title })} />
        {!docId && <InlineWarning msg="Select a doc so Claude knows what to read." />}
        {docId && (
          <a href={`/app/d/${docId}`} target="_blank" rel="noopener noreferrer"
            className="block mt-1.5 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-soft)] underline underline-offset-2">
            Open doc →
          </a>
        )}
      </div>
      <div>
        <MonoLabel className="block mb-1.5">Instruction <span className="font-normal text-[var(--ink-faint)]">(optional)</span></MonoLabel>
        <textarea
          value={instruction}
          onChange={e => onChange({ instruction: e.target.value })}
          placeholder={"Optional framing for how Claude should use this doc."}
          rows={4}
          className="w-full px-2.5 py-2 text-[13px] bg-[var(--canvas)] border border-[var(--line)] rounded-[var(--radius-md)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--line-bright)] resize-none transition-colors leading-[1.6]"
        />
      </div>
    </>
  );
}

// ─── Docs ─────────────────────────────────────────────────────────────────────

function DocsInspectorBody({ data, onChange }: { data: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const docIds     = Array.isArray(data.doc_ids) ? (data.doc_ids as string[]) : [];
  const instruction = typeof data.instruction === 'string' ? data.instruction : '';

  return (
    <>
      <div>
        <MonoLabel className="block mb-1.5">Doc references <span className="font-normal text-[var(--ink-faint)]">({docIds.length})</span></MonoLabel>
        {docIds.length === 0 && <InlineWarning msg="Add at least one doc so Claude knows what to read." />}
        {docIds.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {docIds.map((id, i) => (
              <div key={id} className="flex items-center gap-2">
                <span className="flex-1 text-[12px] font-mono text-[var(--ink-soft)] bg-[var(--canvas)] px-2 py-1 rounded-[var(--radius-sm)] truncate">{id.slice(0,8)}…</span>
                <button type="button" onClick={() => { const n = [...docIds]; n.splice(i,1); onChange({ doc_ids: n }); }} className="text-[var(--ink-faint)] hover:text-[var(--status-error)] transition-colors"><X size={11} strokeWidth={2} /></button>
              </div>
            ))}
          </div>
        )}
        <DocPicker value={null} onChange={(id) => { if (id && !docIds.includes(id)) onChange({ doc_ids: [...docIds, id] }); }} />
      </div>
      <div>
        <MonoLabel className="block mb-1.5">Instruction <span className="font-normal text-[var(--ink-faint)]">(optional)</span></MonoLabel>
        <textarea value={instruction} onChange={e => onChange({ instruction: e.target.value })} placeholder="What should Claude do with these docs?" rows={4}
          className="w-full px-2.5 py-2 text-[13px] bg-[var(--canvas)] border border-[var(--line)] rounded-[var(--radius-md)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--line-bright)] resize-none transition-colors leading-[1.6]" />
      </div>
    </>
  );
}

// ─── Decision ─────────────────────────────────────────────────────────────────

function DecisionInspectorBody({ data, onChange }: { data: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const question = typeof data.question === 'string' ? data.question
    : typeof data.condition === 'string' ? data.condition : '';
  const branches = (data.branches && typeof data.branches === 'object' && !Array.isArray(data.branches))
    ? (data.branches as Record<string, unknown>) : { yes: null, no: null };
  const branchKeys = Object.keys(branches);
  const defaultBranch = typeof data.default_branch === 'string' ? data.default_branch : branchKeys[0] ?? 'yes';

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editVal,    setEditVal]    = useState('');

  const startEdit = (key: string) => { setEditingKey(key); setEditVal(key); };

  const commitEdit = (oldKey: string) => {
    const newKey = editVal.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20);
    if (!newKey || newKey === oldKey) { setEditingKey(null); return; }
    const nb: Record<string, unknown> = {};
    for (const k of Object.keys(branches)) nb[k === oldKey ? newKey : k] = null;
    const newDefault = defaultBranch === oldKey ? newKey : defaultBranch;
    onChange({ branches: nb, question, default_branch: newDefault });
    setEditingKey(null);
  };

  const addBranch = () => {
    if (branchKeys.length >= 4) return;
    const nb = { ...branches, [`branch-${branchKeys.length + 1}`]: null };
    onChange({ branches: nb, default_branch: defaultBranch });
  };

  const removeBranch = (key: string) => {
    if (branchKeys.length <= 2) return;
    const nb = { ...branches };
    delete nb[key];
    const newDefault = key === defaultBranch ? Object.keys(nb)[0] ?? '' : defaultBranch;
    onChange({ branches: nb, default_branch: newDefault });
  };

  return (
    <>
      <div>
        <MonoLabel className="block mb-1.5">Question</MonoLabel>
        <textarea
          value={question}
          onChange={e => onChange({ question: e.target.value, condition: e.target.value })}
          placeholder={"What should Claude decide here?\nE.g. 'Is this an existing customer?'"}
          rows={4}
          className="w-full px-2.5 py-2 text-[13px] bg-[var(--canvas)] border border-[var(--line)] rounded-[var(--radius-md)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--line-bright)] resize-none transition-colors leading-[1.6]"
        />
        {!question.trim() && <InlineWarning msg="Add a question so Claude knows what to decide." />}
      </div>

      <div>
        <MonoLabel className="block mb-2">Branches <span className="font-normal text-[var(--ink-faint)]">({branchKeys.length}/4, min 2)</span></MonoLabel>
        <div className="space-y-2">
          {branchKeys.map(key => (
            <div key={key} className="flex items-center gap-2">
              {editingKey === key
                ? <input
                    autoFocus
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => commitEdit(key)}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(key); if (e.key === 'Escape') setEditingKey(null); }}
                    className="flex-1 text-[12px] font-mono px-2 py-1.5 bg-[var(--canvas)] border border-[var(--accent)] rounded-[var(--radius-sm)] text-[var(--ink)] outline-none"
                  />
                : <button
                    onClick={() => startEdit(key)}
                    className="flex-1 text-left text-[12px] font-mono px-2 py-1.5 bg-[var(--canvas)] border border-[var(--line)] rounded-[var(--radius-sm)] text-[var(--ink-soft)] hover:border-[var(--line-bright)] transition-colors"
                  >{key}</button>
              }
              <button
                onClick={() => removeBranch(key)}
                disabled={branchKeys.length <= 2}
                className="text-[var(--ink-faint)] hover:text-[var(--status-error)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
              ><X size={11} strokeWidth={2} /></button>
            </div>
          ))}
        </div>
        {branchKeys.length < 4 && (
          <button onClick={addBranch} className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors">
            <Plus size={11} strokeWidth={2} /> Add branch
          </button>
        )}
        {branchKeys.length < 2 && <InlineWarning msg="Add at least one more branch." />}
      </div>
    </>
  );
}
