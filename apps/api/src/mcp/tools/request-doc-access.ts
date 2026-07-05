/**
 * MCP tool: `request_doc_access`.
 *
 * FIX 6 — when the current speaker is denied a doc, the bot can file an access
 * request on their behalf. The act-as identity from the MCP plugin means the
 * request is recorded under the SPEAKER (ctx.user_id), routed to the doc owner.
 *
 * Deliberately NOT gated by workspace:write — the whole point is to let an
 * unprivileged / denied person ask. A guest (unidentified speaker, ctx.user_id
 * null) cannot file a request. Reads only the doc's title + owner (never content)
 * via system privilege, since the speaker has no access to the doc itself.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { docAccessRequests, docs, notifications, users } from '../../db/schema.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import type { McpAuthContext } from '../auth.js';
import { withAudit } from './audit.js';

export const REQUEST_DOC_ACCESS_TOOL = {
  name: 'request_doc_access',
  description: [
    'Request access to a document the current speaker cannot see. Files the request',
    'under the speaker and notifies the document owner, who can approve or deny.',
    'Use this when someone asks to see a doc they are not permitted to open.',
    'REQUIRES: an identified speaker (a guest cannot request access).',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_id: { type: 'string', description: 'The UUID of the document to request access to.' },
      message: { type: 'string', description: 'Optional message to the owner explaining why.' },
      permission: { type: 'string', enum: ['read', 'write'], description: "Access level requested. Defaults to 'read'." },
    },
    required: ['doc_id'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Request document access' },
};

const argsSchema = z.object({
  doc_id: z.string().uuid(),
  message: z.string().max(2000).optional(),
  permission: z.enum(['read', 'write']).optional(),
}).strict();

export interface RequestDocAccessResult {
  requested?: boolean;
  doc_title?: string;
  error?: string;
  message?: string;
}

export async function requestDocAccess(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<RequestDocAccessResult> {
  const args = argsSchema.parse(rawArgs);
  const permission = args.permission ?? 'read';

  if (!ctx.user_id) {
    return {
      error: 'not_identified',
      message: "I can't request access for you because I don't have you identified in this workspace.",
    };
  }

  return await withAudit(
    ctx,
    { tool_name: REQUEST_DOC_ACCESS_TOOL.name, args: args as Record<string, unknown> },
    async (): Promise<RequestDocAccessResult> => {
      // Read title + owner via system privilege (the speaker has no access to the doc).
      const [doc] = await withSystemPrivilege((tx) =>
        tx.select({ id: docs.id, title: docs.title, createdBy: docs.createdBy })
          .from(docs)
          .where(and(eq(docs.id, args.doc_id), eq(docs.workspaceId, ctx.tenant_id)))
          .limit(1),
      );
      if (!doc) return { error: 'not_found', message: 'No such document in this workspace.' };

      const recipientId = doc.createdBy;
      if (!recipientId) return { error: 'no_owner', message: 'This document has no owner to route the request to.' };

      const [created] = await withSystemPrivilege((tx) =>
        tx.insert(docAccessRequests).values({
          workspaceId: ctx.tenant_id,
          docId: args.doc_id,
          requesterId: ctx.user_id,
          requestedFromId: recipientId,
          message: args.message ?? null,
          permission,
        }).onConflictDoNothing().returning({ id: docAccessRequests.id }),
      );

      if (created && recipientId !== ctx.user_id) {
        const [requester] = await withSystemPrivilege((tx) =>
          tx.select({ name: users.displayName, email: users.email })
            .from(users).where(eq(users.id, ctx.user_id)).limit(1),
        );
        const who = requester?.name || requester?.email || 'A teammate';
        await withSystemPrivilege((tx) =>
          tx.insert(notifications).values({
            workspaceId: ctx.tenant_id,
            recipientId,
            actorId: ctx.user_id,
            kind: 'access_request',
            title: `Access request: ${doc.title}`,
            body: `${who} is requesting ${permission} access.`,
            link: `/app/docs/${args.doc_id}`,
          }),
        );
      }

      return { requested: true, doc_title: doc.title };
    },
    (r) => ({ requested: r.requested ?? null, error: r.error ?? null }),
  );
}
