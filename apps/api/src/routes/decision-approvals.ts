/**
 * Phase 3b — decision approvals API (SIBLING to the doc access-requests routes; the ACL path is
 * untouched). PATCH confirms or rejects a meeting-proposed decision. Authorization is PROPOSER ONLY
 * (decision_approvals.proposerId === the caller) — stricter than the doc handler's owner-or-admin.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { decisionApprovals, graphNodes, meetings } from '../db/schema.js';
import { confirmDecisionApproval, rejectDecisionApproval } from '../lib/decision-approvals.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const decisionApprovalsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/decision-approvals?box=incoming|outgoing — the inbox. incoming = approvals routed to me
  // (I'm the proposer → I confirm/reject). outgoing = ones I've resolved. Decision-row shape (NOT
  // the AccessRequest shape): decision text + its meeting + doc link.
  app.get<{ Querystring: { box?: string } }>('/api/decision-approvals', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const box = req.query.box === 'outgoing' ? 'outgoing' : 'incoming';
    const mine = box === 'outgoing' ? decisionApprovals.resolvedBy : decisionApprovals.proposerId;
    const rows = await db
      .select({
        id: decisionApprovals.id,
        decision_node_id: decisionApprovals.decisionNodeId,
        doc_id: decisionApprovals.docId,
        status: decisionApprovals.status,
        created_at: decisionApprovals.createdAt,
        resolved_at: decisionApprovals.resolvedAt,
        decision_text: graphNodes.decisionText,
        decision_label: graphNodes.label,
        meeting_title: meetings.title,
      })
      .from(decisionApprovals)
      .leftJoin(graphNodes, eq(graphNodes.id, decisionApprovals.decisionNodeId))
      .leftJoin(meetings, eq(meetings.id, decisionApprovals.meetingId))
      .where(and(eq(mine, req.auth.sub), eq(decisionApprovals.workspaceId, req.auth.tenant_id)))
      .orderBy(desc(decisionApprovals.createdAt))
      .limit(100);
    return reply.send({ box, approvals: rows });
  });

  app.patch<{ Params: { id: string }; Body: { action: 'confirm' | 'reject' } }>(
    '/api/decision-approvals/:id',
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
      const { id } = req.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'bad_id' });
      const action = req.body?.action;
      if (action !== 'confirm' && action !== 'reject') return reply.code(400).send({ error: 'bad_action' });

      const appr = await db.query.decisionApprovals.findFirst({
        where: and(
          eq(decisionApprovals.id, id),
          eq(decisionApprovals.workspaceId, req.auth.tenant_id),
          eq(decisionApprovals.status, 'pending'),
        ),
      });
      if (!appr) return reply.code(404).send({ error: 'not_found' });
      // PROPOSER-ONLY: only the person the decision was routed to may confirm/reject it.
      if (appr.proposerId !== req.auth.sub) {
        return reply.code(403).send({ error: 'only_proposer_can_resolve' });
      }

      try {
        const res = action === 'confirm'
          ? await confirmDecisionApproval(req.auth.tenant_id, id, req.auth.sub)
          : await rejectDecisionApproval(req.auth.tenant_id, id, req.auth.sub);
        return reply.send(res);
      } catch (e) {
        return reply.code(409).send({ error: 'resolve_failed', message: e instanceof Error ? e.message : String(e) });
      }
    },
  );
};
