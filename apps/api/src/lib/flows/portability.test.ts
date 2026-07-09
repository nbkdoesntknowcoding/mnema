/**
 * Portability lib tests (Community Flows — Phase 0, P0-5).
 *
 * Guards the two promises of the feature:
 *   1. Round-trip topology survives publish → import.
 *   2. LEAK GUARD — no workspace UUIDs (doc_id / doc_ids / target_folder_id /
 *      any workspace uuid) ever escape into a published template.
 */
import { describe, it, expect } from 'vitest';
import type { FlowNode, FlowEdge } from './validate.js';
import {
  sanitizeFlowForPublish,
  rehydrateFlowFromTemplate,
  SCHEMA_VERSION,
  type PortableFlowTemplate,
} from './portability.js';
import { validateTemplate, MAX_TEMPLATE_BYTES } from './template-schema.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const DOC_A = '11111111-1111-4111-8111-111111111111';
const DOC_B = '22222222-2222-4222-8222-222222222222';
const FOLDER = '33333333-3333-4333-8333-333333333333';

/** A fixture flow exercising every node kind + several edges. */
function fixtureNodes(): FlowNode[] {
  return [
    {
      client_node_id: 'start',
      kind: 'instruction',
      title: 'Kickoff',
      position_x: 0,
      position_y: 0,
      data: { text: 'Read the brief and begin.' },
    },
    {
      client_node_id: 'ref-doc',
      kind: 'doc',
      title: 'Style guide',
      position_x: 100,
      position_y: 0,
      data: { doc_id: DOC_A, instruction: 'Follow this style guide.' },
    },
    {
      client_node_id: 'ref-docs',
      kind: 'docs',
      title: 'Specs',
      position_x: 200,
      position_y: 0,
      data: { doc_ids: [DOC_A, DOC_B], filter: { type: 'spec' }, instruction: 'Cross-check the specs.' },
    },
    {
      client_node_id: 'branch',
      kind: 'decision',
      title: 'Approved?',
      position_x: 300,
      position_y: 0,
      data: { question: 'Is it approved?', branches: { yes: null, no: null }, default_branch: 'no' },
    },
    {
      client_node_id: 'write-out',
      kind: 'capture',
      title: 'Write summary',
      position_x: 400,
      position_y: 0,
      data: { title_hint: 'Summary', instruction: 'Write a summary doc.', target_folder_id: FOLDER, autonomous: true },
    },
  ];
}

function fixtureEdges(): FlowEdge[] {
  return [
    { from_node_id: 'start', to_node_id: 'ref-doc', from_socket: 'default' },
    { from_node_id: 'ref-doc', to_node_id: 'ref-docs', from_socket: 'default' },
    { from_node_id: 'ref-docs', to_node_id: 'branch', from_socket: 'default' },
    { from_node_id: 'branch', to_node_id: 'write-out', from_socket: 'yes' },
  ];
}

const META = { name: 'Review flow', description: 'A review pipeline', tags: ['review', 'qa'] };

describe('sanitizeFlowForPublish', () => {
  it('leak guard: no UUID appears anywhere in the published template', () => {
    const template = sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META);
    const serialized = JSON.stringify(template);
    expect(serialized).not.toMatch(UUID_RE);
    // Explicitly assert the known secrets are gone.
    expect(serialized).not.toContain(DOC_A);
    expect(serialized).not.toContain(DOC_B);
    expect(serialized).not.toContain(FOLDER);
  });

  it('does not carry doc content keys (markdown/body) — only intent', () => {
    const nodes = fixtureNodes();
    // Pretend an upstream bug attached content; sanitize must not forward it.
    (nodes[1] as FlowNode).data.markdown = 'SECRET internal content';
    const template = sanitizeFlowForPublish(nodes, fixtureEdges(), META);
    expect(JSON.stringify(template)).not.toContain('SECRET internal content');
  });

  it('marks doc/docs/capture with requiresBinding; leaves instruction/decision clean', () => {
    const template = sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META);
    const byId = Object.fromEntries(template.nodes.map((n) => [n.clientNodeId, n]));
    expect(byId['ref-doc']!.data.requiresBinding).toBe('doc');
    expect(byId['ref-docs']!.data.requiresBinding).toBe('docs');
    expect(byId['write-out']!.data.requiresBinding).toBe('capture-folder');
    expect(byId['start']!.data.requiresBinding).toBeUndefined();
    expect(byId['branch']!.data.requiresBinding).toBeUndefined();
  });

  it('docs node keeps filter.type but drops doc_ids', () => {
    const template = sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META);
    const docs = template.nodes.find((n) => n.clientNodeId === 'ref-docs')!;
    expect(docs.data.doc_ids).toBeUndefined();
    expect(docs.data.filter).toEqual({ type: 'spec' });
    expect(docs.data.instruction).toBe('Cross-check the specs.');
  });

  it('is deterministic: identical input yields byte-identical output', () => {
    const a = JSON.stringify(sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META));
    const b = JSON.stringify(sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META));
    expect(a).toBe(b);
  });

  it('defensively strips ids from unknown/future node kinds', () => {
    const rogue: FlowNode = {
      client_node_id: 'rogue',
      kind: 'doc', // typed as doc but we hand it future-ish extra data
      title: 'x',
      position_x: 0,
      position_y: 0,
      data: { doc_id: DOC_A, secret_id: DOC_B, nested: { folder_id: FOLDER, keep: 'ok' } },
    };
    // Force the default branch via an unknown kind cast.
    const asUnknown = { ...rogue, kind: 'webhook' as unknown as FlowNode['kind'] };
    const template = sanitizeFlowForPublish([asUnknown], [], META);
    const serialized = JSON.stringify(template);
    expect(serialized).not.toMatch(UUID_RE);
    expect(serialized).toContain('keep');
  });
});

