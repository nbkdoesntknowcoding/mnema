import { describe, expect, it } from 'vitest';
import { topologicalWalk } from './walk.js';

function node(id: string, y = 0) {
  return {
    client_node_id: id,
    kind: 'instruction',
    title: id,
    position_x: 0,
    position_y: y,
    data: { text: id },
  };
}

function edge(from: string, to: string) {
  return { from_node_id: from, to_node_id: to, from_socket: 'default' };
}

describe('topologicalWalk', () => {
  it('walks a linear flow in source order', () => {
    const result = topologicalWalk(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    expect(result.map((n) => n.client_node_id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by position_y (top-to-bottom on canvas)', () => {
    // Two ready nodes at the same level — the one higher on the canvas
    // (lower y) should come first.
    const result = topologicalWalk(
      [node('higher', 10), node('lower', 200), node('end', 400)],
      [edge('higher', 'end'), edge('lower', 'end')],
    );
    expect(result.map((n) => n.client_node_id)).toEqual(['higher', 'lower', 'end']);
  });

  it('handles a branch-and-merge DAG', () => {
    const result = topologicalWalk(
      [node('s', 0), node('a', 100), node('b', 200), node('e', 300)],
      [edge('s', 'a'), edge('s', 'b'), edge('a', 'e'), edge('b', 'e')],
    );
    expect(result[0]?.client_node_id).toBe('s');
    expect(result[result.length - 1]?.client_node_id).toBe('e');
    expect(result.length).toBe(4);
  });

  it('returns a single node for a singleton flow', () => {
    const result = topologicalWalk([node('only')], []);
    expect(result.map((n) => n.client_node_id)).toEqual(['only']);
  });
});
