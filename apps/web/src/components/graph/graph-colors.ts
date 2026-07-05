// Three.js color values (0xRRGGBB format)
export const NODE_COLORS_HEX: Record<string, number> = {
  doc:       0x60a5fa,  // blue
  flow:      0xfbbf24,  // amber
  flow_step: 0xfbbf24,  // amber
  task:      0x4ade80,  // green
  session:   0x52525b,  // grey
  concept:   0xa78bfa,  // violet
  decision:  0xf0997b,  // orange
  project:   0xe879f9,  // pink
  rationale: 0xf0997b,  // orange
  meeting:   0x22d3ee,  // cyan
  person:    0xfda4af,  // rose
};

// CSS strings for UI elements outside the 3D scene
export const NODE_COLORS_CSS: Record<string, string> = {
  doc:       '#60a5fa',
  flow:      '#fbbf24',
  flow_step: '#fbbf24',
  task:      '#4ade80',
  session:   '#52525b',
  concept:   '#a78bfa',
  decision:  '#f0997b',
  project:   '#e879f9',
  rationale: '#f0997b',
  meeting:   '#22d3ee',
  person:    '#fda4af',
};

// God-nodes: white core → supernova-bright with bloom
export const GOD_NODE_COLOR_HEX = 0xffffff;
export const GOD_NODE_COLOR_CSS = '#ffffff';

// Edge colors
export const EDGE_COLOR         = 'rgba(255,255,255,0.12)';  // SVG/CSS
export const EDGE_COLOR_HEX     = 0x404040;                   // Three.js
export const EDGE_COLOR_INFERRED = 0x2a2a3a;                  // dimmer
