import { FileText, Layers, Zap, Brain, Split } from 'lucide-react';
import { FLOW_TOKENS as T } from './tokens';

type NodeKind = 'doc' | 'docs' | 'instruction' | 'decision' | 'capture';

interface PaletteItem {
  kind: NodeKind;
  label: string;
  accent: string;
  icon: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

interface Props {
  onAdd: (kind: NodeKind) => void;
}

const ICON = { size: 16, strokeWidth: 1.9 } as const;

// One recognizable, accent-coloured icon per node kind we ship. Directive/Step
// are the same `instruction` kind, so they share the one amber icon.
const ITEMS: PaletteItem[] = [
  { kind: 'instruction', label: 'Instruction', accent: T.directive.accent, icon: <Zap {...ICON} /> },
  { kind: 'capture',     label: 'Capture',     accent: T.capture.accent,   icon: <Brain {...ICON} /> },
  { kind: 'doc',         label: 'Doc',         accent: T.doc.accent,       icon: <FileText {...ICON} /> },
  { kind: 'docs',        label: 'Docs',        accent: T.docs.accent,      icon: <Layers {...ICON} /> },
  { kind: 'decision',    label: 'If / Else',   accent: T.decision.accent,  icon: <Split {...ICON} />,
    disabled: true, disabledReason: 'Branching ships in a later phase' },
];

/**
 * Horizontal node-type palette (replaces the "+ Add node" dropdown). Each icon
 * is coloured to its node-type accent and adds that node on click.
 */
export function NodePaletteBar({ onAdd }: Props) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, padding: 3,
      background: 'var(--surface)', border: '1px solid var(--line-strong)',
      borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
    }}>
      {ITEMS.map((item) => (
        <button
          key={item.kind}
          type="button"
          disabled={item.disabled}
          onClick={() => { if (!item.disabled) onAdd(item.kind); }}
          title={item.disabled ? `${item.label} — ${item.disabledReason}` : `Add ${item.label}`}
          aria-label={item.disabled ? `${item.label} (disabled)` : `Add ${item.label}`}
          className="flow-palette-btn"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 7, border: 'none',
            background: 'transparent', color: item.accent,
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            opacity: item.disabled ? 0.32 : 1,
            transition: 'background 120ms ease',
          }}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}
