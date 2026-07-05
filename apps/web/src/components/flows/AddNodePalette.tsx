import { FileText, Layers, MessageSquare, GitBranch, Plus } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { MonoLabel } from '../ui/typography';

type NodeKind = 'doc' | 'docs' | 'instruction' | 'decision';

interface PaletteItem {
  kind: NodeKind;
  label: string;
  icon: React.ReactNode;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface Props {
  onAdd: (kind: NodeKind) => void;
}

const ITEMS: PaletteItem[] = [
  {
    kind: 'doc',
    label: 'Doc',
    icon: <FileText size={13} strokeWidth={1.75} />,
    description: 'Reference a single document',
  },
  {
    kind: 'docs',
    label: 'Docs',
    icon: <Layers size={13} strokeWidth={1.75} />,
    description: 'Reference multiple documents',
  },
  {
    kind: 'instruction',
    label: 'Instruction',
    icon: <MessageSquare size={13} strokeWidth={1.75} />,
    description: 'Plain text instruction for Claude',
  },
  {
    kind: 'decision',
    label: 'Decision',
    icon: <GitBranch size={13} strokeWidth={1.75} className="text-[var(--status-warning)]" />,
    description: 'Conditional branching',
    disabled: true,
    disabledReason: 'Ships in Phase 6.4',
  },
];

export function AddNodePalette({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 h-7 px-2.5 text-[12px] font-medium bg-[var(--interactive-primary)] text-[var(--interactive-primary-fg)] border border-[var(--interactive-primary)] hover:bg-[var(--interactive-primary-hover)] rounded-[var(--radius-sm)] transition-colors"
        title="Add a node"
      >
        <Plus size={12} strokeWidth={2.5} />
        Add node
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[var(--surface)] border border-[var(--line-strong)] rounded-[10px] shadow-lg overflow-hidden py-1">
          {ITEMS.map((item) => (
            <button
              key={item.kind}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) {
                  onAdd(item.kind);
                  setOpen(false);
                }
              }}
              className={
                'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors ' +
                (item.disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-[var(--surface-2)] cursor-pointer')
              }
              title={item.disabled ? item.disabledReason : undefined}
            >
              <span className="mt-0.5 text-[var(--text-secondary)] shrink-0">{item.icon}</span>
              <div>
                <div className="text-[12px] font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                  {item.label}
                  {item.disabled && (
                    <MonoLabel className="text-[var(--text-quaternary)]">6.4</MonoLabel>
                  )}
                </div>
                <div className="text-[11px] text-[var(--text-tertiary)] leading-[1.4] mt-0.5">
                  {item.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
