/**
 * Flow validation (Phase 6.1).
 *
 * The validator enforces structural and semantic invariants every flow
 * must satisfy before it can be saved. These run on every PUT /draft and
 * implicitly on every POST /publish (publish re-validates the draft
 * before promoting it).
 *
 * Invariants enforced:
 *   1. At least one node                   (empty_flow)
 *   2. Every edge endpoint exists          (edge_from_unknown_node / edge_to_unknown_node)
 *   3. No self-edges                       (self_edge — DB also enforces)
 *   4. No cycles                           (cycle_detected)
 *   5. Exactly one entry node              (no_entry_node / multiple_entry_nodes)
 *   6. Every node reachable from entry     (unreachable_nodes)
 *   7. Per-kind `data` shape correct       (invalid_node_data)
 *
 * Validation is fail-fast at major phases: if edges reference unknown
 * nodes, we bail before running the cycle check (the cycle algorithm
 * assumes valid endpoints). Other errors accumulate so the UI can show
 * the full list in one round-trip.
 */

export type FlowNodeKind = 'doc' | 'docs' | 'instruction' | 'decision' | 'capture';

export interface FlowNode {
  client_node_id: string;
  kind: FlowNodeKind;
  title: string;
  position_x: number;
  position_y: number;
  data: Record<string, unknown>;
}

export interface FlowEdge {
  from_node_id: string;
  to_node_id: string;
  from_socket: string;
}

export interface FlowValidationError {
  code:
    | 'empty_flow'
    | 'edge_from_unknown_node'
    | 'edge_to_unknown_node'
    | 'self_edge'
    | 'cycle_detected'
    | 'no_entry_node'
    | 'multiple_entry_nodes'
    | 'unreachable_nodes'
    | 'invalid_node_data';
  message: string;
  node_id?: string;
  edge?: { from: string; to: string };
}

export interface FlowValidationResult {
  valid: boolean;
  errors: FlowValidationError[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param opts.mode 'publish' (default, strict) requires every doc/docs binding
 *   to be resolved. 'draft' tolerates a doc/docs node that was imported from a
 *   community template and still carries a `requiresBinding` marker with no id —
 *   an imported flow is a legal DRAFT before the user re-binds, but must be
 *   fully bound before it can be published.
 */
export function validateFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts: { mode?: 'draft' | 'publish' } = {},
): FlowValidationResult {
  const mode = opts.mode ?? 'publish';
  const errors: FlowValidationError[] = [];

  if (nodes.length === 0) {
    errors.push({
      code: 'empty_flow',
      message: 'A flow must contain at least one node.',
    });
    return { valid: false, errors };
  }

  const nodeIds = new Set(nodes.map((n) => n.client_node_id));

  // 1. Edge endpoint validity (and self-edges). Bail before topological
  // analysis if any edge is structurally broken — those algorithms assume
  // every endpoint exists.
  for (const edge of edges) {
    if (!nodeIds.has(edge.from_node_id)) {
      errors.push({
        code: 'edge_from_unknown_node',
        message: `Edge references unknown source node '${edge.from_node_id}'.`,
        edge: { from: edge.from_node_id, to: edge.to_node_id },
      });
    }
    if (!nodeIds.has(edge.to_node_id)) {
      errors.push({
        code: 'edge_to_unknown_node',
        message: `Edge references unknown target node '${edge.to_node_id}'.`,
        edge: { from: edge.from_node_id, to: edge.to_node_id },
      });
    }
    if (edge.from_node_id === edge.to_node_id) {
      errors.push({
        code: 'self_edge',
        message: `Node '${edge.from_node_id}' cannot have an edge to itself.`,
        edge: { from: edge.from_node_id, to: edge.to_node_id },
      });
    }
  }
  if (errors.length > 0) return { valid: false, errors };

  // 2. Build adjacency and walk to find cycles.
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.client_node_id, []);
  for (const edge of edges) {
    const list = adjacency.get(edge.from_node_id);
    if (list) list.push(edge.to_node_id);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    inStack.add(nodeId);
    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (inStack.has(neighbor)) {
        errors.push({
          code: 'cycle_detected',
          message: `Cycle detected involving '${nodeId}' → '${neighbor}'.`,
          edge: { from: nodeId, to: neighbor },
        });
        return true;
      }
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node.client_node_id)) {
      if (dfs(node.client_node_id)) break;
    }
  }
  if (errors.length > 0) return { valid: false, errors };

  // 3. Find entry nodes — those with no incoming edges.
  const incomingCount = new Map<string, number>();
  for (const node of nodes) incomingCount.set(node.client_node_id, 0);
  for (const edge of edges) {
    incomingCount.set(edge.to_node_id, (incomingCount.get(edge.to_node_id) ?? 0) + 1);
  }
  const entries = [...incomingCount.entries()].filter(([, c]) => c === 0).map(([n]) => n);

  if (entries.length === 0) {
    // Cycles already handled above; reaching here without entries would
    // mean every node has incoming edges — which the cycle check would
    // have caught. Defensive case.
    errors.push({
      code: 'no_entry_node',
      message: 'Flow has no entry node — every node has incoming edges.',
    });
    return { valid: false, errors };
  }
  if (entries.length > 1) {
    errors.push({
      code: 'multiple_entry_nodes',
      message: `Flow has ${entries.length} entry nodes (${entries.join(
        ', ',
      )}). A flow must have exactly one entry node.`,
    });
    return { valid: false, errors };
  }

  // 4. Reachability from entry — every node must be a descendant of entry.
  const entry = entries[0]!;
  const reachable = new Set<string>([entry]);
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current) ?? [];
    for (const n of neighbors) {
      if (!reachable.has(n)) {
        reachable.add(n);
        queue.push(n);
      }
    }
  }

  const unreachable = nodes.filter((n) => !reachable.has(n.client_node_id));
  if (unreachable.length > 0) {
    errors.push({
      code: 'unreachable_nodes',
      message: `${unreachable.length} node(s) unreachable from entry: ${unreachable
        .map((n) => n.client_node_id)
        .join(', ')}.`,
    });
  }

  // 5. Per-kind data shape.
  for (const node of nodes) {
    errors.push(...validateNodeData(node, mode));
  }

  return { valid: errors.length === 0, errors };
}

