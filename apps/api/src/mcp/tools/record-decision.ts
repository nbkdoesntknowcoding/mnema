/**
 * MCP tool: `record_decision` — Decision Memory MD1 / STEP 2.
 *
 * The missing NON-MEETING entry point. Records a decision (engineering, chat, a doc edit —
 * anything not spoken in a recorded meeting) as a durable, dated, first-class `decision`
 * graph node + a searchable Decision doc, with supersede-by-invalidation. `decided_at` is
 * server-set (never client). Idempotent on (project, text).
 */
import { z } from 'zod';
import type { McpAuthContext } from '../auth.js';
import { requireWriteScope } from '../scope.js';
import { withAudit } from './audit.js';
import { recordDecision } from '../../lib/decisions.js';

export const RECORD_DECISION_TOOL = {
  name: 'record_decision',
  description: [
    'Record a decision so it becomes durable, dated, and retrievable — the entry point for any',
    'decision NOT made in a recorded meeting (an engineering/code decision, a choice made in chat,',
    'a doc edit). Creates a first-class `decision` graph node (dated, status=current) plus a',
    'searchable Decision doc, and umbrella-connects to related work on the next graph rebuild.',
    'When this decision REPLACES an earlier one, pass `supersedes` = that decision node id; the old',
    'decision is kept, marked historical, and linked (never deleted). `decided_at` is set by the',
    'server. Use this whenever a decision is settled outside a meeting so the memory stays current.',
  ].join(' '),
  inputSchema: {
    type: 'object' as const,
    properties: {
      decision_text: { type: 'string', description: 'The decision statement, e.g. "TTS provider is Inworld, superseding ElevenLabs".' },
      project_id: { type: 'string', description: 'Optional project UUID to scope the decision to. Omit for a workspace-wide decision.' },
      supersedes: { type: 'string', description: 'Optional graph-node id of the decision this one replaces (it will be marked historical and linked).' },
      decided_in: { type: 'string', description: 'Optional meeting UUID, if the decision came from a meeting.' },
    },
    required: ['decision_text'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Record decision' },
};

const argsSchema = z.object({
  decision_text: z.string().min(1),
  project_id: z.string().uuid().optional(),
  supersedes: z.string().uuid().optional(),
  decided_in: z.string().uuid().optional(),
});

export async function recordDecisionTool(ctx: McpAuthContext, rawArgs: Record<string, unknown>) {
  requireWriteScope(ctx);
  const parsed = argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { content: `Invalid arguments: ${parsed.error.message}`, structuredContent: { error: 'invalid_args' } };
  }
  const args = parsed.data;

  return await withAudit(
    ctx,
    { tool_name: RECORD_DECISION_TOOL.name, args: args as Record<string, unknown> },
    async () => {
      try {
        const res = await recordDecision(ctx.tenant_id, {
          decisionText: args.decision_text,
          projectId: args.project_id ?? null,
          supersedes: args.supersedes ?? null,
          decidedIn: args.decided_in ?? null,
        });
        const supersedeNote = res.supersededOldId ? ` It supersedes decision ${res.supersededOldId} (now historical).` : '';
        return {
          content: `Recorded the decision as a current decision node (${res.nodeId}) + doc (${res.docId}).${supersedeNote}`,
          structuredContent: {
            decision_node_id: res.nodeId, doc_id: res.docId, entity_id: res.entityId,
            status: res.status, superseded_old_id: res.supersededOldId ?? null,
          },
        };
      } catch (e) {
        return { content: `Could not record the decision: ${(e as Error).message}`, structuredContent: { error: 'record_failed', message: (e as Error).message } };
      }
    },
    (result) => {
      const sc = (result?.structuredContent ?? {}) as Record<string, unknown>;
      return { decision_node_id: sc.decision_node_id ?? null, error: sc.error ?? null };
    },
  );
}
