/**
 * Flow portability (Community Flows — Phase 0, tasks P0-1 / P0-2).
 *
 * `sanitizeFlowForPublish` converts a workspace-bound flow graph into a
 * portable template that carries NO workspace-scoped IDs and NO private
 * content, so it can be published to the community hub and imported into any
 * other workspace — or any other Mnema instance.
 *
 * `rehydrateFlowFromTemplate` is the inverse: it turns a template back into the
 * node/edge rows for a new *local* draft flow, leaving workspace bindings
 * (doc_id / doc_ids / target_folder_id) empty for the importer to re-bind.
 *
 * Privacy guarantee: referenced doc/folder CONTENT never travels — only a
 * node's structural intent (title + instruction). Enforced by dropping every
 * workspace id and asserted by the leak-guard test (P0-5).
 *
 * Unbound nodes carry a `data.requiresBinding` marker (one of BindingKind).
 * That marker doubles as (a) the UI "needs binding" signal and (b) the future
 * draft-tolerant validation signal — a doc/docs/capture node with a
 * requiresBinding marker and no id is a legal DRAFT, but must be resolved
 * before publish. See validate.ts for the enforcement side (Phase 2).
 */
import type { FlowNode, FlowEdge, FlowNodeKind } from './validate.js';

/** Current portable-template wire version. Bump on any breaking format change. */
export const SCHEMA_VERSION = 1;

/** Which local resource an imported node must be bound to before publish. */
export type BindingKind = 'doc' | 'docs' | 'capture-folder';

export interface PortableNode {
  clientNodeId: string;
  kind: FlowNodeKind;
  title: string;
  positionX: number;
  positionY: number;
  /** Portable, workspace-free node config. Carries `requiresBinding` when the
   *  node needs a local resource re-bound after import. */
  data: Record<string, unknown>;
}

export interface PortableEdge {
  fromNodeId: string;
  toNodeId: string;
  fromSocket: string;
}

export interface PortableFlowTemplate {
  schemaVersion: number;
  name: string;
  description: string | null;
  tags: string[];
  nodes: PortableNode[];
  edges: PortableEdge[];
}

export interface FlowTemplateMeta {
  name: string;
  description?: string | null;
  tags?: string[];
}

export interface UnboundNode {
  clientNodeId: string;
  kind: FlowNodeKind;
  requiresBinding: BindingKind;
}

export interface RehydratedFlow {
  name: string;
  description: string | null;
  /** Node rows ready to insert into a new local draft version (snake_case to
   *  match the flows lib / DB mapping). */
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Nodes whose workspace binding was stripped and must be re-bound locally. */
  unboundNodes: UnboundNode[];
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function looksLikeUuid(v: unknown): boolean {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Deep-clone a value with a stable (sorted) key order so sanitize output is
 *  byte-deterministic regardless of input key ordering. */
function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => canonical(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

/** Defensive backstop for unknown node kinds: drop any key ending in _id/_ids
 *  and any UUID-valued string, recursively. Known kinds are handled explicitly
 *  below and never reach this. */
function stripWorkspaceIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => !looksLikeUuid(v)).map(stripWorkspaceIds);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (/_id$|_ids$/.test(key)) continue;
      if (looksLikeUuid(v)) continue;
      out[key] = stripWorkspaceIds(v);
    }
    return out;
  }
  return value;
}

/** Produce the portable `data` for one node, stripping workspace bindings and
 *  tagging with a requiresBinding marker where re-binding is needed. */
