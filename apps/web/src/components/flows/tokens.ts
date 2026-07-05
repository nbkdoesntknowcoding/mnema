// All canvas-specific tokens. Import from here — never hardcode in components.

export const FLOW_TOKENS = {
  // Canvas
  canvasBg:      '#0a0a0a',
  canvasDot:     'rgba(255,255,255,0.08)',
  canvasDotSize: 1.5,
  canvasDotGap:  24,

  // Node bases
  nodeBorderRadius: 12,
  nodeWidth: 240,
  nodeMinHeight: 80,
  nodePadding: '14px 16px' as const,

  // Node type palettes
  instruction: {
    bg:     'rgba(234,179,8,0.06)',
    border: 'rgba(234,179,8,0.22)',
    accent: '#fbbf24',
    label:  '#fbbf24',
  },
  doc: {
    bg:     'rgba(96,165,250,0.06)',
    border: 'rgba(96,165,250,0.20)',
    accent: '#60a5fa',
    label:  '#60a5fa',
  },
  docs: {
    bg:     'rgba(96,165,250,0.06)',
    border: 'rgba(96,165,250,0.20)',
    accent: '#60a5fa',
    label:  '#60a5fa',
  },
  decision: {
    bg:     'rgba(139,92,246,0.06)',
    border: 'rgba(139,92,246,0.22)',
    accent: '#a78bfa',
    label:  '#a78bfa',
  },

  // Node selected state
  nodeSelectedBorder: 'rgba(255,255,255,0.30)',
  nodeSelectedShadow: '0 0 0 2px rgba(255,255,255,0.08)',

  // Connection handles
  handleSize: 12,
  handleBg:            '#18181b',
  handleBorder:        'rgba(255,255,255,0.20)',
  handleHoverBg:       '#27272a',
  handleHoverBorder:   'rgba(255,255,255,0.50)',
  handleConnecting:    '#fbbf24',

  // Edges
  edgeColor:          'rgba(255,255,255,0.20)',
  edgeColorSelected:  'rgba(255,255,255,0.50)',
  edgeWidth:          1.5,
  edgeAnimDuration:   '1.5s',

  // Branch label pill
  branchPillBg:     'rgba(139,92,246,0.15)',
  branchPillBorder: 'rgba(139,92,246,0.30)',
  branchPillText:   '#a78bfa',

  // Entry / exit markers
  entryColor: '#4ade80',
  exitColor:  '#52525b',

  // Typography — reference the app's canonical CSS font variables so flow nodes
  // match the rest of the application (was a separate hardcoded font stack).
  fontUI:      'var(--sans)',
  fontMono:    'var(--mono)',
  fontDisplay: 'var(--serif)',
} as const;

export type NodeKind = 'instruction' | 'doc' | 'docs' | 'decision';

export function nodePalette(kind: NodeKind) {
  return FLOW_TOKENS[kind];
}

export function handleStyle(overrides?: React.CSSProperties): React.CSSProperties {
  return {
    width:        FLOW_TOKENS.handleSize,
    height:       FLOW_TOKENS.handleSize,
    background:   FLOW_TOKENS.handleBg,
    border:       `1.5px solid ${FLOW_TOKENS.handleBorder}`,
    borderRadius: '50%',
    transition:   'border-color 120ms ease, background 120ms ease',
    ...overrides,
  };
}
