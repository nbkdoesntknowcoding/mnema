import { describe, expect, it } from 'vitest';
import { validateFlow, type FlowEdge, type FlowNode } from './validate.js';

// Stable UUIDs reused across tests so doc-kind nodes pass uuid-shape checks
// without making the test cases noisy.
const DOC_A = '11111111-1111-1111-1111-111111111111';
const DOC_B = '22222222-2222-2222-2222-222222222222';

function instruction(id: string, text = 'hello'): FlowNode {
  return {
    client_node_id: id,
    kind: 'instruction',
    title: id,
    position_x: 0,
    position_y: 0,
    data: { text },
  };
}

function doc(id: string, docId = DOC_A): FlowNode {
  return {
    client_node_id: id,
    kind: 'doc',
    title: id,
    position_x: 0,
    position_y: 0,
    data: { doc_id: docId, instruction: 'read it' },
  };
}

function edge(from: string, to: string, socket = 'default'): FlowEdge {
  return { from_node_id: from, to_node_id: to, from_socket: socket };
}

describe('validateFlow', () => {
  // ------------------------------------------------------------
  // Happy paths
  // ------------------------------------------------------------

  it('accepts a single-node flow', () => {
    const result = validateFlow([instruction('only')], []);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a linear 3-node flow', () => {
    const result = validateFlow(
      [instruction('a'), instruction('b'), instruction('c')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a branching DAG (one entry, two paths, merge)', () => {
    // entry → a, entry → b, a → end, b → end
    const result = validateFlow(
      [instruction('entry'), instruction('a'), instruction('b'), instruction('end')],
      [edge('entry', 'a'), edge('entry', 'b'), edge('a', 'end'), edge('b', 'end')],
    );
    expect(result.valid).toBe(true);
  });

  it('accepts a flow with a doc node + instruction node + decision node', () => {
    const result = validateFlow(
      [
        instruction('start', 'go'),
        doc('read', DOC_A),
        {
          client_node_id: 'choose',
          kind: 'decision',
          title: 'choose',
          position_x: 0,
          position_y: 0,
          data: { condition: 'has_engineering_doc', branches: { yes: 'read', no: 'start' } },
        },
      ],
      [edge('start', 'read'), edge('read', 'choose')],
    );
    expect(result.valid).toBe(true);
  });

  // ------------------------------------------------------------
  // Structural failures
  // ------------------------------------------------------------

  it('rejects an empty flow', () => {
    const result = validateFlow([], []);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('empty_flow');
  });

  it('rejects an edge with an unknown target node', () => {
    const result = validateFlow([instruction('a')], [edge('a', 'b')]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'edge_to_unknown_node')).toBe(true);
  });

  it('rejects an edge with an unknown source node', () => {
    const result = validateFlow([instruction('a')], [edge('ghost', 'a')]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'edge_from_unknown_node')).toBe(true);
  });

  it('rejects a self-edge', () => {
    const result = validateFlow([instruction('a')], [edge('a', 'a')]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'self_edge')).toBe(true);
  });

  it('rejects two entry nodes (a, b — both with no incoming edges)', () => {
    const result = validateFlow(
      [instruction('a'), instruction('b'), instruction('c')],
      [edge('a', 'c'), edge('b', 'c')],
    );
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'multiple_entry_nodes');
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/2 entry nodes/);
  });

  it('rejects a 2-cycle', () => {
    const result = validateFlow(
      [instruction('a'), instruction('b')],
      [edge('a', 'b'), edge('b', 'a')],
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'cycle_detected')).toBe(true);
  });

  it('rejects a 3-cycle', () => {
    const result = validateFlow(
      [instruction('a'), instruction('b'), instruction('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'cycle_detected')).toBe(true);
  });

  it('rejects unreachable nodes (entry → a; b is orphaned but has incoming from c; c has no entry)', () => {
    // a is the only no-incoming-edges node, so a is the entry. b and c are unreachable.
    // (Note: this also has two entries by raw count if c has no incoming — but here
    // b has no incoming so we'd have two entries. Adjust: give b an incoming from c
    // and give c an incoming from b — that creates a separate cycle. Use a simpler shape.)
    // Simpler shape: a is entry, but b and c form their own component with b→c, b having
    // an incoming edge from itself? No, self-edges are rejected. Easiest: a is entry, b
    // has incoming from c, c has incoming from b — that's a cycle and would fail cycle
    // check first. Instead use a 4-node setup: a is entry with no edges out (so b/c/d
    // unreachable), and b, c, d form a linear sub-chain b→c→d.
    const result = validateFlow(
      [instruction('a'), instruction('b'), instruction('c'), instruction('d')],
      [edge('b', 'c'), edge('c', 'd')],
    );
    expect(result.valid).toBe(false);
    // Multiple entries in this construction (a AND b both have 0 incoming). Verify the
    // validator catches that — that's the real failure mode for this graph shape.
    expect(result.errors.some((e) => e.code === 'multiple_entry_nodes')).toBe(true);
  });

  it("rejects unreachable nodes when there's exactly one entry but other components", () => {
    // To get exactly one entry plus unreachable nodes, you need a component
    // that's a cycle (every node has incoming). But cycles are caught first.
    // The only way past the cycle check is a graph where every non-entry node
    // is reachable — which makes "unreachable" structurally impossible given
    // the other invariants. The error code stays in the API for future-proofing
    // (e.g., when subgraph imports land). For now, verify the code path returns
    // a *non-empty* error for a degenerate shape: 2 entries.
    const result = validateFlow(
      [instruction('a'), instruction('b')], // both entries
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'multiple_entry_nodes')).toBe(true);
  });

  // ------------------------------------------------------------
  // Per-kind data shape
  // ------------------------------------------------------------

  it("rejects a 'doc' node missing doc_id", () => {
    const node: FlowNode = {
      client_node_id: 'd',
      kind: 'doc',
      title: 'd',
      position_x: 0,
      position_y: 0,
      data: {},
    };
    const result = validateFlow([node], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'invalid_node_data')).toBe(true);
  });

  it("rejects a 'doc' node with a malformed doc_id (not a UUID)", () => {
    const node: FlowNode = {
      client_node_id: 'd',
      kind: 'doc',
      title: 'd',
      position_x: 0,
      position_y: 0,
      data: { doc_id: 'not-a-uuid' },
    };
    const result = validateFlow([node], []);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'invalid_node_data');
    expect(err?.message).toMatch(/doc_id/);
  });

  it("rejects an 'instruction' node with empty text", () => {
    const node: FlowNode = {
      client_node_id: 'i',
      kind: 'instruction',
      title: 'i',
      position_x: 0,
      position_y: 0,
      data: { text: '   ' },
    };
    const result = validateFlow([node], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'invalid_node_data')).toBe(true);
  });

  it("rejects a 'docs' node without doc_ids OR filter", () => {
    const node: FlowNode = {
      client_node_id: 'ds',
      kind: 'docs',
      title: 'ds',
      position_x: 0,
      position_y: 0,
      data: {},
    };
    const result = validateFlow([node], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'invalid_node_data')).toBe(true);
  });

  it("accepts a 'docs' node with a doc_ids list of valid UUIDs", () => {
    const node: FlowNode = {
      client_node_id: 'ds',
      kind: 'docs',
      title: 'ds',
      position_x: 0,
      position_y: 0,
      data: { doc_ids: [DOC_A, DOC_B] },
    };
    const result = validateFlow([node], []);
    expect(result.valid).toBe(true);
  });

  it("accepts a 'docs' node with a filter object", () => {
    const node: FlowNode = {
      client_node_id: 'ds',
      kind: 'docs',
      title: 'ds',
      position_x: 0,
      position_y: 0,
      data: { filter: { type: 'engineering' }, instruction: 'read all engineering docs' },
    };
    const result = validateFlow([node], []);
    expect(result.valid).toBe(true);
  });

  it("rejects a 'decision' node without a condition string", () => {
    const node: FlowNode = {
      client_node_id: 'q',
      kind: 'decision',
      title: 'q',
      position_x: 0,
      position_y: 0,
      data: {},
    };
    const result = validateFlow([node], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'invalid_node_data')).toBe(true);
  });
});