function sanitizeNodeData(kind: FlowNodeKind, data: Record<string, unknown>): Record<string, unknown> {
  switch (kind) {
    case 'instruction': {
      // Pure text — fully portable.
      const text = typeof data.text === 'string' ? data.text : '';
      return { text };
    }
    case 'decision': {
      // Pure branching logic — fully portable.
      return {
        question: typeof data.question === 'string' ? data.question : '',
        branches: canonical(data.branches ?? {}),
        default_branch: typeof data.default_branch === 'string' ? data.default_branch : '',
      };
    }
    case 'doc': {
      // Drop doc_id; keep the instruction that describes what the doc is for.
      const out: Record<string, unknown> = { requiresBinding: 'doc' as BindingKind };
      if (typeof data.instruction === 'string') out.instruction = data.instruction;
      return out;
    }
    case 'docs': {
      // Drop concrete doc_ids; keep a type filter (portable) + instruction.
      const out: Record<string, unknown> = { requiresBinding: 'docs' as BindingKind };
      if (data.filter && typeof data.filter === 'object' && !Array.isArray(data.filter)) {
        // filter.type is a portable doc-type string; strip any stray ids defensively.
        out.filter = stripWorkspaceIds(data.filter);
      }
      if (typeof data.instruction === 'string') out.instruction = data.instruction;
      return out;
    }
    case 'capture': {
      // Drop target_folder_id (optional local folder); keep authoring intent.
      const out: Record<string, unknown> = {
        requiresBinding: 'capture-folder' as BindingKind,
        title_hint: typeof data.title_hint === 'string' ? data.title_hint : '',
        instruction: typeof data.instruction === 'string' ? data.instruction : '',
      };
      if (typeof data.autonomous === 'boolean') out.autonomous = data.autonomous;
      return out;
    }
    default: {
      // Unknown/future kind — best-effort strip so nothing workspace-scoped leaks.
      return stripWorkspaceIds(data) as Record<string, unknown>;
    }
  }
}

/**
 * Convert a workspace flow (its published-version graph) into a portable
 * template. Pure — no DB access. Output contains no source-workspace UUIDs.
 */
export function sanitizeFlowForPublish(
  nodes: FlowNode[],
  edges: FlowEdge[],
  meta: FlowTemplateMeta,
): PortableFlowTemplate {
  const portableNodes: PortableNode[] = nodes.map((n) => ({
    clientNodeId: n.client_node_id,
    kind: n.kind,
    title: n.title,
    positionX: n.position_x,
    positionY: n.position_y,
    data: canonical(sanitizeNodeData(n.kind, n.data ?? {})),
  }));

  const portableEdges: PortableEdge[] = edges.map((e) => ({
    fromNodeId: e.from_node_id,
    toNodeId: e.to_node_id,
    fromSocket: e.from_socket,
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    name: meta.name,
    description: meta.description ?? null,
    tags: (meta.tags ?? []).slice(),
    nodes: portableNodes,
    edges: portableEdges,
  };
}

/** Read the requiresBinding marker off a portable node's data, if present. */
function bindingOf(data: Record<string, unknown>): BindingKind | null {
  const rb = data.requiresBinding;
  return rb === 'doc' || rb === 'docs' || rb === 'capture-folder' ? rb : null;
}

/**
 * Turn a portable template into the rows for a new *local* draft flow. Pure —
 * no DB access. Unbound nodes keep their requiresBinding marker and are also
 * returned in `unboundNodes` so the import route + UI can prompt re-binding.
 *
 * Throws on an unsupported schemaVersion — callers should surface a
 * "please upgrade" message rather than silently importing a format they don't
 * understand.
 */
export function rehydrateFlowFromTemplate(template: PortableFlowTemplate): RehydratedFlow {
  if (template.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported flow template schemaVersion ${template.schemaVersion} (this instance supports ${SCHEMA_VERSION}). Please upgrade.`,
    );
  }

  const nodes: FlowNode[] = template.nodes.map((n) => ({
    client_node_id: n.clientNodeId,
    kind: n.kind,
    title: n.title,
    position_x: n.positionX,
    position_y: n.positionY,
    data: { ...n.data },
  }));

  const edges: FlowEdge[] = template.edges.map((e) => ({
    from_node_id: e.fromNodeId,
    to_node_id: e.toNodeId,
    from_socket: e.fromSocket,
  }));

  const unboundNodes: UnboundNode[] = [];
  for (const n of template.nodes) {
    const binding = bindingOf(n.data);
    if (binding) unboundNodes.push({ clientNodeId: n.clientNodeId, kind: n.kind, requiresBinding: binding });
  }

  return {
    name: template.name,
    description: template.description ?? null,
    nodes,
    edges,
    unboundNodes,
  };
}
