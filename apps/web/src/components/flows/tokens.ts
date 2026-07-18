// All canvas-specific tokens. Import from here — never hardcode in components.
//
// The hifi Flows design (design_handoff_flows_editor) is built on the Mnema
// design system. Colours here bind to the global CSS vars in styles/tokens.css
// where a semantic token exists (--surface, --ink, --line, --status-*), and use
// the fixed node-type accent hexes from the design where the meaning is
// node-type-specific (amber directive, gray step, green capture, blue doc, red
// if/else) — those are intentional constants, not theme-reactive.

export const FLOW_TOKENS = {
  // Canvas — dotted grid over the design-system canvas colour.
  canvasBg:      'var(--canvas)',
  canvasDot:     'rgba(255,255,255,0.08)',
  canvasDotSize: 1.5,
  canvasDotGap:  24,

  // Node bases
  nodeBorderRadius: 12,
  nodeWidth: 248,
  nodeMinHeight: 80,
  nodePadding: '11px 14px' as const,

  // Node type palettes. `accent` is the design node-type colour; the soft/line
  // alpha variants are derived inline via accentSoft()/accentLine() helpers.
  instruction: {           // == "Step" (non-entry). Directive (entry) overrides to amber.
    accent: '#b8bcc4',
    label:  '#b8bcc4',
  },
  directive: {             // entry instruction — amber (also the app accent)
    accent: '#ffb370',
    label:  '#ffb370',
  },
  doc: {
    accent: '#7c9cff',
    label:  '#7c9cff',
  },
  docs: {
    accent: '#7c9cff',
    label:  '#7c9cff',
  },
  decision: {              // "If / Else" — red
    accent: '#ff7a8a',
    label:  '#ff7a8a',
  },
  capture: {               // writes-to-brain — green
    accent: '#6be39b',
    label:  '#6be39b',
  },

  // Node selected state (design uses accent-line border + brighter bloom)
  nodeSelectedBorder: 'var(--accent-line)',
  nodeRestBorder:     'var(--line)',

  // Connection handles — 10px circles, canvas fill, 2px accent border.
  handleSize: 10,
  handleBg:   'var(--canvas)',

  // Edges
  edgeWidth:          1.5,
  edgeAnimDuration:   '1.1s',

  // Branch label pill (If/Else) — red-tinted
  branchPillBg:     'rgba(255,122,138,0.14)',
  branchPillBorder: 'rgba(255,122,138,0.30)',
  branchPillText:   '#ff7a8a',

  // Entry / exit markers
  entryColor: '#ffb370',
  exitColor:  '#6e737c',

  // Typography — reference the app's canonical CSS font variables so flow nodes
  // match the rest of the application.
  fontUI:      'var(--sans)',
  fontMono:    'var(--mono)',
  fontDisplay: 'var(--serif)',
} as const;

export type NodeKind = 'instruction' | 'doc' | 'docs' | 'decision' | 'capture';

/** The visual type used to pick an accent — instruction splits into directive (entry) / step. */
export type NodeVisual = 'directive' | 'instruction' | 'doc' | 'docs' | 'decision' | 'capture';

export function nodePalette(kind: NodeKind) {
  return FLOW_TOKENS[kind];
}

/**
 * Resolve the accent for a node. Instruction nodes render as amber "Directive"
 * when they are the flow entry, and gray "Step" otherwise — everything else is
 * keyed straight off its kind.
 */
export function accentFor(kind: NodeKind, isEntry?: boolean): string {
  if (kind === 'instruction') return isEntry ? FLOW_TOKENS.directive.accent : FLOW_TOKENS.instruction.accent;
  return FLOW_TOKENS[kind].accent;
}

/** {accent} at ~13% — soft fills, ambient inner ring. */
export function accentSoft(accent: string): string { return accent + '22'; }
/** {accent} at ~33% — borders on preview buttons / selected. */
export function accentLine(accent: string): string { return accent + '55'; }
/** {accent} at ~23% — resting edge stroke. */
export function accentEdge(accent: string): string { return accent + '3a'; }

/**
 * The layered card shadow: base drop shadow + a per-accent ambient ring/glow,
 * matching the design's `0 8px 28px … , 0 0 0 1px {a}22, 0 10px 46px {a}1f`.
 */
export function cardShadow(accent: string, lit = false): string {
  // Keep the ambient glow tight so it doesn't spill past the card and wash out
  // the incoming/outgoing edges near the handles.
  const ring = `0 0 0 1px ${accent}22, 0 4px 18px ${accent}${lit ? '2a' : '14'}`;
  return `0 8px 28px rgba(0,0,0,.5), ${ring}`;
}

export function handleStyle(accent: string, overrides?: React.CSSProperties): React.CSSProperties {
  return {
    width:        FLOW_TOKENS.handleSize,
    height:       FLOW_TOKENS.handleSize,
    background:   FLOW_TOKENS.handleBg,
    border:       `2px solid ${accent}`,
    borderRadius: '50%',
    transition:   'border-color 120ms ease, background 120ms ease',
    ...overrides,
  };
}
