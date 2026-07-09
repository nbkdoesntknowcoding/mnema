/**
 * Portable flow template schema + validator (Community Flows — Phase 0, P0-3).
 *
 * This is the trust boundary for templates crossing between workspaces and
 * instances. It runs at the hub publish-ingest (P1-4) AND at import (P2-3) so
 * a malicious or malformed template can never create bad flow rows.
 *
 * Forward-compat rule: only SCHEMA_VERSION is accepted. An unknown future
 * version is rejected with `unsupported_schema_version` so an older instance
 * refuses (rather than mangles) a newer format.
 */
import { z } from 'zod';
import { SCHEMA_VERSION, type PortableFlowTemplate } from './portability.js';

/** Hard cap on serialised template size to bound abuse (256 KB). */
export const MAX_TEMPLATE_BYTES = 256 * 1024;
/** Max tags per template. */
export const MAX_TAGS = 10;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const portableNodeSchema = z.object({
  clientNodeId: z.string().min(1).max(128),
  kind: z.enum(['doc', 'docs', 'instruction', 'decision', 'capture']),
  title: z.string().max(500),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  data: z.record(z.unknown()),
});

const portableEdgeSchema = z.object({
  fromNodeId: z.string().min(1).max(128),
  toNodeId: z.string().min(1).max(128),
  fromSocket: z.string().max(128),
});

export const portableTemplateSchema = z.object({
  schemaVersion: z.number().int(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  tags: z.array(z.string().min(1).max(40)).max(MAX_TAGS),
  nodes: z.array(portableNodeSchema).min(1),
  edges: z.array(portableEdgeSchema),
});

export interface TemplateValidationError {
  code:
    | 'schema_shape'
    | 'unsupported_schema_version'
    | 'oversize'
    | 'uuid_in_node_data'
    | 'duplicate_client_node_id'
    | 'edge_unknown_node';
  message: string;
}

export type ValidateTemplateResult =
  | { ok: true; template: PortableFlowTemplate }
  | { ok: false; errors: TemplateValidationError[] };

/** Recursively test whether any string anywhere in a value looks like a UUID. */
function containsUuid(value: unknown): boolean {
  if (typeof value === 'string') return UUID_RE.test(value);
  if (Array.isArray(value)) return value.some(containsUuid);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(containsUuid);
  return false;
}

/**
 * Validate an untrusted template. Returns the typed template on success, or a
 * list of specific errors on failure. Never throws.
 */
export function validateTemplate(input: unknown): ValidateTemplateResult {
  const errors: TemplateValidationError[] = [];

  // 1. Structural shape.
  const parsed = portableTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [{ code: 'schema_shape', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }],
    };
  }
  const template = parsed.data as PortableFlowTemplate;

  // 2. Version.
  if (template.schemaVersion !== SCHEMA_VERSION) {
    errors.push({
      code: 'unsupported_schema_version',
      message: `Template schemaVersion ${template.schemaVersion} is not supported (expected ${SCHEMA_VERSION}).`,
    });
  }

  // 3. Size cap.
  const bytes = Buffer.byteLength(JSON.stringify(template), 'utf8');
  if (bytes > MAX_TEMPLATE_BYTES) {
    errors.push({ code: 'oversize', message: `Template is ${bytes} bytes; max is ${MAX_TEMPLATE_BYTES}.` });
  }

  // 4. Defence-in-depth: no workspace UUIDs may survive inside node data.
  for (const node of template.nodes) {
    if (containsUuid(node.data)) {
      errors.push({
        code: 'uuid_in_node_data',
        message: `Node '${node.clientNodeId}' data contains a UUID-shaped value — workspace ids must be stripped before publish.`,
      });
    }
  }

  // 5. Unique client node ids.
  const seen = new Set<string>();
  for (const node of template.nodes) {
    if (seen.has(node.clientNodeId)) {
      errors.push({ code: 'duplicate_client_node_id', message: `Duplicate clientNodeId '${node.clientNodeId}'.` });
    }
    seen.add(node.clientNodeId);
  }

  // 6. Edges reference existing nodes.
  for (const edge of template.edges) {
    if (!seen.has(edge.fromNodeId)) {
      errors.push({ code: 'edge_unknown_node', message: `Edge from unknown node '${edge.fromNodeId}'.` });
    }
    if (!seen.has(edge.toNodeId)) {
      errors.push({ code: 'edge_unknown_node', message: `Edge to unknown node '${edge.toNodeId}'.` });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, template };
}
