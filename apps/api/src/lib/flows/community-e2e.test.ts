/**
 * Community Flows — publish→import boundary test (Phase 4, P4-4).
 *
 * Simulates the full cross-workspace / cross-instance loop at the data boundary,
 * without live HTTP:
 *   Workspace A flow → sanitize (publish) → validateTemplate (hub ingest) →
 *   rehydrate (import into workspace B) → re-bind a doc locally.
 *
 * The hard gate is the LEAK ASSERTION: nothing workspace-A-scoped may exist in
 * the object the hub would store. See docs/community-flows.md for the manual
 * two-instance runbook that complements this.
 */
import { describe, it, expect } from 'vitest';
import type { FlowNode, FlowEdge } from './validate.js';
import { validateFlow } from './validate.js';
import { sanitizeFlowForPublish, rehydrateFlowFromTemplate } from './portability.js';
import { validateTemplate } from './template-schema.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Workspace A resources (must never appear downstream).
const A_DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const A_FOLDER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
// Workspace B resource the importer binds to.
const B_DOC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function workspaceAFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    nodes: [
      { client_node_id: 'start', kind: 'instruction', title: 'Start', position_x: 0, position_y: 0, data: { text: 'Begin the review.' } },
      { client_node_id: 'guide', kind: 'doc', title: 'Style guide', position_x: 0, position_y: 100, data: { doc_id: A_DOC, instruction: 'Apply the style guide.' } },
      { client_node_id: 'write', kind: 'capture', title: 'Write notes', position_x: 0, position_y: 200, data: { title_hint: 'Notes', instruction: 'Capture findings.', target_folder_id: A_FOLDER } },
    ],
    edges: [
      { from_node_id: 'start', to_node_id: 'guide', from_socket: 'default' },
      { from_node_id: 'guide', to_node_id: 'write', from_socket: 'default' },
    ],
  };
}

describe('community publish → import boundary', () => {
  it('runs the full loop without leaking workspace-A ids, and imports as a valid draft', () => {
    const a = workspaceAFlow();

    // 1. Workspace A publishes: sanitize into a portable template.
    const template = sanitizeFlowForPublish(a.nodes, a.edges, { name: 'Review flow', description: 'A review', tags: ['review'] });

    // 2. Hub ingest boundary: the template must validate...
    const ingest = validateTemplate(template);
    expect(ingest.ok).toBe(true);

    // ...and the object the hub would STORE must contain no workspace-A secrets.
    const stored = JSON.stringify(template);
    expect(stored).not.toMatch(UUID_RE);
    expect(stored).not.toContain(A_DOC);
    expect(stored).not.toContain(A_FOLDER);

    // 3. Workspace B imports: rehydrate into local draft rows.
    const imported = rehydrateFlowFromTemplate(template);
    expect(imported.nodes.map((n) => n.client_node_id).sort()).toEqual(['guide', 'start', 'write']);
    // doc + capture are flagged unbound; instruction is not.
    expect(imported.unboundNodes.map((u) => u.clientNodeId).sort()).toEqual(['guide', 'write']);

    // 4. The imported draft is legal in DRAFT mode (pending bindings) ...
    expect(validateFlow(imported.nodes, imported.edges, { mode: 'draft' }).valid).toBe(true);
    // ... but NOT publishable until bound.
    expect(validateFlow(imported.nodes, imported.edges, { mode: 'publish' }).valid).toBe(false);

    // 5. Workspace B binds the doc node to its OWN doc, then it validates for publish.
    const bound = imported.nodes.map((n) =>
      n.client_node_id === 'guide'
        ? { ...n, data: { instruction: n.data.instruction, doc_id: B_DOC } }
        : n,
    );
    // capture's folder binding is optional, so binding just the doc is enough to publish.
    expect(validateFlow(bound, imported.edges, { mode: 'publish' }).valid).toBe(true);
  });
});
