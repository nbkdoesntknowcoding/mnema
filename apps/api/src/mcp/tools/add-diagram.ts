/**
 * MCP tool: `add_diagram` (Diagram Phase 1, Sprint 1).
 *
 * Lets Claude (and users) author a diagram into a doc — a mermaid diagram or a sanitized inline
 * SVG — that renders in-app and exports to PDF. It's a THIN wrapper over propose_doc_write: it wraps
 * the source in a fenced ```mermaid / ```svg block and appends it through the EXACT same
 * propose/commit safety (preview + Approve), so it's never a silent write and there's no
 * storage-model change (the block is plain markdown, round-trips byte-faithful via get_doc).
 *
 * Visibility: ["model"] (registered via registerProposeTool in server.ts, like the other propose_*).
 */
import { z } from 'zod';
import type { McpAuthContext } from '../auth.js';
import { proposeDocWrite, type ProposeDocWriteResult } from './propose-doc-write.js';
import { fenceDiagram } from './diagram-fence.js';

export const ADD_DIAGRAM_TOOL_NAME = 'add_diagram';

export const ADD_DIAGRAM_TOOL_SPEC = {
  name: ADD_DIAGRAM_TOOL_NAME,
  description: [
    'Add a diagram to a doc. The diagram renders in-app and exports to PDF.',
    '',
    'SVG IS THE DEFAULT AND PREFERRED FORMAT — author a clean, sanitized inline SVG figure (it is',
    'sanitized: no script/handlers/foreignObject/iframe). Use mermaid ONLY when the user explicitly',
    'asks for a mermaid diagram, or when the content is inherently a mermaid type (e.g. a sequence',
    'diagram). When format is omitted it defaults to svg.',
    '',
    'It appends a fenced ```svg (or ```mermaid) block through the SAME preview/approve flow as',
    'propose_doc_write — the commit only fires when the user approves.',
    '',
    'IN CLAUDE CODE / CLI (no panel): show the proposed block, ask the user to approve, then call',
    'confirm_doc_write with the proposal_token. Do NOT confirm without explicit approval.',
    '',
    'REQUIRES: workspace:write scope.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_id: { type: 'string', description: 'UUID of the target doc.' },
      format: { type: 'string', enum: ['svg', 'mermaid'], description: 'Diagram format. Defaults to svg (preferred); use mermaid only when explicitly requested.' },
      source: { type: 'string', description: 'The diagram source — raw SVG markup (preferred), or mermaid text.' },
      after_anchor: { type: 'string', description: 'Optional anchor id to insert after (Phase 1 appends at the end).' },
    },
    required: ['doc_id', 'source'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Add a diagram (with preview)' },
};

const argsSchema = z.object({
  doc_id: z.string().uuid(),
  format: z.enum(['svg', 'mermaid']).default('svg'),   // Build 3: SVG-first — mermaid only on request
  source: z.string().min(1).max(100_000),   // 100KB cap; stored unmangled in the fenced block
  after_anchor: z.string().min(1).max(64).optional(),
}).strict();

export async function addDiagram(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<ProposeDocWriteResult> {
  const args = argsSchema.parse(rawArgs);
  const markdown = fenceDiagram(args.format, args.source);
  // Reuse propose_doc_write's append (token + preview + Approve). after_anchor is accepted for
  // forward-compat but Phase 1 appends at the end; the user still approves before commit.
  return proposeDocWrite(ctx, { operation: 'append', doc_id: args.doc_id, markdown });
}