describe('rehydrateFlowFromTemplate', () => {
  it('round-trips topology: nodes, edges, positions, ids preserved', () => {
    const template = sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META);
    const out = rehydrateFlowFromTemplate(template);

    expect(out.name).toBe(META.name);
    expect(out.nodes.map((n) => n.client_node_id).sort()).toEqual(
      fixtureNodes().map((n) => n.client_node_id).sort(),
    );
    expect(out.edges).toHaveLength(fixtureEdges().length);
    const start = out.nodes.find((n) => n.client_node_id === 'start')!;
    expect(start.position_x).toBe(0);
    expect(start.data.text).toBe('Read the brief and begin.');
  });

  it('reports doc/docs/capture as unbound; not instruction/decision', () => {
    const template = sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META);
    const out = rehydrateFlowFromTemplate(template);
    const unbound = out.unboundNodes.map((u) => u.clientNodeId).sort();
    expect(unbound).toEqual(['ref-doc', 'ref-docs', 'write-out']);
    expect(out.unboundNodes.find((u) => u.clientNodeId === 'ref-doc')!.requiresBinding).toBe('doc');
  });

  it('rehydrated nodes carry no workspace ids', () => {
    const template = sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META);
    const out = rehydrateFlowFromTemplate(template);
    for (const n of out.nodes) {
      expect(n.data.doc_id).toBeUndefined();
      expect(n.data.doc_ids).toBeUndefined();
      expect(n.data.target_folder_id).toBeUndefined();
    }
  });

  it('rejects an unsupported schemaVersion', () => {
    const template = sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META);
    const bumped: PortableFlowTemplate = { ...template, schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => rehydrateFlowFromTemplate(bumped)).toThrow(/Unsupported/i);
  });
});

describe('validateTemplate', () => {
  const good = () => sanitizeFlowForPublish(fixtureNodes(), fixtureEdges(), META);

  it('accepts a sanitized template', () => {
    const res = validateTemplate(good());
    expect(res.ok).toBe(true);
  });

  it('rejects a UUID smuggled into node data', () => {
    const t = good();
    t.nodes[0]!.data.sneaky = DOC_A;
    const res = validateTemplate(t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === 'uuid_in_node_data')).toBe(true);
  });

  it('rejects an edge referencing a missing node', () => {
    const t = good();
    t.edges.push({ fromNodeId: 'start', toNodeId: 'ghost', fromSocket: 'default' });
    const res = validateTemplate(t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === 'edge_unknown_node')).toBe(true);
  });

  it('rejects duplicate clientNodeId', () => {
    const t = good();
    t.nodes.push({ ...t.nodes[0]! });
    const res = validateTemplate(t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === 'duplicate_client_node_id')).toBe(true);
  });

  it('rejects an unsupported schemaVersion', () => {
    const t = good();
    t.schemaVersion = SCHEMA_VERSION + 1;
    const res = validateTemplate(t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === 'unsupported_schema_version')).toBe(true);
  });

  it('rejects an oversize template', () => {
    const t = good();
    t.nodes[0]!.data.text = 'x'.repeat(MAX_TEMPLATE_BYTES + 1);
    const res = validateTemplate(t);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === 'oversize')).toBe(true);
  });

  it('rejects a structurally malformed input', () => {
    const res = validateTemplate({ schemaVersion: 1, name: '', nodes: [], edges: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]!.code).toBe('schema_shape');
  });
});
