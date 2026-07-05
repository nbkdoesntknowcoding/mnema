export const ENTITY_LABELS: Record<string, string> = {
  doc:       '📄 Document',
  flow:      '⑂ Workflow',
  flow_step: '→ Step',
  task:      '✓ Task',
  concept:   '◇ Concept',
  decision:  '⚖ Decision',
  project:   '◎ Project',
  rationale: '💡 Why Note',
  session:   '⚡ Session',
  meeting:   '🎙 Meeting',
  person:    '👤 Person',
};

export const ENTITY_COLORS_HEX: Record<string, number> = {
  doc:       0x60a5fa,
  flow:      0xfbbf24,
  flow_step: 0xd97706,
  task:      0x4ade80,
  concept:   0xa78bfa,
  decision:  0xf0997b,
  project:   0xe879f9,
  rationale: 0xfb7185,
  session:   0x94a3b8,
  meeting:   0x22d3ee,
  person:    0xfda4af,
};

export const ENTITY_COLORS_CSS: Record<string, string> = {
  doc:       '#60a5fa',
  flow:      '#fbbf24',
  flow_step: '#d97706',
  task:      '#4ade80',
  concept:   '#a78bfa',
  decision:  '#f0997b',
  project:   '#e879f9',
  rationale: '#fb7185',
  session:   '#94a3b8',
  meeting:   '#22d3ee',
  person:    '#fda4af',
};

export const EDGE_LABELS: Record<string, string> = {
  references:              'references',
  implements:              'implements',
  depends_on:              'depends on',
  informs:                 'informed',
  contradicts:             'contradicts',
  supersedes:              'replaces',
  semantically_similar_to: 'similar to',
  part_of:                 'part of',
  preceded_by:             'leads to',
  belongs_to:              'belongs to',
  claims:                  'worked on',
  completes:               'completed',
  rationale_for:           'explains why',
  documented_by:           'notes',
  attended_by:             'attended by',
  produced:                'produced',
  assigned_to:             'assigned to',
  related:                 'related to',
};

export function getNodeRadius(degree: number, isGodNode: boolean, entityType: string): number {
  const base: Record<string, number> = {
    doc: 4, concept: 3, decision: 5, flow: 4,
    flow_step: 2, task: 3, project: 6, rationale: 2, session: 2,
    meeting: 5, person: 4,
  };
  return (base[entityType] ?? 3) + Math.min(degree * 0.25, 5) + (isGodNode ? 6 : 0);
}