function validateNodeData(node: FlowNode, mode: 'draft' | 'publish'): FlowValidationError[] {
  const errors: FlowValidationError[] = [];
  const { kind, data, client_node_id } = node;
  // An imported-but-unbound node carries this marker; it is legal in a draft.
  const pendingBinding = mode === 'draft' && Boolean(data.requiresBinding);

  switch (kind) {
    case 'doc': {
      if (pendingBinding) break;
      if (typeof data.doc_id !== 'string' || !UUID_RE.test(data.doc_id)) {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'doc' requires a valid 'doc_id' uuid in data.`,
          node_id: client_node_id,
        });
      }
      if (data.instruction !== undefined && typeof data.instruction !== 'string') {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' has a non-string 'instruction'.`,
          node_id: client_node_id,
        });
      }
      break;
    }
    case 'docs': {
      if (pendingBinding) break;
      const hasIds =
        Array.isArray(data.doc_ids) &&
        data.doc_ids.length > 0 &&
        data.doc_ids.every((id) => typeof id === 'string' && UUID_RE.test(id));
      const hasFilter = !!data.filter && typeof data.filter === 'object';
      if (!hasIds && !hasFilter) {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'docs' requires either non-empty 'doc_ids' (uuid[]) or a 'filter' object.`,
          node_id: client_node_id,
        });
      }
      if (data.instruction !== undefined && typeof data.instruction !== 'string') {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' has a non-string 'instruction'.`,
          node_id: client_node_id,
        });
      }
      break;
    }
    case 'instruction': {
      if (typeof data.text !== 'string' || data.text.trim().length === 0) {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'instruction' requires non-empty 'text' in data.`,
          node_id: client_node_id,
        });
      }
      break;
    }
    case 'decision': {
      // Phase 9.4 shape: { question: string, branches: Record<string,null>, default_branch: string }
      if (typeof data.question !== 'string' || !(data.question as string).trim()) {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'decision' requires a non-empty 'question' string in data.`,
          node_id: client_node_id,
        });
      }
      if (
        !data.branches ||
        typeof data.branches !== 'object' ||
        Array.isArray(data.branches) ||
        Object.keys(data.branches as object).length === 0
      ) {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'decision' requires a non-empty 'branches' object in data.`,
          node_id: client_node_id,
        });
      }
      if (typeof data.default_branch !== 'string') {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'decision' requires a 'default_branch' string in data.`,
          node_id: client_node_id,
        });
      }
      break;
    }
    case 'capture': {
      // A capture node is a design-time slot an agent fills at runtime by
      // producing a doc (Phase 1: read-only shape; the write tool arrives Phase 2).
      if (typeof data.title_hint !== 'string' || !(data.title_hint as string).trim()) {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'capture' requires a non-empty 'title_hint' string in data.`,
          node_id: client_node_id,
        });
      }
      if (typeof data.instruction !== 'string' || !(data.instruction as string).trim()) {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'capture' requires a non-empty 'instruction' string in data.`,
          node_id: client_node_id,
        });
      }
      if (
        data.target_folder_id !== undefined &&
        (typeof data.target_folder_id !== 'string' || !UUID_RE.test(data.target_folder_id))
      ) {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'capture' has an invalid 'target_folder_id' (must be a uuid).`,
          node_id: client_node_id,
        });
      }
      if (data.autonomous !== undefined && typeof data.autonomous !== 'boolean') {
        errors.push({
          code: 'invalid_node_data',
          message: `Node '${client_node_id}' of kind 'capture' has a non-boolean 'autonomous'.`,
          node_id: client_node_id,
        });
      }
      break;
    }
  }

  return errors;
}
